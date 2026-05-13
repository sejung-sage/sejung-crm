-- ============================================================
-- 0032_bulk_message_status_update.sql
-- 메시지 상태 일괄 갱신 RPC 두 개.
--
-- 배경:
--   drain-campaign 이 1청크(=1,000건) 처리 후 messages 테이블에 1건씩 UPDATE 를
--   1,000번 호출하던 구조. 50 parallel × 20 wave 로 묶었지만 여전히 PostgREST
--   HTTP round-trip 1,000회. 6만건 캠페인이 한 drain 호출의 240s time budget 안에
--   7~8 청크밖에 못 처리해 "이어보내기" 를 반복 클릭해야 하는 원인이 됨
--   (2026-05-13 60K 캠페인이 7청크 처리 후 정지).
--
-- 해법:
--   1청크 1,000건을 단일 SQL UPDATE 로 묶는 RPC 두 개:
--     - mark_messages_sent  : sendon batch 응답이 queued 일 때 호출
--     - mark_messages_failed: sendon batch 응답이 failed 일 때 호출
--   한 청크의 메시지는 같은 vendor_message_id(=groupId) 를 공유하므로 한
--   SQL 호출에 묶기에 자연스럽다.
--
-- 효과:
--   - 청크당 UPDATE 라운드트립 1,000회 → 1회 (~99.9% 절감)
--   - 청크당 처리시간 ≈ 30초 → ≈ 5초
--   - 240s budget 안 처리량 7~8청크 → 40~48청크 (=40K~48K건)
--   - 6만건 캠페인이 drain 1~2호출로 완결 (이전 8회 클릭 필요)
--
-- 권한:
--   service_role 만 EXECUTE 허용. drain 라우트가 service client 로 호출.
--
-- 롤백:
--   DROP FUNCTION IF EXISTS public.mark_messages_sent(uuid[], text, int, timestamptz);
--   DROP FUNCTION IF EXISTS public.mark_messages_failed(uuid[], text, timestamptz);
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) mark_messages_sent
--    queued 응답 처리: status='발송됨', vendor_message_id, cost, sent_at 일괄 설정.
--    반환: 실제 UPDATE 된 row 수 (호출자가 sanity check 용).
-- ------------------------------------------------------------
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

  UPDATE public.messages
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
  '으로 일괄 갱신. p_vendor_message_id 는 sendon groupId — 한 batch 의 N건이 공유.';


-- ------------------------------------------------------------
-- 2) mark_messages_failed
--    failed 응답 처리: status='실패', failed_reason, sent_at 일괄 설정.
-- ------------------------------------------------------------
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

  UPDATE public.messages
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
  'failed_reason 으로 일괄 갱신. 부분 실패 식별은 추후 sendon find API 로 보강.';


-- ------------------------------------------------------------
-- 3) 권한
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mark_messages_sent(uuid[], text, int, timestamptz)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_messages_failed(uuid[], text, timestamptz)      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_messages_sent(uuid[], text, int, timestamptz)   TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_messages_failed(uuid[], text, timestamptz)      TO service_role;

COMMIT;
