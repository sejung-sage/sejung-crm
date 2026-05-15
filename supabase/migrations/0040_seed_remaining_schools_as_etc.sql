-- 0040_seed_remaining_schools_as_etc.sql
-- 0039 시드에 포함되지 않은 모든 학생 학교를 '기타' 로 자동 매핑.
--
-- 배경 (2026-05-15):
--   0039 가 강남·서초·송파·용산·동작 5개 구 중고등학교 164개를 시드 매핑.
--   그 외 학교(외고/특목고/타구 학교/ETL 토큰 이슈로 잘려나간 학교명 등)는
--   여전히 미매핑 상태로 남아 매핑 패널에 누적. 사용자 요청대로 일괄 '기타' 처리.
--
-- 처리:
--   students 의 학교명 중 school_regions 에 entry 가 없는 모든 distinct school 을
--   '기타' 로 INSERT. 향후 외고 등을 정확한 지역으로 옮기려면 /regions admin 에서
--   수정 버튼으로 region 변경 가능 (ON CONFLICT DO UPDATE 동작).
--
-- 안전:
--   - school IS NULL 학생은 제외 (매핑 키 없음).
--   - status='탈퇴' 도 제외 — 어차피 미매핑 패널에 안 잡힘. (단 향후 재가입 시
--     학교명이 동일하면 매핑 효과 발생.)
--   - ON CONFLICT (school) DO NOTHING — 이미 매핑된 학교(0039 결과 포함) 는
--     덮어쓰지 않음. 0039 의 강남·서초·송파·용산·동작 매핑이 그대로 유지.
--   - SET LOCAL statement_timeout 으로 6만 row 스캔 안전.
--
-- ROLLBACK:
--   잘못된 '기타' 매핑은 /regions admin 에서 개별 수정 또는
--   DELETE FROM school_regions WHERE region = '기타' AND created_at > '2026-05-15';
--   (created_at 컬럼이 있을 때.)

BEGIN;

SET LOCAL statement_timeout = '5min';

INSERT INTO public.school_regions (school, region)
SELECT DISTINCT s.school, '기타'
FROM public.students s
WHERE s.school IS NOT NULL
  AND s.status <> '탈퇴'
  AND NOT EXISTS (
    SELECT 1 FROM public.school_regions sr WHERE sr.school = s.school
  )
ON CONFLICT (school) DO NOTHING;

COMMIT;
