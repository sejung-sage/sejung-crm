-- ============================================================================
-- 0092_signup_roster_added.sql
-- 설명회 명단: CRM 신청자를 '전체 명단'에 수동 편입했는지 표시하는 플래그.
-- ============================================================================
--
-- [의도]
--   설명회 상세 명단은 좌(CRM 신청생) / 우(전체 명단 = 아카 등록 ∪ 운영자가 추가한
--   CRM 신청자) 2단으로 운영된다. 운영자가 CRM 신청자를 전체 명단으로 옮길 때
--   이 플래그를 TRUE 로 세팅한다. 신청 자체(status)는 건드리지 않으므로 비파괴적.
--
-- [동작]
--   - roster_added = FALSE (기본): CRM 신청생(좌측)에만 노출.
--   - roster_added = TRUE        : 전체 명단(우측)에 합쳐 노출.
--   - 되돌리기(우→좌)도 같은 플래그 토글로 가능(신청 취소가 아님).
-- ============================================================================

ALTER TABLE public.crm_class_signup_items
  ADD COLUMN IF NOT EXISTS roster_added BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.crm_class_signup_items.roster_added IS
  '운영자가 이 CRM 신청을 설명회 전체 명단에 수동 편입했는지 여부. TRUE 면 전체 명단(우측)에 노출. 신청 status 와 독립(비파괴적 토글).';
