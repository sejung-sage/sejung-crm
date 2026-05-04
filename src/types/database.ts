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
/**
 * 출결 상태. 0018 에서 '보강' 추가 (5종).
 * 보강 = 결석분을 동영상강의로 대체 수강한 케이스.
 * 출석률 계산에서는 '출석' + '지각' + '보강' 모두 출석 인정.
 */
export type AttendanceStatus =
  | "출석"
  | "지각"
  | "결석"
  | "조퇴"
  | "보강";
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
  /**
   * 결제 금액(원). **실제 의미는 "회차당 금액"** — 사용자 확인.
   * 총 결제액은 amount × classes.total_sessions 로 계산.
   */
  amount: number;
  paid_at: string | null;
  start_date: string | null;
  end_date: string | null;
  /**
   * 강좌 마스터 연결 키. "{branch_id}-{V_class_list.반고유_코드}" 형태.
   * classes.aca_class_id 와 같은 값. 0016 추가. FK 없음.
   */
  aca_class_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRow {
  id: string;
  student_id: string;
  enrollment_id: string | null;
  attended_at: string;
  status: AttendanceStatus;
  /**
   * 아카 V_Attend_List.출결_코드 추적 키.
   * "{branch_id}-{출결_코드}" 형태. 0017 추가. NULL 다중 허용.
   */
  aca_attendance_id: string | null;
  /**
   * V_Attend_List.반고유_코드 추적 키. "{branch_id}-{반고유_코드}" 형태.
   * classes.aca_class_id 와 매칭. FK 없음. 0018 추가.
   * 학생 상세 "강좌 × 일자 격자" UI 의 group by 키.
   */
  aca_class_id: string | null;
  created_at: string;
}

/**
 * 강좌 마스터 (Aca2000 V_class_list 이관 · 0015).
 *
 * 학생 상세 페이지에서 enrollments.amount(회차당 금액)와 함께
 * total_sessions / total_amount 을 연계 표시할 때 사용.
 *
 * 자연키: aca_class_id = "{branch_id}-{V_class_list.반고유_코드}".
 * subject 는 정규화 매칭 안 되면 NULL, 원값은 subject_raw 에 보존.
 */
export interface ClassRow {
  id: string;
  /** "{branch_id}-{반고유_코드}" — UNIQUE. 우리 자체 등록행은 null. */
  aca_class_id: string | null;
  /** 분원 (대치/송도/반포/방배). RLS 격리 기준. */
  branch: string;
  /** 반명 (V_class_list.반명). */
  name: string;
  teacher_name: string | null;
  /** 아카 원본 과목명 (정규화 안 된 원값). */
  subject_raw: string | null;
  /** 정규화된 과목 (수학/국어/영어/탐구). 매칭 실패 시 null. */
  subject: Subject | null;
  /** 청구회차 (총 회차). decimal 원본. */
  total_sessions: number | null;
  /** 회차당 금액 (원). enrollments.amount 와 동일 의미. */
  amount_per_session: number | null;
  /** 강좌 정가 (원, 참고치). 보통 amount_per_session × total_sessions. */
  total_amount: number | null;
  capacity: number | null;
  /** 요일 자유형 (예: "화목"). */
  schedule_days: string | null;
  /** 시간 자유형 (예: "18:00-22:00"). */
  schedule_time: string | null;
  /** 강의관+강의실 합친 표기 또는 강의실만. */
  classroom: string | null;
  registered_at: string | null;
  /**
   * 강좌 개강일 (DATE). V_class_list 원본에 없어 enrollments.start_date 의
   * 강좌별 MIN 으로 파생/백필. NULL 가능 (자체 등록 강좌 또는 enrollment 부재).
   * 0019 마이그레이션 추가.
   */
  start_date: string | null;
  /**
   * 강좌 종강일 (DATE). V_class_list 원본에 없어 enrollments.end_date 의
   * 강좌별 MAX 으로 파생/백필. 2050-01-01 이상은 Aca2000 의 "미정" placeholder.
   * NULL 은 enrollments 매칭 실패 (자체 등록 또는 수강 0).
   *
   * 진행/종강 상태 derive (앱 레이어):
   *   end_date IS NULL OR end_date >= 오늘 → 진행 중
   *   end_date < 오늘                       → 종강
   *
   * 0020 마이그레이션 추가.
   */
  end_date: string | null;
  /** V_class_list.미사용반구분 = "Y" 면 false. */
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 강좌 리스트 화면 (/classes) 행 타입.
 * ClassRow 기본 필드 + 수강생 수 집계 (enrollments 와 join 한 결과).
 * 향후 출석률 평균 등 집계가 늘어나면 여기 확장.
 */
export interface ClassListItem extends ClassRow {
  /** 이 강좌의 수강 등록 학생 수 (enrollments 행 카운트, 학생 단위 distinct). */
  enrolled_student_count: number;
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
 * 강좌 마스터에서 학생 상세 표시에 필요한 부분만 선별한 lookup 타입.
 * EnrollmentRow.aca_class_id ↔ classes.aca_class_id 로 매칭.
 */
export type EnrollmentClassLookup = Pick<
  ClassRow,
  | "total_sessions"
  | "amount_per_session"
  | "teacher_name"
  | "subject"
  | "subject_raw"
>;

/**
 * 수강 이력 + 강좌 마스터 lookup 머지 결과.
 * class 가 null 이면 강좌 매칭 실패 또는 자체 등록 행 (aca_class_id NULL).
 */
export type EnrollmentWithClass = EnrollmentRow & {
  class: EnrollmentClassLookup | null;
};

/**
 * 강좌 마스터에서 출석 격자 UI 표시에 필요한 부분만 선별.
 * AttendanceRow.aca_class_id ↔ classes.aca_class_id 매칭.
 */
export type AttendanceClassLookup = Pick<
  ClassRow,
  | "name"
  | "teacher_name"
  | "subject"
  | "subject_raw"
  | "schedule_days"
  | "schedule_time"
>;

/**
 * 출석 + 강좌 마스터 lookup 머지 결과.
 * class 가 null 이면 강좌 매칭 실패 또는 자체 등록 (aca_class_id NULL).
 */
export type AttendanceWithClass = AttendanceRow & {
  class: AttendanceClassLookup | null;
};

/**
 * 학생 상세 페이지 data loader 반환 통합 타입.
 * /students/[id] 의 프로필·수강이력·출석·발송이력 4개 영역 원본.
 */
export type StudentDetail = {
  profile: StudentProfileRow;
  enrollments: EnrollmentWithClass[];
  attendances: AttendanceWithClass[];
  messages: StudentMessageRow[];
};

// ─── 강좌 상세(/classes/[id]) 조인 타입 ─────────────────────

/**
 * 강좌 상세 페이지(/classes/[id]) 의 수강생 행.
 * student_profiles 뷰의 핵심 컬럼만 선별 + 그 학생의 강좌별 출석 카운트.
 */
export interface ClassStudentRow {
  id: string;
  name: string;
  school: string | null;
  grade: Grade | null;
  parent_phone: string | null;
  /** 이 강좌에서의 출석 카운트 (status='출석'). */
  attended_count: number;
  /** 이 강좌에서의 결석 카운트. */
  absent_count: number;
  /** 이 강좌에서의 지각 카운트. */
  late_count: number;
  /** 이 강좌에서의 조퇴 카운트. */
  early_leave_count: number;
  /** 이 강좌에서의 보강(동영상) 카운트. */
  makeup_count: number;
  /** 이 강좌에서의 출결 총 회수 (5종 합). */
  total_count: number;
}

/**
 * 강좌 상세 페이지 data loader 반환.
 * 강좌 메타 + 수강생 명단 + 학생×일자 출석 매트릭스 원본.
 */
export interface ClassDetail {
  /** 강좌 마스터 자체. */
  class: ClassRow;
  /** 이 강좌 enrollments 가 있는 학생들 (수강생 명단). */
  students: ClassStudentRow[];
  /**
   * 이 강좌의 모든 출결 기록.
   * UI 에서 attended_at + student_id 로 group 해 학생×일자 격자 빌드.
   */
  attendances: Pick<
    AttendanceRow,
    "id" | "student_id" | "attended_at" | "status" | "aca_class_id"
  >[];
}

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
      classes: {
        Row: ClassRow;
        Insert: Omit<ClassRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<ClassRow, "id">>;
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
