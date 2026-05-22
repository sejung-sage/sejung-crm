"""
세정학원 CRM · 티켓(수강이력) 마이그레이션 (Phase 4 확장).

흐름:
  1. 4분원 V_Ticket_student_income_List 추출 (총 ~수만 건)
  2. 우리 schema 의 aca_tickets 행으로 변환
  3. aca_ticket_id 기준 UPSERT (idempotent)

매핑 (V_Ticket_student_income_List → public.aca_tickets):
  티켓_코드 + 학원_코드   → aca_ticket_id ("{branch_id}-{티켓_코드}" · NULL 이면 skip)
  학생_코드 + 학원_코드   → aca_student_id ("{branch_id}-{학생_코드}" · NULL 가능)
  반고유_코드 + 학원_코드 → aca_class_id ("{branch_id}-{반고유_코드}" · NULL 가능)
  수강이력_코드 + 학원_코드 → aca_enrollment_id ("{branch_id}-{수강이력_코드}" · NULL 가능)
  미납_코드 + 학원_코드   → aca_unpaid_id ("{branch_id}-{미납_코드}" · NULL 가능)
  수납_코드 + 학원_코드   → aca_payment_id ("{branch_id}-{수납_코드}" · NULL 가능)
  학생명                  → student_name
  반명                    → class_name
  강사명                  → teacher_name
  과목명                  → subject_raw
  세부반명                → class_detail
  반_학년                 → class_grade
  반형태1/2/3             → class_type1/2/3
  요일/시간               → schedule_days/schedule_time
  강의관 + 강의실         → classroom (merge)
  납입기한일              → due_date (date)
  티켓사용일              → used_at (timestamp)
  수업일                  → class_date (nvarchar(10) → 그대로, 'YYYY-MM-DD' 가정)
  정상금액                → normal_amount
  할인적용금액            → discount_amount
  결제상태                → payment_state
  납입일                  → paid_at (date)
  납입금액                → paid_amount
  납입형태                → payment_method
  사업자번호              → business_no
  티켓기록날짜시간        → recorded_at (timestamp · nvarchar → parse)
  티켓기록일/티켓생성일   → recorded_on / created_on (date)
  담당강사_목록           → teacher_names
  담당강사_코드목록       → teacher_codes
  학원_코드               → branch (short name)

skip 사유:
  - 티켓_코드 None

HP_학생 컬럼은 PII 라 SELECT 자체에서 제외.

실행:
  source .venv/bin/activate
  DRY_RUN=1 ONLY_BRANCH=80205 python scripts/etl/migrate_tickets.py
  DRY_RUN=0 python scripts/etl/migrate_tickets.py
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime, date
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
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.strftime("%Y-%m-%d")
    if isinstance(raw, date):
        return raw.strftime("%Y-%m-%d")
    s = str(raw).strip()
    if not s:
        return None
    return s[:10]


def to_iso_ts(raw: Any) -> str | None:
    """datetime → ISO 8601. 문자열이면 parse 시도, 실패 시 그대로 (길이만 잘라)."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.isoformat()
    s = str(raw).strip()
    if not s:
        return None
    # 'YYYY-MM-DD HH:MM:SS' 형식 시도
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except ValueError:
            continue
    return s[:30]


def to_int(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


_PII_PATTERN = re.compile(r"\(([^)]*)\)=\(([^)]*)\)")


def _mask_error(msg: str) -> str:
    return _PII_PATTERN.sub(lambda m: f"({m.group(1)})=(***)", msg)[:200]


def _id_or_none(raw: Any, branch_id: str) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    return f"{branch_id}-{s}"


def merge_classroom(hall_raw: Any, room_raw: Any) -> str | None:
    hall = clean_text(hall_raw)
    room = clean_text(room_raw)
    if hall and room:
        return f"{hall} {room}"
    return hall or room


# ─── 추출 ─────────────────────────────────────────────────
def fetch_tickets(db_config: dict) -> list[dict]:
    """V_Ticket_student_income_List 전체 추출. HP_학생 은 PII 라 제외."""
    conn = pymssql.connect(
        server=db_config["server"],
        port=db_config["port"],
        user=USER,
        password=PASSWORD,
        database=db_config["database"],
        timeout=120,
        charset="CP949",
    )
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """
            SELECT
                수강이력_코드,
                반고유_코드,
                미납_코드,
                학생명,
                학생_코드,
                학교,
                학년,
                반형태1,
                반형태2,
                반형태3,
                반명,
                반수강료,
                정원,
                청구회차,
                회차당금액,
                설정값,
                마감여부,
                반_학년,
                강사명,
                과목명,
                세부과목명,
                세부반명,
                요일,
                시간,
                기타,
                강의관,
                강의실,
                납입기한일,
                티켓사용일,
                수업일,
                정상금액,
                할인적용금액,
                결제상태,
                납입일,
                납입금액,
                납입형태,
                티켓_코드,
                사업자번호,
                수납_코드,
                티켓기록날짜시간,
                담당강사_목록,
                담당강사_코드목록,
                학원_코드,
                티켓기록일,
                티켓생성일
            FROM dbo.V_Ticket_student_income_List
            """
        )
        return list(cur.fetchall())
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(row: dict, branch_id: str, branch_name: str) -> dict | None:
    ticket_code = row.get("티켓_코드")
    if ticket_code is None or str(ticket_code).strip() == "":
        return None

    # 수업일은 nvarchar(10) 'YYYY-MM-DD' 가정. 빈값이면 None.
    class_date_raw = clean_text(row.get("수업일"))
    class_date = class_date_raw[:10] if class_date_raw else None

    return {
        "aca_ticket_id": f"{branch_id}-{ticket_code}",
        "aca_student_id": _id_or_none(row.get("학생_코드"), branch_id),
        "aca_class_id": _id_or_none(row.get("반고유_코드"), branch_id),
        "aca_enrollment_id": _id_or_none(row.get("수강이력_코드"), branch_id),
        "aca_unpaid_id": _id_or_none(row.get("미납_코드"), branch_id),
        "aca_payment_id": _id_or_none(row.get("수납_코드"), branch_id),
        "branch": branch_name,
        "student_name": clean_text(row.get("학생명"), max_len=20),
        "student_school": clean_text(row.get("학교"), max_len=50),
        "student_grade": clean_text(row.get("학년"), max_len=10),
        "class_name": clean_text(row.get("반명"), max_len=200),
        "class_type1": clean_text(row.get("반형태1"), max_len=50),
        "class_type2": clean_text(row.get("반형태2"), max_len=50),
        "class_type3": clean_text(row.get("반형태3"), max_len=50),
        "class_total_amount": to_int(row.get("반수강료")),
        "class_capacity": to_int(row.get("정원")),
        "class_total_sessions": (
            float(row["청구회차"]) if row.get("청구회차") is not None else None
        ),
        "class_amount_per_session": to_int(row.get("회차당금액")),
        "settings_value": clean_text(row.get("설정값"), max_len=100),
        "close_flag": clean_text(row.get("마감여부"), max_len=50),
        "class_grade": clean_text(row.get("반_학년"), max_len=20),
        "teacher_name": clean_text(row.get("강사명"), max_len=50),
        "subject_raw": clean_text(row.get("과목명"), max_len=50),
        "subject_detail": clean_text(row.get("세부과목명"), max_len=50),
        "class_detail": clean_text(row.get("세부반명"), max_len=100),
        "schedule_days": clean_text(row.get("요일"), max_len=50),
        "schedule_time": clean_text(row.get("시간"), max_len=50),
        "etc": clean_text(row.get("기타"), max_len=200),
        "classroom": merge_classroom(row.get("강의관"), row.get("강의실")),
        "due_date": to_iso_date(row.get("납입기한일")),
        "used_at": to_iso_ts(row.get("티켓사용일")),
        "class_date": class_date,
        "normal_amount": to_int(row.get("정상금액")),
        "discount_amount": to_int(row.get("할인적용금액")),
        "payment_state": clean_text(row.get("결제상태"), max_len=20),
        "paid_at": to_iso_date(row.get("납입일")),
        "paid_amount": to_int(row.get("납입금액")),
        "payment_method": clean_text(row.get("납입형태"), max_len=50),
        "business_no": clean_text(row.get("사업자번호"), max_len=50),
        "recorded_at": to_iso_ts(row.get("티켓기록날짜시간")),
        "recorded_on": to_iso_date(row.get("티켓기록일")),
        "created_on": to_iso_date(row.get("티켓생성일")),
        "teacher_names": clean_text(row.get("담당강사_목록"), max_len=200),
        "teacher_codes": clean_text(row.get("담당강사_코드목록"), max_len=200),
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("aca_tickets")
            .upsert(batch, on_conflict="aca_ticket_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 티켓 마이그레이션 · DRY_RUN={DRY_RUN} · "
        f"ONLY_BRANCH={ONLY_BRANCH or 'all'}"
    )
    print("=" * 60)

    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET) if not DRY_RUN else None

    grand = {"raw": 0, "transformed": 0, "skipped": 0, "upserted": 0, "errors": 0}

    for db in DATABASES:
        if ONLY_BRANCH and db["branch_id"] != ONLY_BRANCH:
            continue

        label = f"{db['branch_name']} ({db['branch_id']})"
        print(f"\n📍 {label}")

        try:
            rows = fetch_tickets(db)
        except Exception as e:
            print(f"   ❌ 추출 실패: {e}")
            continue
        print(f"   raw: {len(rows):,}건")

        transformed_map: dict[str, dict] = {}
        skipped = 0
        dup = 0
        for r in rows:
            t = transform(r, db["branch_id"], db["branch_name"])
            if t is None:
                skipped += 1
                continue
            key = t["aca_ticket_id"]
            if key in transformed_map:
                dup += 1  # 같은 티켓_코드 중복 raw — 마지막 행 win.
            transformed_map[key] = t
        transformed = list(transformed_map.values())
        print(
            f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 / dedup: {dup:,}건 "
            f"(티켓_코드 누락 / 동일 티켓_코드 중복)"
        )

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                print(
                    f"   sample: aca_ticket_id={s['aca_ticket_id']} "
                    f"student=*** class={s['aca_class_id']} "
                    f"enrollment={s['aca_enrollment_id']} payment={s['aca_payment_id']} "
                    f"used_at={s['used_at']} class_date={s['class_date']} "
                    f"paid_amount={s['paid_amount']} state={s['payment_state']}"
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
