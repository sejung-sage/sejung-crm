-- ============================================================
-- 0019_classes_start_date.sql
-- public.classes.start_date 컬럼 추가 + enrollments 로 백필
--
-- 변경 의도:
--   강좌 리스트(/classes) 정렬과 강좌 상세 헤더 표시에서 "개강일" 이 필요.
--   현재는 registered_at(등록일) 만 있어 정렬 기준으로 부적합.
--
-- V_class_list 원본 부재 사유:
--   Aca2000 V_class_list 에는 강좌 개강일 컬럼이 존재하지 않음.
--   따라서 enrollments.start_date(수강 등록 시작일)의 강좌별 MIN 으로
--   파생/백필. 같은 강좌라도 학생마다 등록 시점이 다를 수 있어
--   "강좌가 처음 시작된 날" = 모든 학생 중 가장 이른 start_date 로 본다.
--
-- 백필 정책:
--   - 대상: classes.aca_class_id IS NOT NULL 인 행 (자체 등록 강좌 제외)
--   - 매칭: enrollments.aca_class_id = classes.aca_class_id
--   - 값  : MIN(enrollments.start_date) (NULL 제외)
--   - NULL 가능: enrollment 가 하나도 없거나 모두 start_date 가 NULL 인 경우.
--   - 멱등: IS DISTINCT FROM 으로 동일 값 UPDATE 회피.
--
-- ETL 재실행 시 갱신 절차:
--   classes ETL UPSERT 직후 본 마이그레이션의 백필 UPDATE 1회 수동 실행.
--   향후 scripts/etl/ 의 강좌 ETL 스크립트가 자동화하도록 보강 예정.
--
-- 정렬 일관성:
--   PG 기본 정렬은 ASC = NULLS LAST, DESC = NULLS FIRST.
--   애플리케이션은 항상 ORDER BY 단에서 nullsFirst: false 옵션을 명시해
--   NULL 강좌가 항상 뒤에 오도록 통일.
--
-- 멱등성:
--   - ADD COLUMN IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
--   - UPDATE 는 IS DISTINCT FROM 으로 변경 없는 행 스킵
--
-- 롤백 (수동):
--   BEGIN;
--     DROP INDEX IF EXISTS public.idx_classes_start_date;
--     ALTER TABLE public.classes DROP COLUMN IF EXISTS start_date;
--   COMMIT;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) 컬럼 추가
-- ------------------------------------------------------------
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS start_date DATE;

COMMENT ON COLUMN public.classes.start_date IS
  '강좌 개강일. V_class_list 원본에 없으므로 enrollments.start_date 의 강좌별 MIN 으로 파생/백필. ETL 재실행 시 별도 갱신 절차 필요.';


-- ------------------------------------------------------------
-- 2) 인덱스
--    강좌 리스트 정렬 (개강일 DESC/ASC) 자주 사용. 단일 컬럼 인덱스.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_classes_start_date
  ON public.classes (start_date);


-- ------------------------------------------------------------
-- 3) 백필 — enrollments.start_date 의 강좌별 MIN
--    aca_class_id IS NOT NULL 인 강좌만 (자체 등록 강좌는 매칭 불가).
--    IS DISTINCT FROM 으로 멱등성 보장 (재실행 시 동일 값 UPDATE 회피).
-- ------------------------------------------------------------
UPDATE public.classes c
SET start_date = sub.min_start
FROM (
  SELECT
    e.aca_class_id,
    MIN(e.start_date) AS min_start
  FROM public.enrollments e
  WHERE e.aca_class_id IS NOT NULL
    AND e.start_date IS NOT NULL
  GROUP BY e.aca_class_id
) AS sub
WHERE c.aca_class_id = sub.aca_class_id
  AND (c.start_date IS NULL OR c.start_date IS DISTINCT FROM sub.min_start);

COMMIT;
