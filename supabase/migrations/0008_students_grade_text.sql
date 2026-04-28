-- ============================================================
-- 0008_students_grade_text.sql
-- 세정학원 CRM · students.grade INT → TEXT 변환
--
-- 배경:
--   아카(Aca2000) MSSQL 의 V_student_list.학년 컬럼 분포를 보니
--   1~10 정수 + "고3"/"졸" 같은 한글 문자 + NULL 33K 까지 매우 다양.
--   기존 INT CHECK (grade IN (1, 2, 3)) 제약으로는 90% 이상 학생을 못 받음.
--
-- 변경:
--   1. students.grade INT → TEXT (CHECK 제약 제거)
--   2. 기존 일반 인덱스 idx_students_grade 도 TEXT 위에서 재생성
--
-- 호환성:
--   - 기존 코드의 grade 사용처 (TypeScript) 는 number → string | null 으로 갱신 필요
--   - UI 의 학년 필터 (고1/고2/고3 칩) 는 운영 정책에 따라 추후 동적 옵션으로 변환
--
-- 운영 메모:
--   - 빈 students 테이블 가정 (마이그레이션 0001~0007 만 있고 실 데이터 없음).
--     데이터 있을 경우 USING 변환 필요할 수 있음.
--
-- 롤백 (수동):
--   ALTER TABLE public.students ALTER COLUMN grade TYPE INT
--     USING NULLIF(regexp_replace(grade, '[^0-9]', '', 'g'), '')::INT;
--   ALTER TABLE public.students ADD CONSTRAINT students_grade_check
--     CHECK (grade IN (1, 2, 3));
-- ============================================================

BEGIN;

-- 1) student_profiles VIEW 가 grade 컬럼 참조 중 → 임시 DROP 후 재생성
--    (0002 마이그레이션의 정의를 그대로 복원, grade 만 TEXT 로 자동 적응)
DROP VIEW IF EXISTS public.student_profiles;

-- 2) CHECK 제약 제거 (이름은 자동 생성된 students_grade_check)
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_grade_check;

-- 3) 컬럼 타입 INT → TEXT
ALTER TABLE public.students
  ALTER COLUMN grade TYPE TEXT
  USING grade::TEXT;

COMMENT ON COLUMN public.students.grade IS
  '학년. 자유 형식 TEXT (예: "1"~"10", "고3", "졸", NULL). 아카 V_student_list.학년 그대로 보존.';

-- 4) 인덱스 재생성 (TEXT 컬럼 위)
DROP INDEX IF EXISTS public.idx_students_grade;
CREATE INDEX idx_students_grade ON public.students (grade);

-- 5) student_profiles VIEW 재생성 (0002 와 동일, grade 만 TEXT 자동 추론)
CREATE OR REPLACE VIEW public.student_profiles AS
SELECT
  s.id,
  s.name,
  s.school,
  s.grade,
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

COMMENT ON VIEW public.student_profiles IS '학생 프로필 (students + enrollments + attendances 집계)';
COMMENT ON COLUMN public.student_profiles.enrollment_count IS '총 수강 횟수';
COMMENT ON COLUMN public.student_profiles.total_paid IS '총 결제 금액 (원 단위)';
COMMENT ON COLUMN public.student_profiles.subjects IS '수강 과목 목록';
COMMENT ON COLUMN public.student_profiles.teachers IS '수강한 강사 목록';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS '출석률 (출석+지각 / 전체 × 100, 소수 1자리)';
COMMENT ON COLUMN public.student_profiles.last_attended_at IS '마지막 출석일';
COMMENT ON COLUMN public.student_profiles.last_paid_at IS '마지막 결제일';

COMMIT;
