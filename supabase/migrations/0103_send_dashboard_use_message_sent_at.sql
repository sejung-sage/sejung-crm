-- ============================================================
-- 0103_send_dashboard_use_message_sent_at.sql
-- crm_send_dashboard 월 버킷·기간 필터를 m.sent_at 기준으로 교체.
-- ------------------------------------------------------------
-- 배경 (2026-07-01):
--   0102 는 월 버킷과 기간 필터(p_from/p_to)를 crm_campaigns.sent_at 으로 잡았다.
--   그런데 예약/드레인 발송 경로는 캠페인의 sent_at 을 채우지 않는다(완료 상태여도
--   c.sent_at IS NULL). 반면 mark_messages_sent 는 개별 메시지의 m.sent_at 을 찍는다.
--   실측: 성공 발송 메시지의 약 31%(≈186k건)가 c.sent_at NULL 이라
--     (1) 월 버킷이 NULL 그룹으로 새고,
--     (2) 기간 필터를 걸면 c.sent_at >= p_from 을 만족 못 해 통째로 사라진다.
--   → '실제 발송 시각' 은 m.sent_at 이 정답. 월 버킷·기간 필터를
--     COALESCE(m.sent_at, c.sent_at) 로 바꿔 전 발송분을 정확히 포착한다.
--
--   나머지 로직(성공/비테스트 필터, 분원·발송자·설명회 필터, 그룹 축, 정렬,
--   마스터 가드)은 0102 그대로. 시그니처·반환 컬럼 불변 → CREATE OR REPLACE.
--
-- 롤백: 0102 의 함수 본문으로 되돌리려면 0102 를 다시 apply.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_send_dashboard(
  p_from     timestamptz DEFAULT NULL,   -- 발송 시작(포함), m.sent_at 기준. NULL=제한 없음
  p_to       timestamptz DEFAULT NULL,   -- 발송 끝(포함), m.sent_at 기준. NULL=제한 없음
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
    -- 발송 시각은 m.sent_at 우선(캠페인 sent_at 이 NULL 인 예약/드레인 발송 대비).
    SELECT
      to_char(COALESCE(m.sent_at, c.sent_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS month_key,
      c.branch      AS branch,
      c.created_by  AS sender_id,
      c.type        AS type,
      m.cost        AS cost
    FROM public.crm_messages m
    JOIN public.crm_campaigns c ON c.id = m.campaign_id
    WHERE m.status IN ('발송됨', '도달')
      AND m.is_test = false
      AND c.is_test = false
      AND (p_from   IS NULL OR COALESCE(m.sent_at, c.sent_at) >= p_from)
      AND (p_to     IS NULL OR COALESCE(m.sent_at, c.sent_at) <= p_to)
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
  'crm_messages(status IN 발송됨/도달, 비테스트) 를 crm_campaigns 조인해 기간(p_from/p_to, '
  'COALESCE(m.sent_at, c.sent_at))·분원(p_branch)·발송자(p_sender)·설명회링크(p_seminar: all/with/without, '
  'crm_class_signup_invitations EXISTS) 로 거르고, p_group_by(month|branch|sender) 축으로 건수·금액(SUM(cost))·'
  '유형별(SMS/LMS/ALIMTALK) 건수를 반환. 월은 KST(Asia/Seoul) YYYY-MM 버킷(m.sent_at 우선). '
  'sender 라벨은 crm_users_profile.name(없으면 (알수없음)). 정렬: month=key ASC, 그 외 total_cost DESC. 0103.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동): 0102 를 다시 apply 하면 c.sent_at 기준으로 되돌아간다.
-- ============================================================
