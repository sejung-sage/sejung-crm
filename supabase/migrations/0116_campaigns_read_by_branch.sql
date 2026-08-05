-- ============================================================
-- 0116_campaigns_read_by_branch.sql
-- 발송내역(crm_campaigns) 조회 가시성을 다시 분원 단위로 확대.
-- ------------------------------------------------------------
-- 배경 (2026-08-04):
--   0075(2026-05-27, 박은주 부원장 요청)로 "발송내역은 본인이 보낸 것만"으로 좁혔으나,
--   운영상 같은 분원 담당자끼리 발송 이력을 공유해야 한다는 요청이 다시 들어왔다.
--   (담당자 부재 시 동료가 이력 확인·후속 처리를 대신해야 함)
--   → 0075 이전의 분원 기준 정책으로 되돌린다.
--
-- 정책:
--   - master                      : 전체 분원 조회 (can_read_branch 내부 분기)
--   - 그 외(admin/manager/viewer) : 본인 분원(up.branch = c.branch) 캠페인 전부
--
-- 파급 (의도된 동작 — 2026-08-04 사용자 확인):
--   취소/예약변경/재발송/재개 액션은 이미 분원 기준 가드(can_send_branch 계열)라
--   소유자 검사가 없다. 조회가 열리면서 같은 분원 admin/manager 는 동료의 예약 발송을
--   취소·변경·재발송할 수 있게 된다. 담당자 부재 시 대리 처리를 위해 허용한다.
--   삭제(delete-campaign)는 master 전용이라 변동 없다.
--
--   crm_messages 읽기 정책(messages_read)은 원래부터 캠페인 분원 기준이라 변경 없음.
--   즉 캠페인이 보이면 그 메시지 내역도 함께 보인다.
--
-- 앱 레이어 1차 가드(list-campaigns / get-campaign)도 같은 규칙으로 맞춘다(더블 가드).
--
-- 롤백 (수동): 0075 를 다시 apply.
--   DROP POLICY IF EXISTS campaigns_read_by_branch ON public.crm_campaigns;
--   CREATE POLICY campaigns_read_own_or_master ON public.crm_campaigns
--     FOR SELECT USING (public.is_master() OR created_by = auth.uid());
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS campaigns_read_own_or_master ON public.crm_campaigns;

CREATE POLICY campaigns_read_by_branch ON public.crm_campaigns
  FOR SELECT
  USING (public.can_read_branch(branch));

COMMENT ON POLICY campaigns_read_by_branch ON public.crm_campaigns IS
  '발송내역 조회: master 는 전체, 그 외 역할은 본인 분원 캠페인 전부(발송자 무관). 0116 에서 0075 의 본인 발송분 한정을 되돌림.';

COMMIT;
