-- ============================================================
-- 0003_rls_policies.sql
-- RLS 4단계 · master / admin / manager / viewer
-- PRD 섹션 4.3 기준
-- ============================================================

-- ------------------------------------------------------------
-- 헬퍼 함수 · auth.uid()를 users_profile 과 연결
-- SECURITY DEFINER 로 RLS 회귀 무한루프 방지.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role FROM public.users_profile WHERE user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_role() IS '현재 로그인 사용자의 역할 (master/admin/manager/viewer)';

CREATE OR REPLACE FUNCTION public.current_user_branch()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT branch FROM public.users_profile WHERE user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_branch() IS '현재 로그인 사용자의 소속 분원';

CREATE OR REPLACE FUNCTION public.is_master()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role = 'master' FROM public.users_profile WHERE user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.is_master() IS '현재 사용자가 master인지 여부';

CREATE OR REPLACE FUNCTION public.can_write_branch(target_branch TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profile up
    WHERE up.user_id = auth.uid()
      AND up.active = TRUE
      AND (
        up.role = 'master'
        OR (up.role = 'admin' AND up.branch = target_branch)
      )
  );
$$;

COMMENT ON FUNCTION public.can_write_branch(TEXT) IS '대상 분원에 쓰기 권한이 있는지 (master 또는 해당 분원 admin)';

CREATE OR REPLACE FUNCTION public.can_send_branch(target_branch TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profile up
    WHERE up.user_id = auth.uid()
      AND up.active = TRUE
      AND (
        up.role = 'master'
        OR (up.role IN ('admin', 'manager') AND up.branch = target_branch)
      )
  );
$$;

COMMENT ON FUNCTION public.can_send_branch(TEXT) IS '대상 분원에 문자 발송 권한이 있는지 (master 또는 해당 분원 admin/manager)';

CREATE OR REPLACE FUNCTION public.can_read_branch(target_branch TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profile up
    WHERE up.user_id = auth.uid()
      AND up.active = TRUE
      AND (up.role = 'master' OR up.branch = target_branch)
  );
$$;

COMMENT ON FUNCTION public.can_read_branch(TEXT) IS '대상 분원에 읽기 권한이 있는지 (master 또는 해당 분원 소속)';


-- ------------------------------------------------------------
-- RLS 활성화
-- ------------------------------------------------------------
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- students 정책
-- 읽기: 분원 소속 or master
-- 쓰기: admin (자기 분원) or master
-- ------------------------------------------------------------
CREATE POLICY students_read_by_branch ON public.students
  FOR SELECT USING (public.can_read_branch(branch));

CREATE POLICY students_insert_by_admin ON public.students
  FOR INSERT WITH CHECK (public.can_write_branch(branch));

CREATE POLICY students_update_by_admin ON public.students
  FOR UPDATE USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

CREATE POLICY students_delete_by_admin ON public.students
  FOR DELETE USING (public.can_write_branch(branch));


-- ------------------------------------------------------------
-- enrollments 정책 (학생의 분원 기준)
-- ------------------------------------------------------------
CREATE POLICY enrollments_read ON public.enrollments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = enrollments.student_id
        AND public.can_read_branch(s.branch)
    )
  );

CREATE POLICY enrollments_write_by_admin ON public.enrollments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = enrollments.student_id
        AND public.can_write_branch(s.branch)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = enrollments.student_id
        AND public.can_write_branch(s.branch)
    )
  );


-- ------------------------------------------------------------
-- attendances 정책 (학생의 분원 기준)
-- ------------------------------------------------------------
CREATE POLICY attendances_read ON public.attendances
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = attendances.student_id
        AND public.can_read_branch(s.branch)
    )
  );

CREATE POLICY attendances_write_by_admin ON public.attendances
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = attendances.student_id
        AND public.can_write_branch(s.branch)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = attendances.student_id
        AND public.can_write_branch(s.branch)
    )
  );


-- ------------------------------------------------------------
-- groups 정책
-- 읽기: 분원 소속 or master
-- 생성/수정/삭제: 해당 분원의 admin/manager (manager도 그룹은 만들 수 있어야 발송 준비 가능)
-- ------------------------------------------------------------
CREATE POLICY groups_read_by_branch ON public.groups
  FOR SELECT USING (public.can_read_branch(branch));

CREATE POLICY groups_insert_by_send ON public.groups
  FOR INSERT WITH CHECK (public.can_send_branch(branch));

CREATE POLICY groups_update_by_send ON public.groups
  FOR UPDATE USING (public.can_send_branch(branch))
  WITH CHECK (public.can_send_branch(branch));

CREATE POLICY groups_delete_by_admin ON public.groups
  FOR DELETE USING (public.can_write_branch(branch));


-- ------------------------------------------------------------
-- templates 정책 (분원 경계 없음 · 전사 공용)
-- master/admin/manager 는 읽기+쓰기, viewer 는 읽기만
-- ------------------------------------------------------------
CREATE POLICY templates_read_all ON public.templates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.user_id = auth.uid() AND up.active = TRUE
    )
  );

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
-- campaigns 정책
-- 읽기: 분원 소속 or master
-- 발송 (INSERT/UPDATE): admin/manager (자기 분원)
-- 삭제: admin 이상
-- ------------------------------------------------------------
CREATE POLICY campaigns_read_by_branch ON public.campaigns
  FOR SELECT USING (public.can_read_branch(branch));

CREATE POLICY campaigns_insert_by_send ON public.campaigns
  FOR INSERT WITH CHECK (public.can_send_branch(branch));

CREATE POLICY campaigns_update_by_send ON public.campaigns
  FOR UPDATE USING (public.can_send_branch(branch))
  WITH CHECK (public.can_send_branch(branch));

CREATE POLICY campaigns_delete_by_admin ON public.campaigns
  FOR DELETE USING (public.can_write_branch(branch));


-- ------------------------------------------------------------
-- messages 정책 (캠페인 분원 기준)
-- ------------------------------------------------------------
CREATE POLICY messages_read ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = messages.campaign_id
        AND public.can_read_branch(c.branch)
    )
  );

CREATE POLICY messages_insert_by_send ON public.messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = messages.campaign_id
        AND public.can_send_branch(c.branch)
    )
  );

-- messages 는 UPDATE/DELETE 일반적으로 금지 (발송 이력은 불변)
-- Webhook 으로 status 업데이트는 service_role 로 우회 수행


-- ------------------------------------------------------------
-- unsubscribes 정책
-- 읽기: 로그인 사용자 전원
-- 쓰기: 누구나 INSERT 가능 (수신거부는 본인 의사)
-- 삭제: master 만
-- ------------------------------------------------------------
CREATE POLICY unsubscribes_read_all ON public.unsubscribes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.user_id = auth.uid() AND up.active = TRUE
    )
  );

CREATE POLICY unsubscribes_insert_anyone ON public.unsubscribes
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY unsubscribes_delete_master ON public.unsubscribes
  FOR DELETE USING (public.is_master());


-- ------------------------------------------------------------
-- users_profile 정책
-- 읽기: 본인 + master는 전체 + admin은 같은 분원
-- 쓰기: master 만
-- ------------------------------------------------------------
CREATE POLICY users_profile_read_self ON public.users_profile
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_master()
    OR (
      public.current_user_role() = 'admin'
      AND branch = public.current_user_branch()
    )
  );

CREATE POLICY users_profile_write_master ON public.users_profile
  FOR ALL USING (public.is_master())
  WITH CHECK (public.is_master());
