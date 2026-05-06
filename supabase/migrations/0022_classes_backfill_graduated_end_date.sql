-- ============================================================
-- 0022_classes_backfill_graduated_end_date.sql
-- "(종)" prefix 가 붙은 종강 강좌의 end_date 일괄 백필.
--
-- 배경:
--   classes.end_date 는 0020_classes_end_date.sql 에서 추가됐지만 기존 행에
--   대한 백필이 적용되지 않아 NULL 상태로 남아 있었다. 그 결과
--   src/lib/classes/list-classes.ts:208-210 의 진행 중 필터
--     end_date IS NULL OR end_date >= 오늘
--   에서 NULL 분기에 걸려 종강이 명백한("(종)" prefix) 강좌까지 "진행 중"
--   탭에 노출되는 운영 이슈가 발생했다.
--
--   2026-05-06 시점 통계:
--     - end_date IS NULL : 462 건
--     - 그 중 name LIKE '(종)%' : 205 건  ← 본 마이그레이션 대상
--
-- 변경:
--   name 이 '(종)' 으로 시작하면서 end_date 가 NULL 인 행의 end_date 를
--   '어제' 로 일괄 채운다. 정확한 종강일은 원본(아카2000)에서 알 수 없으므로
--   "오늘 이전" 임을 보장하는 가장 보수적인 값(어제) 을 선택. 진행/종강
--   필터의 비교 기준은 "오늘" 이라 어제 값은 항상 graduated 로 분류된다.
--
--   active 컬럼은 손대지 않는다 — 운영자가 별도로 관리하는 미사용 플래그라
--   본 마이그레이션의 책임 범위가 아님.
--
-- 안전성:
--   - UPDATE 만 수행, DELETE / DROP 없음.
--   - 조건이 매우 좁아(이름 prefix + NULL) 의도치 않은 행을 건드릴 위험 낮음.
--   - 영향 행 수가 정확히 205 가 아니더라도(추가 동기화로 변동 가능) 동일
--     로직이 멱등(이미 end_date 가 채워진 행은 WHERE 절에서 빠짐).
--
-- 롤백 (수동):
--   본 마이그레이션 적용 전 NULL 이었음을 별도로 보존하지 않으므로 자동 롤백
--   불가. 필요 시 백업 스냅샷에서 복원하거나, 운영자가 강좌 단건 단위로
--   end_date 를 NULL 로 되돌려야 한다.
-- ============================================================

UPDATE classes
SET end_date = (CURRENT_DATE - INTERVAL '1 day')::date
WHERE end_date IS NULL
  AND name LIKE '(종)%';
