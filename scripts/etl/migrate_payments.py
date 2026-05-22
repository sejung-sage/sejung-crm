"""
세정학원 CRM · 수납 이력(payments) 마이그레이션 (Phase 4 확장).

흐름:
  1. 4분원 V_Pay_List 추출 (분원당 수천~수만 건, 총 ~32K 건 예상)
  2. 우리 schema 의 aca_payments 행으로 변환
  3. aca_payment_id 기준 UPSERT (idempotent)

매핑 (V_Pay_List → public.aca_payments):
  수납_코드 + 학원_코드 → aca_payment_id ("{branch_id}-{수납_코드}" · NULL 이면 skip)
  학생_코드 + 학원_코드 → aca_student_id ("{branch_id}-{학생_코드}" · NULL 가능)
  반고유_코드 + 학원_코드 → aca_class_id ("{branch_id}-{반고유_코드}" · NULL 가능)
  미납_코드 + 학원_코드  → aca_unpaid_id ("{branch_id}-{미납_코드}" · NULL 가능)
  학생명                → student_name
  반명                  → class_name
  납입기한              → due_date (YYYY-MM-DD)
  납입일                → paid_at (YYYY-MM-DD)
  항목                  → item
  납입금액              → amount (INT)
  납입형태              → payment_method
  승인번호              → approval_no
  사업자번호            → business_no
  처리자                → handler
  강사명                → teacher_name
  과목명                → subject_raw
  학원_코드             → branch (BRANCH_NAME_MAP 으로 short name)

HP_부모 등 PII 컬럼은 SELECT 자체에서 제외.

skip 사유:
  - 수납_코드 None (자연키 못 만듦)

실행 (프로젝트 루트):
  source .venv/bin/activate
  DRY_RUN=1 ONLY_BRANCH=80205 python scripts/etl/migrate_payments.py  # 단일 분원 dry-run
  DRY_RUN=0 python scripts/etl/migrate_payments.py                    # 4분원 실 적용
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


def _id_or_none(raw: Any, branch_id: str) -> str | None:
    """원본 코드 → "{branch_id}-{code}" 형식 자연키. NULL 이면 None."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    return f"{branch_id}-{s}"


# ─── 추출 ─────────────────────────────────────────────────
def fetch_payments(db_config: dict) -> list[dict]:
    """V_Pay_List 에서 수납 이력 전부 추출. HP_부모 등 PII 는 SELECT 제외."""
    conn = pymssql.connect(
        server=db_config["server"],
        port=db_config["port"],
        user=USER,
        password=PASSWORD,
        database=db_config["database"],
        timeout=120,
        charset="CP949",
        tds_version="7.0",
    )
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """
            SELECT
                학생_코드,
                학생명,
                반고유_코드,
                반명,
                납입기한,
                납입일,
                항목,
                납입금액,
                납입형태,
                승인번호,
                사업자번호,
                처리자,
                강사명,
                과목명,
                미납_코드,
                수납_코드,
                학원_코드
            FROM dbo.V_Pay_List
            """
        )
        return recover_rows(list(cur.fetchall()))
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(row: dict, branch_id: str, branch_name: str) -> dict | None:
    pay_code = row.get("수납_코드")
    if pay_code is None or str(pay_code).strip() == "":
        return None

    return {
        "aca_payment_id": f"{branch_id}-{pay_code}",
        "aca_student_id": _id_or_none(row.get("학생_코드"), branch_id),
        "aca_class_id": _id_or_none(row.get("반고유_코드"), branch_id),
        "aca_unpaid_id": _id_or_none(row.get("미납_코드"), branch_id),
        "branch": branch_name,
        "student_name": clean_text(row.get("학생명"), max_len=20),
        "class_name": clean_text(row.get("반명"), max_len=200),
        "due_date": to_iso_date(row.get("납입기한")),
        "paid_at": to_iso_date(row.get("납입일")),
        "item": clean_text(row.get("항목"), max_len=100),
        "amount": to_int(row.get("납입금액")),
        "payment_method": clean_text(row.get("납입형태"), max_len=50),
        "approval_no": clean_text(row.get("승인번호"), max_len=50),
        "business_no": clean_text(row.get("사업자번호"), max_len=50),
        "handler": clean_text(row.get("처리자"), max_len=50),
        "teacher_name": clean_text(row.get("강사명"), max_len=50),
        "subject_raw": clean_text(row.get("과목명"), max_len=50),
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("aca_payments")
            .upsert(batch, on_conflict="aca_payment_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 수납 이력 마이그레이션 · DRY_RUN={DRY_RUN} · "
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
            rows = fetch_payments(db)
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
            key = t["aca_payment_id"]
            if key in transformed_map:
                dup += 1  # 같은 수납_코드 중복 raw — 마지막 행 win.
            transformed_map[key] = t
        transformed = list(transformed_map.values())
        print(
            f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 / dedup: {dup:,}건 "
            f"(수납_코드 누락 / 동일 수납_코드 중복)"
        )

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                name_preview = (s["student_name"] or "")[:1]
                print(
                    f"   sample: aca_payment_id={s['aca_payment_id']} "
                    f"student=*** (mask:{name_preview}) "
                    f"class={s['aca_class_id']} unpaid={s['aca_unpaid_id']} "
                    f"due={s['due_date']} paid={s['paid_at']} "
                    f"item={s['item']} amount={s['amount']} "
                    f"method={s['payment_method']}"
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
