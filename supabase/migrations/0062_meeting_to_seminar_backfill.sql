-- ============================================================
-- 0062_meeting_to_seminar_backfill.sql
-- 간담회 강좌 → subject='설명회' 통합 backfill.
-- ------------------------------------------------------------
-- 배경:
--   사용자 결정 (2026-05-20) — 간담회도 설명회 enum 으로 통합.
--   별도 enum 만들지 않고 기존 '설명회' 에 합침.
--
--   영향:
--     - aca/crm_classes 의 name LIKE '%간담회%' 인 14건의 subject 갱신
--     - apply_aca_to_crm() 의 active_set 에서 자동 제외 (0058 로직 그대로)
--     - student_profiles.active_enrollment_count 자동 제외 (0061 로직 그대로)
--     - 강좌 list "진행 중만" 필터에서도 제외 (backend list-classes.ts
--       에서 추가 가드 — 본 마이그와 별도 코드 변경)
--
--   현황 (오늘 raw):
--     name LIKE '%간담회%' 14건 — 대치 10 / 방배 4
--     현재 subject: NULL 8 / 영어 3 / 수학 2 / 기타 1 → 모두 '설명회' 로 통합
--     영향 학생: 진행중 enrollment 42건 / 42명 재원생
--
-- 롤백 (수동):
--   raw subject_raw 가 보존되므로 0023 의 normalize_subject 또는
--   ETL re-run 으로 복구 가능. 다만 간담회는 본 마이그 이후 항상 '설명회'.
-- ============================================================

BEGIN;

SET LOCAL statement_timeout = '5min';

-- aca_classes 갱신
UPDATE public.aca_classes
SET subject = '설명회'
WHERE name LIKE '%간담회%'
  AND (subject IS DISTINCT FROM '설명회');

-- crm_classes 갱신 (curated layer)
UPDATE public.crm_classes
SET subject = '설명회'
WHERE name LIKE '%간담회%'
  AND (subject IS DISTINCT FROM '설명회');

COMMIT;
