-- ============================================================
-- 0021_messages_update_policy.sql
-- messages UPDATE RLS 정책 추가 (발송 결과 반영용).
--
-- 배경:
--   0003 의 messages 정책은 SELECT + INSERT 만 정의되어 있고 UPDATE 정책이
--   없다. 주석엔 "Webhook 으로 status 업데이트는 service_role 로 우회 수행" 으로
--   설계되어 있으나, 우리 send-campaign 흐름은 일반 사용자 세션(authenticated)
--   으로 동작하면서 messages 의 status / vendor_message_id / cost / sent_at /
--   failed_reason / delivered_at 을 갱신해야 한다.
--
--   현재 동작:
--     - INSERT 정책 통과 → messages 행 생성 (status='대기')
--     - 어댑터 send() 호출 후 updateMessage() 시도 → RLS 차단으로 silent no-op
--       (await 후 0 rows affected, error 도 throw 안 함)
--     - 결과: messages.status='대기' 그대로, vendor_message_id=NULL
--   ↑ 사용자 화면에서 "메시지 안 옴" 으로 보이는 첫 번째 원인.
--
-- 변경:
--   messages_update_by_send 정책 추가. messages.campaign_id 의 캠페인 분원에
--   대해 send 권한(can_send_branch) 이 있는 사용자만 UPDATE.
--   - INSERT 정책과 동일한 함수(can_send_branch) 사용 — 일관성.
--   - DELETE 는 여전히 차단 (발송 이력 불변 원칙 유지).
--
-- 롤백 (수동):
--   DROP POLICY IF EXISTS messages_update_by_send ON public.messages;
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS messages_update_by_send ON public.messages;

CREATE POLICY messages_update_by_send ON public.messages
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = messages.campaign_id
        AND public.can_send_branch(c.branch)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = messages.campaign_id
        AND public.can_send_branch(c.branch)
    )
  );

COMMENT ON POLICY messages_update_by_send ON public.messages IS
  '발송 권한자가 자기 분원 캠페인의 메시지 status/vendor_message_id/cost/sent_at/failed_reason 을 갱신할 수 있게 허용. send-campaign 의 updateMessage 가 silent fail 하지 않도록 0021 에서 추가.';

COMMIT;
