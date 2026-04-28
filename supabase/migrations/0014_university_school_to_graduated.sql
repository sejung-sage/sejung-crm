-- ============================================================
-- 0014_university_school_to_graduated.sql
-- 세정학원 CRM · 학교가 "대학교" 인 학생을 학년 '졸업' 으로 분류.
--
-- 배경:
--   0012 의 normalize_student_grade(grade_raw, school) /
--   derive_school_level(grade_raw, school) 는 학교명 suffix 가
--   '중'/'중학교'/'고'/'고등학교' 인 경우만 학교급을 결정한다.
--   "○○대학교" 는 끝글자가 '교' 라 어디에도 매칭되지 않아
--   school_level='기타' + (grade_raw 에 따라) grade='미정' 으로 떨어졌다.
--
--   원장 결정: 학교 컬럼이 대학교(대학교/대학원/Univ) 로 표기된 학생은
--   학원 운영상 "졸업" 과 동일하게 취급한다 (학원 OB).
--
-- 변경:
--   1) derive_school_level() 함수 재정의 — 대학교 분기를 최상단에 추가하고
--      '기타' 반환 (UI 의 중/고 1차 필터에 노출되지 않도록).
--   2) normalize_student_grade() 함수 재정의 — 대학교 분기를 최상단에 추가하고
--      '졸업' 반환 (grade_raw 값과 무관하게).
--   3) 백필 — 모든 학생을 두 함수로 재정규화.
--      (0012 와 동일한 UPDATE. 함수가 IMMUTABLE 이라 같은 입력엔 같은 출력.)
--
-- 매칭 규칙:
--   - school ILIKE '%대학교%' → 대학교 학생 (예: '서울대학교', '연세대학교',
--     '○○대학교 의예과' 등 부속 정보 포함)
--   - 부분 일치(`%대학%`) 는 사용하지 않음. "○○대학" 처럼 학교가 아닌
--     일반 명칭 매칭 위험을 피한다.
--
-- 영향 범위:
--   - students.grade / students.school_level 일괄 갱신.
--   - 인덱스/뷰/다른 테이블 컬럼은 그대로.
--
-- 롤백 (수동):
--   0012 의 함수 정의를 다시 적용하고 동일 백필 UPDATE 를 한 번 더 수행.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) derive_school_level() — 대학교 분기 최상단 추가
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_school_level(
  grade_raw TEXT,
  school TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- 학교가 대학교 → '기타' (UI 중/고 1차 필터 노출 X)
    WHEN school IS NOT NULL AND school ILIKE '%대학교%'
      THEN '기타'
    -- 학교명이 분명히 중학교
    WHEN school IS NOT NULL
      AND (RIGHT(TRIM(school), 1) = '중' OR TRIM(school) LIKE '%중학교')
      THEN '중'
    -- 학교명이 분명히 고등학교
    WHEN school IS NOT NULL
      AND (RIGHT(TRIM(school), 1) = '고' OR TRIM(school) LIKE '%고등학교')
      THEN '고'
    -- 학교명 없음 + grade_raw NULL → 기타(미정)
    WHEN grade_raw IS NULL OR TRIM(grade_raw) = ''
      THEN '기타'
    -- 학교명 없음 + 한글 표기 ("고3", "졸") → 고로 간주
    WHEN TRIM(grade_raw) IN ('고3', '졸')
      THEN '고'
    -- 학교명 없음 + 정수 grade → 학원 운영상 고등부 위주이므로 '고' 로 추정
    WHEN TRIM(grade_raw) ~ '^[0-9]+$'
      THEN '고'
    ELSE '기타'
  END;
$$;

COMMENT ON FUNCTION public.derive_school_level(TEXT, TEXT) IS
  '학생의 school_level (중/고/기타) 도출. school ILIKE ''%대학교%'' 우선 → 기타. 그 외엔 school 컬럼 suffix(중/중학교/고/고등학교) 기준, 없으면 grade_raw 로 추정. IMMUTABLE.';


-- ------------------------------------------------------------
-- 2) normalize_student_grade() — 대학교 분기 최상단 추가
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_student_grade(
  grade_raw TEXT,
  school TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- 학교가 대학교 → grade_raw 와 무관하게 '졸업'
    WHEN school IS NOT NULL AND school ILIKE '%대학교%' THEN '졸업'

    -- NULL / 공백 → 미정
    WHEN grade_raw IS NULL OR TRIM(grade_raw) = '' THEN '미정'

    -- 명시적 한글 표기
    WHEN TRIM(grade_raw) = '고3' THEN '고3'
    WHEN TRIM(grade_raw) = '졸'  THEN '졸업'

    -- 정수 1/2/3 + 학교 suffix 로 중/고 분기
    WHEN TRIM(grade_raw) = '1' THEN
      CASE WHEN public.derive_school_level(grade_raw, school) = '중'
           THEN '중1' ELSE '고1' END
    WHEN TRIM(grade_raw) = '2' THEN
      CASE WHEN public.derive_school_level(grade_raw, school) = '중'
           THEN '중2' ELSE '고2' END
    WHEN TRIM(grade_raw) = '3' THEN
      CASE WHEN public.derive_school_level(grade_raw, school) = '중'
           THEN '중3' ELSE '고3' END

    -- 4 = 재수
    WHEN TRIM(grade_raw) = '4' THEN '재수'

    -- 0, 5~10 = 장기 재수 / 졸업과 통합
    WHEN TRIM(grade_raw) IN ('0', '5', '6', '7', '8', '9', '10') THEN '졸업'

    -- 알 수 없는 값 → 방어적으로 미정
    ELSE '미정'
  END;
$$;

COMMENT ON FUNCTION public.normalize_student_grade(TEXT, TEXT) IS
  '학생 학년 정규화 (중1/중2/중3/고1/고2/고3/재수/졸업/미정 9종). school ILIKE ''%대학교%'' 우선 → 졸업. 그 외엔 grade_raw + 학교명 기반. IMMUTABLE.';


-- ------------------------------------------------------------
-- 3) 백필 — 모든 학생을 두 함수로 재정규화
--   대학교 분기가 새로 들어왔으므로 기존 '미정'/'고1' 등으로 잘못 분류된
--   대학생들이 '졸업' 으로 옮겨진다. 비대학생 학생은 0012 와 동일한 결과
--   (함수 IMMUTABLE) 라 변동 없음.
-- ------------------------------------------------------------
UPDATE public.students
   SET grade        = public.normalize_student_grade(grade_raw, school),
       school_level = public.derive_school_level(grade_raw, school);

COMMIT;
