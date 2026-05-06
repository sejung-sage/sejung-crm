-- ============================================================
-- 0026_student_profiles_region.sql
-- student_profiles 뷰 재정의 — region 컬럼 추가
--
-- 배경:
--   0025 에서 public.school_regions (school → region) 매핑 테이블을 만들었다.
--   학생 명단 필터/발송 그룹 빌더에서 "강남구", "서초구" 단위로 학생을 모아
--   조회할 수 있도록, student_profiles 뷰에 region 컬럼을 derive 해 추가.
--
--   매칭 키 정책:
--     - LEFT JOIN public.school_regions sr ON sr.school = s.school
--     - 매칭 안 되면 region = '기타' (COALESCE)
--     - school 이 NULL 인 학생도 '기타' 로 잡힘 (NULL 비교 → COALESCE fallback)
--
-- 변경 요약:
--   - 0018 의 student_profiles 정의를 base 로 LEFT JOIN school_regions 추가
--   - SELECT 절 끝에 COALESCE(sr.region, '기타') AS region 추가
--   - GROUP BY 에 sr.region 추가 (집계 식 외부)
--   - 다른 컬럼/COMMENT/RLS 영향 없음 — CREATE OR REPLACE VIEW 로 멱등
--
-- 멱등성: CREATE OR REPLACE VIEW
--
-- 롤백 (수동):
--   BEGIN;
--     -- 0018 의 정의로 복원 (region 컬럼 제거)
--     CREATE OR REPLACE VIEW public.student_profiles AS
--     SELECT s.id, s.name, s.school, s.grade, s.grade_raw, s.school_level,
--            s.track, s.status, s.branch, s.parent_phone, s.phone, s.registered_at,
--            COUNT(DISTINCT e.id) AS enrollment_count,
--            COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
--            ARRAY_AGG(DISTINCT e.subject) FILTER (WHERE e.subject IS NOT NULL) AS subjects,
--            ARRAY_AGG(DISTINCT e.teacher_name) FILTER (WHERE e.teacher_name IS NOT NULL) AS teachers,
--            ROUND(AVG(CASE WHEN a.status IN ('출석','지각','보강') THEN 1.0 ELSE 0.0 END) * 100, 1) AS attendance_rate,
--            MAX(a.attended_at) AS last_attended_at,
--            MAX(e.paid_at) AS last_paid_at
--     FROM public.students s
--     LEFT JOIN public.enrollments e ON e.student_id = s.id
--     LEFT JOIN public.attendances a ON a.student_id = s.id
--     GROUP BY s.id;
--   COMMIT;
-- ============================================================

BEGIN;

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
      CASE WHEN a.status IN ('출석', '지각', '보강') THEN 1.0 ELSE 0.0 END
    ) * 100, 1
  ) AS attendance_rate,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.students s
LEFT JOIN public.enrollments e   ON e.student_id = s.id
LEFT JOIN public.attendances a   ON a.student_id = s.id
LEFT JOIN public.school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (students + enrollments + attendances 집계 + school_regions 지역 매핑). 0026 에서 region 컬럼 추가 (학교 → 지역 매핑, 미매칭은 ''기타'').';
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
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 ((출석+지각+보강) / 전체 × 100, 소수 1자리). 보강 = 동영상강의 대체 수강, 출석 인정. 0018 변경.';
COMMENT ON COLUMN public.student_profiles.last_attended_at IS '마지막 출석일';
COMMENT ON COLUMN public.student_profiles.last_paid_at IS '마지막 결제일';
COMMENT ON COLUMN public.student_profiles.region IS
  '지역명 (예: "강남구", "서초구"). school_regions LEFT JOIN 결과. 매칭 실패/학교 NULL 시 ''기타''. 학생 명단/발송 그룹의 지역 필터 대상. 0026 추가.';

COMMIT;
