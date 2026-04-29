"""
세정학원 CRM · 출결 이력(attendances) 마이그레이션 (Phase 3).

흐름:
  1. Supabase 의 students 에서 (aca2000_id → id) 매핑 사전 로드
  2. 4분원 V_Attend_List 추출 (필요한 5개 컬럼만 SELECT)
  3. (학원_코드, 학생_코드) 로 학생 매칭 → 우리 attendances 변환
  4. aca_attendance_id 기준 UPSERT (idempotent)

매핑 (V_Attend_List → public.attendances):
  출결_코드 + 학원_코드 → aca_attendance_id ("{branch_id}-{출결_코드}")
  학생_코드 + 학원_코드 → student_id (lookup students.aca2000_id)
  출결일               → attended_at (NOT NULL · NULL 이면 skip)
  구분                 → status ("출석"/"지각"/"결석"/"조퇴"/"보강" 외 값은 skip)
  반고유_코드          → aca_class_id ("{branch_id}-{반고유_코드}" · None/0 이면 None)
  enrollment_id        → None 고정 (추후 별도 보강 마이그레이션에서 처리)

skip 사유:
  - 출결_코드 None
  - 학생_코드 None / students 매핑 실패
  - 출결일 None (attended_at NOT NULL)
  - 구분이 우리 CHECK 제약 5종("출석"/"지각"/"결석"/"조퇴"/"보강") 외 값
  (반고유_코드 누락은 skip 사유 아님 — aca_class_id=None 으로 통과)

DRY_RUN 출력:
  - sample 1건
  - 구분(status) 분포 dict (어떤 표기가 들어오는지 확인용 — 우리 5종 외 값은
    skip 사유로 노출되니 사용자가 매핑 확장 결정에 사용)

실행:
  source .venv/bin/activate
  ONLY_BRANCH=80205 DRY_RUN=1 python scripts/etl/migrate_attendances.py
  DRY_RUN=0 python scripts/etl/migrate_attendances.py
"""

from __future__ import annotations

import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import pymssql  # type: ignore
from dotenv import load_dotenv
from supabase import create_client  # type: ignore

# ─── env ──────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent.parent
for env_path in [Path(__file__).parent / ".env", PROJECT_ROOT / ".env.local"]:
    if env_path.exists():
        load_dotenv(env_path, override=False)

USER = os.getenv("ACA_MSSQL_USER", "sejung_user")
PASSWORD = os.getenv("ACA_MSSQL_PASSWORD", "")
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SECRET = (
    os.getenv("SUPABASE_SECRET_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)
DRY_RUN = os.getenv("DRY_RUN", "1") == "1"
ONLY_BRANCH = os.getenv("ONLY_BRANCH", "").strip() or None
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "500"))

if not PASSWORD:
    print("❌ ACA_MSSQL_PASSWORD 누락")
    sys.exit(1)
if not (SUPABASE_URL and SUPABASE_SECRET):
    print("❌ SUPABASE_URL / SUPABASE_SECRET_KEY 누락")
    sys.exit(1)

DATABASES = [
    {"branch_name": "방배", "branch_id": "80205",
     "server": "117.52.92.212", "port": 14333, "database": "db31191"},
    {"branch_name": "대치", "branch_id": "78031",
     "server": "117.52.92.211", "port": 14333, "database": "db777164"},
    {"branch_name": "반포", "branch_id": "85489",
     "server": "117.52.92.211", "port": 14333, "database": "db777165"},
    {"branch_name": "송도", "branch_id": "85491",
     "server": "117.52.92.211", "port": 14333, "database": "db777166"},
]

# attendances.status CHECK 제약 (0018 마이그레이션에서 4종 → 5종 확장).
# 이 5종 외 값은 무조건 skip — 임의 매핑 추가 금지.
ALLOWED_STATUS = {"출석", "지각", "결석", "조퇴", "보강"}


# ─── 헬퍼 ─────────────────────────────────────────────────
def clean_text(raw: Any, max_len: int | None = None) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    return s[:max_len] if max_len else s


def to_iso_date(raw: Any) -> str | None:
    """datetime/smalldatetime → 'YYYY-MM-DD'. NULL/빈값 → None."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.strftime("%Y-%m-%d")
    s = str(raw).strip()
    if not s:
        return None
    # 이미 ISO 형태일 수 있음
    return s[:10]


def to_int(raw: Any, default: int = 0) -> int:
    if raw is None:
        return default
    try:
        return int(raw)
    except (ValueError, TypeError):
        return default


_PII_PATTERN = re.compile(r"\(([^)]*)\)=\(([^)]*)\)")


def _mask_error(msg: str) -> str:
    return _PII_PATTERN.sub(lambda m: f"({m.group(1)})=(***)", msg)[:200]


# ─── 학생 lookup 사전 로드 ───────────────────────────────
def load_student_id_map(supabase) -> dict[str, str]:
    """students.aca2000_id → students.id 매핑 사전.

    Supabase row limit 1000/req. 페이지네이션으로 전체 100K 로드.
    """
    print("📥 students aca2000_id → id 매핑 로드 중...")
    mapping: dict[str, str] = {}
    page_size = 1000
    offset = 0
    while True:
        res = (
            supabase.table("students")
            .select("id, aca2000_id")
            .not_.is_("aca2000_id", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            aca = r.get("aca2000_id")
            sid = r.get("id")
            if aca and sid:
                mapping[aca] = sid
        if len(rows) < page_size:
            break
        offset += page_size
    print(f"   학생 매핑 {len(mapping):,}건 로드 완료")
    return mapping


# ─── 추출 ─────────────────────────────────────────────────
def fetch_attendances(db_config: dict) -> list[dict]:
    """V_Attend_List 에서 우리에게 필요한 6개 컬럼만 추출.

    원본 뷰는 학생명/HP_부모/학교/학년/처리자/강사명/과목명/요일/시간 등
    수십 개 컬럼이 있으나 attendances 테이블에는 매핑되지 않으므로 SELECT
    절에서 제외해 네트워크 비용을 줄인다.
    """
    conn = pymssql.connect(
        server=db_config["server"],
        port=db_config["port"],
        user=USER,
        password=PASSWORD,
        database=db_config["database"],
        timeout=60,
        charset="UTF-8",
    )
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """
            SELECT
                출결_코드,
                학생_코드,
                출결일,
                구분,
                학원_코드,
                반고유_코드
            FROM dbo.V_Attend_List
            """
        )
        return list(cur.fetchall())
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(
    row: dict, branch_id: str, student_id_map: dict[str, str]
) -> dict | None:
    # 출결_코드 (PK 역할) 누락 시 추적 불가 → skip
    attend_code = row.get("출결_코드")
    if attend_code is None:
        return None
    aca_attendance_id = f"{branch_id}-{attend_code}"

    # 학생 매핑 (학생 마이그 시 skip 된 학생의 출결은 자동 skip)
    student_code = row.get("학생_코드")
    if student_code is None:
        return None
    student_aca_id = f"{branch_id}-{student_code}"
    student_id = student_id_map.get(student_aca_id)
    if not student_id:
        return None

    # attended_at NOT NULL
    attended_at = to_iso_date(row.get("출결일"))
    if not attended_at:
        return None

    # status CHECK 제약 ("출석"/"지각"/"결석"/"조퇴"/"보강")
    status = clean_text(row.get("구분"))
    if status not in ALLOWED_STATUS:
        return None

    # 강좌 매칭 키 — 반고유_코드 None/0 이면 None 으로 통과 (skip 아님).
    # int 캐스팅으로 trailing decimal 방어 (보통 int 컬럼).
    class_code = row.get("반고유_코드")
    if class_code is None or to_int(class_code) == 0:
        aca_class_id = None
    else:
        aca_class_id = f"{branch_id}-{to_int(class_code)}"

    return {
        "aca_attendance_id": aca_attendance_id,
        "student_id": student_id,
        "enrollment_id": None,  # 1:1 매칭 보장 안 됨 → 추후 보강
        "attended_at": attended_at,
        "status": status,
        "aca_class_id": aca_class_id,
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("attendances")
            .upsert(batch, on_conflict="aca_attendance_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 출결이력 마이그레이션 · DRY_RUN={DRY_RUN} · "
        f"ONLY_BRANCH={ONLY_BRANCH or 'all'}"
    )
    print("=" * 60)

    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET)

    # 학생 매핑 로드 (DRY_RUN 에서도 lookup 검증 필요)
    student_id_map = load_student_id_map(supabase)
    if not student_id_map:
        print("❌ students 테이블이 비어있음. 먼저 migrate_students.py 실행 필요.")
        sys.exit(1)

    grand = {"raw": 0, "transformed": 0, "skipped": 0, "upserted": 0, "errors": 0}

    for db in DATABASES:
        if ONLY_BRANCH and db["branch_id"] != ONLY_BRANCH:
            continue

        label = f"{db['branch_name']} ({db['branch_id']})"
        print(f"\n📍 {label}")

        try:
            rows = fetch_attendances(db)
        except Exception as e:
            print(f"   ❌ 추출 실패: {e}")
            continue
        print(f"   raw: {len(rows):,}건")

        # 구분(status) 분포 — DRY_RUN 진단용. 우리 5종 외 값이 있으면
        # skip 되니 사용자가 매핑 확장 결정에 사용.
        status_dist: Counter = Counter()
        for r in rows:
            s = clean_text(r.get("구분")) or "(NULL)"
            status_dist[s] += 1

        transformed: list[dict] = []
        skipped = 0
        for r in rows:
            t = transform(r, db["branch_id"], student_id_map)
            if t is None:
                skipped += 1
            else:
                transformed.append(t)
        print(
            f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 "
            f"(출결/학생코드 누락 · 학생 매칭 실패 · 출결일 NULL · 구분 5종 외)"
        )

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                print(
                    f"   sample: aca_attendance_id={s['aca_attendance_id']} "
                    f"student_id={s['student_id']} at={s['attended_at']} "
                    f"status={s['status']} aca_class_id={s['aca_class_id']}"
                )
            print(f"   구분 분포: {dict(status_dist.most_common())}")
            continue

        upserted = 0
        errors = 0
        for i in range(0, len(transformed), BATCH_SIZE):
            chunk = transformed[i : i + BATCH_SIZE]
            n, err = upsert_batch(supabase, chunk)
            if err:
                errors += len(chunk)
                print(f"   ❌ batch {i}: {err}")
            else:
                upserted += n
                if (i // BATCH_SIZE) % 10 == 0 or i + BATCH_SIZE >= len(transformed):
                    print(f"   ✓ batch {i}: {n}건 upsert (누적 {upserted:,})")
        grand["upserted"] += upserted
        grand["errors"] += errors

    print("\n" + "=" * 60)
    print("📊 합계")
    for k, v in grand.items():
        print(f"   {k:<12}: {v:,}")
    if DRY_RUN:
        print("\n⚠️  DRY_RUN=1 — Supabase 에 INSERT 안 함.")
    print("=" * 60)


if __name__ == "__main__":
    main()
