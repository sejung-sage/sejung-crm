-- 0035_normalize_students_school_nfc.sql
-- 학교명 NFC 유니코드 정규화 — students / school_regions.
--
-- 배경 (2026-05-15):
--   0034 적용 후에도 /regions 미매핑 카운트가 줄지 않는 현상 지속.
--   매핑 표에는 "고" 가 들어가 있는데도 student_profiles 뷰의 LEFT JOIN
--   sr.school = s.school 매칭이 실패. trim 으로 잡히지 않는 차이가 있음.
--
--   가장 유력한 원인: 한글 NFC vs NFD 유니코드 정규화 차이.
--   - NFC "고" = U+ACE0 (1 codepoint, 3 bytes UTF-8)
--   - NFD "고" = U+1100 + U+1169 (2 codepoint, 6 bytes UTF-8)
--   시각적으로 동일하지만 byte 비교가 다르므로 PostgreSQL 의 equality 가 실패.
--   macOS 파일시스템·일부 외부 시스템 export 가 NFD 로 떨어지는 케이스 흔함.
--
-- 처리:
--   1) students.school 일괄 NFC 정규화.
--   2) school_regions.school 도 NFC 정규화 (양쪽 다 NFC 면 매칭 보장).
--   3) CHECK 제약으로 향후 NFD 데이터 유입 차단.
--
-- 안전:
--   - 0034 의 students_school_trimmed_chk 와 양립. NFC 정규화 후 trim 가능성
--     낮지만 안전상 함께 적용 (TRIM(NORMALIZE(s, NFC))).
--   - SET LOCAL statement_timeout 으로 6만 row UPDATE 안전.
--   - PostgreSQL 13+ 의 NORMALIZE 함수 사용. Supabase 는 14/15.
--
-- ROLLBACK:
--   ALTER TABLE public.students DROP CONSTRAINT students_school_nfc_chk;
--   ALTER TABLE public.school_regions DROP CONSTRAINT school_regions_school_nfc_chk;
--   (정규화된 값을 NFD 로 되돌리는 건 의미 없음.)

BEGIN;

SET LOCAL statement_timeout = '5min';

-- 1) students.school NFC 정규화 + 재 trim.
UPDATE public.students
SET school = TRIM(NORMALIZE(school, NFC))
WHERE school IS NOT NULL
  AND school <> TRIM(NORMALIZE(school, NFC));

-- NFC 정규화 결과가 빈 문자열인 row → NULL.
UPDATE public.students
SET school = NULL
WHERE school IS NOT NULL
  AND LENGTH(school) = 0;

-- 2) school_regions.school NFC 정규화.
UPDATE public.school_regions
SET school = TRIM(NORMALIZE(school, NFC))
WHERE school <> TRIM(NORMALIZE(school, NFC));

-- 3) 향후 가드 — NFC 정규화된 값만 허용.
ALTER TABLE public.students
  ADD CONSTRAINT students_school_nfc_chk
  CHECK (school IS NULL OR school = NORMALIZE(school, NFC));

ALTER TABLE public.school_regions
  ADD CONSTRAINT school_regions_school_nfc_chk
  CHECK (school = NORMALIZE(school, NFC));

COMMENT ON CONSTRAINT students_school_nfc_chk ON public.students IS
  '학교명은 NFC 정규화된 값만 허용. school_regions 매핑 키와 byte-level 일치 보장 — JOIN 매칭 실패 방지.';
COMMENT ON CONSTRAINT school_regions_school_nfc_chk ON public.school_regions IS
  '매핑 키도 NFC 정규화 — students.school 과 byte-level 일치.';

COMMIT;
