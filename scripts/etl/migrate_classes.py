"""
세정학원 CRM · 강좌 마스터(classes) 마이그레이션 (Phase 2.5).

흐름:
  1. 4분원 V_class_list 추출 (분원당 약 1,597건, 총 ~6,000건)
  2. 우리 schema 의 classes 행으로 변환
  3. aca_class_id 기준 UPSERT (idempotent)

매핑 (V_class_list → public.classes):
  반고유_코드      → aca_class_id ("{branch_id}-{반고유_코드}")
  반명             → name (REQUIRED · 빈값 skip)
  강사명           → teacher_name
  과목명           → subject_raw (원본 보존)
                  → subject (정확 일치만: 수학/국어/영어/탐구)
  청구회차         → total_sessions (NUMERIC, NULL 허용)
  회차당금액       → amount_per_session (INT, NULL 허용)
  반수강료         → total_amount (INT, NULL 허용)
  정원             → capacity (INT, NULL 허용)
  요일             → schedule_days (max_len 50)
  시간             → schedule_time (max_len 50)
  강의관 + 강의실  → classroom (둘 다 있으면 "{강의관} {강의실}", 한쪽만이면 그쪽)
  등록일           → registered_at (YYYY-MM-DD)
  미사용반구분     → active ('Y' 이면 FALSE, 그 외 TRUE)
  학원_코드        → branch (분원명)

실행:
  source scripts/etl/.venv/bin/activate
  ONLY_BRANCH=80205 DRY_RUN=1 python scripts/etl/migrate_classes.py
  DRY_RUN=0 python scripts/etl/migrate_classes.py
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
    """공백 strip 후 빈 문자열이면 None. 선택적으로 max_len 으로 잘라냄."""
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
    return s[:10]


def to_int(raw: Any) -> int | None:
    """NULL 허용 int. 변환 실패 시 None."""
    if raw is None:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


def to_float(raw: Any) -> float | None:
    """NULL 허용 float (decimal → numeric 매핑용). 변환 실패 시 None."""
    if raw is None:
        return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


_PII_PATTERN = re.compile(r"\(([^)]*)\)=\(([^)]*)\)")


def _mask_error(msg: str) -> str:
    """Supabase/PG 에러 메시지의 '(컬럼)=(값)' 형식 PII 마스킹."""
    return _PII_PATTERN.sub(lambda m: f"({m.group(1)})=(***)", msg)[:200]


# ─── subject 정규화 ──────────────────────────────────────
# DB CHECK 제약: subject IN ('수학','국어','영어','탐구') OR NULL.
# 부분 매칭(예: "수학 1", "고등 수학") 하지 않음 — 보수적으로 정확 일치만.
_ALLOWED_SUBJECTS = {"수학", "국어", "영어", "탐구"}


def normalize_subject(raw: Any) -> str | None:
    """과목명 raw 가 정확히 4종 중 하나면 그 값, 아니면 None."""
    s = clean_text(raw)
    if s is None:
        return None
    return s if s in _ALLOWED_SUBJECTS else None


# ─── classroom 합치기 ────────────────────────────────────
def merge_classroom(hall_raw: Any, room_raw: Any) -> str | None:
    """강의관 + 강의실 합치기.
    - 둘 다 있으면 "{강의관} {강의실}"
    - 한쪽만 있으면 그쪽
    - 둘 다 없으면 None
    """
    hall = clean_text(hall_raw)
    room = clean_text(room_raw)
    if hall and room:
        return f"{hall} {room}"
    return hall or room


# ─── 추출 ─────────────────────────────────────────────────
def fetch_classes(db_config: dict) -> list[dict]:
    """V_class_list 에서 강좌 마스터 전부 추출."""
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
                반고유_코드,
                반명,
                강사명,
                과목명,
                청구회차,
                회차당금액,
                반수강료,
                정원,
                요일,
                시간,
                강의관,
                강의실,
                등록일,
                미사용반구분,
                학원_코드
            FROM dbo.V_class_list
            """
        )
        return list(cur.fetchall())
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(row: dict, branch_id: str, branch_name: str) -> dict | None:
    """V_class_list row → public.classes row.
    name 빈값이면 None 반환 (skip).
    """
    name = clean_text(row.get("반명"), max_len=200)
    if not name:
        return None  # name NOT NULL

    class_code = row.get("반고유_코드")
    if class_code is None:
        return None
    aca_class_id = f"{branch_id}-{class_code}"

    # 미사용반구분: 'Y' 면 비활성. 공백/NULL/그 외 → 활성.
    inactive_flag = clean_text(row.get("미사용반구분"))
    active = not (inactive_flag == "Y")

    return {
        "aca_class_id": aca_class_id,
        "branch": branch_name,
        "name": name,
        "teacher_name": clean_text(row.get("강사명")),
        "subject_raw": clean_text(row.get("과목명")),
        "subject": normalize_subject(row.get("과목명")),
        "total_sessions": to_float(row.get("청구회차")),
        "amount_per_session": to_int(row.get("회차당금액")),
        "total_amount": to_int(row.get("반수강료")),
        "capacity": to_int(row.get("정원")),
        "schedule_days": clean_text(row.get("요일"), max_len=50),
        "schedule_time": clean_text(row.get("시간"), max_len=50),
        "classroom": merge_classroom(row.get("강의관"), row.get("강의실")),
        "registered_at": to_iso_date(row.get("등록일")),
        "active": active,
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("classes")
            .upsert(batch, on_conflict="aca_class_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 강좌 마스터 마이그레이션 · DRY_RUN={DRY_RUN} · "
        f"ONLY_BRANCH={ONLY_BRANCH or 'all'}"
    )
    print("=" * 60)

    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET)

    grand = {"raw": 0, "transformed": 0, "skipped": 0, "upserted": 0, "errors": 0}

    for db in DATABASES:
        if ONLY_BRANCH and db["branch_id"] != ONLY_BRANCH:
            continue

        label = f"{db['branch_name']} ({db['branch_id']})"
        print(f"\n📍 {label}")

        try:
            rows = fetch_classes(db)
        except Exception as e:
            print(f"   ❌ 추출 실패: {e}")
            continue
        print(f"   raw: {len(rows):,}건")

        transformed: list[dict] = []
        skipped = 0
        for r in rows:
            t = transform(r, db["branch_id"], db["branch_name"])
            if t is None:
                skipped += 1
            else:
                transformed.append(t)
        print(
            f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 "
            f"(name 누락 / 반고유_코드 누락)"
        )

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                name_preview = (s["name"] or "")[:20]
                print(
                    f"   sample: aca_class_id={s['aca_class_id']} "
                    f"name={name_preview}*** teacher={s['teacher_name']} "
                    f"subject={s['subject']} (raw={s['subject_raw']}) "
                    f"sessions={s['total_sessions']} "
                    f"per={s['amount_per_session']} total={s['total_amount']} "
                    f"cap={s['capacity']} days={s['schedule_days']} "
                    f"time={s['schedule_time']} room={s['classroom']} "
                    f"reg={s['registered_at']} active={s['active']}"
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
