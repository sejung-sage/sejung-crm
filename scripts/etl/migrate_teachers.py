"""
세정학원 CRM · 강사/직원(teachers) 마이그레이션 (Phase 4 확장).

흐름:
  1. 4분원 V_People_List 추출 (분원당 수십 명, 총 ~200명)
  2. 우리 schema 의 aca_teachers 행으로 변환
  3. aca_teacher_id 기준 UPSERT (idempotent)

매핑 (V_People_List → public.aca_teachers):
  강사_코드 + 학원_코드 → aca_teacher_id ("{branch_id}-{강사_코드}" · NULL 이면 skip)
  강사명               → name
  아이디               → login_id
  강사_HP              → phone (normalize_phone, 실패해도 NULL 만 — skip X)
  생년월일             → birthday (date / 'YYYY-MM-DD' 가정)
  유형                 → role_type
  직책                 → position
  부서                 → department
  구분                 → status_label  (예: '재직중' / '퇴사함' 등)
  우편번호             → postal_code (공백 strip)
  도로명주소           → road_address
  학원_코드            → branch (short name)

skip 사유:
  - 강사_코드 None

PII 정책:
  전화번호는 sample 출력 시 끝 4자리만 표시 (010-****-1234).

실행:
  source .venv/bin/activate
  DRY_RUN=1 ONLY_BRANCH=80205 python scripts/etl/migrate_teachers.py
  DRY_RUN=0 python scripts/etl/migrate_teachers.py
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
PHONE_DIGITS_RE = re.compile(r"\D+")


def normalize_phone(raw: Any) -> str | None:
    """학생 ETL 과 동일 로직. 강사 데이터는 정상값이 더 많지만 placeholder 거부 동일 적용."""
    if raw is None:
        return None
    digits = PHONE_DIGITS_RE.sub("", str(raw))
    if len(digits) < 10 or len(digits) > 11:
        return None
    if not digits.startswith(("010", "011", "016", "017", "018", "019")):
        return None
    suffix = digits[3:]
    if suffix == "0" * len(suffix):
        return None
    if len(set(suffix)) == 1:
        return None
    return digits


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
    # 생년월일이 'YYYYMMDD' 8자리로 올 수도 있음 → 'YYYY-MM-DD' 로 변환 시도
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return s[:10]


_PII_PATTERN = re.compile(r"\(([^)]*)\)=\(([^)]*)\)")


def _mask_error(msg: str) -> str:
    return _PII_PATTERN.sub(lambda m: f"({m.group(1)})=(***)", msg)[:200]


def _mask_phone(p: str | None) -> str:
    if not p or len(p) < 4:
        return "***"
    return f"***-****-{p[-4:]}"


# ─── 추출 ─────────────────────────────────────────────────
def fetch_teachers(db_config: dict) -> list[dict]:
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
                강사_코드,
                강사명,
                아이디,
                강사_HP,
                생년월일,
                유형,
                직책,
                부서,
                구분,
                우편번호,
                도로명주소,
                학원_코드
            FROM dbo.V_People_List
            """
        )
        return list(cur.fetchall())
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(row: dict, branch_id: str, branch_name: str) -> dict | None:
    teacher_code = row.get("강사_코드")
    if teacher_code is None or str(teacher_code).strip() == "":
        return None

    # 전화번호: 실패해도 NULL 만 — skip X (강사 데이터 보존 우선)
    phone = normalize_phone(row.get("강사_HP"))

    return {
        "aca_teacher_id": f"{branch_id}-{teacher_code}",
        "branch": branch_name,
        "name": clean_text(row.get("강사명"), max_len=50),
        "login_id": clean_text(row.get("아이디"), max_len=50),
        "phone": phone,
        "birthday": to_iso_date(row.get("생년월일")),
        "role_type": clean_text(row.get("유형"), max_len=50),
        "position": clean_text(row.get("직책"), max_len=50),
        "department": clean_text(row.get("부서"), max_len=50),
        "status_label": clean_text(row.get("구분"), max_len=20),
        # 우편번호/도로명주소는 NOT NULL 가능성. 빈 문자열 들어오면 trim 후 None.
        # DB 가 NOT NULL 이라면 architect 가 DEFAULT '' 부여 가정.
        "postal_code": clean_text(row.get("우편번호"), max_len=10),
        "road_address": clean_text(row.get("도로명주소"), max_len=200),
    }


# ─── 적재 ─────────────────────────────────────────────────
def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    try:
        res = (
            supabase.table("aca_teachers")
            .upsert(batch, on_conflict="aca_teacher_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(
        f"세정학원 강사 마이그레이션 · DRY_RUN={DRY_RUN} · "
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
            rows = fetch_teachers(db)
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
        print(f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 (강사_코드 누락)")

        grand["raw"] += len(rows)
        grand["transformed"] += len(transformed)
        grand["skipped"] += skipped

        if DRY_RUN:
            if transformed:
                s = transformed[0]
                print(
                    f"   sample: aca_teacher_id={s['aca_teacher_id']} "
                    f"name=*** login_id={s['login_id']} "
                    f"phone={_mask_phone(s['phone'])} role={s['role_type']} "
                    f"dept={s['department']} status={s['status_label']}"
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
