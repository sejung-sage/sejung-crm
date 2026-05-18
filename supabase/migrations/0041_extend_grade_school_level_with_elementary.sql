-- 0041_extend_grade_school_level_with_elementary.sql
-- grade / school_level CHECK 확장: 초등(초1~초6) 추가.
--
-- 배경 (2026-05-15):
--   0012 정규화 enum 이 중/고/기타·중1~고3+재수+졸업+미정 만 지원. 학원이 초등반
--   운영을 확장하면서 초등학생을 일반 학년·학교급 필터로 분류 필요.
--   - grade: '초1','초2','초3','초4','초5','초6' 추가 (총 15종)
--   - school_level: '초' 추가 (총 4종: 초/중/고/기타)
--
-- 변경:
--   1) CHECK 제약 갱신 — 위 신규 enum 값 허용.
--   2) derive_school_level() — 학교명 끝 패턴 '%초등학교'/'%초' 우선 매칭 → '초'.
--   3) normalize_student_grade() — grade_raw "1"~"6" 가 학교가 초이면 초1~초6.
--      "4"/"5"/"6" 도 학교가 초면 초4/초5/초6 (이전엔 재수·졸업).
--   4) 백필 — 학교가 초인 학생의 grade·school_level 재계산.
--
-- 안전:
--   - SET LOCAL statement_timeout '5min' 으로 6만 row UPDATE 안전.
--   - derive_school_level / normalize_student_grade 는 IMMUTABLE STABLE 함수라
--     변경 후 의존 인덱스 영향 없음. student_profiles 뷰는 학생 컬럼 직접 노출이라
--     함수 변경과 무관.
--   - 학교명 끝 '%고','%중' 이 학교명 안에 '초' 가 있어도 우선 적용되도록 CASE
--     순서: 초등학교 → 중학교 → 고등학교 → 줄임형. (전체 끝글자 패턴 안전.)
--
-- ROLLBACK:
--   CHECK 만 0012 정의로 복원 후 함수도 0012 정의로. 백필된 grade='초N' /
--   school_level='초' 학생은 grade='미정', school_level='기타' 로 변경 필요.

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) CHECK 제약 갱신 ───────────────────────────────────
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_grade_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_grade_check
  CHECK (grade IS NULL OR grade IN (
    '초1','초2','초3','초4','초5','초6',
    '중1','중2','중3',
    '고1','고2','고3',
    '재수','졸업','미정'
  ));

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_school_level_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_school_level_check
  CHECK (school_level IS NULL OR school_level IN ('초','중','고','기타'));

-- ── 2) derive_school_level() 갱신 — 초 추가 ─────────────
CREATE OR REPLACE FUNCTION public.derive_school_level(
  grade_raw TEXT,
  school    TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- 학교명 끝 패턴 우선 (구체적인 패턴 먼저).
    WHEN school IS NOT NULL AND (school LIKE '%초등학교') THEN '초'
    WHEN school IS NOT NULL AND (school LIKE '%중학교')   THEN '중'
    WHEN school IS NOT NULL AND (school LIKE '%고등학교') THEN '고'
    -- 줄임형 끝 글자 — 한 글자 매칭이므로 가장 마지막.
    WHEN school IS NOT NULL AND (school LIKE '%초') THEN '초'
    WHEN school IS NOT NULL AND (school LIKE '%중') THEN '중'
    WHEN school IS NOT NULL AND (school LIKE '%고') THEN '고'
    -- 학교 정보 없을 때 grade_raw 로 추정 — 초등 식별 불가. 기타.
    ELSE '기타'
  END;
$$;

COMMENT ON FUNCTION public.derive_school_level(TEXT, TEXT) IS
  '학생의 school_level (초/중/고/기타) 도출. 학교명 끝 패턴 우선(○○초등학교/○○중학교/○○고등학교 → ○○초/○○중/○○고). 0041 에서 초 추가.';

-- ── 3) normalize_student_grade() 갱신 — 초1~초6 분기 추가 ─
CREATE OR REPLACE FUNCTION public.normalize_student_grade(
  grade_raw TEXT,
  school    TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN grade_raw IS NULL OR TRIM(grade_raw) = '' THEN '미정'

    -- 1~3: 학교급에 따라 초1/중1/고1 ...
    WHEN TRIM(grade_raw) = '1' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '초' THEN '초1' WHEN '중' THEN '중1' ELSE '고1'
      END
    WHEN TRIM(grade_raw) = '2' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '초' THEN '초2' WHEN '중' THEN '중2' ELSE '고2'
      END
    WHEN TRIM(grade_raw) = '3' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '초' THEN '초3' WHEN '중' THEN '중3' ELSE '고3'
      END

    -- 4: 학교가 초 → 초4, 아니면 재수 (기존 정책).
    WHEN TRIM(grade_raw) = '4' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '초' THEN '초4' ELSE '재수'
      END

    -- 5,6: 학교가 초 → 초5/초6, 아니면 졸업 (장기 재수).
    WHEN TRIM(grade_raw) = '5' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '초' THEN '초5' ELSE '졸업'
      END
    WHEN TRIM(grade_raw) = '6' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '초' THEN '초6' ELSE '졸업'
      END

    -- 0, 7~10, '졸' = 졸업
    WHEN TRIM(grade_raw) IN ('0','7','8','9','10','졸') THEN '졸업'

    -- 명시적 학년 값 (예: "고3", "초5") 도 그대로 통과.
    WHEN TRIM(grade_raw) IN (
      '초1','초2','초3','초4','초5','초6',
      '중1','중2','중3','고1','고2','고3','재수','졸업','미정'
    ) THEN TRIM(grade_raw)

    ELSE '미정'
  END;
$$;

COMMENT ON FUNCTION public.normalize_student_grade(TEXT, TEXT) IS
  '정규화 학년 도출 — 초1~초6/중1~중3/고1~고3/재수/졸업/미정. grade_raw 의 숫자값을 학교급 분기 후 매핑. 0041 에서 초1~초6 분기 추가.';

-- ── 4) 백필 ───────────────────────────────────────────────
-- 학교가 초인 학생들의 school_level/grade 가 0012 시점 함수로 산출되어
-- '기타'/'미정' 또는 잘못된 중·고 학년으로 남아 있을 수 있음. 일괄 재계산.
UPDATE public.students
SET
  school_level = public.derive_school_level(grade_raw, school),
  grade        = public.normalize_student_grade(grade_raw, school)
WHERE
  school_level IS DISTINCT FROM public.derive_school_level(grade_raw, school)
  OR grade IS DISTINCT FROM public.normalize_student_grade(grade_raw, school);

COMMIT;
