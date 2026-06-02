-- 0084_class_signup_tables.sql
-- 설명회·신청 페이지 새 모델 — 강좌(crm_classes) 를 단일 정체성으로 삼는 구조.
-- 기존 crm_seminars / crm_seminar_invitations / crm_seminar_invitation_items 는
-- 본 마이그에서 건드리지 않는다 (코드 전환이 끝난 뒤 별도 마이그로 DROP).
--
-- 배경 (2026-06-02):
--   - 그동안 "설명회" 가 crm_seminars 별도 테이블로 살아 강좌와 단절. Aca 행정팀의
--     실제 워크플로우는 "설명회를 Aca 강좌로 등록"이며, ETL이 0083 까지 와서
--     반형태/이름으로 잡힌 강좌가 subject='설명회' 로 분류된다. 이제 그 강좌를
--     설명회의 정체성으로 삼고, 공개 신청 페이지·invitation 만 별도 테이블로 둔다.
--
-- 새 테이블 3개:
--   1) crm_class_signup_pages       (1개 강좌·1개 페이지. class_id FK NULLABLE — B안 대비)
--   2) crm_class_signup_invitations (학생 단위 페이지 토큰. 1 학생 × 1 발송 = 1 행)
--   3) crm_class_signup_items       (invitation × signup_page 매트릭스. 카드 1개 = 1행)
--
-- 의존성:
--   - 0049 RLS 헬퍼: is_master(), can_read_branch(t), can_write_branch(t).
--   - crm_classes (FK target).
--   - crm_students (FK target).
--
-- 권한 모델:
--   - 운영자 SELECT/INSERT/UPDATE/DELETE: master 전체, admin 본인 분원, 그 외 차단.
--   - 학부모 페이지·신청은 SECURITY DEFINER RPC (별도 마이그) 만 통과.
--
-- 롤백:
--   BEGIN;
--   DROP TABLE IF EXISTS public.crm_class_signup_items;
--   DROP TABLE IF EXISTS public.crm_class_signup_invitations;
--   DROP TABLE IF EXISTS public.crm_class_signup_pages;
--   COMMIT;

BEGIN;

SET LOCAL statement_timeout = '2min';

-- ════════════════════════════════════════════════════════════════
-- 1) crm_class_signup_pages — 강좌별 공개 신청 페이지
-- ════════════════════════════════════════════════════════════════
CREATE TABLE public.crm_class_signup_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- class_id NULLABLE: A안에선 항상 NOT NULL 사용. B안(CRM-only) 대비 NULL 허용.
  -- ON DELETE CASCADE: 강좌가 사라지면 페이지도 함께 정리.
  class_id          UUID REFERENCES public.crm_classes(id) ON DELETE CASCADE,
  branch            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'open', 'closed')),
  signup_opens_at   TIMESTAMPTZ,
  signup_closes_at  TIMESTAMPTZ,
  description       TEXT,
  -- 페이지별 정원. NULL 이면 강좌(crm_classes.capacity) 값을 따른다.
  capacity_override INT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT class_signup_pages_window_chk
    CHECK (
      signup_opens_at IS NULL
      OR signup_closes_at IS NULL
      OR signup_opens_at <= signup_closes_at
    ),
  CONSTRAINT class_signup_pages_capacity_positive_chk
    CHECK (capacity_override IS NULL OR capacity_override > 0),
  -- A안 운영 단계에선 한 강좌당 페이지 1개 — 중복 차단.
  -- B안 도입 시 class_id NULL 행이 여러 개 가능해도 partial unique 이라 그쪽엔 영향 없음.
  CONSTRAINT class_signup_pages_one_per_class
    UNIQUE (class_id)
);

CREATE INDEX idx_class_signup_pages_branch_status
  ON public.crm_class_signup_pages (branch, status);
CREATE INDEX idx_class_signup_pages_class_id
  ON public.crm_class_signup_pages (class_id);

COMMENT ON TABLE  public.crm_class_signup_pages IS
  '강좌별 공개 신청 페이지 메타. 0084 도입 — crm_seminars 를 대체. 1 강좌 = 1 페이지 (UNIQUE class_id). class_id NULL 은 B안(CRM-only 설명회) 대비.';
COMMENT ON COLUMN public.crm_class_signup_pages.id IS '신청 페이지 PK (UUID).';
COMMENT ON COLUMN public.crm_class_signup_pages.class_id IS
  '대상 강좌 FK (crm_classes.id). NULLABLE — A안 운영 단계에선 항상 NOT NULL 채워야 함. B안 도입 시 NULL 행은 페이지 자체에 메타 보유.';
COMMENT ON COLUMN public.crm_class_signup_pages.branch IS
  '분원 (대치/송도/반포/방배). RLS 격리 기준 — 강좌의 분원과 동일하게 채울 것 (app 책임).';
COMMENT ON COLUMN public.crm_class_signup_pages.status IS
  '페이지 상태. draft=비공개·초안 / open=공개 신청 받음 / closed=마감. 학부모 페이지는 open 만 노출.';
COMMENT ON COLUMN public.crm_class_signup_pages.signup_opens_at IS
  '공개 신청 시작 시각 (timestamptz). NULL 이면 status 만으로 판정.';
COMMENT ON COLUMN public.crm_class_signup_pages.signup_closes_at IS
  '공개 신청 마감 시각 (timestamptz). NULL 이면 status 만으로 판정.';
COMMENT ON COLUMN public.crm_class_signup_pages.description IS
  '학부모 페이지에 노출되는 추가 설명 (강좌 기본 정보 외). NULL 허용.';
COMMENT ON COLUMN public.crm_class_signup_pages.capacity_override IS
  '페이지별 정원 override. NULL 이면 crm_classes.capacity 사용. 행사 별 정원 조정용.';
COMMENT ON COLUMN public.crm_class_signup_pages.created_by IS
  '생성자(auth.users.id). 통계·감사용.';

-- ════════════════════════════════════════════════════════════════
-- 2) crm_class_signup_invitations — 학생 단위 페이지 토큰
-- ════════════════════════════════════════════════════════════════
CREATE TABLE public.crm_class_signup_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch       TEXT NOT NULL,
  student_id   UUID NOT NULL REFERENCES public.crm_students(id) ON DELETE CASCADE,
  link_token   TEXT NOT NULL UNIQUE,
  campaign_id  UUID,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_class_signup_invitations_branch_student
  ON public.crm_class_signup_invitations (branch, student_id);
CREATE INDEX idx_class_signup_invitations_campaign
  ON public.crm_class_signup_invitations (campaign_id);

COMMENT ON TABLE  public.crm_class_signup_invitations IS
  '신청 페이지 초대 — 학생 단위. 학생당 1회 발송 = 1행. link_token 으로 학부모가 /s/<token> 접근. 0082 의 crm_seminar_invitations 를 대체.';
COMMENT ON COLUMN public.crm_class_signup_invitations.id IS '초대 PK (UUID).';
COMMENT ON COLUMN public.crm_class_signup_invitations.branch IS
  '분원. RLS 격리 기준 — 학생의 분원과 동일.';
COMMENT ON COLUMN public.crm_class_signup_invitations.student_id IS
  '학생 FK. 학생 삭제 시 함께 삭제(ON DELETE CASCADE) — 학부모 페이지도 자동 무효화.';
COMMENT ON COLUMN public.crm_class_signup_invitations.link_token IS
  '학부모 공개 URL 토큰 (nanoid 12, URL-safe). UNIQUE. ~72bit 엔트로피. 서버 INSERT 시점 생성.';
COMMENT ON COLUMN public.crm_class_signup_invitations.campaign_id IS
  '이 invitation 을 만든 캠페인(crm_campaigns.id). 추적·집계용.';
COMMENT ON COLUMN public.crm_class_signup_invitations.created_by IS
  '발송 작성자(auth.users.id). 감사용.';

-- ════════════════════════════════════════════════════════════════
-- 3) crm_class_signup_items — invitation 안의 카드 (×N pages)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE public.crm_class_signup_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id   UUID NOT NULL REFERENCES public.crm_class_signup_invitations(id) ON DELETE CASCADE,
  signup_page_id  UUID NOT NULL REFERENCES public.crm_class_signup_pages(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'signed', 'cancelled')),
  signed_at       TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID,
  CONSTRAINT class_signup_items_unique_pair
    UNIQUE (invitation_id, signup_page_id),
  CONSTRAINT class_signup_items_signed_consistency_chk
    CHECK (
      (status = 'signed' AND signed_at IS NOT NULL)
      OR (status <> 'signed' AND signed_at IS NULL)
    ),
  CONSTRAINT class_signup_items_cancelled_consistency_chk
    CHECK (
      (status = 'cancelled' AND cancelled_at IS NOT NULL)
      OR (status <> 'cancelled' AND cancelled_at IS NULL)
    )
);

CREATE INDEX idx_class_signup_items_invitation
  ON public.crm_class_signup_items (invitation_id);
CREATE INDEX idx_class_signup_items_page
  ON public.crm_class_signup_items (signup_page_id);
CREATE INDEX idx_class_signup_items_status
  ON public.crm_class_signup_items (status);

COMMENT ON TABLE  public.crm_class_signup_items IS
  'invitation 의 카드들. 각 행 = "이 학생에게 이 페이지를 안내했고, 학부모가 신청/취소했는지" 상태. (invitation_id, signup_page_id) UNIQUE — 동일 invitation 안에서 페이지 중복 차단.';
COMMENT ON COLUMN public.crm_class_signup_items.id IS '아이템 PK.';
COMMENT ON COLUMN public.crm_class_signup_items.invitation_id IS
  '소속 invitation FK. CASCADE — invitation 삭제 시 함께 정리.';
COMMENT ON COLUMN public.crm_class_signup_items.signup_page_id IS
  '대상 신청 페이지 FK. CASCADE — 페이지 삭제 시 함께 정리.';
COMMENT ON COLUMN public.crm_class_signup_items.status IS
  '상태. pending=발송됨·미신청 / signed=학부모 신청 완료 / cancelled=신청 취소.';
COMMENT ON COLUMN public.crm_class_signup_items.signed_at IS
  '학부모 [신청] 클릭 시각. status=signed 일 때만 NOT NULL (CHECK 강제).';
COMMENT ON COLUMN public.crm_class_signup_items.cancelled_at IS
  '취소 시각. status=cancelled 일 때만 NOT NULL (CHECK 강제).';
COMMENT ON COLUMN public.crm_class_signup_items.cancelled_by IS
  '취소 주체(auth.users.id). 학부모 본인 취소면 NULL.';

-- ════════════════════════════════════════════════════════════════
-- RLS — 0082 의 invitation 정책과 동일 패턴(분원 격리·anon 차단).
-- 학부모 페이지는 별도 SECURITY DEFINER RPC 로만 접근 (이후 마이그).
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.crm_class_signup_pages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_class_signup_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_class_signup_items       ENABLE ROW LEVEL SECURITY;

-- pages — 0082 패턴(read / write-ALL 두 정책). 헬퍼가 master 자체 처리.
CREATE POLICY class_signup_pages_read_branch
  ON public.crm_class_signup_pages
  FOR SELECT TO authenticated
  USING (public.can_read_branch(branch));
CREATE POLICY class_signup_pages_write_branch
  ON public.crm_class_signup_pages
  FOR ALL TO authenticated
  USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

COMMENT ON POLICY class_signup_pages_read_branch ON public.crm_class_signup_pages IS
  '신청 페이지 읽기 — master 전사 / admin·manager·viewer 본인 분원. anon 차단.';
COMMENT ON POLICY class_signup_pages_write_branch ON public.crm_class_signup_pages IS
  '신청 페이지 쓰기(INSERT/UPDATE/DELETE) — master 전사 / admin 본인 분원만.';

-- invitations
CREATE POLICY class_signup_invitations_read_branch
  ON public.crm_class_signup_invitations
  FOR SELECT TO authenticated
  USING (public.can_read_branch(branch));
CREATE POLICY class_signup_invitations_write_branch
  ON public.crm_class_signup_invitations
  FOR ALL TO authenticated
  USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

COMMENT ON POLICY class_signup_invitations_read_branch ON public.crm_class_signup_invitations IS
  'invitation 읽기 — master 전사 / 그 외 본인 분원. anon 차단.';
COMMENT ON POLICY class_signup_invitations_write_branch ON public.crm_class_signup_invitations IS
  'invitation 쓰기 — master 전사 / admin 본인 분원만.';

-- items — invitation 의 branch 를 통해 격리 (item 자체엔 branch 컬럼 없음).
CREATE POLICY class_signup_items_read_via_invitation
  ON public.crm_class_signup_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_class_signup_invitations inv
      WHERE inv.id = crm_class_signup_items.invitation_id
        AND public.can_read_branch(inv.branch)
    )
  );
CREATE POLICY class_signup_items_write_via_invitation
  ON public.crm_class_signup_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_class_signup_invitations inv
      WHERE inv.id = crm_class_signup_items.invitation_id
        AND public.can_write_branch(inv.branch)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.crm_class_signup_invitations inv
      WHERE inv.id = crm_class_signup_items.invitation_id
        AND public.can_write_branch(inv.branch)
    )
  );

COMMENT ON POLICY class_signup_items_read_via_invitation ON public.crm_class_signup_items IS
  '아이템 읽기 — invitation 의 분원 기준 격리(item 자체엔 branch 없음). 학부모 페이지는 RPC 통해서만.';
COMMENT ON POLICY class_signup_items_write_via_invitation ON public.crm_class_signup_items IS
  '아이템 쓰기 — invitation 의 분원 기준 격리. 학부모 신청은 SECURITY DEFINER RPC 만.';

-- ════════════════════════════════════════════════════════════════
-- updated_at 자동 갱신 트리거 (pages 만 — invitations/items 는 status
-- 변경 시각이 signed_at/cancelled_at 으로 따로 기록되어 불필요).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_class_signup_pages_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_class_signup_pages_updated_at
  BEFORE UPDATE ON public.crm_class_signup_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_class_signup_pages_updated_at();

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- 다음 마이그(예정 0085~):
--   - lookup_signup_page_by_token(text) — 학부모 페이지 RPC
--   - claim_signup_item(text, uuid)     — 학부모 신청 RPC
--   - 0082 의 RPC 와 같은 시그니처·로직, 테이블만 새 것 사용.
-- 코드 전환(Phase 2~3) 완료 후 별도 마이그로 crm_seminars* 시리즈 DROP.
-- ════════════════════════════════════════════════════════════════
