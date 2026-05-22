"""
세정학원 CRM · 강사-반 배정(teacher_subjects) 마이그레이션 (Phase 4 확장).

흐름:
  1. 4분원 V_People_Subject_List 추출 (분원당 ~수백 건)
  2. (강사_코드, 반고유_코드, 배정일) 자연키 조합으로 변환
  3. aca_teacher_subject_id 기준 UPSERT (idempotent)

자연키:
  aca_teacher_subject_id =
    "{branch_id}-{강사_코드}-{반고유_코드}-{배정일 YYYYMMDD}"
  (한 강사가 같은 반에 다른 날짜로 재배정될 수 있음 — 배정일 포함이 자연스럽다.)

매핑 (V_People_Subject_List → public.aca_teacher_subjects):
  과목                   → subject_raw
  강사명                 → teacher_name
  강사_코드 + 학원_코드  → aca_teacher_id
  배정일                 → assigned_at (date · NULL 이면 skip)
  종료일                 → ended_at (date · NULL 가능)
  반고유_코드 + 학원_코드 → aca_class_id
  반명                   → class_name
  학원_코드              → branch (short name)

skip 사유:
  - 배정일 None (자연키 못 만듦)
  - 강사_코드 / 반고유_코드 None (자연키 못 만듦)

실행:
  source .venv/bin/activate
  DRY_RUN=1 ONLY_BRANCH=80205 python scripts/etl/migrate_teacher_subjects.py
  DRY_RUN=0 python scripts/etl/migrate_teacher_subjects.py
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
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "200"))

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
def fetch_teacher_subjects(db_config: dict) -> list[dict]:
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
                과목,
                강사명,
                강사_코드,
                배정일,
                종료일,
                반고유_코드,
                반명,
                학원_코드
            FROM dbo.V_People_Subject_List
            """
        )
        return recover_rows(list(cur.fetchall()))
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(row: dict, branch_id: str, branch_name: str) -> dict | None:
    teacher_code = row.get("강사_코드")
    class_code = row.get("반고유_코드")
    assigned_compact = date_to_compact(row.get("배정일"))
    if (
        teacher_code is None
        or class_code is None
        or assigned_compact is None
    ):
        return None

    aca_teacher_subject_id = (
        f"{branch_id}-{teacher_code}-{class_code}-{assigned_compact}"
    )

    return {
        "aca_teacher_subject_id": aca_teacher_subject_id,
        "aca_teacher_id": f"{branch_id}-{teacher_code}",
        "aca_class_id": f"{branch_id}-{class_code}",
        "branch": branch_name,
        "subject_raw": clean_text(row.get("과목"), max_len=50),
        "teacher_name": clean_text(row.get("강사명"), max_len=50),
        "class_name": clean_text(row.get("반명"), max_len=200),
        "assigned_at": to_iso_date(row.get("배정일")),
        "ended_at": to_iso_date(row.get("종료일")),
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("aca_teacher_subjects")
            .upsert(batch, on_conflict="aca_teacher_subject_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 강사-반 배정 마이그레이션 · DRY_RUN={DRY_RUN} · "
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
            rows = fetch_teacher_subjects(db)
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
            key = t["aca_teacher_subject_id"]
            if key in transformed_map:
                dup += 1  # 같은 (강사,반,배정일) 중복 — 마지막 행 win.
            transformed_map[key] = t
        transformed = list(transformed_map.values())
        print(
            f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 / dedup: {dup:,}건 "
            f"(같은 강사·반·배정일 중복 — 마지막 행 보존)"
        )

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                print(
                    f"   sample: id={s['aca_teacher_subject_id']} "
                    f"teacher={s['aca_teacher_id']} class={s['aca_class_id']} "
                    f"subject={s['subject_raw']} "
                    f"assigned={s['assigned_at']} ended={s['ended_at']}"
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
                if (i // BATCH_SIZE) % 5 == 0 or i + BATCH_SIZE >= len(transformed):
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
