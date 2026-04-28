-- ============================================================
-- 0001_initial_schema.sql
-- 세정학원 CRM · 초기 스키마
-- PRD 섹션 4.1 기준. 모든 컬럼에 한글 COMMENT 필수.
-- ============================================================

-- 공통 · updated_at 자동 갱신 트리거 함수
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.set_updated_at() IS 'updated_at 컬럼 자동 갱신용 공통 트리거 함수';


-- ------------------------------------------------------------
-- students · 학생
-- ------------------------------------------------------------
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca2000_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  parent_phone TEXT,
  school TEXT,
  grade INT CHECK (grade IN (1, 2, 3)),
  track TEXT CHECK (track IN ('문과', '이과')),
  status TEXT NOT NULL DEFAULT '재원생'
    CHECK (status IN ('재원생', '수강이력자', '신규리드', '탈퇴')),
  branch TEXT NOT NULL,
  registered_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.students IS '학생';
COMMENT ON COLUMN public.students.id IS '학생 ID';
COMMENT ON COLUMN public.students.aca2000_id IS '아카2000 ID (마이그레이션 키)';
COMMENT ON COLUMN public.students.name IS '이름';
COMMENT ON COLUMN public.students.phone IS '학생 연락처';
COMMENT ON COLUMN public.students.parent_phone IS '학부모 연락처 (발송 주 대상)';
COMMENT ON COLUMN public.students.school IS '학교 (예: 휘문고, 단대부고)';
COMMENT ON COLUMN public.students.grade IS '학년 (1:고1, 2:고2, 3:고3)';
COMMENT ON COLUMN public.students.track IS '계열 (문과/이과)';
COMMENT ON COLUMN public.students.status IS '재원 상태 (재원생/수강이력자/신규리드/탈퇴)';
COMMENT ON COLUMN public.students.branch IS '분원 (대치/송도 등)';
COMMENT ON COLUMN public.students.registered_at IS '학원 최초 등록일';
COMMENT ON COLUMN public.students.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.students.updated_at IS '레코드 최종 수정 시각';

CREATE INDEX idx_students_branch ON public.students (branch);
CREATE INDEX idx_students_grade ON public.students (grade);
CREATE INDEX idx_students_status ON public.students (status);
CREATE INDEX idx_students_school ON public.students (school);
CREATE INDEX idx_students_parent_phone ON public.students (parent_phone);
CREATE INDEX idx_students_name ON public.students (name);

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ------------------------------------------------------------
-- enrollments · 수강 이력
-- ------------------------------------------------------------
CREATE TABLE public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_name TEXT NOT NULL,
  teacher_name TEXT,
  subject TEXT CHECK (subject IN ('수학', '국어', '영어', '탐구')),
  amount INT NOT NULL DEFAULT 0,
  paid_at DATE,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.enrollments IS '수강 이력';
COMMENT ON COLUMN public.enrollments.id IS '수강 ID';
COMMENT ON COLUMN public.enrollments.student_id IS '학생 ID (FK)';
COMMENT ON COLUMN public.enrollments.course_name IS '강좌명 (예: 고2 수학 내신반)';
COMMENT ON COLUMN public.enrollments.teacher_name IS '강사명';
COMMENT ON COLUMN public.enrollments.subject IS '과목 (수학/국어/영어/탐구)';
COMMENT ON COLUMN public.enrollments.amount IS '결제 금액 (원 단위)';
COMMENT ON COLUMN public.enrollments.paid_at IS '결제일';
COMMENT ON COLUMN public.enrollments.start_date IS '개강일';
COMMENT ON COLUMN public.enrollments.end_date IS '종강일';
COMMENT ON COLUMN public.enrollments.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.enrollments.updated_at IS '레코드 최종 수정 시각';

CREATE INDEX idx_enrollments_student_id ON public.enrollments (student_id);
CREATE INDEX idx_enrollments_teacher ON public.enrollments (teacher_name);
CREATE INDEX idx_enrollments_subject ON public.enrollments (subject);
CREATE INDEX idx_enrollments_paid_at ON public.enrollments (paid_at);

CREATE TRIGGER trg_enrollments_updated_at
  BEFORE UPDATE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ------------------------------------------------------------
-- attendances · 출석 이력
-- ------------------------------------------------------------
CREATE TABLE public.attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES public.enrollments(id) ON DELETE SET NULL,
  attended_at DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('출석', '지각', '결석', '조퇴')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.attendances IS '출석 이력';
COMMENT ON COLUMN public.attendances.id IS '출석 ID';
COMMENT ON COLUMN public.attendances.student_id IS '학생 ID (FK)';
COMMENT ON COLUMN public.attendances.enrollment_id IS '수강 ID (FK)';
COMMENT ON COLUMN public.attendances.attended_at IS '출석일';
COMMENT ON COLUMN public.attendances.status IS '출석 상태 (출석/지각/결석/조퇴)';
COMMENT ON COLUMN public.attendances.created_at IS '레코드 생성 시각';

CREATE INDEX idx_attendances_student_id ON public.attendances (student_id);
CREATE INDEX idx_attendances_attended_at ON public.attendances (attended_at);
CREATE INDEX idx_attendances_enrollment_id ON public.attendances (enrollment_id);


-- ------------------------------------------------------------
-- groups · 발송 그룹 (세그먼트)
-- ------------------------------------------------------------
CREATE TABLE public.groups (
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

CREATE INDEX idx_groups_branch ON public.groups (branch);
CREATE INDEX idx_groups_created_by ON public.groups (created_by);
CREATE INDEX idx_groups_last_sent_at ON public.groups (last_sent_at DESC);

CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ------------------------------------------------------------
-- templates · 문자 템플릿
-- ------------------------------------------------------------
CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SMS', 'LMS', 'ALIMTALK')),
  teacher_name TEXT,
  auto_captured BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.templates IS '문자 & 알림톡 템플릿';
COMMENT ON COLUMN public.templates.id IS '템플릿 ID';
COMMENT ON COLUMN public.templates.name IS '템플릿명';
COMMENT ON COLUMN public.templates.subject IS '제목 (LMS/알림톡 전용)';
COMMENT ON COLUMN public.templates.body IS '본문';
COMMENT ON COLUMN public.templates.type IS '유형 (SMS:단문 90b / LMS:장문 2000b / ALIMTALK:알림톡)';
COMMENT ON COLUMN public.templates.teacher_name IS '강사명 (강사별 분류용)';
COMMENT ON COLUMN public.templates.auto_captured IS '발송 시 자동 수집 여부';
COMMENT ON COLUMN public.templates.created_by IS '생성자';
COMMENT ON COLUMN public.templates.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.templates.updated_at IS '레코드 최종 수정 시각';

CREATE INDEX idx_templates_type ON public.templates (type);
CREATE INDEX idx_templates_teacher ON public.templates (teacher_name);

CREATE TRIGGER trg_templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ------------------------------------------------------------
-- campaigns · 발송 캠페인
-- ------------------------------------------------------------
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  template_id UUID REFERENCES public.templates(id) ON DELETE SET NULL,
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT '임시저장'
    CHECK (status IN ('임시저장', '예약됨', '발송중', '완료', '실패', '취소')),
  total_recipients INT NOT NULL DEFAULT 0,
  total_cost INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  branch TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.campaigns IS '발송 캠페인';
COMMENT ON COLUMN public.campaigns.id IS '캠페인 ID';
COMMENT ON COLUMN public.campaigns.title IS '캠페인 제목';
COMMENT ON COLUMN public.campaigns.template_id IS '템플릿 ID (FK)';
COMMENT ON COLUMN public.campaigns.group_id IS '발송 그룹 ID (FK)';
COMMENT ON COLUMN public.campaigns.scheduled_at IS '예약 시각';
COMMENT ON COLUMN public.campaigns.sent_at IS '발송 완료 시각';
COMMENT ON COLUMN public.campaigns.status IS '상태 (임시저장/예약됨/발송중/완료/실패/취소)';
COMMENT ON COLUMN public.campaigns.total_recipients IS '총 수신자 수';
COMMENT ON COLUMN public.campaigns.total_cost IS '총 비용 (원)';
COMMENT ON COLUMN public.campaigns.created_by IS '생성자';
COMMENT ON COLUMN public.campaigns.branch IS '분원 (RLS 격리 기준)';
COMMENT ON COLUMN public.campaigns.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.campaigns.updated_at IS '레코드 최종 수정 시각';

CREATE INDEX idx_campaigns_status ON public.campaigns (status);
CREATE INDEX idx_campaigns_branch ON public.campaigns (branch);
CREATE INDEX idx_campaigns_scheduled_at ON public.campaigns (scheduled_at);
CREATE INDEX idx_campaigns_sent_at ON public.campaigns (sent_at DESC);
CREATE INDEX idx_campaigns_group_id ON public.campaigns (group_id);

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ------------------------------------------------------------
-- messages · 발송 건별 이력
-- ------------------------------------------------------------
CREATE TABLE public.messages (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
COMMENT ON COLUMN public.messages.created_at IS '레코드 생성 시각';

CREATE INDEX idx_messages_campaign_id ON public.messages (campaign_id);
CREATE INDEX idx_messages_student_id ON public.messages (student_id);
CREATE INDEX idx_messages_phone ON public.messages (phone);
CREATE INDEX idx_messages_status ON public.messages (status);
CREATE INDEX idx_messages_campaign_status ON public.messages (campaign_id, status);
CREATE INDEX idx_messages_sent_at ON public.messages (sent_at DESC);


-- ------------------------------------------------------------
-- unsubscribes · 수신 거부
-- ------------------------------------------------------------
CREATE TABLE public.unsubscribes (
  phone TEXT PRIMARY KEY,
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT
);

COMMENT ON TABLE public.unsubscribes IS '수신 거부 번호 목록 (발송 시 반드시 제외)';
COMMENT ON COLUMN public.unsubscribes.phone IS '전화번호 (PK)';
COMMENT ON COLUMN public.unsubscribes.unsubscribed_at IS '거부 등록 시각';
COMMENT ON COLUMN public.unsubscribes.reason IS '거부 사유';


-- ------------------------------------------------------------
-- users_profile · 계정과 권한
-- ------------------------------------------------------------
CREATE TABLE public.users_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('master', 'admin', 'manager', 'viewer')),
  branch TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_profile IS '계정과 권한 (auth.users 확장)';
COMMENT ON COLUMN public.users_profile.user_id IS '사용자 ID (auth.users FK, PK)';
COMMENT ON COLUMN public.users_profile.name IS '이름';
COMMENT ON COLUMN public.users_profile.role IS '권한 (master:마스터 / admin:관리자 / manager:실장 / viewer:사용자)';
COMMENT ON COLUMN public.users_profile.branch IS '소속 분원';
COMMENT ON COLUMN public.users_profile.active IS '활성 여부 (false면 로그인 차단)';
COMMENT ON COLUMN public.users_profile.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.users_profile.updated_at IS '레코드 최종 수정 시각';

CREATE INDEX idx_users_profile_branch ON public.users_profile (branch);
CREATE INDEX idx_users_profile_role ON public.users_profile (role);

CREATE TRIGGER trg_users_profile_updated_at
  BEFORE UPDATE ON public.users_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
