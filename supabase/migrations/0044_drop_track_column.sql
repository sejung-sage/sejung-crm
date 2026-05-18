-- 0044_drop_track_column.sql
-- students.track 컬럼 제거 (문과·이과 분류 폐기).
--
-- 배경 (2026-05-18):
--   계열(문과/이과) 분류를 운영에서 사용 안 하기로 결정. 학생 명단·발송 그룹의
--   계열 필터, 학생 상세의 계열 라벨, import 어댑터의 계열 컬럼 모두 폐기.
--
-- 처리 순서 (의존성 정리):
--   1) student_profiles 뷰 DROP — track 컬럼 참조 끊기.
--   2) ALTER TABLE students DROP COLUMN track CASCADE — 인덱스/제약 자동 정리.
--   3) student_profiles 뷰 재생성 — 0030 정의에서 track 컬럼만 제거.
--   4) (선택) CHECK 제약 / track 관련 인덱스 정리.
--
-- 안전:
--   - 뷰 의존: student_profiles 만. 다른 뷰 없음.
--   - 0030 의 attendance_rate / region 등 모든 컬럼·정책 그대로 유지.
--   - 컬럼 DROP 은 되돌릴 수 없는 작업 — 운영 데이터의 track 값은 영구 소실.
--     사용 안 한다는 결정 하에 진행.
--
-- ROLLBACK:
--   ALTER TABLE students ADD COLUMN track TEXT
--     CHECK (track IS NULL OR track IN ('문과','이과'));
--   (단 기존 값은 복구 불가)

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) 뷰 DROP ───────────────────────────────────────────
DROP VIEW IF EXISTS public.student_profiles;

-- ── 2) track 컬럼 DROP ───────────────────────────────────
ALTER TABLE public.students DROP COLUMN IF EXISTS track CASCADE;

-- ── 3) 뷰 재생성 (0030 정의 - track 제거) ────────────────
CREATE VIEW public.student_profiles AS
SELECT
  s.id,
  s.name,
  s.school,
  s.grade,
  s.grade_raw,
  s.school_level,
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
  CASE
    WHEN s.branch = '방배' THEN
      ROUND(
        AVG(
          CASE WHEN a.status IN ('출석', '지각', '보강') THEN 1.0 ELSE 0.0 END
        ) FILTER (WHERE a.id IS NOT NULL) * 100,
        1
      )
    ELSE
      CASE
        WHEN COUNT(DISTINCT e.id) = 0 THEN NULL
        ELSE
          ROUND(
            (
              GREATEST(
                COUNT(DISTINCT e.id)
                  - COUNT(DISTINCT a.id) FILTER (WHERE a.status = '결석'),
                0
              )::numeric
              / COUNT(DISTINCT e.id)
            ) * 100,
            1
          )
      END
  END AS attendance_rate,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.students s
LEFT JOIN public.enrollments e   ON e.student_id = s.id
LEFT JOIN public.attendances a   ON a.student_id = s.id
LEFT JOIN public.school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (students + enrollments + attendances 집계 + school_regions 지역 매핑). 0044 에서 track 컬럼 제거 — 계열 분류 폐기.';
COMMENT ON COLUMN public.student_profiles.grade IS
  '정규화된 학년 (10종). UI 필터 대상.';
COMMENT ON COLUMN public.student_profiles.grade_raw IS
  '아카 V_student_list.학년 원본 값. 디버그·ETL 재처리용.';
COMMENT ON COLUMN public.student_profiles.school_level IS
  '학교급 (초/중/고/기타). UI 1차 필터.';
COMMENT ON COLUMN public.student_profiles.enrollment_count IS '총 수강 횟수';
COMMENT ON COLUMN public.student_profiles.total_paid IS '총 결제 금액 (원 단위)';
COMMENT ON COLUMN public.student_profiles.subjects IS '수강 과목 목록';
COMMENT ON COLUMN public.student_profiles.teachers IS '수강한 강사 목록';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (분원 분기, 소수 1자리). 방배: (출석+지각+보강)/전체 attendance row. 그 외: (enrollment_count - 결석 distinct)/enrollment_count.';
COMMENT ON COLUMN public.student_profiles.last_attended_at IS '마지막 출석일';
COMMENT ON COLUMN public.student_profiles.last_paid_at IS '마지막 결제일';
COMMENT ON COLUMN public.student_profiles.region IS
  '지역명 (예: "강남구", "서초구"). school_regions LEFT JOIN 결과. 매칭 실패/학교 NULL 시 ''기타''.';

COMMIT;
