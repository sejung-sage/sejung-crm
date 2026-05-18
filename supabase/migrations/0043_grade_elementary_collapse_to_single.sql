-- 0043_grade_elementary_collapse_to_single.sql
-- 0041 의 초1~초6 (6종) 을 '초등' 단일 값으로 통합.
--
-- 배경 (2026-05-18):
--   학원 운영상 초등은 학년별 구분 의미가 낮고, 학년 칩이 13종으로 늘어
--   가독성 ↓. 초등생은 '초등' 한 칩으로 충분 (학년이 필요하면 학생 상세에서 grade_raw 확인).
--
-- 변경:
--   1) 기존 grade CHECK 제거 (백필이 '초등' 새 값을 사용할 수 있게).
--   2) 백필 — 기존 grade IN ('초1'~'초6') row 를 '초등' 으로 일괄 변경.
--   3) 새 grade CHECK 추가 — '초1'~'초6' 제거, '초등' 추가. 총 10종.
--      (초등, 중1~중3, 고1~고3, 재수, 졸업, 미정)
--   4) normalize_student_grade() — 학교가 초이면 grade_raw 무관 '초등'.
--
-- 순서 주의: CHECK 풀기 전에 UPDATE 를 시도하면 SQLSTATE 23514 위반.
-- 0041 시점 CHECK 가 '초등' 을 허용하지 않으므로 반드시 DROP → UPDATE → ADD.
--
-- 안전: 0041 의 derive_school_level / school_level CHECK 는 그대로 유지.
--   학교급은 여전히 초/중/고/기타 4종. 변경은 grade 만.
--
-- ROLLBACK:
--   0041 정의로 normalize_student_grade·CHECK 복원 후 grade='초등' row 를
--   grade_raw 기반으로 재계산 (또는 모두 NULL 로).

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) 기존 CHECK 먼저 제거 ───────────────────────────────
-- 백필이 UPDATE grade='초등' 을 시도하는데 0041 시점 CHECK 는 '초등' 미포함
-- (초1~초6 만 허용) 이라 SQLSTATE 23514 발생. CHECK 를 먼저 풀어야 한다.
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_grade_check;

-- ── 2) 백필 — 초1~초6 → 초등 ────────────────────────────
UPDATE public.students
SET grade = '초등'
WHERE grade IN ('초1','초2','초3','초4','초5','초6');

-- ── 3) 새 CHECK 추가 (10종) ──────────────────────────────
ALTER TABLE public.students
  ADD CONSTRAINT students_grade_check
  CHECK (grade IS NULL OR grade IN (
    '초등',
    '중1','중2','중3',
    '고1','고2','고3',
    '재수','졸업','미정'
  ));

-- ── 3) normalize_student_grade() 갱신 — 초이면 '초등' ─────
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

    -- 학교가 초이면 grade_raw 무관 '초등'.
    WHEN public.derive_school_level(grade_raw, school) = '초' THEN '초등'

    -- 1~3: 중/고 분기
    WHEN TRIM(grade_raw) = '1' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '중' THEN '중1' ELSE '고1'
      END
    WHEN TRIM(grade_raw) = '2' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '중' THEN '중2' ELSE '고2'
      END
    WHEN TRIM(grade_raw) = '3' THEN
      CASE public.derive_school_level(grade_raw, school)
        WHEN '중' THEN '중3' ELSE '고3'
      END

    -- 4: 재수
    WHEN TRIM(grade_raw) = '4' THEN '재수'

    -- 0, 5~10, '졸' = 졸업
    WHEN TRIM(grade_raw) IN ('0','5','6','7','8','9','10','졸') THEN '졸업'

    -- 명시적 학년 값은 그대로 통과.
    WHEN TRIM(grade_raw) IN (
      '초등',
      '중1','중2','중3','고1','고2','고3','재수','졸업','미정'
    ) THEN TRIM(grade_raw)

    ELSE '미정'
  END;
$$;

COMMENT ON FUNCTION public.normalize_student_grade(TEXT, TEXT) IS
  '정규화 학년 도출 — 초등/중1~중3/고1~고3/재수/졸업/미정 (총 10종). 학교가 초이면 grade_raw 무관 ''초등'' 단일 분류. 0043 에서 초1~초6 통합.';

COMMIT;
