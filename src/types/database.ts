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
 * 학년 (정규화 enum, 10종 — 초등/중1~중3/고1~고3/재수/졸업/미정).
 * 0012 자유 TEXT → enum, 0041 초1~초6 추가, 0043 초등 단일값으로 통합.
 * 단일 출처는 `@/lib/schemas/common.GradeSchema`.
 */
export type Grade =
  | "초등"
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
 * 0041 에서 '초' 추가 (총 4종).
 */
export type SchoolLevel = "초" | "중" | "고" | "기타";
// Track 타입 제거 — 0044 마이그에서 students.track 컬럼 DROP.
// 문과/이과 분류 폐기 (2026-05-18).
export type StudentStatus = "재원생" | "수강이력자" | "수강 x" | "탈퇴";
export type Subject =
  | "국어"
  | "영어"
  | "수학"
  | "과탐"
  | "사탐"
  | "컨설팅"
  | "기타";
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
/**
 * 템플릿 발송 유형.
 * 0059 마이그에서 ALIMTALK 제거 — 광고/안내 발송 채널로 부적합 (Phase 1 으로 보류).
 * 신규/수정 시 SMS 또는 LMS 만 허용. 과거 ALIMTALK row 는 LMS 로 자동 변환됨.
 */
export type TemplateType = "SMS" | "LMS";
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
  /** 학교급 (초/중/고/기타). 0012 추가. school+grade_raw 로 derive_school_level() 도출. */
  school_level: SchoolLevel | null;
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
  /** 정규화된 과목 (국어/영어/수학/과탐/사탐/컨설팅/기타). 매칭 실패 시 null. */
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
 *
 * GroupRow + 조인 필드. `created_by` 는 auth.users(id) FK 라 PostgREST nested
 * select 가 불가하므로, 앱 레이어에서 crm_users_profile.name 을 별도 lookup
 * 하여 `creator_name` 에 채운다. 매핑 실패(다른 분원 RLS·삭제된 사용자) 시 null.
 */
export type GroupListItem = GroupRow & {
  /** 작성자 이름 (crm_users_profile.name). 매핑 실패 시 null. UI 는 "—" 표시. */
  creator_name: string | null;
};

export interface TemplateRow {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  type: TemplateType;
  auto_captured: boolean;
  /** 광고성 여부. TRUE 면 [광고] prefix / 080 footer / 야간 차단 적용. */
  is_ad: boolean;
  /** 본문 EUC-KR 바이트(한글 2, ASCII 1). 생성·수정 시 앱에서 계산. */
  byte_count: number;
  /** 분원 (대치/송도/반포/방배). 0055 추가. master 만 다른 분원 조회/편집. */
  branch: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 템플릿 리스트·상세 화면용 행 타입.
 *
 * TemplateRow + 조인 필드. `created_by` 는 auth.users(id) FK 라 PostgREST nested
 * select 가 불가하므로, 앱 레이어에서 crm_users_profile.name 을 별도 lookup
 * 하여 `creator_name` 에 채운다. 매핑 실패 시 null → UI 는 "—" 표시.
 */
export type TemplateListItem = TemplateRow & {
  /** 작성자 이름 (crm_users_profile.name). 매핑 실패 시 null. */
  creator_name: string | null;
};

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
  /**
   * 발송 본문 스냅샷. 예약 발송 시 cron 디스패처가 다시 읽음.
   * 즉시 발송도 보존(retry/감사 추적). 0027 마이그레이션 추가.
   */
  body: string | null;
  /** LMS/알림톡 제목 (SMS 는 NULL). 0027 추가. */
  subject: string | null;
  /**
   * 발송 유형. 0027 추가, 0059 에서 신규 템플릿은 SMS/LMS 만 허용.
   * 다만 과거 캠페인 데이터에 'ALIMTALK' 값이 남아 있을 수 있어
   * CampaignRow 자체는 'ALIMTALK' 까지 union 으로 둔다 (DB CHECK 도 동일 유지).
   */
  type: "SMS" | "LMS" | "ALIMTALK" | null;
  /** 광고성 여부. 예약 cron 시 야간 가드 재적용. 0027 추가. */
  is_ad: boolean;
  /**
   * 동일번호 1회 발송 여부. 0074 추가.
   * TRUE 면 같은 학부모 번호(parent_phone 정규화 기준) N건을 1건으로 합쳐
   * 발송해 문자비를 절감한다(형제 중복 방지). 발송 큐 적재 직전 collapse.
   * 본문에 {이름} 등 개인화 변수가 있으면 dedupe 와 상호배타 — 애플리케이션
   * 레이어에서 비활성화한다. 기본 FALSE(학생 1명당 1건, 종전 동작).
   */
  dedupe_by_phone: boolean;
  /**
   * 발송 대상 — 학부모 대표번호(crm_students.parent_phone) 발송 여부. 0077 추가.
   * TRUE 면 학부모 레그를 생성한다(번호 없으면 스킵). 세정 운영 기본값 TRUE.
   * send_to_student 와 독립이며 둘 다 TRUE 면 한 학생이 학부모·학생 양쪽으로
   * 최대 2건 발송된다. 둘 다 FALSE 는 DB CHECK(chk_campaigns_send_target)와
   * Zod refine 으로 금지.
   */
  send_to_parent: boolean;
  /**
   * 발송 대상 — 학생 개인번호(crm_students.phone) 발송 여부. 0077 추가.
   * TRUE 면 학생 레그를 생성한다(번호 없으면 스킵). 기본값 FALSE.
   * send_to_parent 와 독립. 수신거부 제외는 레그의 번호 기준으로 독립 판정.
   */
  send_to_student: boolean;
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
  /**
   * 발송자 이름 (crm_users_profile.name).
   * `created_by` 는 auth.users(id) FK 라 PostgREST nested select 불가 → 앱
   * 레이어에서 별도 lookup. 매핑 실패(다른 분원 RLS·삭제된 사용자) 시 null →
   * UI 는 "—" 표시.
   */
  creator_name: string | null;
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
  /** 학교급 (초/중/고/기타). 0012 추가, 0041 에서 '초' 추가. */
  school_level: SchoolLevel | null;
  status: StudentStatus;
  branch: string;
  parent_phone: string | null;
  phone: string | null;
  registered_at: string | null;
  enrollment_count: number;
  /**
   * 진행 중 수강 개수. 0060 추가.
   * end_date IS NULL OR end_date >= CURRENT_DATE 이고 subject<>'설명회' 인 enrollment 수.
   * COUNT 집계라 0 가능 — NOT NULL 보장.
   */
  active_enrollment_count: number;
  total_paid: number;
  subjects: Subject[] | null;
  teachers: string[] | null;
  last_attended_at: string | null;
  last_paid_at: string | null;
  /**
   * 지역명 (예: "강남구", "서초구", "송파구", "인천 송도", "기타").
   * school_regions 매핑 LEFT JOIN 결과. 미매칭/학교 NULL 시 '기타'.
   * 뷰에서 COALESCE 되므로 NOT NULL 보장. 0026 추가.
   */
  region: string;
}

/**
 * 학교 → 지역 매핑 (0025 추가).
 *
 * 학생 명단/발송 그룹의 지역 필터(강남구/서초구 등)에 사용.
 * student_profiles 뷰에서 LEFT JOIN 후 COALESCE(region, '기타').
 *
 * RLS:
 *   SELECT — 모든 활성 사용자 (전사 공용)
 *   INSERT/UPDATE/DELETE — master/admin 만
 */
export interface SchoolRegionRow {
  /** 학교명 PK (예: "휘문고"). students.school 과 정확 일치. */
  school: string;
  /** 지역명 (자유 텍스트, 빈/공백만 차단). admin UI 에서 신규 추가 가능. */
  region: string;
  created_at: string;
  updated_at: string;
}

// ─── 학생 상세(F1-02) 조인 타입 ─────────────────────────────

/**
 * 학생 상세 페이지 발송 이력 조인 행.
 * messages × campaigns 조인 결과를 가볍게 표현.
 *
 * 0027~ 캠페인 본문 스냅샷(body/subject/type) 도입 후, 학생 상세에서
 * accordion 으로 본문·유형·작성자를 펼쳐 볼 수 있도록 확장.
 * body/type 은 옛 캠페인엔 NULL 가능. sender_name 은 매핑 실패 시 NULL.
 */
export interface StudentMessageRow {
  id: string;
  phone: string;
  status: MessageStatus;
  sent_at: string | null;
  campaign_title: string;
  campaign_id: string;
  /** 캠페인 본문 스냅샷. 0027 이전 캠페인은 NULL. */
  campaign_body: string | null;
  /** 발송 유형. NULL 가능 (옛 캠페인). */
  campaign_type: "SMS" | "LMS" | "ALIMTALK" | null;
  /**
   * 발송자 이름 (crm_users_profile.name).
   * created_by NULL · 사용자 프로필 미매칭 · 시스템 발송 등 매핑 실패 시 NULL.
   */
  sender_name: string | null;
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
  | "start_date"
  | "end_date"
>;

/**
 * 출석 + 강좌 마스터 lookup 머지 결과.
 * class 가 null 이면 강좌 매칭 실패 또는 자체 등록 (aca_class_id NULL).
 */
export type AttendanceWithClass = AttendanceRow & {
  class: AttendanceClassLookup | null;
};

/**
 * 결제완료 ticket 의 예정 회차 (강좌 × 수업 예정일).
 *
 * aca_tickets.payment_state='결제완료' 행마다 1개 — 매주 같은 요일로 펼쳐진다.
 * 학생 상세 출석 격자에서 "결제 8회 = column 8개" 진척도 표시용.
 *
 * 비-방배 분원에서만 채워진다. 방배는 attendance row 가 정확해 빈 배열.
 */
export interface ExpectedSession {
  aca_class_id: string;
  /** 'YYYY-MM-DD' (aca_tickets.class_date 의 날짜 부분). */
  class_date: string;
}

/**
 * 학생 상세 페이지 data loader 반환 통합 타입.
 * /students/[id] 의 프로필·수강이력·출석·발송이력 4개 영역 원본.
 */
export type StudentDetail = {
  profile: StudentProfileRow;
  enrollments: EnrollmentWithClass[];
  attendances: AttendanceWithClass[];
  messages: StudentMessageRow[];
  /**
   * 결제완료 ticket 의 강좌 × 예정 회차 리스트.
   * 비-방배 분원 + ticket 존재 시에만 비어있지 않음. 빈 배열 default.
   */
  expectedSessions: ExpectedSession[];
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
  /**
   * 학생의 현재 재원 상태 (crm_students.status 원값, 출결 카운트와 무관한 학생 단위 속성).
   *
   * "종강 강좌 → 다음 시즌 미등록(이탈) 추적" 기능(박은주 부원장 2026-05-27)을 위해 추가.
   * 이탈(lapsed) 정의 = status !== '재원생'. 재원생은 어딘가 진행 중 수강이 있는 학생이라
   * 이탈에서 제외. status ∈ {수강이력자, 수강 x, 탈퇴} 가 이탈 후보.
   *  - groups/new?class=<id>&filter=lapsed prefill 이 이 컬럼으로 includeStudentIds 를 거른다.
   *  - 강좌 상세 UI 의 "다음 시즌 미등록 학생" 섹션이 같은 기준으로 카운트·명단을 그린다.
   * 탈퇴 학생은 명단(이탈의 일종)에는 포함되나 발송 시 기존 안전 가드가 자동 제외한다.
   */
  status: StudentStatus;
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

// ─── ETL 동기화 이력 (0079) ─────────────────────────────────

/** ETL 동기화 실행 결과. */
export type EtlSyncStatus = "success" | "failed";

/**
 * etl_sync_runs 1행 — Aca2000 → Supabase ETL 1회 실행 결과.
 * UI 사이드바 "마지막 동기화 시각 + 성공/실패" 표시 소스.
 */
export interface EtlSyncRunRow {
  id: number;
  /** ETL 실행 종료 시각 (ISO, UTC). 표시는 KST. */
  finished_at: string;
  status: EtlSyncStatus;
  /** 실패 시 요약 메시지. 성공 시 null. */
  error_message: string | null;
  created_at: string;
}

// ─── Supabase Database 스키마 (client typing용) ─────────────

export interface Database {
  public: {
    Tables: {
      // ── aca_* : Aca2000 ETL 적재 (0049 prefix). raw layer. ────
      // ETL Python(scripts/etl/) 이 직접 적재. 운영 코드는 거의 안 봄.
      aca_students: { Row: StudentRow; Insert: StudentInsert; Update: StudentUpdate };
      aca_enrollments: {
        Row: EnrollmentRow;
        Insert: Omit<EnrollmentRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<EnrollmentRow, "id">>;
      };
      aca_attendances: {
        Row: AttendanceRow;
        Insert: Omit<AttendanceRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<AttendanceRow, "id">>;
      };
      aca_classes: {
        Row: ClassRow;
        Insert: Omit<ClassRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<ClassRow, "id">>;
      };
      // ── crm_* (학생/강좌/수강/출석) : 정제 layer (0051 dual-layer) ─
      // apply_aca_to_crm() 함수가 aca_* → crm_* 정제 UPSERT. 운영 페이지는
      // 이쪽만 본다. schema 는 aca_* 와 동일 (LIKE INCLUDING ALL).
      crm_students: { Row: StudentRow; Insert: StudentInsert; Update: StudentUpdate };
      crm_enrollments: {
        Row: EnrollmentRow;
        Insert: Omit<EnrollmentRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<EnrollmentRow, "id">>;
      };
      crm_attendances: {
        Row: AttendanceRow;
        Insert: Omit<AttendanceRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<AttendanceRow, "id">>;
      };
      crm_classes: {
        Row: ClassRow;
        Insert: Omit<ClassRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<ClassRow, "id">>;
      };
      // ── crm_* : CRM 자체 데이터 (0049 prefix 분리) ──────────
      crm_groups: {
        Row: GroupRow;
        Insert: Omit<GroupRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<GroupRow, "id">>;
      };
      crm_templates: {
        Row: TemplateRow;
        Insert: Omit<TemplateRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<TemplateRow, "id">>;
      };
      crm_campaigns: {
        Row: CampaignRow;
        Insert: Omit<CampaignRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<CampaignRow, "id">>;
      };
      crm_messages: {
        Row: MessageRow;
        Insert: Omit<MessageRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<MessageRow, "id">>;
      };
      crm_unsubscribes: {
        Row: UnsubscribeRow;
        Insert: UnsubscribeRow;
        Update: Partial<UnsubscribeRow>;
      };
      crm_users_profile: {
        Row: UserProfileRow;
        Insert: Omit<UserProfileRow, "created_at" | "updated_at">;
        Update: Partial<UserProfileRow>;
      };
      crm_school_regions: {
        Row: SchoolRegionRow;
        Insert: Omit<SchoolRegionRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<SchoolRegionRow, "school">>;
      };
      // ── ETL 동기화 이력 (0079) — UI "마지막 동기화" 표시 소스 ──
      etl_sync_runs: {
        Row: EtlSyncRunRow;
        Insert: { status: EtlSyncStatus; finished_at?: string; error_message?: string | null };
        Update: Partial<Omit<EtlSyncRunRow, "id">>;
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

// ===== aca_* 확장 raw 테이블 (0054) =====
//
// 0054_aca_extension_tables.sql 에서 추가된 7개 view 의 raw 적재 테이블.
// ETL Python (scripts/etl/migrate_*.py) 이 직접 적재. 운영 코드는 거의 안 봄.
// 향후 정산·강사·반형태 분석의 anchor.
// 각 테이블 컬럼 집합은 마이그의 CREATE TABLE 정의와 1:1 동일.

/** 아카 수납 이력 raw (V_Pay_List). 32,985~67,666 rows/분원. */
export interface AcaPaymentRow {
  id: string;
  aca_payment_id: string;
  aca_student_id: string | null;
  aca_class_id: string | null;
  aca_unpaid_id: string | null;
  branch: string;
  student_name: string | null;
  class_name: string | null;
  due_date: string | null;
  paid_at: string | null;
  item: string | null;
  amount: number | null;
  payment_method: string | null;
  approval_no: string | null;
  business_no: string | null;
  handler: string | null;
  teacher_name: string | null;
  subject_raw: string | null;
  created_at: string;
  updated_at: string;
}

/** 아카 수강권 raw — 회차 단위 결제 단위 (V_Ticket_student_income_List 슈퍼셋). 19,147~220,128 rows/분원. */
export interface AcaTicketRow {
  id: string;
  aca_ticket_id: string;
  aca_student_id: string | null;
  aca_class_id: string | null;
  aca_enrollment_id: string | null;
  aca_unpaid_id: string | null;
  aca_payment_id: string | null;
  branch: string;
  student_name: string | null;
  student_school: string | null;
  student_grade: string | null;
  class_name: string | null;
  class_type1: string | null;
  class_type2: string | null;
  class_type3: string | null;
  class_total_amount: number | null;
  class_capacity: number | null;
  class_total_sessions: number | null;
  class_amount_per_session: number | null;
  settings_value: string | null;
  close_flag: string | null;
  class_grade: string | null;
  teacher_name: string | null;
  subject_raw: string | null;
  subject_detail: string | null;
  class_detail: string | null;
  schedule_days: string | null;
  schedule_time: string | null;
  etc: string | null;
  classroom: string | null;
  due_date: string | null;
  used_at: string | null;
  class_date: string | null;
  normal_amount: number | null;
  discount_amount: number | null;
  payment_state: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  payment_method: string | null;
  business_no: string | null;
  recorded_at: string | null;
  recorded_on: string | null;
  created_on: string | null;
  teacher_names: string | null;
  teacher_codes: string | null;
  created_at: string;
  updated_at: string;
}

/** 아카 반×수업일 회계 스냅샷 raw (V_class_account_list). 6,298~32,677 rows/분원. */
export interface AcaClassAccountRow {
  id: string;
  aca_class_account_id: string;
  aca_class_id: string | null;
  aca_class_type_id: string | null;
  branch: string;
  class_name: string | null;
  total_amount: number | null;
  capacity: number | null;
  total_sessions: number | null;
  amount_per_session: number | null;
  settings_value: string | null;
  close_flag: string | null;
  class_grade: string | null;
  teacher_name: string | null;
  subject_raw: string | null;
  subject_detail: string | null;
  class_detail: string | null;
  schedule_days: string | null;
  schedule_time: string | null;
  etc: string | null;
  class_type_sort: number | null;
  class_sort: number | null;
  class_date: string | null;
  unsettled: number | null;
  recall_target: number | null;
  completed: number | null;
  created_at: string;
  updated_at: string;
}

/** 아카 미납 항목 raw (V_income_List). 19~616 rows/분원. */
export interface AcaUnpaidRow {
  id: string;
  aca_unpaid_id: string;
  aca_student_id: string | null;
  aca_class_id: string | null;
  branch: string;
  student_name: string | null;
  student_school: string | null;
  student_grade: string | null;
  class_type1: string | null;
  class_type2: string | null;
  class_type3: string | null;
  class_name: string | null;
  due_date: string | null;
  item: string | null;
  amount: number | null;
  handler: string | null;
  settings_value: string | null;
  close_flag: string | null;
  class_grade: string | null;
  teacher_name: string | null;
  subject_raw: string | null;
  subject_detail: string | null;
  class_detail: string | null;
  schedule_days: string | null;
  schedule_time: string | null;
  etc: string | null;
  classroom: string | null;
  created_at: string;
  updated_at: string;
}

/** 아카 강사·직원 마스터 raw (V_People_List). 51~179 rows/분원. */
export interface AcaTeacherRow {
  id: string;
  aca_teacher_id: string;
  branch: string;
  name: string | null;
  login_id: string | null;
  phone: string | null;
  birthday: string | null;
  role_type: string | null;
  position: string | null;
  department: string | null;
  status_label: string | null;
  postal_code: string | null;
  road_address: string | null;
  created_at: string;
  updated_at: string;
}

/** 아카 강사-반 배정 이력 raw (V_People_Subject_List). 189~1,538 rows/분원. */
export interface AcaTeacherSubjectRow {
  id: string;
  aca_teacher_subject_id: string;
  aca_teacher_id: string | null;
  aca_class_id: string | null;
  branch: string;
  subject_raw: string | null;
  teacher_name: string | null;
  class_name: string | null;
  assigned_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 아카 반형태 분류 raw — 반형태1/2/3 트리 (V_classqqtype_list). 2~15 rows/분원. */
export interface AcaClassTypeRow {
  id: string;
  aca_class_type_id: string;
  branch: string;
  registered_at: string | null;
  type1: string | null;
  type2: string | null;
  type3: string | null;
  brand_code: number | null;
  brand_name: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}
