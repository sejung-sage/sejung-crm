-- 0034_normalize_students_school_trim.sql
-- students.school 의 앞뒤 공백/제어문자 일괄 제거.
--
-- 배경 (2026-05-15):
--   /regions 미매핑 학교 패널에서 "고", "고등학교" 같은 학교명에 지역을 지정하고
--   저장 → 매핑 표(school_regions)에는 정상 저장되는데도 미매핑 카운트가 줄지
--   않는 현상. 원인: 학생 row 의 school 값이 실제로는 "고 ", "\n고" 같이
--   공백/제어문자가 섞인 변형이라 student_profiles 뷰의
--   LEFT JOIN school_regions sr ON sr.school = s.school 매칭이 실패.
--   결국 학생들의 region 이 그대로 '기타' 로 남고 미매핑 풀에 다시 잡힘.
--
-- 처리:
--   1) trim 결과가 빈 문자열이 되는 row 는 NULL 로 (학교 정보 없는 학생과 동일 취급).
--   2) trim 결과가 원본과 다른 row 는 정규화된 값으로 UPDATE.
--   3) 향후 데이터가 또 trim 안 된 채 들어오는 것 방지를 위한 CHECK 제약 추가.
--      ETL 단(adapter) 에서도 trim 처리하는 것이 정석이지만, DB 레벨 가드를
--      함께 둠 — RLS 와 같은 다단 방어.
--
-- 영향:
--   - student_profiles 뷰 LEFT JOIN 매칭 정상화 → 매핑된 학교 학생의 region 채워짐.
--   - 학생 명단 학교 필터 / 미매핑 패널 / 학생 검색의 학교 표시 일관성 확보.
--
-- 안전:
--   - UPDATE 는 WHERE 절로 변경 필요 row 만 좁힘 (전체 row 스캔 1회).
--   - 6만 row 기준 UPDATE 는 수십 초 이내. statement_timeout 우려가 있다면 콘솔에서
--     SET LOCAL statement_timeout = '5min'; 와 함께 실행.
--
-- ROLLBACK:
--   CHECK 만 제거 — trim 된 값을 원상 복구하는 건 의미 없음(원본 보존 가치 없음).
--     ALTER TABLE public.students DROP CONSTRAINT students_school_trimmed_chk;

BEGIN;

-- 6만 row UPDATE 가 기본 statement_timeout(보통 ≤30s)을 넘길 수 있어 트랜잭션 한정으로 늘림.
SET LOCAL statement_timeout = '5min';

-- 1) trim 결과가 빈 문자열인 row → NULL.
UPDATE public.students
SET school = NULL
WHERE school IS NOT NULL
  AND LENGTH(TRIM(school)) = 0;

-- 2) 앞뒤 공백/제어문자 정규화.
UPDATE public.students
SET school = TRIM(school)
WHERE school IS NOT NULL
  AND school <> TRIM(school);

-- 3) 앞으로의 INSERT/UPDATE 가드.
ALTER TABLE public.students
  ADD CONSTRAINT students_school_trimmed_chk
  CHECK (school IS NULL OR school = TRIM(school));

COMMENT ON CONSTRAINT students_school_trimmed_chk ON public.students IS
  '학교명은 앞뒤 공백 없는 정규화된 값만 허용. ETL/UI 입력 모두 동일 규칙 — school_regions 매핑 키와 일치 보장.';

COMMIT;
