-- ============================================================
-- 0020_classes_end_date.sql
-- public.classes.end_date 컬럼 추가 + enrollments 로 백필
--
-- 변경 의도:
--   강좌 진행/종강 상태 식별이 필요. 강좌 리스트(/classes) 에서
--   "진행 중" / "종강" 필터·정렬 및 강좌 상세 헤더 표시에 사용.
--   현재 classes 에는 종강일 컬럼이 없어 derive 불가.
--
-- V_class_list 원본 부재 사유:
--   Aca2000 V_class_list 에는 강좌 종강일 컬럼이 존재하지 않음.
--   따라서 enrollments.end_date(수강 종료 예정일)의 강좌별 MAX 으로
--   파생/백필. 같은 강좌라도 학생마다 종료일이 다를 수 있어
--   "강좌가 마지막으로 끝나는 날" = 모든 학생 중 가장 늦은 end_date 로 본다.
--
-- enrollments.end_date 분포 (진단 기준):
--   - NULL              : 0건 (Aca2000 항상 값 박음)
--   - >= 2050-01-01     : 16,493건 (16.7%) — 종강 미정 placeholder
--   placeholder 는 그대로 백필되며, 진행/종강 derive 시 자동으로
--   "진행 중"으로 분류되므로 정상 동작.
--
-- 백필 정책:
--   - 대상: classes.aca_class_id IS NOT NULL 인 행 (자체 등록 강좌 제외)
--   - 매칭: enrollments.aca_class_id = classes.aca_class_id
--   - 값  : MAX(enrollments.end_date) (NULL 제외)
--   - NULL 가능: enrollment 가 하나도 없거나 모두 end_date 가 NULL 인 경우
--                (= 자체 등록 강좌 또는 수강 0).
--   - 멱등: IS DISTINCT FROM 으로 동일 값 UPDATE 회피.
--
-- placeholder >= 2050-01-01 의미:
--   Aca2000 운영자가 종강일이 확정되지 않은 강좌에 박은 dummy 값.
--   (예: "2050-12-31", "9999-12-31" 등). 종강 미정 = 무기한 진행 중.
--   본 마이그레이션은 그대로 보존하며, derive 로직에서 자연스럽게
--   "진행 중" 으로 처리됨 (end_date >= CURRENT_DATE).
--
-- 진행/종강 상태 derive (앱 레이어 / 추후 view):
--   end_date IS NULL OR end_date >= CURRENT_DATE → 진행 중
--                                                  (NULL 은 정보 없음 = 진행 중으로 취급)
--   end_date < CURRENT_DATE                      → 종강
--
-- ETL 재실행 시 갱신 절차:
--   0019 의 start_date 백필과 동일 step 으로 매일 갱신.
--   .github/workflows/sync-aca.yml 의 step 5 에서 start_date / end_date 를
--   같은 psql 호출로 묶어서 실행.
--
-- 정렬 일관성:
--   PG 기본 정렬은 ASC = NULLS LAST, DESC = NULLS FIRST.
--   애플리케이션은 ORDER BY 단에서 nullsFirst: false 를 명시해
--   NULL 강좌가 항상 뒤에 오도록 통일 (start_date 와 동일 규약).
--
-- 멱등성:
--   - ADD COLUMN IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
--   - UPDATE 는 IS DISTINCT FROM 으로 변경 없는 행 스킵
--
-- 롤백 (수동):
--   BEGIN;
--     DROP INDEX IF EXISTS public.idx_classes_end_date;
--     ALTER TABLE public.classes DROP COLUMN IF EXISTS end_date;
--   COMMIT;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) 컬럼 추가
-- ------------------------------------------------------------
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS end_date DATE;

COMMENT ON COLUMN public.classes.end_date IS
  '강좌 종강일. V_class_list 원본에 없으므로 enrollments.end_date 의 강좌별 MAX 으로 파생/백필. 2050-01-01 이상은 Aca2000 의 "미정" placeholder. NULL 은 enrollments 매칭 실패 케이스.';


-- ------------------------------------------------------------
-- 2) 인덱스
--    진행 중 / 종강 필터링·정렬에 모두 사용. 단일 컬럼 인덱스.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_classes_end_date
  ON public.classes (end_date);


-- ------------------------------------------------------------
-- 3) 백필 — enrollments.end_date 의 강좌별 MAX
--    aca_class_id IS NOT NULL 인 강좌만 (자체 등록 강좌는 매칭 불가).
--    IS DISTINCT FROM 으로 멱등성 보장 (재실행 시 동일 값 UPDATE 회피).
-- ------------------------------------------------------------
UPDATE public.classes c
SET end_date = sub.max_end
FROM (
  SELECT
    e.aca_class_id,
    MAX(e.end_date) AS max_end
  FROM public.enrollments e
  WHERE e.aca_class_id IS NOT NULL
    AND e.end_date IS NOT NULL
  GROUP BY e.aca_class_id
) AS sub
WHERE c.aca_class_id = sub.aca_class_id
  AND (c.end_date IS NULL OR c.end_date IS DISTINCT FROM sub.max_end);

COMMIT;
