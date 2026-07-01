-- ============================================================
-- 0102_send_dashboard_rpc.sql
-- crm_send_dashboard RPC — 마스터 전용 발송 대시보드 집계.
-- ------------------------------------------------------------
-- 배경 (2026-07-01):
--   대표(마스터)가 발송 성과를 한눈에 보고 싶어함. 기간·분원·발송자·설명회
--   링크 유무로 필터하고, 월/분원/발송자 축으로 집계한 건수·금액·유형별 건수를
--   한 번에 받아 대시보드를 그린다.
--
-- 데이터 소스:
--   - crm_campaigns (c): 캠페인 1행. branch/created_by/type/sent_at/is_test 보유.
--   - crm_messages  (m): 수신자 1건. campaign_id FK, status/cost/is_test 보유.
--       branch/created_by/type 는 messages 에 없으므로 반드시 campaign 조인.
--   - crm_class_signup_invitations: campaign_id 가 EXISTS 하면 '설명회 링크 있음'.
--   - crm_users_profile (up): 발송자 이름(name) 조회 — sender 그룹 라벨용.
--
-- 집계 규칙:
--   - 성공 발송 = m.status IN ('발송됨','도달'). 실패/수신거부는 cost=0 이라
--     굳이 배제하지 않아도 금액엔 영향 없으나, 건수 정확성을 위해 status 필터.
--   - 테스트 발송 제외: m.is_test = false AND c.is_test = false.
--   - 금액은 이미 crm_messages.cost 에 건별 저장돼 있으므로 SUM(cost) (재계산 X).
--   - 월 버킷은 KST 기준: to_char(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM').
--
-- 권한:
--   - SECURITY DEFINER 라 RLS 를 우회한다 → 함수 최상단에서 is_master() 가드 필수.
--     비마스터 호출은 42501(권한 없음) 예외.
--   - GRANT EXECUTE 는 authenticated 전체(내부 가드가 실제 접근 제어 담당).
--
-- 롤백:
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.crm_send_dashboard(
--     timestamptz, timestamptz, text, uuid, text, text
--   );
--   COMMIT;
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.crm_send_dashboard(
  timestamptz, timestamptz, text, uuid, text, text
);

CREATE FUNCTION public.crm_send_dashboard(
  p_from     timestamptz DEFAULT NULL,   -- 발송 시작(포함), c.sent_at 기준. NULL=제한 없음
  p_to       timestamptz DEFAULT NULL,   -- 발송 끝(포함), c.sent_at 기준. NULL=제한 없음
  p_branch   text        DEFAULT NULL,   -- 분원 필터. NULL=전체
  p_sender   uuid        DEFAULT NULL,   -- 발송자(c.created_by) 필터. NULL=전체
  p_seminar  text        DEFAULT 'all',  -- 설명회 링크: 'all' | 'with' | 'without'
  p_group_by text        DEFAULT 'month' -- 집계 축: 'month' | 'branch' | 'sender'
)
RETURNS TABLE(
  group_key      text,    -- 그룹 원시키 (month:'YYYY-MM' / branch:분원 / sender:created_by uuid 문자열)
  group_label    text,    -- 표시용 (month=key / branch=분원 / sender=발송자 이름 or '(알수없음)')
  msg_count      bigint,  -- 성공 발송 건수
  total_cost     bigint,  -- 금액 합계 (원)
  sms_count      bigint,  -- SMS 성공 건수
  lms_count      bigint,  -- LMS 성공 건수
  alimtalk_count bigint   -- 알림톡 성공 건수
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 마스터 가드: SECURITY DEFINER 로 RLS 를 우회하므로 내부에서 반드시 검증.
  IF NOT public.is_master() THEN
    RAISE EXCEPTION '권한 없음: 마스터 전용' USING ERRCODE = '42501';
  END IF;

  -- 집계 축 검증.
  IF p_group_by NOT IN ('month', 'branch', 'sender') THEN
    RAISE EXCEPTION '잘못된 p_group_by: %, (month|branch|sender 중 하나)', p_group_by
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    -- 성공·비테스트 발송만 걸러 캠페인 축 필드를 붙인 기준 집합.
    SELECT
      to_char(c.sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS month_key,
      c.branch      AS branch,
      c.created_by  AS sender_id,
      c.type        AS type,
      m.cost        AS cost
    FROM public.crm_messages m
    JOIN public.crm_campaigns c ON c.id = m.campaign_id
    WHERE m.status IN ('발송됨', '도달')
      AND m.is_test = false
      AND c.is_test = false
      AND (p_from   IS NULL OR c.sent_at >= p_from)
      AND (p_to     IS NULL OR c.sent_at <= p_to)
      AND (p_branch IS NULL OR c.branch = p_branch)
      AND (p_sender IS NULL OR c.created_by = p_sender)
      -- 설명회 링크 유무: invitations 에 해당 campaign_id 존재 여부.
      AND (
        p_seminar = 'all'
        OR (p_seminar = 'with' AND EXISTS (
              SELECT 1 FROM public.crm_class_signup_invitations inv
              WHERE inv.campaign_id = c.id))
        OR (p_seminar = 'without' AND NOT EXISTS (
              SELECT 1 FROM public.crm_class_signup_invitations inv
              WHERE inv.campaign_id = c.id))
      )
  ),
  agg AS (
    -- 그룹 축(g_key)·라벨(g_label) 을 p_group_by 로 분기해 한 번에 집계.
    SELECT
      CASE p_group_by
        WHEN 'month'  THEN f.month_key
        WHEN 'branch' THEN f.branch
        WHEN 'sender' THEN f.sender_id::text
      END AS g_key,
      CASE p_group_by
        WHEN 'month'  THEN f.month_key
        WHEN 'branch' THEN f.branch
        WHEN 'sender' THEN COALESCE(up.name, '(알수없음)')
      END AS g_label,
      COUNT(*)                                            AS c_count,
      COALESCE(SUM(f.cost), 0)                            AS c_cost,
      COUNT(*) FILTER (WHERE f.type = 'SMS')              AS c_sms,
      COUNT(*) FILTER (WHERE f.type = 'LMS')              AS c_lms,
      COUNT(*) FILTER (WHERE f.type = 'ALIMTALK')         AS c_alimtalk
    FROM filtered f
    LEFT JOIN public.crm_users_profile up
      ON p_group_by = 'sender' AND up.user_id = f.sender_id
    GROUP BY 1, 2
  )
  SELECT
    a.g_key,
    a.g_label,
    a.c_count,
    a.c_cost::bigint,
    a.c_sms,
    a.c_lms,
    a.c_alimtalk
  FROM agg a
  ORDER BY
    -- month 는 시간순(key ASC), branch/sender 는 금액 큰 순(total DESC).
    CASE WHEN p_group_by = 'month' THEN a.g_key END ASC,
    CASE WHEN p_group_by <> 'month' THEN a.c_cost END DESC;
END;
$$;

COMMENT ON FUNCTION public.crm_send_dashboard(
  timestamptz, timestamptz, text, uuid, text, text
) IS
  '마스터 전용 발송 대시보드 집계 RPC(SECURITY DEFINER, 내부 is_master() 가드). '
  'crm_messages(status IN 발송됨/도달, 비테스트) 를 crm_campaigns 조인해 기간(p_from/p_to, c.sent_at)·'
  '분원(p_branch)·발송자(p_sender)·설명회링크(p_seminar: all/with/without, crm_class_signup_invitations EXISTS) '
  '로 거르고, p_group_by(month|branch|sender) 축으로 건수·금액(SUM(cost))·유형별(SMS/LMS/ALIMTALK) 건수를 반환. '
  '월은 KST(Asia/Seoul) YYYY-MM 버킷. sender 라벨은 crm_users_profile.name(없으면 (알수없음)). '
  '정렬: month=key ASC, 그 외 total_cost DESC. 0102.';

GRANT EXECUTE ON FUNCTION public.crm_send_dashboard(
  timestamptz, timestamptz, text, uuid, text, text
) TO authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.crm_send_dashboard(
--   timestamptz, timestamptz, text, uuid, text, text
-- );
-- COMMIT;
-- ============================================================
