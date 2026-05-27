-- 0075_campaigns_read_own_or_master.sql
-- 발송내역(crm_campaigns) 조회 가시성 축소 — 본인 발송분만, master 는 전체.
--
-- 배경 (2026-05-27, 박은주 부원장 요청):
--   기존 정책 campaigns_read_by_branch 는 같은 분원의 모든 사용자가 서로의
--   발송 캠페인을 열람 가능했다. 운영상 "발송내역은 본인이 보낸 것만 보이고,
--   master 만 전체를 본다"로 좁힌다.
--
-- 정책 변경:
--   - master            : 전체 분원·전 사용자 캠페인 조회 (is_master()).
--   - 그 외(admin/manager/viewer) : created_by = auth.uid() 인 본인 발송분만.
--     (본인 캠페인은 항상 본인 분원이므로 분원 격리는 자동 충족.)
--
-- 적용 범위:
--   crm_campaigns SELECT 정책만 교체. INSERT/UPDATE/DELETE 정책은 그대로.
--   crm_messages 읽기 정책은 변경하지 않음 — 상세 진입은 get-campaign(앱 1차
--   가드) + 본 SELECT 정책으로 차단되므로 타 사용자 메시지 노출 경로 없음.
--
-- 앱 레이어 1차 가드(list-campaigns / get-campaign 의 created_by 필터)와
-- 이 RLS 2차 가드의 더블 가드 패턴 (actions.ts 표준과 동일).
--
-- 롤백 (수동):
--   DROP POLICY IF EXISTS campaigns_read_own_or_master ON public.crm_campaigns;
--   CREATE POLICY campaigns_read_by_branch ON public.crm_campaigns
--     FOR SELECT USING (public.can_read_branch(branch));

BEGIN;

DROP POLICY IF EXISTS campaigns_read_by_branch ON public.crm_campaigns;

CREATE POLICY campaigns_read_own_or_master ON public.crm_campaigns
  FOR SELECT
  USING (
    public.is_master()
    OR created_by = auth.uid()
  );

COMMENT ON POLICY campaigns_read_own_or_master ON public.crm_campaigns IS
  '발송내역 조회: master 는 전체, 그 외 역할은 created_by = auth.uid() 본인 발송분만.';

COMMIT;
