"""
세정학원 CRM · 학생 일회성 마이그레이션 (Phase 1).

흐름:
  4개 분원 MSSQL V_student_list  →  변환 + 분원 ID 매핑  →  Supabase students UPSERT

0012 마이그레이션 정규화 모델 반영:
  - students.grade_raw (TEXT)       ← 아카 V_student_list.학년 원값
  - students.grade (TEXT, 9종 enum) ← grade_policy.normalize_grade(grade_raw, school)
  - students.school_level (중/고/기타) ← grade_policy.derive_school_level(grade_raw, school)
  Python 측 정규화 함수는 DB 의 IMMUTABLE 함수와 1:1 동일 (grade_policy.py).

매핑 (V_student_list → public.students):
  학생_코드   → aca2000_id  (TEXT, 분원_branch_id 와 결합해서 유니크 보장: "{branch_id}-{학생_코드}")
  학생명      → name        (REQUIRED · 빈값 행은 skip + 통계)
  HP_부모     → parent_phone (REQUIRED · 정규화 후 빈값 skip)
  HP_학생     → phone        (선택)
  학교        → school
  학년        → grade_raw + grade + school_level (3개 컬럼 동시 채움)
  학원_코드   → branch       (BRANCH_NAME_MAP 으로 short name 매핑)

기본 정책:
  status = '재원생' (MSSQL 에서 status 정보 없음. 운영팀 확인 후 보강 가능)
  track = NULL
  registered_at = NULL

UPSERT 키:
  aca2000_id (UNIQUE). 같은 학생이 재발송되어도 update (idempotent).
  재실행 시 grade_raw/grade/school_level 모두 재계산되어 정합성 유지.

실행:
  source .venv/bin/activate
  DRY_RUN=1 python scripts/etl/migrate_students.py                   # 변환만
  ONLY_BRANCH=80205 DRY_RUN=1 python scripts/etl/migrate_students.py # 방배만
  DRY_RUN=0 python scripts/etl/migrate_students.py                   # 실 적용

성능:
  배치 INSERT 500건/회. 105K → 약 210회 호출 → 수 분 소요.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Any

import pymssql  # type: ignore
from dotenv import load_dotenv
from supabase import create_client  # type: ignore

# 0012 마이그레이션 정규화 모델: DB 함수와 동일한 룰을 Python 측 미러로 사용.
# scripts/etl/ 를 패키지로 설치하지 않으므로 동일 디렉토리 상대 import.
sys.path.insert(0, str(Path(__file__).parent))
from grade_policy import normalize_grade, derive_school_level  # noqa: E402

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

# ─── 분원 정의 ───────────────────────────────────────────
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
    """하이픈/공백 제거 후 10~11자리 010~019 만 OK. placeholder(전부 0/같은 숫자)도 거부."""
    if raw is None:
        return None
    digits = PHONE_DIGITS_RE.sub("", str(raw))
    if len(digits) < 10 or len(digits) > 11:
        return None
    if not digits.startswith(("010", "011", "016", "017", "018", "019")):
        return None
    # placeholder 거부: "01000000000", "01011111111" 같은 단일 숫자 반복
    suffix = digits[3:]
    if suffix == "0" * len(suffix):
        return None
    if len(set(suffix)) == 1:
        return None
    return digits


def clean_text(raw: Any, max_len: int | None = None) -> str | None:
    """빈/공백 → None. 양쪽 trim. (선택) 길이 제한."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    return s[:max_len] if max_len else s


# ─── 추출 ─────────────────────────────────────────────────
def fetch_students(db_config: dict) -> list[dict]:
    """단일 분원의 V_student_list 전체 조회."""
    conn = pymssql.connect(
        server=db_config["server"],
        port=db_config["port"],
        user=USER,
        password=PASSWORD,
        database=db_config["database"],
        timeout=30,
        charset="UTF-8",
    )
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute(
            """
            SELECT
                학생_코드,
                학생명,
                HP_부모,
                HP_학생,
                학교,
                학년,
                학원_코드
            FROM dbo.V_student_list
            """
        )
        return list(cur.fetchall())
    finally:
        conn.close()


# ─── 변환 ─────────────────────────────────────────────────
def transform(row: dict, branch_short: str, branch_id: str) -> dict | None:
    """단일 row → public.students 레코드. 필수값 없으면 None (skip)."""
    name = clean_text(row.get("학생명"), max_len=20)
    if not name:
        return None

    parent_phone = normalize_phone(row.get("HP_부모"))
    if not parent_phone:
        return None  # parent_phone NOT NULL 제약 + UNIQUE 키

    student_code = row.get("학생_코드")
    if student_code is None:
        return None
    aca2000_id = f"{branch_id}-{student_code}"

    school = clean_text(row.get("학교"), max_len=20)
    raw_grade = clean_text(row.get("학년"), max_len=10)  # 원값 그대로 (정규화 전).

    return {
        "aca2000_id": aca2000_id,
        "name": name,
        "parent_phone": parent_phone,
        "phone": normalize_phone(row.get("HP_학생")),
        "school": school,
        # 0012: grade_raw 는 아카 원값 백업, grade 는 정규화 enum, school_level 는 학교급.
        "grade_raw": raw_grade,
        "grade": normalize_grade(raw_grade, school),
        "school_level": derive_school_level(raw_grade, school),
        "branch": branch_short,
        "status": "재원생",
        "track": None,
        "registered_at": None,
    }


# ─── 적재 ─────────────────────────────────────────────────
_PII_PATTERN = re.compile(r"\(([^)]*)\)=\(([^)]*)\)")


def _mask_error(msg: str) -> str:
    """Supabase 에러 details 의 PII (Key (col)=(val)) 패턴을 마스킹."""
    return _PII_PATTERN.sub(lambda m: f"({m.group(1)})=(***)", msg)[:200]


def upsert_batch(supabase, batch: list[dict]) -> tuple[int, str | None]:
    """배치 UPSERT (onConflict: aca2000_id). (성공건수, 마스킹된 에러메시지)."""
    try:
        res = (
            supabase.table("students")
            .upsert(batch, on_conflict="aca2000_id")
            .execute()
        )
        return len(res.data or []), None
    except Exception as e:
        return 0, _mask_error(str(e))


# ─── main ─────────────────────────────────────────────────
def main() -> None:
    print("=" * 60)
    print(f"세정학원 학생 마이그레이션 · DRY_RUN={DRY_RUN} · ONLY_BRANCH={ONLY_BRANCH or 'all'}")
    print("=" * 60)

    supabase = None
    if not DRY_RUN:
        supabase = create_client(SUPABASE_URL, SUPABASE_SECRET)

    grand_total = {"raw": 0, "transformed": 0, "skipped": 0, "upserted": 0, "errors": 0}

    for db in DATABASES:
        if ONLY_BRANCH and db["branch_id"] != ONLY_BRANCH:
            continue

        label = f"{db['branch_name']} ({db['branch_id']})"
        print(f"\n📍 {label}")

        try:
            rows = fetch_students(db)
        except Exception as e:
            print(f"   ❌ 추출 실패: {e}")
            continue
        print(f"   raw: {len(rows):,}건")

        transformed: list[dict] = []
        skipped = 0
        for r in rows:
            t = transform(r, db["branch_name"], db["branch_id"])
            if t is None:
                skipped += 1
            else:
                transformed.append(t)
        print(f"   변환: {len(transformed):,}건 / skip: {skipped:,}건 (필수값 누락)")

        grand_total["raw"] += len(rows)
        grand_total["transformed"] += len(transformed)
        grand_total["skipped"] += skipped

        if DRY_RUN:
            # 샘플 1건 (PII 마스킹) 출력 + grade 분포 요약
            if transformed:
                s = transformed[0]
                print(
                    f"   sample: aca2000_id={s['aca2000_id']} "
                    f"name=*** parent_phone=***-****-{s['parent_phone'][-4:]} "
                    f"branch={s['branch']} "
                    f"grade_raw={s['grade_raw']!r} grade={s['grade']!r} "
                    f"school_level={s['school_level']!r}"
                )
                # 분원별 grade 분포 (정규화 결과 검증용)
                dist: dict[str, int] = {}
                for t in transformed:
                    dist[t["grade"]] = dist.get(t["grade"], 0) + 1
                dist_str = ", ".join(
                    f"{k}={v:,}" for k, v in sorted(dist.items())
                )
                print(f"   grade 분포: {dist_str}")
            continue

        # 실 UPSERT
        upserted = 0
        errors = 0
        for i in range(0, len(transformed), BATCH_SIZE):
            chunk = transformed[i : i + BATCH_SIZE]
            n, err = upsert_batch(supabase, chunk)
            if err:
                errors += len(chunk)
                print(f"   ❌ batch {i}: {err[:200]}")
            else:
                upserted += n
                print(f"   ✓ batch {i}: {n}건 upsert (누적 {upserted:,})")
        grand_total["upserted"] += upserted
        grand_total["errors"] += errors

    print("\n" + "=" * 60)
    print("📊 합계")
    for k, v in grand_total.items():
        print(f"   {k:<12}: {v:,}")
    if DRY_RUN:
        print("\n⚠️  DRY_RUN=1 — Supabase 에 INSERT 안 함. 실 적용은 DRY_RUN=0.")
    print("=" * 60)


if __name__ == "__main__":
    main()
