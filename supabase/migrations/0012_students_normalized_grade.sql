-- ============================================================
-- 0012_students_normalized_grade.sql
-- 세정학원 CRM · students.grade 정규화 (자유형식 TEXT → 9종 enum)
--
-- 배경:
--   0008 마이그레이션에서 students.grade 를 자유형식 TEXT 로 바꿔
--   아카(Aca2000) V_student_list.학년 원값 ("1"~"10", "고3", "졸", NULL...)
--   을 그대로 받고 있음. 실 데이터 약 10만 건 분포:
--     NULL: 30,932 / "4": 16,114 / "3": 15,938 / "2": 13,097 / "5": 9,575
--     "1": 8,445 / "6": 2,392 / "8": 2,016 / "7": 842 / "0": 411
--     "10": 233 / "9": 72 / "고3": 50 / "졸": 15
--
--   원장 인터뷰 결과:
--     - 같은 정수 "1"·"2"·"3" 도 학교 컬럼이 "○○중" 으로 끝나면 중1/중2/중3,
--       그 외(NULL/고/기타) 면 고1/고2/고3.
--     - "4" 는 재수, "5" 이상은 장기 재수(=졸업과 통합).
--     - "0" / NULL 은 정리되지 않은 데이터 → "미정".
--   즉 grade 단독으론 의미 결정 불가하고 school 과 결합 필요.
--
-- 변경 요약:
--   1. 새 컬럼 grade_raw (TEXT) 추가 — 아카 원값 백업.
--   2. 새 컬럼 school_level (TEXT, 중/고/기타) 추가.
--   3. 정규화 함수 normalize_student_grade / derive_school_level (IMMUTABLE) 정의.
--   4. 기존 grade 컬럼 의미를 자유 TEXT → 9종 정규화 enum 으로 전환.
--      - 백필: grade_raw ← 기존 grade, grade ← normalize_student_grade(grade_raw, school).
--      - CHECK 제약 (중1/중2/중3/고1/고2/고3/재수/졸업/미정) 추가.
--   5. student_profiles VIEW 재생성 (grade_raw, school_level 노출).
--   6. 인덱스 추가: idx_students_school_level, idx_students_grade_raw.
--
-- 범위 밖 (이번 마이그레이션에서 제외):
--   - enrollment_status 추가 — 보류. 수업마다 end_date 가 안 채워진 케이스가
--     있어 신호가 약함 (사용자 결정).
--   - ETL 스크립트 갱신 — backend-dev 가 normalize_student_grade(...) 호출하도록 별도 작업.
--   - UI 필터 갱신 — frontend-dev 가 새 enum 칩으로 교체 별도 작업.
--
-- 롤백 (수동):
--   BEGIN;
--     DROP VIEW IF EXISTS public.student_profiles;
--     ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_grade_check;
--     -- grade 를 grade_raw 의 원값으로 복원
--     UPDATE public.students SET grade = grade_raw;
--     ALTER TABLE public.students DROP COLUMN IF EXISTS grade_raw;
--     ALTER TABLE public.students DROP COLUMN IF EXISTS school_level;
--     DROP INDEX IF EXISTS public.idx_students_school_level;
--     DROP INDEX IF EXISTS public.idx_students_grade_raw;
--     DROP FUNCTION IF EXISTS public.normalize_student_grade(TEXT, TEXT);
--     DROP FUNCTION IF EXISTS public.derive_school_level(TEXT, TEXT);
--     -- 0008 의 student_profiles VIEW 정의로 복원 (해당 파일 51~79줄 참조)
--   COMMIT;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) student_profiles VIEW DROP (grade 컬럼 의존)
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.student_profiles;


-- ------------------------------------------------------------
-- 2) 정규화 함수 — school_level 도출
--
--   "○○중" / "○○중학교" 로 끝나면 '중', "○○고" / "○○고등학교" 로 끝나면 '고',
--   그 외(NULL 학교 + 정수 grade) 는 grade 가 1~10 범위면 '고' 로 추정,
--   grade_raw 가 NULL 이면 '기타'.
--
--   주의:
--   - "휘문고등학교" 가 '중' 으로 잘못 매칭되지 않게 RIGHT(...) 비교는
--     문자 1자 ('중') 을 고정으로 보고, '중학교' 만 LIKE 로 보강.
--   - school 이 NULL/공백이면 grade_raw 만 보고 추정 ('고' 추정 or '기타').
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
  '학생의 school_level (중/고/기타) 도출. school 컬럼 suffix(중/중학교/고/고등학교) 우선, 없으면 grade_raw 로 추정. IMMUTABLE 이라 ETL/뷰에서도 호출 가능.';


-- ------------------------------------------------------------
-- 3) 정규화 함수 — grade 도출 (9종 enum)
--
--   도출 표:
--     grade_raw '1'/'2'/'3' + school_level '중'  → 중1/중2/중3
--     grade_raw '1'/'2'/'3' + school_level '고'/'기타' → 고1/고2/고3
--     grade_raw '4'                              → 재수
--     grade_raw '0'/'5'~'10'/'졸'                → 졸업
--     grade_raw '고3'                            → 고3
--     grade_raw NULL/공백/알 수 없는 값          → 미정 (방어적)
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
  '학생 학년 정규화 (중1/중2/중3/고1/고2/고3/재수/졸업/미정 9종). 아카 원값(grade_raw)+학교명 기반. IMMUTABLE 이라 ETL UPSERT, generated column, 뷰에서 모두 호출 가능.';


-- ------------------------------------------------------------
-- 4) 새 컬럼 추가
-- ------------------------------------------------------------
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS grade_raw TEXT,
  ADD COLUMN IF NOT EXISTS school_level TEXT;

COMMENT ON COLUMN public.students.grade_raw IS
  '아카(Aca2000) V_student_list.학년 원본 값. "1"~"10"/"고3"/"졸"/NULL 등 자유 형식. 정규화 결과는 grade 컬럼.';
COMMENT ON COLUMN public.students.school_level IS
  '학교급 (중/고/기타). school+grade_raw 조합으로 derive_school_level() 도출. UI 1차 필터(중등/고등 분리)에서 사용.';


-- ------------------------------------------------------------
-- 5) 백필
--   (a) grade_raw 에 기존 grade 원값 복사
--   (b) grade 를 정규화된 enum 값으로 덮어쓰기
--   (c) school_level 채우기
--
--   주의: 단계별로 분리해 grade UPDATE 가 grade_raw 를 참조할 수 있게 한다.
-- ------------------------------------------------------------
UPDATE public.students
   SET grade_raw = grade
 WHERE grade_raw IS NULL;

UPDATE public.students
   SET grade        = public.normalize_student_grade(grade_raw, school),
       school_level = public.derive_school_level(grade_raw, school);


-- ------------------------------------------------------------
-- 6) CHECK 제약
--   기존 0008 의 자유형식 grade 제약은 없음 (DROP 됨). 새 enum 제약 추가.
-- ------------------------------------------------------------
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_grade_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_grade_check
  CHECK (grade IS NULL OR grade IN (
    '중1','중2','중3','고1','고2','고3','재수','졸업','미정'
  ));

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_school_level_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_school_level_check
  CHECK (school_level IS NULL OR school_level IN ('중','고','기타'));

COMMENT ON COLUMN public.students.grade IS
  '정규화된 학년 (중1/중2/중3/고1/고2/고3/재수/졸업/미정 9종). 0012 마이그레이션에서 자유 TEXT → enum 으로 의미 변경. 원값은 grade_raw 컬럼 참조.';


-- ------------------------------------------------------------
-- 7) 인덱스
--   기존 idx_students_grade 는 0008 에서 만들어 둔 일반 인덱스 유지 (TEXT enum).
--   추가:
--     - idx_students_school_level : 중/고 1차 필터링
--     - idx_students_grade_raw    : ETL 재실행 시 원값 비교/디버그
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_students_school_level
  ON public.students (school_level);

CREATE INDEX IF NOT EXISTS idx_students_grade_raw
  ON public.students (grade_raw);


-- ------------------------------------------------------------
-- 8) student_profiles VIEW 재생성
--   0008 의 정의 + grade_raw / school_level 노출.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.student_profiles AS
SELECT
  s.id,
  s.name,
  s.school,
  s.grade,
  s.grade_raw,
  s.school_level,
  s.track,
  s.status,
  s.branch,
  s.parent_phone,
  s.phone,
  s.registered_at,
  COUNT(DISTINCT e.id) AS enrollment_count,
  COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
  ARRAY_AGG(DISTINCT e.subject)
    FILTER (WHERE e.subject IS NOT NULL) AS subjects,
  ARRAY_AGG(DISTINCT e.teacher_name)
    FILTER (WHERE e.teacher_name IS NOT NULL) AS teachers,
  ROUND(
    AVG(
      CASE WHEN a.status IN ('출석', '지각') THEN 1.0 ELSE 0.0 END
    ) * 100, 1
  ) AS attendance_rate,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at
FROM public.students s
LEFT JOIN public.enrollments e ON e.student_id = s.id
LEFT JOIN public.attendances a ON a.student_id = s.id
GROUP BY s.id;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (students + enrollments + attendances 집계). 0012 에서 grade_raw / school_level 컬럼 노출 추가.';
COMMENT ON COLUMN public.student_profiles.grade IS
  '정규화된 학년 (중1~고3/재수/졸업/미정 9종). UI 필터 대상.';
COMMENT ON COLUMN public.student_profiles.grade_raw IS
  '아카 V_student_list.학년 원본 값. 디버그·ETL 재처리용.';
COMMENT ON COLUMN public.student_profiles.school_level IS
  '학교급 (중/고/기타). UI 1차 필터.';
COMMENT ON COLUMN public.student_profiles.enrollment_count IS '총 수강 횟수';
COMMENT ON COLUMN public.student_profiles.total_paid IS '총 결제 금액 (원 단위)';
COMMENT ON COLUMN public.student_profiles.subjects IS '수강 과목 목록';
COMMENT ON COLUMN public.student_profiles.teachers IS '수강한 강사 목록';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS '출석률 (출석+지각 / 전체 × 100, 소수 1자리)';
COMMENT ON COLUMN public.student_profiles.last_attended_at IS '마지막 출석일';
COMMENT ON COLUMN public.student_profiles.last_paid_at IS '마지막 결제일';

COMMIT;
