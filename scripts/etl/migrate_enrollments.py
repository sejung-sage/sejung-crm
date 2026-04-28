"""
세정학원 CRM · 수강 이력(enrollments) 마이그레이션 (Phase 2).

흐름:
  1. Supabase 의 students 에서 (aca2000_id → id) 매핑 사전 로드
  2. 4분원 V_student_class_list 추출
  3. (학원_코드, 학생_코드) 로 학생 매칭 → 우리 enrollments 변환
  4. aca_enrollment_id 기준 UPSERT (idempotent)

매핑 (V_student_class_list → public.enrollments):
  수강이력_코드 → aca_enrollment_id ("{branch_id}-{수강이력_코드}")
  학생_코드+학원_코드 → student_id (lookup students.aca2000_id)
  반명         → course_name (REQUIRED · 빈값 skip)
  시작일       → start_date
  종료일       → end_date
  반수강료     → amount (NULL → 0)
  (없음)       → paid_at = NULL (추후 V_Pay_List 매칭)
  (없음)       → subject = NULL (추후 V_class_list 매칭)
  (없음)       → teacher_name = NULL (추후 V_Ticket 의 담당강사_목록)

실행:
  source .venv/bin/activate
  ONLY_BRANCH=80205 DRY_RUN=1 python scripts/etl/migrate_enrollments.py
  DRY_RUN=0 python scripts/etl/migrate_enrollments.py
"""

from __future__ import annotations

import os
import re
import sys
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
def fetch_enrollments(db_config: dict) -> list[dict]:
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
                수강이력_코드,
                학생_코드,
                반명,
                시작일,
                종료일,
                반수강료,
                학원_코드
            FROM dbo.V_student_class_list
            """
        )
        return list(cur.fetchall())
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(
    row: dict, branch_id: str, student_id_map: dict[str, str]
) -> dict | None:
    course_name = clean_text(row.get("반명"), max_len=100)
    if not course_name:
        return None  # course_name NOT NULL

    enroll_code = row.get("수강이력_코드")
    if enroll_code is None:
        return None
    aca_enrollment_id = f"{branch_id}-{enroll_code}"

    student_code = row.get("학생_코드")
    if student_code is None:
        return None
    student_aca_id = f"{branch_id}-{student_code}"
    student_id = student_id_map.get(student_aca_id)
    if not student_id:
        return None  # 학생 매핑 실패 (학생 마이그 시 skip 된 행 등)

    return {
        "aca_enrollment_id": aca_enrollment_id,
        "student_id": student_id,
        "course_name": course_name,
        "teacher_name": None,  # 추후 V_Ticket 매칭
        "subject": None,  # 우리 CHECK 제약 ('수학','국어','영어','탐구') 외 값은 못 받음
        "amount": to_int(row.get("반수강료"), 0),
        "paid_at": None,
        "start_date": to_iso_date(row.get("시작일")),
        "end_date": to_iso_date(row.get("종료일")),
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("enrollments")
            .upsert(batch, on_conflict="aca_enrollment_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 수강이력 마이그레이션 · DRY_RUN={DRY_RUN} · "
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
            rows = fetch_enrollments(db)
        except Exception as e:
            print(f"   ❌ 추출 실패: {e}")
            continue
        print(f"   raw: {len(rows):,}건")

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
            f"(course_name 누락 / 학생 매칭 실패 / 코드 누락)"
        )

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                print(
                    f"   sample: aca_enrollment_id={s['aca_enrollment_id']} "
                    f"course={s['course_name'][:20]}*** amount={s['amount']:,} "
                    f"start={s['start_date']} end={s['end_date']}"
                )
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
