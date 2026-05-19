-- 0047_drop_student_status_lead.sql
-- students.status 의 '신규리드' 폐기 — 3종으로 축소 (재원생/수강이력자/탈퇴).
--
-- 배경 (2026-05-19):
--   학원 운영에서 '신규리드' 상태 미사용. UI 칩에서도 노출 제거 + DB enum
--   에서도 영구 폐기.
--
-- 처리:
--   1) DROP CHECK 제약 (이전 4종 허용).
--   2) UPDATE status='신규리드' → '수강이력자' (둘 다 비-재원 상태로 의미
--      가장 가까움. 운영 결정).
--   3) ADD 새 CHECK 제약 (3종만 허용).
--
-- 순서 중요: 0043 의 grade '초등' 케이스와 동일 — CHECK 가 신규 값을 막을 수
-- 있으므로 DROP → UPDATE → ADD.
--
-- ROLLBACK:
--   DROP CONSTRAINT students_status_check;
--   ADD CHECK (status IN ('재원생','수강이력자','신규리드','탈퇴'));
--   단 이전 '신규리드' 데이터는 복구 불가 (이미 '수강이력자' 로 이전됨).

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) 기존 CHECK 제거 ────────────────────────────────────
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_status_check;

-- ── 2) 백필 — 신규리드 → 수강이력자 ───────────────────────
UPDATE public.students
SET status = '수강이력자'
WHERE status = '신규리드';

-- ── 3) 새 CHECK 추가 (3종) ────────────────────────────────
ALTER TABLE public.students
  ADD CONSTRAINT students_status_check
  CHECK (status IN ('재원생', '수강이력자', '탈퇴'));

COMMENT ON COLUMN public.students.status IS
  '재원 상태 (재원생/수강이력자/탈퇴). 0047 에서 신규리드 폐기.';

COMMIT;
