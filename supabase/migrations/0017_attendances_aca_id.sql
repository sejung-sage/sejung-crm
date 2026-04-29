-- ============================================================
-- 0017_attendances_aca_id.sql
-- attendances 에 aca_attendance_id 추가 (아카 V_Attend_List 추적 키)
--
-- 목적:
--   attendances 는 자체 자연키가 없어 ETL 재실행 시 중복 삽입 위험.
--   아카(Aca2000) V_Attend_List.출결_코드 를 "{branch_id}-{출결_코드}"
--   형태로 보관해 idempotent UPSERT 가능하게 함.
--   (0010 enrollments.aca_enrollment_id, 0015 classes.aca_class_id 와 동일 패턴.)
--
-- 컬럼:
--   - aca_attendance_id TEXT UNIQUE (NULL 허용 — 우리 CRM 자체 등록 가능성).
--     UNIQUE 는 partial index 가 아닌 일반 UNIQUE 제약 (PostgreSQL 의 NULL distinct
--     기본 동작에 따라 NULL 다중 허용).
--
-- 롤백 (수동):
--   ALTER TABLE public.attendances DROP CONSTRAINT IF EXISTS attendances_aca_attendance_id_key;
--   ALTER TABLE public.attendances DROP COLUMN IF EXISTS aca_attendance_id;
-- ============================================================

BEGIN;

ALTER TABLE public.attendances
  ADD COLUMN IF NOT EXISTS aca_attendance_id TEXT;

COMMENT ON COLUMN public.attendances.aca_attendance_id IS
  '아카(Aca2000) V_Attend_List.출결_코드 추적 키. "{branch_id}-{출결_코드}" 형태. 우리 CRM 에서 직접 생성한 row 는 NULL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendances_aca_attendance_id_key'
  ) THEN
    ALTER TABLE public.attendances
      ADD CONSTRAINT attendances_aca_attendance_id_key
      UNIQUE (aca_attendance_id);
  END IF;
END$$;

COMMENT ON CONSTRAINT attendances_aca_attendance_id_key ON public.attendances IS
  '아카 출결 추적 키 유니크 제약. NULL 은 여러 개 허용(우리 CRM 자체 등록행). ETL UPSERT 의 ON CONFLICT 대상.';

COMMIT;
