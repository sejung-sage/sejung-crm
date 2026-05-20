-- ============================================================
-- wipe-messaging-data.sql
-- 문자 관련 데이터(템플릿·캠페인·메시지) 전체 삭제 1회성 정리 스크립트.
-- ------------------------------------------------------------
-- 사용:
--   ⚠️ 마이그레이션이 아닙니다 — supabase/migrations 가 아니라 supabase/scripts.
--   Supabase Dashboard → SQL Editor 에서 직접 실행.
--
-- 대상:
--   - crm_messages    : 발송 건별 이력 (학생 × 캠페인)
--   - crm_campaigns   : 캠페인 마스터
--   - crm_templates   : 문자 템플릿
--
-- 보존:
--   - crm_groups      : 발송 그룹 정의 (필터 조건). 학생 명단 필터링 자산이라 유지.
--                       단, last_sent_at / last_message_preview 캐시는 함께 비움.
--   - crm_unsubscribes: 학부모 수신거부 명단. 운영 안전 정책상 절대 비우지 않음.
--   - 학생/수강/출결/지역 등 운영 데이터.
--
-- 트랜잭션:
--   BEGIN/COMMIT 으로 감싸 한 번에 적용. 중간 실패 시 전부 롤백.
--   TRUNCATE ... CASCADE 사용 — FK 관계상 발송 그룹 외 모든 참조가 자동 정리.
-- ============================================================

BEGIN;

-- 1) 발송 이력 → 캠페인 → 템플릿 순서로 비움.
--    CASCADE 가 알아서 FK 의존성을 풀어주지만 명시적으로 dependent-first.
TRUNCATE TABLE public.crm_messages   RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.crm_campaigns  RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.crm_templates  RESTART IDENTITY CASCADE;

-- 2) 발송 그룹의 최근 발송 메타데이터 캐시 비우기 (그룹 자체는 유지).
UPDATE public.crm_groups
   SET last_sent_at = NULL,
       last_message_preview = NULL;

COMMIT;

-- 검증 (각 0건 이어야 함):
--   SELECT COUNT(*) FROM public.crm_messages;
--   SELECT COUNT(*) FROM public.crm_campaigns;
--   SELECT COUNT(*) FROM public.crm_templates;
