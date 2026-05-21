-- ============================================================
-- 0069_mark_messages_rpc_crm_prefix.sql
-- 메시지 상태 일괄 갱신 RPC 의 테이블 참조를 crm_messages 로 갱신.
-- ------------------------------------------------------------
-- 배경:
--   0032 에서 도입한 mark_messages_sent / mark_messages_failed 가
--   `public.messages` 를 참조한다. 그러나 dual-layer 도입(0048+) 이후
--   메시지 테이블은 `crm_messages` 로 prefix 변경됨. RPC 함수 본문은
--   그때 같이 갱신되지 않아 drain 워커가 호출하면 다음 에러로 폭주:
--     relation "public.messages" does not exist
--   대치 강남구 재원생 캠페인(2,287건)이 발송중인데 전체 대기 상태로
--   고착된 직접 원인이 이것.
--
-- 수정:
--   동일 시그니처로 CREATE OR REPLACE — UPDATE 대상만 crm_messages 로.
--   권한·SECURITY DEFINER·search_path 등 나머지는 0032 와 동일.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_messages_sent(
  p_ids uuid[],
  p_vendor_message_id text,
  p_cost int,
  p_sent_at timestamptz DEFAULT now()
)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.crm_messages
     SET status = '발송됨',
         vendor_message_id = p_vendor_message_id,
         cost = p_cost,
         sent_at = p_sent_at
   WHERE id = ANY(p_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.mark_messages_sent(uuid[], text, int, timestamptz) IS
  'drain 워커가 sendon batch 큐 적재 성공 후 호출. p_ids 의 메시지를 status=발송됨 '
  '으로 일괄 갱신. p_vendor_message_id 는 sendon groupId — 한 batch 의 N건이 공유. '
  '0069: dual-layer prefix(crm_messages) 반영.';


CREATE OR REPLACE FUNCTION public.mark_messages_failed(
  p_ids uuid[],
  p_failed_reason text,
  p_sent_at timestamptz DEFAULT now()
)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.crm_messages
     SET status = '실패',
         failed_reason = p_failed_reason,
         sent_at = p_sent_at
   WHERE id = ANY(p_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.mark_messages_failed(uuid[], text, timestamptz) IS
  'drain 워커가 sendon batch 실패 시 호출. p_ids 의 메시지를 status=실패 + '
  'failed_reason 으로 일괄 갱신. 부분 실패 식별은 추후 sendon find API 로 보강. '
  '0069: dual-layer prefix(crm_messages) 반영.';


REVOKE ALL ON FUNCTION public.mark_messages_sent(uuid[], text, int, timestamptz)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_messages_failed(uuid[], text, timestamptz)      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_messages_sent(uuid[], text, int, timestamptz)   TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_messages_failed(uuid[], text, timestamptz)      TO service_role;


-- ------------------------------------------------------------
-- find_stalled_campaigns 도 같은 사유로 갱신.
-- 0031 의 원본은 public.campaigns / public.messages 옛 이름 참조.
-- pg_cron sweep_stalled_campaigns() 가 본 함수를 호출해 멈춘 캠페인을
-- 자동 재킥하므로 dual-layer 후로도 정상 동작해야 함.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_stalled_campaigns(
  p_stall_minutes int DEFAULT 3
)
RETURNS TABLE (campaign_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id AS campaign_id
    FROM public.crm_campaigns c
   WHERE c.status = '발송중'
     AND EXISTS (
       SELECT 1
         FROM public.crm_messages m
        WHERE m.campaign_id = c.id
          AND m.status = '대기'
     )
     AND COALESCE(
           (SELECT MAX(m.sent_at)
              FROM public.crm_messages m
             WHERE m.campaign_id = c.id),
           c.created_at
         ) < (now() - make_interval(mins => p_stall_minutes));
$$;

COMMENT ON FUNCTION public.find_stalled_campaigns(int) IS
  '발송중인데 마지막 발송 시각이 p_stall_minutes 분 이상 전인 캠페인 ID 목록. '
  '한 건도 발송 안된 케이스는 crm_campaigns.created_at 으로 판정. '
  'pg_cron sweep_stalled_campaigns() 가 사용. '
  '0069: dual-layer prefix(crm_campaigns / crm_messages) 반영.';

COMMIT;
