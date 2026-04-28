-- ============================================================
-- 0010_enrollments_aca_id.sql
-- enrollments 에 aca_enrollment_id 추가 (아카 V_student_class_list 추적 키)
--
-- 목적:
--   enrollments 는 자체 자연키가 없어 ETL 재실행 시 중복 삽입 위험.
--   아카(Aca2000) V_student_class_list.수강이력_코드 를 "{branch_id}-{수강이력_코드}"
--   형태로 보관해 idempotent UPSERT 가능하게 함.
--
-- 컬럼:
--   - aca_enrollment_id TEXT UNIQUE (NULL 허용 — 향후 우리 CRM 자체 등록도 가능)
--
-- 롤백 (수동):
--   DROP INDEX IF EXISTS public.idx_enrollments_aca_enrollment_id;
--   ALTER TABLE public.enrollments DROP COLUMN IF EXISTS aca_enrollment_id;
-- ============================================================

BEGIN;

ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS aca_enrollment_id TEXT;

COMMENT ON COLUMN public.enrollments.aca_enrollment_id IS
  '아카(Aca2000) V_student_class_list.수강이력_코드 추적 키. "{branch_id}-{수강이력_코드}" 형태. 우리 CRM 에서 직접 생성한 row 는 NULL.';

-- UNIQUE 부분 인덱스: NULL 허용하면서 NOT NULL 값들만 유니크.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_aca_enrollment_id
  ON public.enrollments (aca_enrollment_id)
  WHERE aca_enrollment_id IS NOT NULL;

COMMIT;
