"""
ETL 마지막 단계 — aca_* (raw) → crm_* (curated) 동기화.

0051_crm_curated_layer.sql 의 apply_aca_to_crm() RPC 호출.
이 단계가 빠지면 ETL 으로 aca_students 에 데이터가 들어가도
CRM 웹이 보는 crm_students 는 옛 데이터로 남는다.

호출:
  python scripts/etl/apply_to_crm.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

# scripts/etl/.env
load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    print("[ERROR] SUPABASE_URL / SUPABASE_SECRET_KEY env 가 없습니다.")
    sys.exit(1)


def main() -> None:
    print("=" * 60)
    print("apply_aca_to_crm() · aca_* → crm_* 동기화")
    print("=" * 60)

    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
    try:
        result = supabase.rpc("apply_aca_to_crm").execute()
    except Exception as e:  # pragma: no cover
        print(f"[ERROR] RPC 호출 실패: {e}")
        sys.exit(1)

    rows = result.data or []
    if not rows:
        print("[WARN] RPC 응답이 비어 있습니다.")
        sys.exit(1)

    row = rows[0]
    print(f"  students_upserted    : {row.get('students_upserted', 0):>10,}")
    print(f"  classes_upserted     : {row.get('classes_upserted', 0):>10,}")
    print(f"  enrollments_upserted : {row.get('enrollments_upserted', 0):>10,}")
    print(f"  attendances_upserted : {row.get('attendances_upserted', 0):>10,}")
    print("=" * 60)


if __name__ == "__main__":
    main()
