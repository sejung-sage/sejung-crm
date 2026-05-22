"""
세정학원 CRM · 강좌 회계 일별 스냅샷 마이그레이션 (Phase 4 확장).

흐름:
  1. 4분원 V_class_account_list 추출 (분원당 수천 건)
  2. (반고유_코드, 수업일) 자연키 조합으로 변환
  3. aca_class_account_id 기준 UPSERT (idempotent)

자연키:
  aca_class_account_id = "{branch_id}-{반고유_코드}-{수업일 YYYYMMDD}"

매핑 (V_class_account_list → public.aca_class_accounts):
  반형태_코드 + 학원_코드 → aca_class_type_id ("{branch_id}-{반형태_코드}" · NULL 가능)
  반고유_코드 + 학원_코드 → aca_class_id ("{branch_id}-{반고유_코드}")
  반명                    → class_name
  반수강료                → total_amount
  정원                    → capacity
  청구회차                → total_sessions (numeric)
  회차당금액              → amount_per_session
  설정값                  → settings_value
  마감여부                → close_flag
  반_학년                 → class_grade
  강사명                  → teacher_name
  과목명                  → subject_raw
  세부과목명              → subject_detail
  세부반명                → class_detail
  요일/시간               → schedule_days/schedule_time
  기타                    → etc
  반형태_정렬             → class_type_sort
  반_정렬                 → class_sort
  수업일                  → class_date (date · NULL 이면 skip)
  미정산/회수대상/정상완료 → unsettled / recall_target / completed (int)
  학원_코드               → branch (short name)

skip 사유:
  - 수업일 None (자연키 못 만듦)
  - 반고유_코드 None (자연키 못 만듦)

실행:
  source .venv/bin/activate
  DRY_RUN=1 ONLY_BRANCH=80205 python scripts/etl/migrate_class_accounts.py
  DRY_RUN=0 python scripts/etl/migrate_class_accounts.py
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
from _encoding import recover_rows
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


def date_to_compact(raw: Any) -> str | None:
    """수업일 → 'YYYYMMDD' (자연키 부품). None 가능."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.strftime("%Y%m%d")
    if isinstance(raw, date):
        return raw.strftime("%Y%m%d")
    s = str(raw).strip()
    if not s:
        return None
    return s[:10].replace("-", "")


def to_int(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


def to_float(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        return float(raw)
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


# ─── 추출 ─────────────────────────────────────────────────
def fetch_class_accounts(db_config: dict) -> list[dict]:
    conn = pymssql.connect(
        server=db_config["server"],
        port=db_config["port"],
        user=USER,
        password=PASSWORD,
        database=db_config["database"],
        timeout=120,
        charset="UTF-8",
    )
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """
            SELECT
                반형태_코드,
                반고유_코드,
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
                반형태_정렬,
                반_정렬,
                수업일,
                미정산,
                회수대상,
                정상완료
            FROM dbo.V_class_account_list
            """
        )
        rows = recover_rows(list(cur.fetchall()))
        # 학원_코드는 view 에서 빠질 수 있으니 보강
        for r in rows:
            r.setdefault("학원_코드", None)
        return rows
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(row: dict, branch_id: str, branch_name: str) -> dict | None:
    class_code = row.get("반고유_코드")
    class_date_compact = date_to_compact(row.get("수업일"))
    if class_code is None or class_date_compact is None:
        return None

    aca_class_account_id = f"{branch_id}-{class_code}-{class_date_compact}"

    return {
        "aca_class_account_id": aca_class_account_id,
        "aca_class_id": f"{branch_id}-{class_code}",
        "aca_class_type_id": _id_or_none(row.get("반형태_코드"), branch_id),
        "branch": branch_name,
        "class_name": clean_text(row.get("반명"), max_len=200),
        "total_amount": to_int(row.get("반수강료")),
        "capacity": to_int(row.get("정원")),
        "total_sessions": to_float(row.get("청구회차")),
        "amount_per_session": to_int(row.get("회차당금액")),
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
        "class_type_sort": to_int(row.get("반형태_정렬")),
        "class_sort": to_int(row.get("반_정렬")),
        "class_date": to_iso_date(row.get("수업일")),
        "unsettled": to_int(row.get("미정산")),
        "recall_target": to_int(row.get("회수대상")),
        "completed": to_int(row.get("정상완료")),
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("aca_class_accounts")
            .upsert(batch, on_conflict="aca_class_account_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 강좌 회계 일별 스냅샷 마이그레이션 · DRY_RUN={DRY_RUN} · "
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
            rows = fetch_class_accounts(db)
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
            key = t["aca_class_account_id"]
            if key in transformed_map:
                dup += 1  # 같은 (반,수업일) 중복 — 마지막 행 win.
            transformed_map[key] = t
        transformed = list(transformed_map.values())
        print(
            f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 / dedup: {dup:,}건 "
            f"(반고유_코드 또는 수업일 누락 / 같은 반·수업일 중복)"
        )

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                print(
                    f"   sample: aca_class_account_id={s['aca_class_account_id']} "
                    f"class_date={s['class_date']} "
                    f"unsettled={s['unsettled']} recall={s['recall_target']} "
                    f"completed={s['completed']} cap={s['capacity']}"
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
