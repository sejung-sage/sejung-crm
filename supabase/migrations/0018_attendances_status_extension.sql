-- ============================================================
-- 0018_attendances_status_extension.sql
-- attendances 테이블 status enum 확장 + aca_class_id 컬럼 추가
--
-- 배경:
--   V_Attend_List DRY_RUN 결과 status 분포:
--     출석   14,816 (89.0%)
--     결석    1,907 (11.0%)
--     보강      304 ( 1.8%)
--     지각       32 ( 0.2%)
--     조퇴        0
--
--   기존 0001 schema 의 attendances.status CHECK 제약은
--     CHECK (status IN ('출석', '지각', '결석', '조퇴'))
--   로 정의되어 있어, '보강' 데이터를 ETL 로 받으면 위반.
--
--   사용자 확인:
--     '보강' = 결석분을 동영상강의로 대체 수강한 케이스.
--             따라서 출석률 계산에서도 '출석 인정' 으로 본다.
--
--   또한 현재 ETL 은 V_Attend_List.반고유_코드 를 SELECT 하지 않아
--   어떤 강좌의 출결인지 추적 불가 (enrollment_id 도 NULL 다수).
--   학생 상세 페이지 "강좌 × 일자 격자" UI 를 만들기 위해
--   attendances.aca_class_id (= "{branch_id}-{반고유_코드}") 가 필요.
--   classes.aca_class_id 와 매칭되며 FK 는 두지 않는다
--   (enrollments.aca_class_id 와 같은 정책 — 0010/0016 참조).
--
-- 변경 요약:
--   1. attendances_status_check 제약 DROP + 5종 enum 으로 재추가.
--      ('출석', '지각', '결석', '조퇴', '보강')
--   2. attendances.aca_class_id TEXT 컬럼 추가 + 인덱스.
--   3. student_profiles VIEW 재생성 — attendance_rate 식의
--      IN 절에 '보강' 추가 ('출석', '지각', '보강' 모두 출석 인정).
--      나머지 컬럼·COMMENT 는 0012 정의 그대로 복제.
--
-- 멱등성:
--   - 제약 DROP/ADD 는 DO 블록으로 가드.
--   - 컬럼/인덱스 는 IF NOT EXISTS.
--   - 뷰는 CREATE OR REPLACE.
--
-- 롤백 (수동):
--   BEGIN;
--     -- (1) 뷰: 0012 의 attendance_rate 식으로 복원
--     CREATE OR REPLACE VIEW public.student_profiles AS ...
--       (CASE WHEN a.status IN ('출석','지각') THEN 1.0 ELSE 0.0 END)
--     -- (2) aca_class_id 제거
--     DROP INDEX IF EXISTS public.idx_attendances_aca_class_id;
--     ALTER TABLE public.attendances DROP COLUMN IF EXISTS aca_class_id;
--     -- (3) status 제약 4종 복원
--     ALTER TABLE public.attendances DROP CONSTRAINT IF EXISTS attendances_status_check;
--     -- 단, 이미 '보강' 데이터가 들어왔다면 먼저 정리 필요.
--     ALTER TABLE public.attendances
--       ADD CONSTRAINT attendances_status_check
--       CHECK (status IN ('출석', '지각', '결석', '조퇴'));
--   COMMIT;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) status CHECK 제약 확장 — '보강' 추가
--   PostgreSQL 기본 제약명 'attendances_status_check' 시도.
--   존재하지 않으면 NOTICE 후 통과 (멱등성).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendances_status_check'
      AND conrelid = 'public.attendances'::regclass
  ) THEN
    ALTER TABLE public.attendances
      DROP CONSTRAINT attendances_status_check;
    RAISE NOTICE 'Dropped existing attendances_status_check.';
  ELSE
    RAISE NOTICE 'attendances_status_check not found — skipping DROP.';
  END IF;
END$$;

ALTER TABLE public.attendances
  ADD CONSTRAINT attendances_status_check
  CHECK (status IN ('출석', '지각', '결석', '조퇴', '보강'));

COMMENT ON CONSTRAINT attendances_status_check ON public.attendances IS
  '출결 상태 5종 enum (출석/지각/결석/조퇴/보강). 보강 = 결석분 동영상강의 대체 수강. 0018 에서 4종 → 5종 확장.';

COMMENT ON COLUMN public.attendances.status IS
  '출결 상태 (출석/지각/결석/조퇴/보강). 보강은 결석분을 동영상강의로 대체 수강한 케이스 — 출석률 계산에서 출석으로 인정. 0018 에서 enum 확장.';


-- ------------------------------------------------------------
-- 2) aca_class_id 컬럼 추가
--   학생 상세 "강좌 × 일자 격자" UI 의 group by 키.
--   FK 없음 (enrollments.aca_class_id 와 같은 정책).
-- ------------------------------------------------------------
ALTER TABLE public.attendances
  ADD COLUMN IF NOT EXISTS aca_class_id TEXT;

COMMENT ON COLUMN public.attendances.aca_class_id IS
  'V_Attend_List.반고유_코드 추적 키. "{branch_id}-{반고유_코드}" 형태. classes.aca_class_id 와 매칭. FK 없음 (ETL 로 채우는 자연키, 강좌 마스터 미수신 가능성 대비). 학생 상세 강좌 × 일자 격자 UI 의 group by 키.';

CREATE INDEX IF NOT EXISTS idx_attendances_aca_class_id
  ON public.attendances (aca_class_id);


-- ------------------------------------------------------------
-- 3) student_profiles VIEW 재생성
--   0012 정의를 그대로 복제하되, attendance_rate 식의 IN 절에
--   '보강' 만 추가. 다른 컬럼·COMMENT 변경 없음.
--
--   원장 정책: '출석' + '지각' + '보강' = 출석 인정,
--             '결석' + '조퇴' = 미출석.
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
      CASE WHEN a.status IN ('출석', '지각', '보강') THEN 1.0 ELSE 0.0 END
    ) * 100, 1
  ) AS attendance_rate,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at
FROM public.students s
LEFT JOIN public.enrollments e ON e.student_id = s.id
LEFT JOIN public.attendances a ON a.student_id = s.id
GROUP BY s.id;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (students + enrollments + attendances 집계). 0018 에서 attendance_rate 산식에 ''보강'' 추가 (동영상강의 대체 수강도 출석 인정).';
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

COMMIT;
