-- ============================================================
-- 0117_templates_manager_write.sql
-- crm_templates : manager 롤에 본인 분원 쓰기 허용
-- ------------------------------------------------------------
-- 배경 (반포 부원장 요청 2026-08-07):
--   "자주 쓰는 문구를 분원별로 저장해놓고 쓰고 싶다" — 기능(/templates)은
--   0013/0055 에서 이미 완성돼 있으나, 쓰기 정책이 master/admin 한정이라
--   부원장 계정(role='manager')은 목록만 보이고 저장 시 튕겼다.
--   부원장이 상용문구를 직접 관리하는 것이 운영 실태이므로 쓰기를 연다.
--
-- 범위 (의도적으로 좁힘):
--   crm_templates 한 테이블만. 학생·그룹·계정·수신거부 등 다른 리소스의
--   manager 권한은 그대로 read(+campaign send) 유지.
--   → 공용 헬퍼 can_write_branch() 를 고치면 전 테이블에 새어나가므로
--     템플릿 전용 헬퍼 can_write_template_branch() 를 새로 만든다.
--
-- 롤백:
--   DROP POLICY crm_templates_write_branch ON public.crm_templates;
--   CREATE POLICY crm_templates_write_branch ON public.crm_templates
--     FOR ALL USING (public.can_write_branch(branch))
--     WITH CHECK (public.can_write_branch(branch));
--   DROP FUNCTION public.can_write_template_branch(TEXT);
-- ============================================================

BEGIN;

-- ── 1) 템플릿 전용 쓰기 헬퍼 ────────────────────────────────
-- can_write_branch() 와 동일하되 manager 를 포함한다.
-- can_send_branch() 와 허용 롤 집합이 같지만, "발송 트리거"와 "상용문구 편집"은
-- 서로 독립적으로 바뀔 수 있는 정책이라 함수를 공유하지 않는다.
CREATE OR REPLACE FUNCTION public.can_write_template_branch(target_branch TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_users_profile up
    WHERE up.user_id = auth.uid()
      AND up.active = TRUE
      AND (
        up.role = 'master'
        OR (up.role IN ('admin', 'manager') AND up.branch = target_branch)
      )
  );
$$;

COMMENT ON FUNCTION public.can_write_template_branch(TEXT) IS
  '상용문구(crm_templates) 쓰기 권한 — master 전사, admin/manager 는 본인 분원. 0117 추가.';

-- ── 2) 쓰기 정책 교체 ───────────────────────────────────────
DROP POLICY IF EXISTS crm_templates_write_branch ON public.crm_templates;

CREATE POLICY crm_templates_write_branch ON public.crm_templates
  FOR ALL
  USING (public.can_write_template_branch(branch))
  WITH CHECK (public.can_write_template_branch(branch));

COMMENT ON POLICY crm_templates_write_branch ON public.crm_templates IS
  '상용문구 쓰기 — master + admin/manager(본인 분원). 0117 에서 manager 추가. viewer 는 여전히 읽기 전용.';

COMMIT;
