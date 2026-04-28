-- ============================================================
-- 0013_recreate_groups_templates_messages.sql
-- groups / templates / messages 테이블 복구 마이그레이션.
--
-- 배경:
--   Production DB 에서 위 3개 테이블이 누락된 상태로 발견됨.
--   (supabase_migrations 에는 0001 적용 기록 있으나 실제 테이블 부재)
--   0001 이후 어느 시점에 DROP 되었거나 0001 이 부분 commit된 비정상 상태.
--
-- 안전성:
--   - 누락 테이블 셋은 빈 상태 (조회 불가) — 데이터 손실 위험 없음.
--   - 운영 데이터(students/enrollments/attendances/campaigns/unsubscribes/users_profile)
--     는 건드리지 않음.
--   - IF NOT EXISTS / DROP TRIGGER IF EXISTS 로 멱등성 보장.
--
-- 합쳐진 출처:
--   - 0001_initial_schema.sql (groups/templates/messages 기본)
--   - 0003_rls_policies.sql (해당 정책 3종)
--   - 0005_templates_ad_flag.sql (templates 추가 컬럼)
--   - 0007_messages_test_flag.sql (messages 추가 컬럼)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 사전 조건 · updated_at 트리거 함수 존재 확인
-- (0001 의 set_updated_at() 가 살아 있어야 본 마이그레이션이 동작)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.set_updated_at() IS 'updated_at 컬럼 자동 갱신용 공통 트리거 함수';


-- ============================================================
-- 1) groups · 발송 그룹 (세그먼트)
--    출처: 0001_initial_schema.sql:134-165
-- ============================================================
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipient_count INT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  last_message_preview TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.groups IS '발송 그룹 (세그먼트)';
COMMENT ON COLUMN public.groups.id IS '그룹 ID';
COMMENT ON COLUMN public.groups.name IS '그룹명 (예: 대치 고2 학부모)';
COMMENT ON COLUMN public.groups.branch IS '분원 (대치/송도)';
COMMENT ON COLUMN public.groups.filters IS '필터 조건 JSON (예: {"grades":[2],"schools":["휘문고"],"subjects":["수학"]})';
COMMENT ON COLUMN public.groups.recipient_count IS '총 연락처 수 (집계 캐시)';
COMMENT ON COLUMN public.groups.last_sent_at IS '최근 발송일';
COMMENT ON COLUMN public.groups.last_message_preview IS '마지막 발송 내용 미리보기';
COMMENT ON COLUMN public.groups.created_by IS '생성자 (auth.users FK)';
COMMENT ON COLUMN public.groups.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.groups.updated_at IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_groups_branch ON public.groups (branch);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON public.groups (created_by);
CREATE INDEX IF NOT EXISTS idx_groups_last_sent_at ON public.groups (last_sent_at DESC);

DROP TRIGGER IF EXISTS trg_groups_updated_at ON public.groups;
CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 2) templates · 문자 & 알림톡 템플릿
--    출처: 0001_initial_schema.sql:171-201 + 0005_templates_ad_flag.sql
--    (0005 의 is_ad / byte_count 컬럼을 CREATE TABLE 시점에 통합)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SMS', 'LMS', 'ALIMTALK')),
  teacher_name TEXT,
  auto_captured BOOLEAN NOT NULL DEFAULT FALSE,
  is_ad BOOLEAN NOT NULL DEFAULT FALSE,
  byte_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 멱등 보강: CREATE TABLE IF NOT EXISTS 가 기존 테이블이 (잔존하더라도 구버전이면)
-- 새 컬럼을 추가하지 않으므로, 0005 추가 컬럼은 ALTER 로 한 번 더 보장.
ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS is_ad BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS byte_count INT NOT NULL DEFAULT 0;

COMMENT ON TABLE public.templates IS '문자 & 알림톡 템플릿';
COMMENT ON COLUMN public.templates.id IS '템플릿 ID';
COMMENT ON COLUMN public.templates.name IS '템플릿명';
COMMENT ON COLUMN public.templates.subject IS '제목 (LMS/알림톡 전용)';
COMMENT ON COLUMN public.templates.body IS '본문';
COMMENT ON COLUMN public.templates.type IS '유형 (SMS:단문 90b / LMS:장문 2000b / ALIMTALK:알림톡)';
COMMENT ON COLUMN public.templates.teacher_name IS '강사명 (강사별 분류용)';
COMMENT ON COLUMN public.templates.auto_captured IS '발송 시 자동 수집 여부';
COMMENT ON COLUMN public.templates.is_ad IS
  '광고성 여부. TRUE 면 발송 시 [광고] prefix + 080 수신거부 footer + 야간 차단 규칙이 적용됨. 알림 용도는 FALSE.';
COMMENT ON COLUMN public.templates.byte_count IS
  '본문 바이트(EUC-KR, 한글 2 / ASCII 1). 생성·수정 시 애플리케이션에서 계산해 저장.';
COMMENT ON COLUMN public.templates.created_by IS '생성자';
COMMENT ON COLUMN public.templates.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.templates.updated_at IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_templates_type ON public.templates (type);
CREATE INDEX IF NOT EXISTS idx_templates_teacher ON public.templates (teacher_name);
CREATE INDEX IF NOT EXISTS idx_templates_is_ad ON public.templates (is_ad);

DROP TRIGGER IF EXISTS trg_templates_updated_at ON public.templates;
CREATE TRIGGER trg_templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 3) messages · 발송 건별 이력
--    출처: 0001_initial_schema.sql:253-286 + 0007_messages_test_flag.sql
--    (0007 의 is_test 컬럼을 CREATE TABLE 시점에 통합)
--
--    주의: 0007 은 campaigns.is_test 도 추가하지만 campaigns 테이블은
--          이미 운영 중이므로 본 복구 마이그레이션 범위 밖.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '대기'
    CHECK (status IN ('대기', '발송됨', '도달', '실패')),
  vendor_message_id TEXT,
  cost INT NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_reason TEXT,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 멱등 보강 (위 templates 와 동일한 이유)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON TABLE public.messages IS '발송 건별 이력';
COMMENT ON COLUMN public.messages.id IS '메시지 ID';
COMMENT ON COLUMN public.messages.campaign_id IS '캠페인 ID (FK)';
COMMENT ON COLUMN public.messages.student_id IS '학생 ID (FK, 학생이 삭제되어도 이력은 보존)';
COMMENT ON COLUMN public.messages.phone IS '수신 번호';
COMMENT ON COLUMN public.messages.status IS '상태 (대기/발송됨/도달/실패)';
COMMENT ON COLUMN public.messages.vendor_message_id IS '벤더 발송 ID (문자나라·to-go 등)';
COMMENT ON COLUMN public.messages.cost IS '건별 비용 (원)';
COMMENT ON COLUMN public.messages.sent_at IS '발송 시각';
COMMENT ON COLUMN public.messages.delivered_at IS '도달 시각';
COMMENT ON COLUMN public.messages.failed_reason IS '실패 사유 (벤더 응답 원문)';
COMMENT ON COLUMN public.messages.is_test IS
  '테스트 발송 여부. TRUE 면 캠페인 통계·도달률·비용 합산에서 제외할 것.';
COMMENT ON COLUMN public.messages.created_at IS '레코드 생성 시각';

CREATE INDEX IF NOT EXISTS idx_messages_campaign_id ON public.messages (campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_student_id ON public.messages (student_id);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON public.messages (phone);
CREATE INDEX IF NOT EXISTS idx_messages_status ON public.messages (status);
CREATE INDEX IF NOT EXISTS idx_messages_campaign_status ON public.messages (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON public.messages (sent_at DESC);


-- ============================================================
-- 4) RLS 활성화 + 정책
--    출처: 0003_rls_policies.sql 의 groups/templates/messages 블록
--    (정책 이름 충돌 방지를 위해 DROP POLICY IF EXISTS 선행)
-- ============================================================

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- groups 정책
-- 읽기: 분원 소속 or master
-- 생성/수정: 해당 분원의 admin/manager (manager도 그룹은 만들 수 있어야 발송 준비 가능)
-- 삭제: 해당 분원의 admin 이상
-- ------------------------------------------------------------
DROP POLICY IF EXISTS groups_read_by_branch ON public.groups;
CREATE POLICY groups_read_by_branch ON public.groups
  FOR SELECT USING (public.can_read_branch(branch));

DROP POLICY IF EXISTS groups_insert_by_send ON public.groups;
CREATE POLICY groups_insert_by_send ON public.groups
  FOR INSERT WITH CHECK (public.can_send_branch(branch));

DROP POLICY IF EXISTS groups_update_by_send ON public.groups;
CREATE POLICY groups_update_by_send ON public.groups
  FOR UPDATE USING (public.can_send_branch(branch))
  WITH CHECK (public.can_send_branch(branch));

DROP POLICY IF EXISTS groups_delete_by_admin ON public.groups;
CREATE POLICY groups_delete_by_admin ON public.groups
  FOR DELETE USING (public.can_write_branch(branch));


-- ------------------------------------------------------------
-- templates 정책 (분원 경계 없음 · 전사 공용)
-- master/admin/manager 는 읽기+쓰기, viewer 는 읽기만
-- ------------------------------------------------------------
DROP POLICY IF EXISTS templates_read_all ON public.templates;
CREATE POLICY templates_read_all ON public.templates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.user_id = auth.uid() AND up.active = TRUE
    )
  );

DROP POLICY IF EXISTS templates_write_by_send ON public.templates;
CREATE POLICY templates_write_by_send ON public.templates
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.user_id = auth.uid()
        AND up.active = TRUE
        AND up.role IN ('master', 'admin', 'manager')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.user_id = auth.uid()
        AND up.active = TRUE
        AND up.role IN ('master', 'admin', 'manager')
    )
  );


-- ------------------------------------------------------------
-- messages 정책 (캠페인 분원 기준)
-- 읽기: 캠페인 분원 소속 or master
-- 생성: 캠페인 분원의 admin/manager
-- UPDATE/DELETE 는 정책 미정의 → 차단 (Webhook 등은 service_role 우회)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS messages_read ON public.messages;
CREATE POLICY messages_read ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = messages.campaign_id
        AND public.can_read_branch(c.branch)
    )
  );

DROP POLICY IF EXISTS messages_insert_by_send ON public.messages;
CREATE POLICY messages_insert_by_send ON public.messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = messages.campaign_id
        AND public.can_send_branch(c.branch)
    )
  );


COMMIT;
