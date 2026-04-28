"""
세정학원 CRM · ETL 학년 정규화 정책 (Python 측 미러)

DB 의 public.normalize_student_grade(grade_raw, school) /
public.derive_school_level(grade_raw, school) IMMUTABLE 함수 와
완전히 동일한 규칙을 Python 으로 재구현. ETL UPSERT 시 매 row 마다
RPC 를 호출하지 않고 클라이언트에서 정규화하여 성능 확보.

0012 마이그레이션 (supabase/migrations/0012_students_normalized_grade.sql)
의 SQL 정의를 1:1 번역. 정의 변경 시 양쪽을 동시에 갱신해야 정합성 유지.

사용:
    from grade_policy import normalize_grade, derive_school_level

    grade = normalize_grade(row.get("학년"), row.get("학교"))   # → '중1'~'미정' 9종
    level = derive_school_level(row.get("학년"), row.get("학교"))  # → '중'/'고'/'기타'

매핑표 (DB 함수와 동일):

    grade_raw      | school 끝         | grade 결과
    ---------------|-------------------|-----------
    '1'/'2'/'3'    | '중' or '중학교'   | 중1/중2/중3
    '1'/'2'/'3'    | 그 외             | 고1/고2/고3
    '4'            | *                 | 재수
    '0','5'~'10'   | *                 | 졸업
    '졸'           | *                 | 졸업
    '고3'          | *                 | 고3
    그 외/NULL/공백 | *                 | 미정
"""

from __future__ import annotations

from typing import Any

# DB normalize_student_grade 결과로 사용 가능한 9종 enum.
GRADE_VALUES: tuple[str, ...] = (
    "중1", "중2", "중3",
    "고1", "고2", "고3",
    "재수", "졸업", "미정",
)
SCHOOL_LEVEL_VALUES: tuple[str, ...] = ("중", "고", "기타")


def _strip(v: Any) -> str:
    """입력을 문자열로 통일하고 양쪽 공백 제거. None/공백은 빈문자열."""
    if v is None:
        return ""
    return str(v).strip()


def _is_middle_school(school: Any) -> bool:
    """학교명이 중학교 suffix 인지.
    "○○중" (마지막 1글자) 또는 "○○중학교" 로 끝나면 True.
    DB derive_school_level 의 '중' 분기와 동일.
    """
    s = _strip(school)
    if not s:
        return False
    if s.endswith("중학교"):
        return True
    return s[-1] == "중"


def _is_high_school(school: Any) -> bool:
    """학교명이 고등학교 suffix 인지.
    "○○고" (마지막 1글자) 또는 "○○고등학교" 로 끝나면 True.
    """
    s = _strip(school)
    if not s:
        return False
    if s.endswith("고등학교"):
        return True
    return s[-1] == "고"


def derive_school_level(grade_raw: Any, school: Any) -> str:
    """학교급 도출. '중' / '고' / '기타' 중 하나 반환.

    DB derive_school_level(grade_raw, school) 과 동일 규칙:
      1. 학교명 suffix '중'/'중학교' → '중'
      2. 학교명 suffix '고'/'고등학교' → '고'
      3. 학교명 없음 + grade_raw NULL/공백 → '기타'
      4. 학교명 없음 + '고3'/'졸' → '고'
      5. 학교명 없음 + 정수 → '고' (학원 고등부 위주)
      6. 그 외 → '기타'
    """
    if _is_middle_school(school):
        return "중"
    if _is_high_school(school):
        return "고"

    g = _strip(grade_raw)
    if not g:
        return "기타"
    if g in ("고3", "졸"):
        return "고"
    if g.isdigit():
        return "고"
    return "기타"


def normalize_grade(grade_raw: Any, school: Any) -> str:
    """학년 정규화. 9종 enum 중 하나 반환 (NULL 반환 안 함).

    DB normalize_student_grade(grade_raw, school) 와 동일.
    재실행 idempotent: 이미 정규화된 enum 값이면 그대로 반환.
    """
    g = _strip(grade_raw)

    # NULL / 공백 → 미정
    if not g:
        return "미정"

    # 이미 정규화된 enum 값이면 그대로 (재실행 안전).
    if g in GRADE_VALUES:
        return g

    # 명시적 한글 표기
    if g == "졸":
        return "졸업"
    # '고3' 은 GRADE_VALUES 에 이미 포함되어 위에서 처리됨.

    # 정수 1/2/3 + school suffix 로 중/고 분기
    if g == "1":
        return "중1" if _is_middle_school(school) else "고1"
    if g == "2":
        return "중2" if _is_middle_school(school) else "고2"
    if g == "3":
        return "중3" if _is_middle_school(school) else "고3"

    # 4 = 재수
    if g == "4":
        return "재수"

    # 0, 5~10 = 장기 재수 / 졸업과 통합
    if g in ("0", "5", "6", "7", "8", "9", "10"):
        return "졸업"

    # 알 수 없는 값 → 방어적으로 미정
    return "미정"


# ─── self-test (python scripts/etl/grade_policy.py) ─────────
if __name__ == "__main__":
    assert normalize_grade("2", "대왕중") == "중2"
    assert normalize_grade("2", "휘문중학교") == "중2"
    assert normalize_grade("2", "휘문고") == "고2"
    assert normalize_grade("2", "휘문고등학교") == "고2"
    assert normalize_grade("2", None) == "고2"  # NULL school → 고 추정
    assert normalize_grade("3", "대왕중") == "중3"
    assert normalize_grade("3", None) == "고3"
    assert normalize_grade("4", None) == "재수"
    assert normalize_grade("졸", "휘문고") == "졸업"
    assert normalize_grade("0", None) == "졸업"
    assert normalize_grade("8", None) == "졸업"
    assert normalize_grade("10", None) == "졸업"
    assert normalize_grade(None, None) == "미정"
    assert normalize_grade("", None) == "미정"
    assert normalize_grade("  ", None) == "미정"
    assert normalize_grade("abc", None) == "미정"
    # idempotent
    assert normalize_grade("중2", "대왕중") == "중2"
    assert normalize_grade("고1", None) == "고1"
    assert normalize_grade("미정", None) == "미정"

    assert derive_school_level("2", "대왕중") == "중"
    assert derive_school_level("2", "휘문고") == "고"
    assert derive_school_level("2", None) == "고"
    assert derive_school_level(None, None) == "기타"
    assert derive_school_level("졸", None) == "고"
    assert derive_school_level("고3", None) == "고"
    assert derive_school_level("abc", None) == "기타"

    print("✓ grade_policy self-test passed")
