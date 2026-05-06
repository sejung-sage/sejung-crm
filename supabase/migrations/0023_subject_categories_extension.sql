-- ============================================================
-- 0023_subject_categories_extension.sql
-- subject CHECK 제약을 4종 → 7종으로 확장.
--
-- 배경:
--   0001 / 0015 마이그레이션에서 enrollments.subject / classes.subject 의
--   CHECK 제약을 ('수학', '국어', '영어', '탐구') 4종으로 정의했으나
--   세정학원 실제 분류는 7종 (국어 / 영어 / 수학 / 과탐 / 사탐 / 컨설팅 /
--   기타) 임이 확인됨. "기타" 는 약술·논술 등 소수 강좌의 catch-all 버킷.
--
--   '탐구' 는 V_class_list.과목명 raw 에 정확히 등장하지 않아 운영 DB
--   classes.subject 가 '탐구' 로 적재된 행은 사실상 없음 (사용자 컨펌).
--   enrollments.subject 는 ETL 에서 항상 NULL 로 두므로 영향 없음.
--   그래도 안전망으로 마이그 안에서 '탐구' → NULL 처리 후 CHECK 제약 갱신.
--
-- 변경:
--   1) public.enrollments.subject CHECK 7종으로 갱신 (안전망 NULL 백필 후).
--   2) public.classes.subject CHECK 7종으로 갱신 (안전망 NULL 백필 후).
--   3) 두 컬럼 COMMENT 갱신.
--
-- 안전성:
--   - 운영에 '탐구' 행이 없을 것으로 예상되지만, 있더라도 NULL 로 안전 백필.
--   - 새 7종에 포함되지 않는 다른 값은 0001/0015 의 기존 CHECK 가 이미
--     차단했으므로 추가 정리 불필요.
--   - constraint 이름은 PostgreSQL auto-naming 컨벤션
--     (<table>_<column>_check) 사용. IF EXISTS 로 멱등.
--
-- 롤백 (수동):
--   ALTER TABLE public.enrollments
--     DROP CONSTRAINT IF EXISTS enrollments_subject_check,
--     ADD CONSTRAINT enrollments_subject_check
--       CHECK (subject IS NULL OR subject IN ('수학','국어','영어','탐구'));
--   ALTER TABLE public.classes
--     DROP CONSTRAINT IF EXISTS classes_subject_check,
--     ADD CONSTRAINT classes_subject_check
--       CHECK (subject IS NULL OR subject IN ('수학','국어','영어','탐구'));
-- ============================================================

BEGIN;

-- ── enrollments.subject ─────────────────────────────────────
UPDATE public.enrollments SET subject = NULL WHERE subject = '탐구';

ALTER TABLE public.enrollments
  DROP CONSTRAINT IF EXISTS enrollments_subject_check;

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_subject_check
  CHECK (
    subject IS NULL
    OR subject IN ('국어', '영어', '수학', '과탐', '사탐', '컨설팅', '기타')
  );

COMMENT ON COLUMN public.enrollments.subject IS
  '과목 (국어/영어/수학/과탐/사탐/컨설팅/기타). ETL 은 현재 NULL 로 적재.';

-- ── classes.subject ─────────────────────────────────────────
UPDATE public.classes SET subject = NULL WHERE subject = '탐구';

ALTER TABLE public.classes
  DROP CONSTRAINT IF EXISTS classes_subject_check;

ALTER TABLE public.classes
  ADD CONSTRAINT classes_subject_check
  CHECK (
    subject IS NULL
    OR subject IN ('국어', '영어', '수학', '과탐', '사탐', '컨설팅', '기타')
  );

COMMENT ON COLUMN public.classes.subject IS
  '정규화된 과목 (국어/영어/수학/과탐/사탐/컨설팅/기타). subject_raw 매칭 실패 시 NULL.';

COMMIT;
