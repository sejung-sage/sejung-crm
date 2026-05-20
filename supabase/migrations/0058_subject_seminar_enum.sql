-- 0058_subject_seminar_enum.sql
-- subject CHECK 제약을 7종 → 8종으로 확장 — '설명회' 추가.
-- 그리고 apply_aca_to_crm() 의 재원생/이력자 판정에서 설명회 강좌 제외.
--
-- 배경 (2026-05-20 운영 진단):
--   - 전체 재원생 8,633명 중 1,623명(18.8%) 이 '진행중 강좌 = 설명회만'.
--   - 예: 정지우(휘문고 고3) — 정규 강좌 모두 종강, 설명회 강좌 1건만 진행중.
--   - 설명회 강좌(end_date='2050-01-01' sentinel) 가 active_set 에 들어와
--     재원생으로 오분류된 케이스. 전부 대치 분원, 설명회 강좌 총 77개.
--
-- 사용자 결정:
--   1) subject enum 에 '설명회' 추가 → 강좌명에 '설명회' 포함된 77개 backfill.
--   2) apply_aca_to_crm() 의 active_set / any_enrollment_set 양쪽에서
--      설명회 강좌를 제외.
--      → 설명회'만' 있는 학생은 자동으로:
--          - 정규 수강 이력 있음 → '수강이력자'
--          - 설명회만 있음       → '수강 x'
--
-- 단계:
--   1) 기존 CHECK DROP (aca_classes / crm_classes 각각)
--   2) 새 CHECK 추가 — 8종 ('설명회' 포함)
--   3) 데이터 backfill — name LIKE '%설명회%' 인 강좌의 subject = '설명회'
--      (subject_raw 는 보존 — 원본 '기타'/NULL 그대로)
--   4) apply_aca_to_crm() CREATE OR REPLACE — active_set / any_enrollment_set
--      에서 설명회 제외하는 LEFT JOIN 추가
--   5) 함수 COMMENT 갱신
--
-- 롤백 노트 (수동):
--   ALTER TABLE public.aca_classes DROP CONSTRAINT aca_classes_subject_check;
--   ALTER TABLE public.crm_classes DROP CONSTRAINT crm_classes_subject_check;
--   ALTER TABLE public.aca_classes ADD CONSTRAINT classes_subject_check
--     CHECK (subject IS NULL OR subject IN
--       ('국어','영어','수학','과탐','사탐','컨설팅','기타'));
--   ALTER TABLE public.crm_classes ADD CONSTRAINT classes_subject_check
--     CHECK (subject IS NULL OR subject IN
--       ('국어','영어','수학','과탐','사탐','컨설팅','기타'));
--   UPDATE public.aca_classes SET subject = NULL WHERE subject = '설명회';
--   UPDATE public.crm_classes SET subject = NULL WHERE subject = '설명회';
--   그리고 apply_aca_to_crm() 을 0053 정의로 되돌릴 것.
--
-- 적용 후 다음 단계 (사용자 수동 실행):
--   SELECT * FROM apply_aca_to_crm();
--     → 1,623명 재원생이 '수강이력자' 또는 '수강 x' 로 재분류됨.

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) 기존 CHECK 풀기 ─────────────────────────────────────
-- LIKE INCLUDING ALL 로 만든 crm_classes 의 CHECK 이름은 원본 보존 패턴이지만
-- (참고: 0053 에서 students_status_check 그대로 유지된 사례), 일부 PG 버전은
-- 새 이름을 부여하기도 함. 두 이름 모두 IF EXISTS 로 안전하게 drop.

ALTER TABLE public.aca_classes
  DROP CONSTRAINT IF EXISTS classes_subject_check,
  DROP CONSTRAINT IF EXISTS aca_classes_subject_check;

ALTER TABLE public.crm_classes
  DROP CONSTRAINT IF EXISTS classes_subject_check,
  DROP CONSTRAINT IF EXISTS crm_classes_subject_check;

-- ── 2) 데이터 backfill — 설명회 강좌 subject 갱신 ─────────
-- 새 CHECK 를 걸기 전에 먼저 UPDATE — CHECK 에 어긋날 수 있는 값은 없으나
-- 순서상 데이터를 먼저 정리하고 제약 부여하는 흐름이 깔끔.
-- subject_raw 는 그대로 — 원본 추적용.
UPDATE public.aca_classes
   SET subject = '설명회'
 WHERE name LIKE '%설명회%';

UPDATE public.crm_classes
   SET subject = '설명회'
 WHERE name LIKE '%설명회%';

-- ── 3) 새 CHECK 추가 — 8종 ('설명회' 포함) ─────────────────
ALTER TABLE public.aca_classes
  ADD CONSTRAINT aca_classes_subject_check
  CHECK (
    subject IS NULL
    OR subject IN
      ('국어', '영어', '수학', '과탐', '사탐', '컨설팅', '기타', '설명회')
  );

ALTER TABLE public.crm_classes
  ADD CONSTRAINT crm_classes_subject_check
  CHECK (
    subject IS NULL
    OR subject IN
      ('국어', '영어', '수학', '과탐', '사탐', '컨설팅', '기타', '설명회')
  );

COMMENT ON COLUMN public.aca_classes.subject IS
  '정규화된 과목 (국어/영어/수학/과탐/사탐/컨설팅/기타/설명회). subject_raw 매칭 실패 시 NULL.';
COMMENT ON COLUMN public.crm_classes.subject IS
  '정규화된 과목 (국어/영어/수학/과탐/사탐/컨설팅/기타/설명회). subject_raw 매칭 실패 시 NULL.';

-- ── 4) apply_aca_to_crm() — 설명회 제외 로직 ───────────────
-- active_set / any_enrollment_set 양쪽에서 설명회 강좌의 enrollment 를 제외.
-- → 설명회'만' 수강한 학생은:
--     - active_set 에 없음   → '재원생' 아님
--     - any_enrollment_set 에 없음 → '수강이력자' 아님
--     - 결과: '수강 x'
-- → 설명회 + 정규 수강 이력 있는 학생은:
--     - 정규 강좌가 진행중이면 active_set 에 들어와 '재원생' 유지
--     - 정규 강좌가 모두 종강이고 설명회만 진행중이면 any_enrollment_set 에 들어와 '수강이력자'

CREATE OR REPLACE FUNCTION public.apply_aca_to_crm()
RETURNS TABLE(
  students_upserted bigint,
  classes_upserted bigint,
  enrollments_upserted bigint,
  attendances_upserted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_students bigint;
  v_classes bigint;
  v_enrollments bigint;
  v_attendances bigint;
BEGIN
  WITH active_set AS (
    SELECT DISTINCT e.student_id
    FROM public.aca_enrollments e
    LEFT JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    WHERE (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
      AND (c.subject IS DISTINCT FROM '설명회')
  ),
  any_enrollment_set AS (
    SELECT DISTINCT e.student_id
    FROM public.aca_enrollments e
    LEFT JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    WHERE c.subject IS DISTINCT FROM '설명회'
  ),
  school_candidate AS (
    SELECT
      e.student_id,
      ks.school,
      COUNT(*) AS hits
    FROM public.aca_enrollments e
    JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    JOIN public.crm_school_regions ks ON c.name LIKE '%' || ks.school || '%'
    WHERE LENGTH(ks.school) >= 2
    GROUP BY e.student_id, ks.school
  ),
  best_school AS (
    SELECT DISTINCT ON (student_id)
      student_id, school
    FROM school_candidate
    ORDER BY student_id, hits DESC, LENGTH(school) DESC
  ),
  src AS (
    SELECT
      a.id, a.aca2000_id, a.name, a.phone, a.parent_phone,
      COALESCE(a.school, bs.school) AS school,
      a.grade, a.grade_raw, a.school_level,
      CASE
        WHEN a.status = '탈퇴' THEN '탈퇴'
        WHEN a.id IN (SELECT student_id FROM active_set) THEN '재원생'
        WHEN a.id IN (SELECT student_id FROM any_enrollment_set) THEN '수강이력자'
        ELSE '수강 x'
      END AS status,
      a.branch, a.registered_at,
      a.created_at, a.updated_at
    FROM public.aca_students a
    LEFT JOIN best_school bs ON bs.student_id = a.id
  ),
  ups AS (
    INSERT INTO public.crm_students (
      id, aca2000_id, name, phone, parent_phone, school,
      grade, grade_raw, school_level, status, branch, registered_at,
      created_at, updated_at
    )
    SELECT
      id, aca2000_id, name, phone, parent_phone, school,
      grade, grade_raw, school_level, status, branch, registered_at,
      created_at, updated_at
    FROM src
    ON CONFLICT (id) DO UPDATE SET
      aca2000_id   = EXCLUDED.aca2000_id,
      name         = EXCLUDED.name,
      phone        = EXCLUDED.phone,
      parent_phone = EXCLUDED.parent_phone,
      school       = EXCLUDED.school,
      grade        = EXCLUDED.grade,
      grade_raw    = EXCLUDED.grade_raw,
      school_level = EXCLUDED.school_level,
      status       = EXCLUDED.status,
      branch       = EXCLUDED.branch,
      registered_at= EXCLUDED.registered_at,
      updated_at   = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_students FROM ups;

  WITH ups AS (
    INSERT INTO public.crm_classes
      SELECT * FROM public.aca_classes
    ON CONFLICT (id) DO UPDATE SET
      aca_class_id       = EXCLUDED.aca_class_id,
      branch             = EXCLUDED.branch,
      name               = EXCLUDED.name,
      teacher_name       = EXCLUDED.teacher_name,
      subject_raw        = EXCLUDED.subject_raw,
      subject            = EXCLUDED.subject,
      total_sessions     = EXCLUDED.total_sessions,
      amount_per_session = EXCLUDED.amount_per_session,
      total_amount       = EXCLUDED.total_amount,
      capacity           = EXCLUDED.capacity,
      schedule_days      = EXCLUDED.schedule_days,
      schedule_time      = EXCLUDED.schedule_time,
      start_date         = EXCLUDED.start_date,
      end_date           = EXCLUDED.end_date,
      active             = EXCLUDED.active,
      updated_at         = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_classes FROM ups;

  WITH ups AS (
    INSERT INTO public.crm_enrollments
      SELECT * FROM public.aca_enrollments
    ON CONFLICT (id) DO UPDATE SET
      student_id    = EXCLUDED.student_id,
      course_name   = EXCLUDED.course_name,
      teacher_name  = EXCLUDED.teacher_name,
      subject       = EXCLUDED.subject,
      amount        = EXCLUDED.amount,
      paid_at       = EXCLUDED.paid_at,
      start_date    = EXCLUDED.start_date,
      end_date      = EXCLUDED.end_date,
      aca_class_id  = EXCLUDED.aca_class_id,
      updated_at    = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_enrollments FROM ups;

  WITH ups AS (
    INSERT INTO public.crm_attendances
      SELECT * FROM public.aca_attendances
    ON CONFLICT (id) DO UPDATE SET
      student_id    = EXCLUDED.student_id,
      enrollment_id = EXCLUDED.enrollment_id,
      attended_at   = EXCLUDED.attended_at,
      status        = EXCLUDED.status
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_attendances FROM ups;

  RETURN QUERY SELECT v_students, v_classes, v_enrollments, v_attendances;
END;
$$;

COMMENT ON FUNCTION public.apply_aca_to_crm() IS
  '0058 — subject 8종 (설명회 추가). active_set/any_enrollment_set 에서 설명회 제외 — 설명회만 수강한 학생은 ''수강 x'' 또는 정규 이력 있으면 ''수강이력자''.';

COMMIT;
