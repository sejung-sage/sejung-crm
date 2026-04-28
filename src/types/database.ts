/**
 * 세정학원 CRM · DB 타입 정의
 *
 * supabase/migrations/*.sql 과 1:1 대응. 실제 DB가 붙으면
 * `npx supabase gen types typescript --local > src/types/database.ts`
 * 로 자동 생성 가능. 현재는 수동 유지.
 *
 * 규약:
 *  - 컬럼명은 snake_case (DB 원형 유지)
 *  - enum 은 유니온 리터럴 타입
 *  - nullable 컬럼은 `| null` 명시
 */

// ─── Enum 리터럴 ────────────────────────────────────────────

export type Branch = "대치" | "송도" | string;
/**
 * 학년 (정규화 9종 enum).
 * 0012 마이그레이션에서 자유형식 TEXT → enum 으로 전환.
 * 단일 출처는 `@/lib/schemas/common.GradeSchema`.
 */
export type Grade =
  | "중1"
  | "중2"
  | "중3"
  | "고1"
  | "고2"
  | "고3"
  | "재수"
  | "졸업"
  | "미정";
/**
 * 학교급. school + grade_raw 조합으로 derive_school_level() 도출.
 */
export type SchoolLevel = "중" | "고" | "기타";
export type Track = "문과" | "이과";
export type StudentStatus =
  | "재원생"
  | "수강이력자"
  | "신규리드"
  | "탈퇴";
export type Subject = "수학" | "국어" | "영어" | "탐구";
export type AttendanceStatus = "출석" | "지각" | "결석" | "조퇴";
export type TemplateType = "SMS" | "LMS" | "ALIMTALK";
export type CampaignStatus =
  | "임시저장"
  | "예약됨"
  | "발송중"
  | "완료"
  | "실패"
  | "취소";
export type MessageStatus = "대기" | "발송됨" | "도달" | "실패";
export type UserRole = "master" | "admin" | "manager" | "viewer";

// ─── 테이블 Row 타입 ────────────────────────────────────────

export interface StudentRow {
  id: string;
  aca2000_id: string;
  name: string;
  phone: string | null;
  parent_phone: string | null;
  school: string | null;
  /** 정규화된 학년 (중1~고3/재수/졸업/미정 9종). 0012 에서 enum 화. */
  grade: Grade | null;
  /** 아카(Aca2000) V_student_list.학년 원본 값 ("1"~"10"/"고3"/"졸"/NULL). 0012 추가. */
  grade_raw: string | null;
  /** 학교급 (중/고/기타). 0012 추가. school+grade_raw 로 derive_school_level() 도출. */
  school_level: SchoolLevel | null;
  track: Track | null;
  status: StudentStatus;
  branch: string;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
}

export type StudentInsert = Omit<
  StudentRow,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
};

export type StudentUpdate = Partial<Omit<StudentRow, "id" | "aca2000_id">>;

export interface EnrollmentRow {
  id: string;
  student_id: string;
  course_name: string;
  teacher_name: string | null;
  subject: Subject | null;
  amount: number;
  paid_at: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRow {
  id: string;
  student_id: string;
  enrollment_id: string | null;
  attended_at: string;
  status: AttendanceStatus;
  created_at: string;
}

/**
 * groups.filters (JSONB) 의 정규 구조는 Zod 스키마에서 단일 출처로 관리.
 * 타입만 import 하여 순환 참조를 피함. (런타임 값 import 금지)
 *
 * 구조 변경 시 @/lib/schemas/group.GroupFiltersSchema 를 수정하면
 * 여기까지 자동 전파됨.
 */
export type { GroupFilters } from "@/lib/schemas/group";
import type { GroupFilters } from "@/lib/schemas/group";

export interface GroupRow {
  id: string;
  name: string;
  branch: string;
  filters: GroupFilters;
  recipient_count: number;
  last_sent_at: string | null;
  last_message_preview: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 그룹 리스트 화면용 행 타입.
 * MVP 는 별도 필드 없이 GroupRow 와 동일. 조인 필드 추가 시 확장.
 */
export type GroupListItem = GroupRow;

export interface TemplateRow {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  type: TemplateType;
  teacher_name: string | null;
  auto_captured: boolean;
  /** 광고성 여부. TRUE 면 [광고] prefix / 080 footer / 야간 차단 적용. */
  is_ad: boolean;
  /** 본문 EUC-KR 바이트(한글 2, ASCII 1). 생성·수정 시 앱에서 계산. */
  byte_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRow {
  id: string;
  title: string;
  template_id: string | null;
  group_id: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  status: CampaignStatus;
  total_recipients: number;
  total_cost: number;
  created_by: string | null;
  branch: string;
  /** 테스트 발송 캠페인 여부. 0007 마이그레이션에서 추가. */
  is_test: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  campaign_id: string;
  student_id: string | null;
  phone: string;
  status: MessageStatus;
  vendor_message_id: string | null;
  cost: number;
  sent_at: string | null;
  delivered_at: string | null;
  failed_reason: string | null;
  /** 테스트 발송 1건 여부. TRUE 면 캠페인 통계·도달률·비용 합산에서 제외. 0007 추가. */
  is_test: boolean;
  created_at: string;
}

/**
 * 캠페인 리스트 화면(F3-02)용 조인 행.
 * 리스트에서 바로 템플릿명/그룹명/도달·실패 건수를 보여주기 위해
 * 애플리케이션 레이어에서 channels 조인 + 집계하여 구성.
 */
export type CampaignListItem = CampaignRow & {
  template_name: string | null;
  group_name: string | null;
  delivered_count: number;
  failed_count: number;
};

/**
 * 캠페인 상세 메시지 행.
 * messages 테이블 Row + student 이름 조인.
 * 상태 enum 은 MessageStatus 재사용.
 */
export interface CampaignMessageRow {
  id: string;
  campaign_id: string;
  student_id: string | null;
  phone: string;
  status: MessageStatus;
  vendor_message_id: string | null;
  cost: number;
  sent_at: string | null;
  delivered_at: string | null;
  failed_reason: string | null;
  /** 테스트 발송 1건 여부. TRUE 면 통계 집계에서 제외. 0007 추가. */
  is_test: boolean;
  created_at: string;
  /** 조인: students.name. 학생 연결이 끊긴 발송이면 null. */
  student_name?: string | null;
}

export interface UnsubscribeRow {
  phone: string;
  unsubscribed_at: string;
  reason: string | null;
}

export interface UserProfileRow {
  user_id: string;
  name: string;
  /** 0006 에서 추가된 보조 컬럼. auth.users.email 의 복사본. 마이그레이션 전 레코드는 null 가능. */
  email: string | null;
  role: UserRole;
  branch: string;
  active: boolean;
  /** 첫 로그인 시 비밀번호 변경 강제 플래그. 초대 직후 TRUE. */
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 계정 관리 목록 UI 행 타입.
 * 현재는 UserProfileRow 와 동일. 이후 last_sign_in_at 등 조인 메타 필요하면 확장.
 */
export type AccountListItem = UserProfileRow;

/**
 * 세션 현재 사용자. middleware·Server Component 가 공통으로 사용.
 *
 * dev-seed 모드의 가상 master 사용자도 이 타입을 그대로 만족시킨다.
 * email 은 반드시 값이 있어야 한다(로그인한 사용자이므로 auth.users.email 보장).
 */
export type CurrentUser = {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  branch: string;
  active: boolean;
  must_change_password: boolean;
};

// ─── 뷰 타입 ────────────────────────────────────────────────

export interface StudentProfileRow {
  id: string;
  name: string;
  school: string | null;
  /** 정규화된 학년 (중1~고3/재수/졸업/미정 9종). 0012 에서 enum 화. */
  grade: Grade | null;
  /** 아카 원본 학년 값 (디버그·ETL 재처리용). 0012 추가. */
  grade_raw: string | null;
  /** 학교급 (중/고/기타). 0012 추가. */
  school_level: SchoolLevel | null;
  track: Track | null;
  status: StudentStatus;
  branch: string;
  parent_phone: string | null;
  phone: string | null;
  registered_at: string | null;
  enrollment_count: number;
  total_paid: number;
  subjects: Subject[] | null;
  teachers: string[] | null;
  attendance_rate: number | null;
  last_attended_at: string | null;
  last_paid_at: string | null;
}

// ─── 학생 상세(F1-02) 조인 타입 ─────────────────────────────

/**
 * 학생 상세 페이지 발송 이력 조인 행.
 * messages × campaigns 조인 결과를 가볍게 표현.
 */
export interface StudentMessageRow {
  id: string;
  phone: string;
  status: MessageStatus;
  sent_at: string | null;
  campaign_title: string;
  campaign_id: string;
}

/**
 * 학생 상세 페이지 data loader 반환 통합 타입.
 * /students/[id] 의 프로필·수강이력·출석·발송이력 4개 영역 원본.
 */
export type StudentDetail = {
  profile: StudentProfileRow;
  enrollments: EnrollmentRow[];
  attendances: AttendanceRow[];
  messages: StudentMessageRow[];
};

// ─── Supabase Database 스키마 (client typing용) ─────────────

export interface Database {
  public: {
    Tables: {
      students: { Row: StudentRow; Insert: StudentInsert; Update: StudentUpdate };
      enrollments: {
        Row: EnrollmentRow;
        Insert: Omit<EnrollmentRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<EnrollmentRow, "id">>;
      };
      attendances: {
        Row: AttendanceRow;
        Insert: Omit<AttendanceRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<AttendanceRow, "id">>;
      };
      groups: {
        Row: GroupRow;
        Insert: Omit<GroupRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<GroupRow, "id">>;
      };
      templates: {
        Row: TemplateRow;
        Insert: Omit<TemplateRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<TemplateRow, "id">>;
      };
      campaigns: {
        Row: CampaignRow;
        Insert: Omit<CampaignRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<CampaignRow, "id">>;
      };
      messages: {
        Row: MessageRow;
        Insert: Omit<MessageRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<MessageRow, "id">>;
      };
      unsubscribes: {
        Row: UnsubscribeRow;
        Insert: UnsubscribeRow;
        Update: Partial<UnsubscribeRow>;
      };
      users_profile: {
        Row: UserProfileRow;
        Insert: Omit<UserProfileRow, "created_at" | "updated_at">;
        Update: Partial<UserProfileRow>;
      };
    };
    Views: {
      student_profiles: {
        Row: StudentProfileRow;
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
