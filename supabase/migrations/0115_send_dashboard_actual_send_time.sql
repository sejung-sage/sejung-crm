-- ============================================================
-- 0115_send_dashboard_actual_send_time.sql
-- crm_send_dashboard 의 '발송 시각' 을 예약 시각 기준으로 교정 + 빈 달 0행 자동 생성.
-- ------------------------------------------------------------
-- 배경 (2026-08-04): 대시보드에 2026-08 행이 아예 나타나지 않았다.
--
-- (1) 예약 발송분이 '접수한 달' 로 집계되는 버그
--   drain-campaign 은 scheduled_at 이 미래면 sendon 네이티브 예약으로 배치를 접수하고
--   (reservationDatetime), 그 자리에서 crm_messages 를 '발송됨' 으로 마킹하며
--   m.sent_at 에 **접수 시각(now())** 을 찍는다. 실제 발송은 그 뒤 scheduled_at 에
--   sendon 이 수행하므로, m.sent_at 은 '실제 발송 시각' 이 아니다.
--   캠페인 쪽 c.sent_at 은 예약 경로에서 NULL 이라 보정도 안 된다.
--
--   실측: 8/1~8/8 예약분 56,991건이 전부 7/28~7/31 에 접수돼 2026-07 버킷으로 샜다.
--     → 2026-08 행이 통째로 사라지고, 2026-07 이 그만큼 부풀었다.
--   재집계 예상(총계 1,005,548건 불변):
--     2026-06  237,905 → 199,018
--     2026-07  767,644 → 749,539
--     2026-08        0 →  56,991
--
--   → 실제 발송 시각 = COALESCE(c.scheduled_at, m.sent_at, c.sent_at).
--     · 예약 발송(즉시 접수 + 미래 발송): c.scheduled_at 이 실제 발송 시각
--     · 즉시 발송: c.scheduled_at 이 NULL → m.sent_at (0103 동작 유지)
--     · 취소된 예약은 메시지가 '실패' 로 바뀌므로 status 필터에서 이미 빠진다
--   월 버킷과 기간 필터(p_from/p_to) 양쪽에 동일하게 적용한다.
--
-- (2) 발송 0건인 달의 행이 생기지 않던 문제
--   월별 집계는 crm_messages 를 GROUP BY 한 결과만 돌려줘, 그 달 발송이 없으면
--   행 자체가 없다. 운영 입장에서는 집계 누락과 구분되지 않는다.
--   → month 축일 때 연속 월 격자를 만들어 0건인 달도 0행으로 채운다.
--     격자 범위(KST): p_from 의 달(없으면 최초 발송 달) ~ p_to 의 달(없으면 이번 달).
--     끝을 항상 이번 달로 잡으므로 달이 바뀌면 그 달 행이 자동으로 생긴다.
--     branch/sender 축은 격자 개념이 없어 0103 동작 그대로.
--
-- 시그니처·반환 컬럼 불변 → CREATE OR REPLACE. 프런트엔드 변경 없음.
-- 롤백: 0103 을 다시 apply.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_send_dashboard(
  p_from     timestamptz DEFAULT NULL,   -- 발송 시작(포함), 실제 발송 시각 기준. NULL=제한 없음
  p_to       timestamptz DEFAULT NULL,   -- 발송 끝(포함), 실제 발송 시각 기준. NULL=제한 없음
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
    -- 발송 시각 = COALESCE(c.scheduled_at, m.sent_at, c.sent_at).
    --   예약 발송은 m.sent_at 이 '접수 시각' 이라 실제 발송월을 못 맞춘다 → scheduled_at 우선.
    SELECT
      to_char(
        COALESCE(c.scheduled_at, m.sent_at, c.sent_at) AT TIME ZONE 'Asia/Seoul',
        'YYYY-MM'
      )             AS month_key,
      c.branch      AS branch,
      c.created_by  AS sender_id,
      c.type        AS type,
      m.cost        AS cost
    FROM public.crm_messages m
    JOIN public.crm_campaigns c ON c.id = m.campaign_id
    WHERE m.status IN ('발송됨', '도달')
      AND m.is_test = false
      AND c.is_test = false
      AND (p_from IS NULL
           OR COALESCE(c.scheduled_at, m.sent_at, c.sent_at) >= p_from)
      AND (p_to IS NULL
           OR COALESCE(c.scheduled_at, m.sent_at, c.sent_at) <= p_to)
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
  ),
  bounds AS (
    -- 월 격자의 시작·끝(KST 월 초). month 축이 아니면 아래 months 에서 통째로 걸러진다.
    SELECT
      COALESCE(
        date_trunc('month', p_from AT TIME ZONE 'Asia/Seoul'),
        (SELECT date_trunc('month', to_date(MIN(f.month_key), 'YYYY-MM')) FROM filtered f),
        date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')
      ) AS lo,
      COALESCE(
        date_trunc('month', p_to AT TIME ZONE 'Asia/Seoul'),
        date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')
      ) AS hi
  ),
  months AS (
    -- lo~hi 연속 월 격자. 발송이 없는 달도 여기서 키가 만들어진다.
    SELECT to_char(gs, 'YYYY-MM') AS month_key
    FROM bounds b
    CROSS JOIN LATERAL generate_series(b.lo, b.hi, interval '1 month') AS gs
    WHERE p_group_by = 'month'
  ),
  result AS (
    -- 실제 집계 + (월 축일 때만) 집계가 없는 달의 0행.
    SELECT
      a.g_key, a.g_label,
      a.c_count, a.c_cost::bigint AS c_cost, a.c_sms, a.c_lms, a.c_alimtalk
    FROM agg a
    UNION ALL
    SELECT
      m.month_key, m.month_key,
      0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint
    FROM months m
    WHERE NOT EXISTS (SELECT 1 FROM agg a WHERE a.g_key = m.month_key)
  )
  SELECT
    r.g_key,
    r.g_label,
    r.c_count,
    r.c_cost,
    r.c_sms,
    r.c_lms,
    r.c_alimtalk
  FROM result r
  ORDER BY
    -- month 는 시간순(key ASC), branch/sender 는 금액 큰 순(total DESC).
    CASE WHEN p_group_by = 'month' THEN r.g_key END ASC,
    CASE WHEN p_group_by <> 'month' THEN r.c_cost END DESC;
END;
$$;

COMMENT ON FUNCTION public.crm_send_dashboard(
  timestamptz, timestamptz, text, uuid, text, text
) IS
  '마스터 전용 발송 대시보드 집계 RPC(SECURITY DEFINER, 내부 is_master() 가드). '
  'crm_messages(status IN 발송됨/도달, 비테스트) 를 crm_campaigns 조인해 기간(p_from/p_to)·분원(p_branch)·'
  '발송자(p_sender)·설명회링크(p_seminar: all/with/without, crm_class_signup_invitations EXISTS) 로 거르고, '
  'p_group_by(month|branch|sender) 축으로 건수·금액(SUM(cost))·유형별(SMS/LMS/ALIMTALK) 건수를 반환. '
  '발송 시각은 COALESCE(c.scheduled_at, m.sent_at, c.sent_at) — 예약 발송은 m.sent_at 이 sendon 접수 시각이라 '
  '실제 발송월을 못 맞추므로 scheduled_at 을 우선한다. 월은 KST(Asia/Seoul) YYYY-MM 버킷. '
  'month 축은 [p_from 또는 최초 발송월] ~ [p_to 또는 이번 달] 연속 격자를 만들어 발송 0건인 달도 0행으로 채운다. '
  'sender 라벨은 crm_users_profile.name(없으면 (알수없음)). 정렬: month=key ASC, 그 외 total_cost DESC. 0115.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동): 0103 을 다시 apply 하면 m.sent_at 기준 + 빈 달 누락으로 되돌아간다.
-- ============================================================
