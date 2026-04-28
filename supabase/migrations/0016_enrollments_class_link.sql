-- ============================================================
-- 0016_enrollments_class_link.sql
-- enrollments.aca_class_id · 강좌 마스터 연결 키
--
-- 목적:
--   학생 수강이력(enrollments) 행이 어떤 강좌 마스터(classes)에 속하는지
--   "{branch_id}-{반고유_코드}" 자연키로 연결. 강좌 정가/총회차 비교, 출석률
--   조회, 강좌별 수강생 list 등에 사용.
--
-- FK 두지 않는 이유:
--   - classes 미동기화 시점에도 enrollments ETL 이 돌아가야 함 (선후 의존 제거).
--   - 우리 CRM 자체 등록한 enrollment 가 classes 와 무관하게 존재할 수 있음.
--   - 잘못된 ON DELETE 연쇄 위험 회피.
--   → 일반 텍스트 컬럼 + 인덱스만. 무결성은 ETL 레이어에서 보장.
--
-- 멱등성:
--   - ADD COLUMN IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
--
-- 롤백 (수동):
--   DROP INDEX IF EXISTS public.idx_enrollments_aca_class_id;
--   ALTER TABLE public.enrollments DROP COLUMN IF EXISTS aca_class_id;
-- ============================================================

BEGIN;

ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS aca_class_id TEXT;

COMMENT ON COLUMN public.enrollments.aca_class_id IS
  '강좌 마스터 연결 키. "{학원_코드}-{V_class_list.반고유_코드}" 형태. classes.aca_class_id 와 같은 값. FK 는 두지 않고 ETL 레이어에서 무결성 보장. 우리 CRM 자체 등록행은 NULL 가능.';

CREATE INDEX IF NOT EXISTS idx_enrollments_aca_class_id
  ON public.enrollments (aca_class_id);

COMMIT;
