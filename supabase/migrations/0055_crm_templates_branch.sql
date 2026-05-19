-- ============================================================
-- 0055_crm_templates_branch.sql
-- crm_templates 에 branch 컬럼 추가 + 분원 격리 RLS.
-- ------------------------------------------------------------
-- 배경:
--   /compose 페이지가 listTemplates() 로 모든 분원 템플릿을 섞어서
--   노출하는 문제 발견 (UX 감사 결과 #1, #4). groups·campaigns 와
--   동일한 분원 격리 정책으로 일치시킨다.
-- 변경:
--   1) ADD COLUMN branch text NOT NULL.
--      기존 행은 created_by 의 crm_users_profile.branch 로 백필,
--      매핑이 없으면 '대치' (운영 메인 분원) 로.
--   2) RLS:
--      - 읽기: can_read_branch(branch)  (master 는 모두, 그 외 본인 분원)
--      - 쓰기: can_write_branch(branch) (master + admin 본인 분원)
--   3) INDEX (branch) 추가.
-- 롤백:
--   ALTER TABLE crm_templates DROP COLUMN branch;
--   기존 ALL-읽기 정책 복구는 0013 마이그레이션의 templates_read_all,
--   templates_write_by_send 정의를 참고.
-- ============================================================

-- ── 1) 컬럼 추가 (기본값 '대치' 로 일단 충족) ──────────────
ALTER TABLE public.crm_templates
  ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT '대치';

COMMENT ON COLUMN public.crm_templates.branch IS
  '분원 (대치/송도/반포/방배). 0055 추가. master 만 다른 분원 템플릿 조회/편집 가능.';

-- ── 2) 백필 — created_by 의 분원으로 갱신 ──────────────────
-- created_by 가 NULL 이거나 매핑이 없는 행은 default '대치' 유지.
UPDATE public.crm_templates t
   SET branch = up.branch
  FROM public.crm_users_profile up
 WHERE t.created_by IS NOT NULL
   AND t.created_by = up.user_id
   AND up.branch IS NOT NULL
   AND up.branch <> '';

-- 백필 후 DEFAULT 제거 — 신규 INSERT 는 명시적으로 branch 지정 필수.
ALTER TABLE public.crm_templates
  ALTER COLUMN branch DROP DEFAULT;

-- ── 3) RLS 재정의 — 읽기/쓰기 모두 분원 헬퍼 기준 ───────────
-- 이전 정책(전사 공유) 정리.
DROP POLICY IF EXISTS templates_read_all   ON public.crm_templates;
DROP POLICY IF EXISTS templates_write_by_send ON public.crm_templates;

CREATE POLICY crm_templates_read_branch ON public.crm_templates
  FOR SELECT USING (public.can_read_branch(branch));

CREATE POLICY crm_templates_write_branch ON public.crm_templates
  FOR ALL
  USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

COMMENT ON POLICY crm_templates_read_branch ON public.crm_templates IS
  '템플릿 읽기 — master 는 전사, 그 외는 본인 분원 만.';
COMMENT ON POLICY crm_templates_write_branch ON public.crm_templates IS
  '템플릿 쓰기 — master + admin(본인 분원). manager/viewer 는 쓰기 불가.';

-- ── 4) 인덱스 ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_crm_templates_branch
  ON public.crm_templates (branch);
