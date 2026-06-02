-- 0086_drop_legacy_seminars.sql
-- 옛 설명회 인프라(0080~0082)를 일괄 DROP. Phase 2-B-3 (2026-06-02) 정리.
--
-- 배경:
--   Phase 2-B-1·2 에서 모든 코드 경로가 새 모델(crm_class_signup_pages /
--   _invitations / _items + lookup_signup_invitation_by_token / claim_signup_item RPC)
--   로 이전됐고, Phase 2-B-3 에서 옛 UI/lib/action/test 가 제거됐다. 그러므로
--   옛 테이블·RPC 를 안전하게 DROP 할 수 있다.
--
-- 데이터:
--   사전 확인(2026-06-02)에 따라 옛 테이블의 데이터는 전부 테스트:
--     crm_seminars                  : 3 rows (sdfghjhgfdes 등)
--     crm_seminar_invitations       : 0 rows
--     crm_seminar_invitation_items  : 0 rows
--     crm_seminar_signups           : 4 rows (전부 같은 테스트 설명회·dev IP)
--   운영 데이터 없음 — 폐기 안전.
--
-- 순서 (FK 의존성):
--   1) crm_seminar_invitation_items (→ invitations, seminars FK)
--   2) crm_seminar_invitations      (→ students FK; seminars 가 아닌 student FK)
--   3) crm_seminar_signups          (→ seminars FK)
--   4) crm_seminars                 (마지막)
--   5) 옛 RPC 2종
--
-- 롤백 노트:
--   원복은 사실상 불가 — 옛 데이터는 테스트만이고 코드 경로도 모두 제거됨.
--   필요하면 0080~0082 마이그를 다시 실행하되 그건 대대적 코드 롤백을 동반.

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) 자식 테이블부터 (FK 의존성 따라서) ─────────────────
DROP TABLE IF EXISTS public.crm_seminar_invitation_items CASCADE;
DROP TABLE IF EXISTS public.crm_seminar_invitations CASCADE;
DROP TABLE IF EXISTS public.crm_seminar_signups CASCADE;

-- ── 2) 부모 테이블 ─────────────────────────────────────
DROP TABLE IF EXISTS public.crm_seminars CASCADE;

-- ── 3) 옛 RPC 2종 (0082 가 추가했고 0085 새 RPC 로 대체됨) ──
DROP FUNCTION IF EXISTS public.lookup_invitation_by_token(text);
DROP FUNCTION IF EXISTS public.claim_invitation_item(text, uuid);

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- 적용 후 검증:
--   -- 테이블 없는지 확인
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name LIKE 'crm_seminar%';
--   -- 기대: crm_seminars / _invitations / _invitation_items / _signups 모두 없음.
--
--   -- 새 테이블은 살아있는지
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name LIKE 'crm_class_signup%';
--   -- 기대: crm_class_signup_pages / _invitations / _items.
--
--   -- 옛 RPC 가 없는지
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('lookup_invitation_by_token','claim_invitation_item');
--   -- 기대: 0 rows.
--
--   -- 새 RPC 가 있는지
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('lookup_signup_invitation_by_token','claim_signup_item');
--   -- 기대: 2 rows.
-- ════════════════════════════════════════════════════════════════
