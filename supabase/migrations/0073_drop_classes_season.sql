-- 0073_drop_classes_season.sql
-- 강좌 시즌 분류 기능 롤백 — aca_classes / crm_classes 의 season 컬럼 전면 제거.
--
-- 배경 (2026-05-26):
--   0070 에서 추가한 시즌(season) 수동 분류 기능을 사용자 요청으로 제거.
--   (여름방학특강/겨울방학특강/내신/상반기정규/하반기정규/기타 6종 enum 폐기.)
--   운영팀 강좌별 수동 입력 부담 대비 효용이 낮다는 판단.
--
-- apply_aca_to_crm() 재정의 불필요:
--   0070 은 함수 crm_classes UPDATE 절에 season COALESCE 보존 로직을 넣었으나,
--   이후 0072 가 함수를 0051 기준으로 CREATE OR REPLACE 하면서 season 참조가
--   이미 사라진 상태다. 현재(0072) 함수 본문은 season 을 어디에서도 명시하지 않고,
--   crm_classes 적재는 `INSERT INTO crm_classes SELECT * FROM aca_classes`
--   (위치 기반) 이다. season 을 양쪽 테이블에서 동시에 DROP 하면 컬럼 수·순서가
--   그대로 정렬되므로 함수는 재정의 없이 계속 유효하다. (함수 본문은 DROP COLUMN
--   을 차단하지 않음 — 차단 대상은 VIEW·생성컬럼·제약뿐.)
--
-- 뷰 의존성 없음:
--   student_profiles 뷰는 crm_classes 를 JOIN 만 하고 season 을 SELECT 하지
--   않으므로 DROP COLUMN 을 막지 않는다.
--
-- 단계 (양쪽 테이블 동일):
--   1) CHECK 제약 DROP
--   2) INDEX DROP
--   3) COLUMN DROP
--
-- 롤백 (재도입 시): 0070 의 ADD COLUMN/CHECK/INDEX/COMMENT 블록을 재실행.

BEGIN;

-- ── aca_classes.season 제거 ───────────────────────────────────
ALTER TABLE public.aca_classes
  DROP CONSTRAINT IF EXISTS aca_classes_season_check;

DROP INDEX IF EXISTS public.idx_aca_classes_season;

ALTER TABLE public.aca_classes
  DROP COLUMN IF EXISTS season;

-- ── crm_classes.season 제거 ───────────────────────────────────
ALTER TABLE public.crm_classes
  DROP CONSTRAINT IF EXISTS crm_classes_season_check;

DROP INDEX IF EXISTS public.idx_crm_classes_season;

ALTER TABLE public.crm_classes
  DROP COLUMN IF EXISTS season;

COMMIT;
