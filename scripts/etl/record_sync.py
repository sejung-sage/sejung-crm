"""
ETL 마지막 단계 — etl_sync_runs 에 실행 결과 1행 기록.

UI 사이드바의 "마지막 동기화 시각 + 성공/실패" 표시 소스(0079).
run_all.bat 의 성공/실패 분기 양쪽에서 호출된다.

호출:
  python scripts/etl/record_sync.py ok
  python scripts/etl/record_sync.py fail "2 steps failed"

주의: 이력 기록 실패가 ETL 전체 결과(exit code)를 좌우하면 안 되므로,
INSERT 가 실패해도 0(정상) 으로 종료한다 (경고만 출력).
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


def main() -> None:
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        print("[WARN] SUPABASE_URL / SUPABASE_SECRET_KEY env 없음 — 이력 기록 건너뜀.")
        sys.exit(0)

    # argv[1]: ok|success|0 -> success, 그 외 -> failed
    raw = sys.argv[1].lower() if len(sys.argv) > 1 else "ok"
    status = "success" if raw in ("ok", "success", "0") else "failed"

    # argv[2:] 를 합쳐 실패 사유로. 성공이면 무시.
    message = " ".join(sys.argv[2:]).strip()
    row: dict[str, str] = {"status": status}
    if status == "failed" and message:
        row["error_message"] = message[:500]

    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
    try:
        supabase.table("etl_sync_runs").insert(row).execute()
    except Exception as e:  # pragma: no cover - 기록 실패는 무시
        print(f"[WARN] 동기화 이력 기록 실패(무시): {e}")
        sys.exit(0)

    print(f"[OK] etl_sync_runs 기록: status={status}")


if __name__ == "__main__":
    main()
