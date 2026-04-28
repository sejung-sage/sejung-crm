-- ============================================================
-- 0011_enrollments_aca_id_unique_constraint.sql
-- enrollments.aca_enrollment_id 를 partial unique index → 일반 UNIQUE 제약으로 교체
--
-- 배경:
--   0010 에서 partial unique index (WHERE aca_enrollment_id IS NOT NULL) 로 만들었으나
--   PostgreSQL 의 ON CONFLICT (col) 는 partial index 와 매칭되지 않아
--   ETL UPSERT 시 "no unique or exclusion constraint matching" 42P10 에러 발생.
--
--   PostgreSQL 은 기본적으로 UNIQUE 제약에서 NULL 을 distinct 로 취급하므로
--   일반 UNIQUE 제약으로 바꿔도 우리 CRM 자체 등록(NULL) 행을 여러 개 허용함.
--
-- 변경:
--   - DROP INDEX idx_enrollments_aca_enrollment_id
--   - ADD CONSTRAINT enrollments_aca_enrollment_id_key UNIQUE (aca_enrollment_id)
--
-- 롤백 (수동):
--   ALTER TABLE public.enrollments DROP CONSTRAINT IF EXISTS enrollments_aca_enrollment_id_key;
--   CREATE UNIQUE INDEX idx_enrollments_aca_enrollment_id
--     ON public.enrollments (aca_enrollment_id) WHERE aca_enrollment_id IS NOT NULL;
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS public.idx_enrollments_aca_enrollment_id;

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_aca_enrollment_id_key UNIQUE (aca_enrollment_id);

COMMENT ON CONSTRAINT enrollments_aca_enrollment_id_key ON public.enrollments IS
  '아카(Aca2000) 수강이력 추적 키 유니크 제약. NULL 은 여러 개 허용(우리 CRM 자체 등록행). ETL UPSERT 의 ON CONFLICT 대상.';

COMMIT;
