"""
세정학원 CRM · 반 형태(class_types) 마이그레이션 (Phase 4 확장).

흐름:
  1. 4분원 V_classqqtype_list 추출 (분원당 ~수십 건)
  2. 우리 schema 의 aca_class_types 행으로 변환
  3. aca_class_type_id 기준 UPSERT (idempotent)

매핑 (V_classqqtype_list → public.aca_class_types):
  반형태_코드 + 학원_코드 → aca_class_type_id ("{branch_id}-{반형태_코드}" · NULL 이면 skip)
  등록일                  → registered_at (date)
  반형태1/2/3             → type1 / type2 / type3
  브랜치_코드             → brand_code (int)
  브랜치명                → brand_name
  정렬                    → sort_order (int)
  학원_코드               → branch (short name)

skip 사유:
  - 반형태_코드 None

실행:
  source .venv/bin/activate
  DRY_RUN=1 ONLY_BRANCH=80205 python scripts/etl/migrate_class_types.py
  DRY_RUN=0 python scripts/etl/migrate_class_types.py
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
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "100"))

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


# ─── 추출 ─────────────────────────────────────────────────
def fetch_class_types(db_config: dict) -> list[dict]:
    conn = pymssql.connect(
        server=db_config["server"],
        port=db_config["port"],
        user=USER,
        password=PASSWORD,
        database=db_config["database"],
        timeout=60,
        charset="CP949",
        tds_version="7.0",
    )
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """
            SELECT
                반형태_코드,
                등록일,
                반형태1,
                반형태2,
                반형태3,
                브랜치_코드,
                브랜치명,
                정렬,
                학원_코드
            FROM dbo.V_classqqtype_list
            """
        )
        return recover_rows(list(cur.fetchall()))
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(row: dict, branch_id: str, branch_name: str) -> dict | None:
    type_code = row.get("반형태_코드")
    if type_code is None or str(type_code).strip() == "":
        return None

    return {
        "aca_class_type_id": f"{branch_id}-{type_code}",
        "branch": branch_name,
        "registered_at": to_iso_date(row.get("등록일")),
        "type1": clean_text(row.get("반형태1"), max_len=50),
        "type2": clean_text(row.get("반형태2"), max_len=50),
        "type3": clean_text(row.get("반형태3"), max_len=50),
        "brand_code": to_int(row.get("브랜치_코드")),
        "brand_name": clean_text(row.get("브랜치명"), max_len=100),
        "sort_order": to_int(row.get("정렬")),
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("aca_class_types")
            .upsert(batch, on_conflict="aca_class_type_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 반 형태 마이그레이션 · DRY_RUN={DRY_RUN} · "
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
            rows = fetch_class_types(db)
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
        print(f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 (반형태_코드 누락)")

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                print(
                    f"   sample: aca_class_type_id={s['aca_class_type_id']} "
                    f"type1={s['type1']} type2={s['type2']} type3={s['type3']} "
                    f"brand={s['brand_name']} sort={s['sort_order']}"
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
