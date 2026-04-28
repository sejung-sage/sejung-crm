/**
 * 개발용 인메모리 학생 시드.
 * 실제 Supabase 미연결 시 UI 가 빈 화면으로 보이지 않도록 fallback 제공.
 *
 * ⚠️  프로덕션/스테이징 빌드에선 절대 사용 금지. env 기반으로만 활성화.
 */

import type {
  AccountListItem,
  AttendanceRow,
  CampaignListItem,
  CampaignMessageRow,
  CampaignRow,
  CurrentUser,
  EnrollmentRow,
  GroupRow,
  StudentMessageRow,
  StudentProfileRow,
  TemplateRow,
} from "@/types/database";

export const DEV_STUDENT_PROFILES: StudentProfileRow[] = [
  {
    id: "dev-DC0001",
    name: "김민준",
    school: "휘문고",
    grade: "고2",
    grade_raw: "2",
    school_level: "고",
    track: "이과",
    status: "재원생",
    branch: "대치",
    parent_phone: "01090010001",
    phone: "01011110001",
    registered_at: "2025-03-02",
    enrollment_count: 1,
    total_paid: 550000,
    subjects: ["수학"],
    teachers: ["백봉영T"],
    attendance_rate: 96.5,
    last_attended_at: "2026-04-21",
    last_paid_at: "2026-03-02",
  },
  {
    id: "dev-DC0002",
    name: "이서연",
    school: "단대부고",
    grade: "고2",
    grade_raw: "2",
    school_level: "고",
    track: "문과",
    status: "재원생",
    branch: "대치",
    parent_phone: "01090010002",
    phone: "01011110002",
    registered_at: "2025-03-02",
    enrollment_count: 1,
    total_paid: 480000,
    subjects: ["국어"],
    teachers: ["김정우T"],
    attendance_rate: 92.0,
    last_attended_at: "2026-04-21",
    last_paid_at: "2026-03-02",
  },
  {
    id: "dev-DC0003",
    name: "박지후",
    school: "휘문고",
    grade: "고3",
    grade_raw: "3",
    school_level: "고",
    track: "이과",
    status: "재원생",
    branch: "대치",
    parent_phone: "01090010003",
    phone: "01011110003",
    registered_at: "2024-03-04",
    enrollment_count: 1,
    total_paid: 650000,
    subjects: ["수학"],
    teachers: ["백봉영T"],
    attendance_rate: 100.0,
    last_attended_at: "2026-04-22",
    last_paid_at: "2026-02-28",
  },
  {
    id: "dev-DC0004",
    name: "최유진",
    school: "중동고",
    grade: "고1",
    grade_raw: "1",
    school_level: "고",
    track: null,
    status: "신규리드",
    branch: "대치",
    parent_phone: "01090010004",
    phone: "01011110004",
    registered_at: "2026-02-10",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
  {
    id: "dev-DC0005",
    name: "정하늘",
    school: "단대부고",
    grade: "고3",
    grade_raw: "3",
    school_level: "고",
    track: "문과",
    status: "수강이력자",
    branch: "대치",
    parent_phone: "01090010005",
    phone: "01011110005",
    registered_at: "2023-03-06",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: "2024-11-30",
    last_paid_at: "2024-09-01",
  },
  {
    id: "dev-SD0001",
    name: "강도윤",
    school: "송도고",
    grade: "고2",
    grade_raw: "2",
    school_level: "고",
    track: "이과",
    status: "재원생",
    branch: "송도",
    parent_phone: "01090020001",
    phone: "01022220001",
    registered_at: "2025-03-03",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
  {
    id: "dev-SD0002",
    name: "윤지우",
    school: "인천포스코고",
    grade: "고1",
    grade_raw: "1",
    school_level: "고",
    track: null,
    status: "재원생",
    branch: "송도",
    parent_phone: "01090020002",
    phone: "01022220002",
    registered_at: "2026-03-03",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
  {
    id: "dev-SD0003",
    name: "임하윤",
    school: "송도고",
    grade: "고3",
    grade_raw: "3",
    school_level: "고",
    track: "문과",
    status: "재원생",
    branch: "송도",
    parent_phone: "01090020003",
    phone: "01022220003",
    registered_at: "2024-03-05",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
  {
    id: "dev-SD0004",
    name: "한예린",
    school: "송도국제고",
    grade: "고2",
    grade_raw: "2",
    school_level: "고",
    track: "이과",
    status: "탈퇴",
    branch: "송도",
    parent_phone: "01090020004",
    phone: "01022220004",
    registered_at: "2024-09-01",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
  {
    id: "dev-SD0005",
    name: "조서윤",
    school: "송도고",
    grade: "고1",
    grade_raw: "1",
    school_level: "고",
    track: null,
    status: "신규리드",
    branch: "송도",
    parent_phone: "01090020005",
    phone: "01022220005",
    registered_at: "2026-04-01",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
  // ─── 0012 마이그레이션 정규화 enum 검증용 시드 ─────────────
  // includeHidden 토글, schoolLevel 필터, '미정'/'졸업'/'중X' 칩 동작 확인.
  {
    // 중2 (school_level=중) — 학교명이 '중' 으로 끝나는 케이스
    id: "dev-DC0006",
    name: "한지민",
    school: "대왕중",
    grade: "중2",
    grade_raw: "2",
    school_level: "중",
    track: null,
    status: "재원생",
    branch: "대치",
    parent_phone: "01090010006",
    phone: "01011110006",
    registered_at: "2026-03-04",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
  {
    // 졸업 (장기 재수 통합) — 기본 숨김 대상
    id: "dev-DC0007",
    name: "송재호",
    school: "휘문고",
    grade: "졸업",
    grade_raw: "졸",
    school_level: "고",
    track: "이과",
    status: "수강이력자",
    branch: "대치",
    parent_phone: "01090010007",
    phone: "01011110007",
    registered_at: "2022-03-02",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
  {
    // 미정 (NULL/알 수 없는 grade_raw) — 기본 숨김 대상
    id: "dev-DC0008",
    name: "임가람",
    school: null,
    grade: "미정",
    grade_raw: null,
    school_level: "기타",
    track: null,
    status: "신규리드",
    branch: "대치",
    parent_phone: "01090010008",
    phone: null,
    registered_at: "2026-04-20",
    enrollment_count: 0,
    total_paid: 0,
    subjects: null,
    teachers: null,
    attendance_rate: null,
    last_attended_at: null,
    last_paid_at: null,
  },
];

export function isDevSeedMode(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes("your-project") ||
    process.env.SEJUNG_DEV_SEED === "1"
  );
}

// ─── F1-02 학생 상세용 시드 ─────────────────────────────────
//
// 빈 케이스(수강/출석/발송 모두 없음): DC0004(신규리드), SD0004(탈퇴),
// SD0005(신규리드) 3명.
// DC0005(수강이력자)는 과거 수강만, 최근 출석 없음.
// DC0001·DC0002 만 발송 이력 보유, 나머지는 빈 케이스.

export const DEV_ENROLLMENTS: EnrollmentRow[] = [
  // 김민준 (고2 이과, 수학) · 1건
  {
    id: "dev-ENR-0001",
    student_id: "dev-DC0001",
    course_name: "고2 수학 내신반",
    teacher_name: "백봉영T",
    subject: "수학",
    amount: 550000,
    paid_at: "2026-03-02",
    start_date: "2026-03-02",
    end_date: "2026-06-30",
    aca_class_id: null,
    created_at: "2026-03-02T10:00:00+09:00",
    updated_at: "2026-03-02T10:00:00+09:00",
  },
  // 이서연 (고2 문과, 국어) · 1건
  {
    id: "dev-ENR-0002",
    student_id: "dev-DC0002",
    course_name: "고2 국어 내신반",
    teacher_name: "김정우T",
    subject: "국어",
    amount: 480000,
    paid_at: "2026-03-02",
    start_date: "2026-03-02",
    end_date: "2026-06-30",
    aca_class_id: null,
    created_at: "2026-03-02T10:05:00+09:00",
    updated_at: "2026-03-02T10:05:00+09:00",
  },
  // 박지후 (고3 이과, 수학) · 2건 (내신+수능)
  {
    id: "dev-ENR-0003",
    student_id: "dev-DC0003",
    course_name: "고3 수학 내신반",
    teacher_name: "백봉영T",
    subject: "수학",
    amount: 650000,
    paid_at: "2026-02-28",
    start_date: "2026-03-02",
    end_date: "2026-06-30",
    aca_class_id: null,
    created_at: "2026-02-28T11:00:00+09:00",
    updated_at: "2026-02-28T11:00:00+09:00",
  },
  {
    id: "dev-ENR-0004",
    student_id: "dev-DC0003",
    course_name: "고3 수학 수능반",
    teacher_name: "백봉영T",
    subject: "수학",
    amount: 700000,
    paid_at: "2026-04-01",
    start_date: "2026-04-05",
    end_date: "2026-07-31",
    aca_class_id: null,
    created_at: "2026-04-01T09:30:00+09:00",
    updated_at: "2026-04-01T09:30:00+09:00",
  },
  // 정하늘 (수강이력자) · 과거 1건
  {
    id: "dev-ENR-0005",
    student_id: "dev-DC0005",
    course_name: "고3 국어 수능반",
    teacher_name: "김정우T",
    subject: "국어",
    amount: 620000,
    paid_at: "2024-09-01",
    start_date: "2024-09-02",
    end_date: "2024-11-30",
    aca_class_id: null,
    created_at: "2024-09-01T10:00:00+09:00",
    updated_at: "2024-09-01T10:00:00+09:00",
  },
  // 강도윤 (고2 이과, 수학+영어) · 3건
  {
    id: "dev-ENR-0006",
    student_id: "dev-SD0001",
    course_name: "고2 수학 내신반",
    teacher_name: "백봉영T",
    subject: "수학",
    amount: 520000,
    paid_at: "2026-03-03",
    start_date: "2026-03-03",
    end_date: "2026-06-30",
    aca_class_id: null,
    created_at: "2026-03-03T10:00:00+09:00",
    updated_at: "2026-03-03T10:00:00+09:00",
  },
  {
    id: "dev-ENR-0007",
    student_id: "dev-SD0001",
    course_name: "고2 영어 내신반",
    teacher_name: "이준호T",
    subject: "영어",
    amount: 450000,
    paid_at: "2026-03-03",
    start_date: "2026-03-03",
    end_date: "2026-06-30",
    aca_class_id: null,
    created_at: "2026-03-03T10:05:00+09:00",
    updated_at: "2026-03-03T10:05:00+09:00",
  },
  {
    id: "dev-ENR-0008",
    student_id: "dev-SD0001",
    course_name: "고2 탐구 선행반",
    teacher_name: "정민서T",
    subject: "탐구",
    amount: 380000,
    paid_at: "2026-04-05",
    start_date: "2026-04-10",
    end_date: "2026-07-31",
    aca_class_id: null,
    created_at: "2026-04-05T09:00:00+09:00",
    updated_at: "2026-04-05T09:00:00+09:00",
  },
  // 윤지우 (고1) · 1건
  {
    id: "dev-ENR-0009",
    student_id: "dev-SD0002",
    course_name: "고1 수학 기초반",
    teacher_name: "백봉영T",
    subject: "수학",
    amount: 350000,
    paid_at: "2026-03-03",
    start_date: "2026-03-03",
    end_date: "2026-06-30",
    aca_class_id: null,
    created_at: "2026-03-03T11:00:00+09:00",
    updated_at: "2026-03-03T11:00:00+09:00",
  },
  // 임하윤 (고3 문과) · 2건
  {
    id: "dev-ENR-0010",
    student_id: "dev-SD0003",
    course_name: "고3 국어 수능반",
    teacher_name: "김정우T",
    subject: "국어",
    amount: 680000,
    paid_at: "2026-02-28",
    start_date: "2026-03-02",
    end_date: "2026-06-30",
    aca_class_id: null,
    created_at: "2026-02-28T10:00:00+09:00",
    updated_at: "2026-02-28T10:00:00+09:00",
  },
  {
    id: "dev-ENR-0011",
    student_id: "dev-SD0003",
    course_name: "고3 영어 수능반",
    teacher_name: "이준호T",
    subject: "영어",
    amount: 550000,
    paid_at: "2026-02-28",
    start_date: "2026-03-02",
    end_date: "2026-06-30",
    aca_class_id: null,
    created_at: "2026-02-28T10:05:00+09:00",
    updated_at: "2026-02-28T10:05:00+09:00",
  },
];

export const DEV_ATTENDANCES: AttendanceRow[] = [
  // 김민준 · 5건
  {
    id: "dev-ATT-0001",
    student_id: "dev-DC0001",
    enrollment_id: "dev-ENR-0001",
    attended_at: "2026-04-07",
    status: "출석",
    created_at: "2026-04-07T18:00:00+09:00",
  },
  {
    id: "dev-ATT-0002",
    student_id: "dev-DC0001",
    enrollment_id: "dev-ENR-0001",
    attended_at: "2026-04-10",
    status: "출석",
    created_at: "2026-04-10T18:00:00+09:00",
  },
  {
    id: "dev-ATT-0003",
    student_id: "dev-DC0001",
    enrollment_id: "dev-ENR-0001",
    attended_at: "2026-04-14",
    status: "지각",
    created_at: "2026-04-14T18:00:00+09:00",
  },
  {
    id: "dev-ATT-0004",
    student_id: "dev-DC0001",
    enrollment_id: "dev-ENR-0001",
    attended_at: "2026-04-17",
    status: "출석",
    created_at: "2026-04-17T18:00:00+09:00",
  },
  {
    id: "dev-ATT-0005",
    student_id: "dev-DC0001",
    enrollment_id: "dev-ENR-0001",
    attended_at: "2026-04-21",
    status: "출석",
    created_at: "2026-04-21T18:00:00+09:00",
  },
  // 이서연 · 4건
  {
    id: "dev-ATT-0006",
    student_id: "dev-DC0002",
    enrollment_id: "dev-ENR-0002",
    attended_at: "2026-04-08",
    status: "출석",
    created_at: "2026-04-08T19:00:00+09:00",
  },
  {
    id: "dev-ATT-0007",
    student_id: "dev-DC0002",
    enrollment_id: "dev-ENR-0002",
    attended_at: "2026-04-11",
    status: "출석",
    created_at: "2026-04-11T19:00:00+09:00",
  },
  {
    id: "dev-ATT-0008",
    student_id: "dev-DC0002",
    enrollment_id: "dev-ENR-0002",
    attended_at: "2026-04-15",
    status: "결석",
    created_at: "2026-04-15T19:00:00+09:00",
  },
  {
    id: "dev-ATT-0009",
    student_id: "dev-DC0002",
    enrollment_id: "dev-ENR-0002",
    attended_at: "2026-04-21",
    status: "출석",
    created_at: "2026-04-21T19:00:00+09:00",
  },
  // 박지후 · 8건 (출석률 100%)
  {
    id: "dev-ATT-0010",
    student_id: "dev-DC0003",
    enrollment_id: "dev-ENR-0003",
    attended_at: "2026-04-06",
    status: "출석",
    created_at: "2026-04-06T18:30:00+09:00",
  },
  {
    id: "dev-ATT-0011",
    student_id: "dev-DC0003",
    enrollment_id: "dev-ENR-0003",
    attended_at: "2026-04-09",
    status: "출석",
    created_at: "2026-04-09T18:30:00+09:00",
  },
  {
    id: "dev-ATT-0012",
    student_id: "dev-DC0003",
    enrollment_id: "dev-ENR-0003",
    attended_at: "2026-04-13",
    status: "출석",
    created_at: "2026-04-13T18:30:00+09:00",
  },
  {
    id: "dev-ATT-0013",
    student_id: "dev-DC0003",
    enrollment_id: "dev-ENR-0003",
    attended_at: "2026-04-16",
    status: "출석",
    created_at: "2026-04-16T18:30:00+09:00",
  },
  {
    id: "dev-ATT-0014",
    student_id: "dev-DC0003",
    enrollment_id: "dev-ENR-0004",
    attended_at: "2026-04-18",
    status: "출석",
    created_at: "2026-04-18T20:30:00+09:00",
  },
  {
    id: "dev-ATT-0015",
    student_id: "dev-DC0003",
    enrollment_id: "dev-ENR-0003",
    attended_at: "2026-04-20",
    status: "출석",
    created_at: "2026-04-20T18:30:00+09:00",
  },
  {
    id: "dev-ATT-0016",
    student_id: "dev-DC0003",
    enrollment_id: "dev-ENR-0004",
    attended_at: "2026-04-21",
    status: "출석",
    created_at: "2026-04-21T20:30:00+09:00",
  },
  {
    id: "dev-ATT-0017",
    student_id: "dev-DC0003",
    enrollment_id: "dev-ENR-0003",
    attended_at: "2026-04-22",
    status: "출석",
    created_at: "2026-04-22T18:30:00+09:00",
  },
  // 강도윤 · 6건
  {
    id: "dev-ATT-0018",
    student_id: "dev-SD0001",
    enrollment_id: "dev-ENR-0006",
    attended_at: "2026-04-07",
    status: "출석",
    created_at: "2026-04-07T18:00:00+09:00",
  },
  {
    id: "dev-ATT-0019",
    student_id: "dev-SD0001",
    enrollment_id: "dev-ENR-0007",
    attended_at: "2026-04-09",
    status: "출석",
    created_at: "2026-04-09T20:00:00+09:00",
  },
  {
    id: "dev-ATT-0020",
    student_id: "dev-SD0001",
    enrollment_id: "dev-ENR-0006",
    attended_at: "2026-04-14",
    status: "조퇴",
    created_at: "2026-04-14T18:00:00+09:00",
  },
  {
    id: "dev-ATT-0021",
    student_id: "dev-SD0001",
    enrollment_id: "dev-ENR-0007",
    attended_at: "2026-04-16",
    status: "출석",
    created_at: "2026-04-16T20:00:00+09:00",
  },
  {
    id: "dev-ATT-0022",
    student_id: "dev-SD0001",
    enrollment_id: "dev-ENR-0008",
    attended_at: "2026-04-18",
    status: "출석",
    created_at: "2026-04-18T14:00:00+09:00",
  },
  {
    id: "dev-ATT-0023",
    student_id: "dev-SD0001",
    enrollment_id: "dev-ENR-0006",
    attended_at: "2026-04-21",
    status: "출석",
    created_at: "2026-04-21T18:00:00+09:00",
  },
  // 윤지우 · 3건
  {
    id: "dev-ATT-0024",
    student_id: "dev-SD0002",
    enrollment_id: "dev-ENR-0009",
    attended_at: "2026-04-08",
    status: "출석",
    created_at: "2026-04-08T17:00:00+09:00",
  },
  {
    id: "dev-ATT-0025",
    student_id: "dev-SD0002",
    enrollment_id: "dev-ENR-0009",
    attended_at: "2026-04-15",
    status: "지각",
    created_at: "2026-04-15T17:00:00+09:00",
  },
  {
    id: "dev-ATT-0026",
    student_id: "dev-SD0002",
    enrollment_id: "dev-ENR-0009",
    attended_at: "2026-04-22",
    status: "출석",
    created_at: "2026-04-22T17:00:00+09:00",
  },
  // 임하윤 · 5건
  {
    id: "dev-ATT-0027",
    student_id: "dev-SD0003",
    enrollment_id: "dev-ENR-0010",
    attended_at: "2026-04-06",
    status: "출석",
    created_at: "2026-04-06T19:00:00+09:00",
  },
  {
    id: "dev-ATT-0028",
    student_id: "dev-SD0003",
    enrollment_id: "dev-ENR-0011",
    attended_at: "2026-04-09",
    status: "출석",
    created_at: "2026-04-09T20:30:00+09:00",
  },
  {
    id: "dev-ATT-0029",
    student_id: "dev-SD0003",
    enrollment_id: "dev-ENR-0010",
    attended_at: "2026-04-13",
    status: "출석",
    created_at: "2026-04-13T19:00:00+09:00",
  },
  {
    id: "dev-ATT-0030",
    student_id: "dev-SD0003",
    enrollment_id: "dev-ENR-0011",
    attended_at: "2026-04-16",
    status: "지각",
    created_at: "2026-04-16T20:30:00+09:00",
  },
  {
    id: "dev-ATT-0031",
    student_id: "dev-SD0003",
    enrollment_id: "dev-ENR-0010",
    attended_at: "2026-04-20",
    status: "출석",
    created_at: "2026-04-20T19:00:00+09:00",
  },
];

export const DEV_STUDENT_MESSAGES: StudentMessageRow[] = [
  // 김민준 · 2건 (개강 안내 + 시험 대비)
  {
    id: "dev-MSG-0001",
    phone: "01090010001",
    status: "도달",
    sent_at: "2026-03-01T10:00:00+09:00",
    campaign_title: "2026년 3월 개강 안내",
    campaign_id: "dev-CMP-0001",
  },
  {
    id: "dev-MSG-0002",
    phone: "01090010001",
    status: "발송됨",
    sent_at: "2026-04-18T15:00:00+09:00",
    campaign_title: "4월 내신 대비 특강 안내",
    campaign_id: "dev-CMP-0002",
  },
  // 이서연 · 1건
  {
    id: "dev-MSG-0003",
    phone: "01090010002",
    status: "도달",
    sent_at: "2026-03-01T10:00:00+09:00",
    campaign_title: "2026년 3월 개강 안내",
    campaign_id: "dev-CMP-0001",
  },
];

// ─── 조회 헬퍼 ─────────────────────────────────────────────

export function findDevProfileById(
  studentId: string,
): StudentProfileRow | null {
  return DEV_STUDENT_PROFILES.find((p) => p.id === studentId) ?? null;
}

export function findDevEnrollmentsByStudentId(
  studentId: string,
): EnrollmentRow[] {
  return DEV_ENROLLMENTS.filter((e) => e.student_id === studentId);
}

export function findDevAttendancesByStudentId(
  studentId: string,
): AttendanceRow[] {
  return DEV_ATTENDANCES.filter((a) => a.student_id === studentId);
}

export function findDevMessagesByStudentId(
  studentId: string,
): StudentMessageRow[] {
  // 학생 상세용 발송 이력은 학생의 학부모/본인 phone 과 매칭.
  const profile = findDevProfileById(studentId);
  if (!profile) return [];
  const phones = new Set<string>(
    [profile.parent_phone, profile.phone].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    ),
  );
  if (phones.size === 0) return [];
  return DEV_STUDENT_MESSAGES.filter((m) => phones.has(m.phone));
}

// ─── F2 발송 그룹 시드 ──────────────────────────────────────
//
// recipient_count 는 각 그룹의 filters 를 DEV_STUDENT_PROFILES 에 적용한 뒤
// 비활성("탈퇴") 제외하고 센 값(또는 현실적 대략치).
// unsubscribes 시드는 MVP dev-seed 에 없어 고려하지 않음.
// dev-seed 모드에서 UI 는 카운트만 보여주고 "저장"은 서버에서 차단됨.

export const DEV_GROUPS: GroupRow[] = [
  {
    id: "dev-group-1",
    name: "대치 고2 전체",
    branch: "대치",
    filters: { grades: ["고2"], schools: [], subjects: [] },
    // DC0001(고2 재원)·DC0002(고2 재원) 2명. 탈퇴 제외 후 2.
    recipient_count: 2,
    last_sent_at: "2026-04-15T14:00:00+09:00",
    last_message_preview:
      "[광고] 세정학원 대치 4월 주간테스트 안내드립니다. 토요일 오후 2시...",
    created_by: null,
    created_at: "2026-03-10T09:00:00+09:00",
    updated_at: "2026-04-15T14:00:00+09:00",
  },
  {
    id: "dev-group-2",
    name: "대치 수학 수강생",
    branch: "대치",
    filters: { grades: [], schools: [], subjects: ["수학"] },
    // DC0001·DC0003 이 수학 수강. 현실 수치로 5 (실제 시드 외 추정 수강생 포함).
    recipient_count: 5,
    last_sent_at: "2026-04-08T10:30:00+09:00",
    last_message_preview:
      "[광고] 이번주 수학 숙제 미제출자 명단입니다. 확인 부탁드립니다...",
    created_by: null,
    created_at: "2026-03-12T11:20:00+09:00",
    updated_at: "2026-04-08T10:30:00+09:00",
  },
  {
    id: "dev-group-3",
    name: "송도 고3 탐구",
    branch: "송도",
    filters: { grades: ["고3"], schools: [], subjects: ["탐구"] },
    // 시드 내 해당자 0 이나 현실 수강생 가정 3.
    recipient_count: 3,
    last_sent_at: null,
    last_message_preview: null,
    created_by: null,
    created_at: "2026-04-01T15:10:00+09:00",
    updated_at: "2026-04-01T15:10:00+09:00",
  },
  {
    id: "dev-group-4",
    name: "대치 휘문고 국어",
    branch: "대치",
    filters: { grades: [], schools: ["휘문고"], subjects: ["국어"] },
    // 휘문고 × 국어 교차. 현실 수치로 4.
    recipient_count: 4,
    last_sent_at: null,
    last_message_preview: null,
    created_by: null,
    created_at: "2026-04-05T09:45:00+09:00",
    updated_at: "2026-04-05T09:45:00+09:00",
  },
];

export function findDevGroupById(id: string): GroupRow | null {
  return DEV_GROUPS.find((g) => g.id === id) ?? null;
}

/**
 * 그룹 리스트 조회(dev-seed).
 * - branch: 분원 정확히 일치. 빈 문자열/undefined 면 전체.
 * - q: 그룹명 부분일치(대소문자 무시).
 */
export function listDevGroups(args: {
  branch?: string;
  q?: string;
}): GroupRow[] {
  const branch = args.branch?.trim() ?? "";
  const q = args.q?.trim().toLowerCase() ?? "";
  return DEV_GROUPS.filter((g) => {
    if (branch && g.branch !== branch) return false;
    if (q && !g.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ─── F3-A 템플릿 시드 ───────────────────────────────────────
//
// byte_count 는 실제 EUC-KR 계산 전 현실적 추정치.
// backend 의 byte 유틸 도입 후 재계산 예정.

export const DEV_TEMPLATES: TemplateRow[] = [
  {
    id: "dev-tpl-1",
    name: "주간 테스트 안내",
    subject: "세정학원 주간테스트 안내",
    body:
      "안녕하세요 세정학원입니다. 이번주 토요일 오후 2시에 주간테스트가 진행됩니다. " +
      "대상은 고2 내신반 전원이며, 장소는 대치관 2층 201호입니다. " +
      "필기구와 학생증을 지참해 주시기 바랍니다. 결석 시 보강은 별도 일정으로 안내드립니다.",
    type: "LMS",
    teacher_name: "김정우T",
    auto_captured: false,
    is_ad: false,
    byte_count: 260,
    created_by: null,
    created_at: "2026-02-20T09:00:00+09:00",
    updated_at: "2026-02-20T09:00:00+09:00",
  },
  {
    id: "dev-tpl-2",
    name: "이번주 결석자 안내",
    subject: null,
    body:
      "[세정학원] 이번주 결석하신 것으로 확인됩니다. 보강 일정 문의주세요. 02-555-1234",
    type: "SMS",
    teacher_name: null,
    auto_captured: false,
    is_ad: false,
    byte_count: 88,
    created_by: null,
    created_at: "2026-03-05T10:30:00+09:00",
    updated_at: "2026-03-05T10:30:00+09:00",
  },
  {
    id: "dev-tpl-3",
    name: "특강 모집",
    subject: "여름 특강 모집 안내",
    body:
      "[세정학원] 2026 여름 수능 대비 특강 모집. 대상: 고3 전원. " +
      "기간: 7/1 ~ 8/31, 주 3회 저녁반. 수강료 85만원, 조기등록 시 10% 할인. " +
      "상담 및 신청은 대치관 02-555-1234 또는 홈페이지에서 가능합니다. " +
      "커리큘럼은 주요 대학 기출을 중심으로 구성되어 있으며 교재는 자체 제작. " +
      "수강 정원 20명 한정으로 선착순 마감됩니다. 놓치지 마세요.",
    type: "LMS",
    teacher_name: "백봉영T",
    auto_captured: false,
    is_ad: true,
    byte_count: 420,
    created_by: null,
    created_at: "2026-03-25T14:00:00+09:00",
    updated_at: "2026-03-25T14:00:00+09:00",
  },
  {
    id: "dev-tpl-4",
    name: "학부모 상담주간",
    subject: "학부모 상담주간 일정 안내",
    body:
      "세정학원 학부모 상담주간 안내드립니다. 일정: 4/22(수) ~ 4/26(일). " +
      "시간대는 평일 오후 6시~9시, 주말 오전 10시~오후 5시입니다. " +
      "상담은 예약제이며, 홈페이지 또는 전화로 예약 부탁드립니다.",
    type: "LMS",
    teacher_name: "박선생T",
    auto_captured: false,
    is_ad: false,
    byte_count: 240,
    created_by: null,
    created_at: "2026-04-05T11:00:00+09:00",
    updated_at: "2026-04-05T11:00:00+09:00",
  },
  {
    id: "dev-tpl-5",
    name: "알림톡: 수업 변경",
    subject: "수업 일정 변경 안내",
    body:
      "[세정학원] 수업 일정이 일부 변경되었습니다. 변경 내용은 학부모 앱에서 확인 가능합니다. 문의: 02-555-1234",
    type: "ALIMTALK",
    teacher_name: null,
    auto_captured: false,
    is_ad: false,
    byte_count: 150,
    created_by: null,
    created_at: "2026-04-10T09:30:00+09:00",
    updated_at: "2026-04-10T09:30:00+09:00",
  },
];

// ─── F3-A 캠페인 시드 ───────────────────────────────────────
//
// 단가 가정: SMS 20원, LMS 25원, ALIMTALK 10원.
// total_cost = total_recipients * 단가 (실패 캠페인은 부분 집행).

export const DEV_CAMPAIGNS: CampaignRow[] = [
  {
    // 완료 · group-1(2명) × LMS(25원) = 50원
    id: "dev-cmp-1",
    title: "2026년 3월 개강 안내",
    template_id: "dev-tpl-1",
    group_id: "dev-group-1",
    scheduled_at: null,
    sent_at: "2026-03-01T10:00:00+09:00",
    status: "완료",
    total_recipients: 2,
    total_cost: 50,
    created_by: null,
    branch: "대치",
    is_test: false,
    created_at: "2026-03-01T09:55:00+09:00",
    updated_at: "2026-03-01T10:05:00+09:00",
  },
  {
    // 완료 · group-2(5명) × SMS(20원) = 100원
    id: "dev-cmp-2",
    title: "4월 결석자 보강 안내",
    template_id: "dev-tpl-2",
    group_id: "dev-group-2",
    scheduled_at: null,
    sent_at: "2026-04-08T10:30:00+09:00",
    status: "완료",
    total_recipients: 5,
    total_cost: 100,
    created_by: null,
    branch: "대치",
    is_test: false,
    created_at: "2026-04-08T10:25:00+09:00",
    updated_at: "2026-04-08T10:35:00+09:00",
  },
  {
    // 완료 · group-4(4명) × LMS(25원) = 100원
    id: "dev-cmp-3",
    title: "학부모 상담주간 안내",
    template_id: "dev-tpl-4",
    group_id: "dev-group-4",
    scheduled_at: null,
    sent_at: "2026-04-15T14:00:00+09:00",
    status: "완료",
    total_recipients: 4,
    total_cost: 100,
    created_by: null,
    branch: "대치",
    is_test: false,
    created_at: "2026-04-15T13:55:00+09:00",
    updated_at: "2026-04-15T14:05:00+09:00",
  },
  {
    // 발송중 · group-1(2명) × LMS(25원) = 50원 · 광고 템플릿
    id: "dev-cmp-4",
    title: "여름 특강 모집",
    template_id: "dev-tpl-3",
    group_id: "dev-group-1",
    scheduled_at: null,
    sent_at: "2026-04-20T09:00:00+09:00",
    status: "발송중",
    total_recipients: 2,
    total_cost: 50,
    created_by: null,
    branch: "대치",
    is_test: false,
    created_at: "2026-04-20T08:55:00+09:00",
    updated_at: "2026-04-20T09:00:00+09:00",
  },
  {
    // 예약됨 · group-3(3명) × ALIMTALK(10원) = 30원
    id: "dev-cmp-5",
    title: "수업 일정 변경 알림",
    template_id: "dev-tpl-5",
    group_id: "dev-group-3",
    scheduled_at: "2026-04-25T09:00:00+09:00",
    sent_at: null,
    status: "예약됨",
    total_recipients: 3,
    total_cost: 30,
    created_by: null,
    branch: "송도",
    is_test: false,
    created_at: "2026-04-18T16:00:00+09:00",
    updated_at: "2026-04-18T16:00:00+09:00",
  },
  {
    // 실패 · group-2(5명) × LMS. 벤더 오류로 전체 실패, 비용 0.
    id: "dev-cmp-6",
    title: "4월 내신 특강 안내",
    template_id: "dev-tpl-3",
    group_id: "dev-group-2",
    scheduled_at: null,
    sent_at: "2026-04-18T21:30:00+09:00",
    status: "실패",
    total_recipients: 5,
    total_cost: 0,
    created_by: null,
    branch: "대치",
    is_test: false,
    created_at: "2026-04-18T21:25:00+09:00",
    updated_at: "2026-04-18T21:35:00+09:00",
  },
];

// ─── F3-A 캠페인 메시지 시드 ────────────────────────────────
//
// 재발송 테스트 위해 실패 건 다수 포함.
// 학생 id 는 DEV_STUDENT_PROFILES 의 실제 id 와 매칭.
// phone 은 해당 학생의 parent_phone 사용.

export const DEV_CAMPAIGN_MESSAGES: CampaignMessageRow[] = [
  // --- CMP-1 (완료, LMS, group-1) : 대치 고2 전체 · DC0001, DC0002 ---
  {
    id: "dev-msg-1-1",
    campaign_id: "dev-cmp-1",
    student_id: "dev-DC0001",
    phone: "01090010001",
    status: "도달",
    vendor_message_id: "mn-mock-0001",
    cost: 25,
    sent_at: "2026-03-01T10:00:05+09:00",
    delivered_at: "2026-03-01T10:00:42+09:00",
    failed_reason: null,
    is_test: false,
    created_at: "2026-03-01T10:00:00+09:00",
  },
  {
    id: "dev-msg-1-2",
    campaign_id: "dev-cmp-1",
    student_id: "dev-DC0002",
    phone: "01090010002",
    status: "도달",
    vendor_message_id: "mn-mock-0002",
    cost: 25,
    sent_at: "2026-03-01T10:00:05+09:00",
    delivered_at: "2026-03-01T10:00:40+09:00",
    failed_reason: null,
    is_test: false,
    created_at: "2026-03-01T10:00:00+09:00",
  },
  // --- CMP-2 (완료, SMS, group-2) · 대치 수학 수강생 ---
  {
    id: "dev-msg-2-1",
    campaign_id: "dev-cmp-2",
    student_id: "dev-DC0001",
    phone: "01090010001",
    status: "도달",
    vendor_message_id: "mn-mock-0101",
    cost: 20,
    sent_at: "2026-04-08T10:30:10+09:00",
    delivered_at: "2026-04-08T10:30:45+09:00",
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-08T10:30:00+09:00",
  },
  {
    id: "dev-msg-2-2",
    campaign_id: "dev-cmp-2",
    student_id: "dev-DC0003",
    phone: "01090010003",
    status: "도달",
    vendor_message_id: "mn-mock-0102",
    cost: 20,
    sent_at: "2026-04-08T10:30:10+09:00",
    delivered_at: "2026-04-08T10:30:42+09:00",
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-08T10:30:00+09:00",
  },
  {
    id: "dev-msg-2-3",
    campaign_id: "dev-cmp-2",
    student_id: "dev-DC0002",
    phone: "01090010002",
    status: "발송됨",
    vendor_message_id: "mn-mock-0103",
    cost: 20,
    sent_at: "2026-04-08T10:30:10+09:00",
    delivered_at: null,
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-08T10:30:00+09:00",
  },
  {
    id: "dev-msg-2-4",
    campaign_id: "dev-cmp-2",
    student_id: "dev-DC0005",
    phone: "01090010005",
    status: "실패",
    vendor_message_id: "mn-mock-0104",
    cost: 0,
    sent_at: "2026-04-08T10:30:10+09:00",
    delivered_at: null,
    failed_reason: "수신거부 번호",
    is_test: false,
    created_at: "2026-04-08T10:30:00+09:00",
  },
  // --- CMP-3 (완료, LMS, group-4) · 대치 휘문고 국어 ---
  {
    id: "dev-msg-3-1",
    campaign_id: "dev-cmp-3",
    student_id: "dev-DC0001",
    phone: "01090010001",
    status: "도달",
    vendor_message_id: "mn-mock-0201",
    cost: 25,
    sent_at: "2026-04-15T14:00:05+09:00",
    delivered_at: "2026-04-15T14:00:38+09:00",
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-15T14:00:00+09:00",
  },
  {
    id: "dev-msg-3-2",
    campaign_id: "dev-cmp-3",
    student_id: "dev-DC0003",
    phone: "01090010003",
    status: "도달",
    vendor_message_id: "mn-mock-0202",
    cost: 25,
    sent_at: "2026-04-15T14:00:05+09:00",
    delivered_at: "2026-04-15T14:00:40+09:00",
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-15T14:00:00+09:00",
  },
  {
    id: "dev-msg-3-3",
    campaign_id: "dev-cmp-3",
    student_id: "dev-DC0002",
    phone: "01090010002",
    status: "발송됨",
    vendor_message_id: "mn-mock-0203",
    cost: 25,
    sent_at: "2026-04-15T14:00:05+09:00",
    delivered_at: null,
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-15T14:00:00+09:00",
  },
  // --- CMP-4 (발송중, LMS 광고, group-1) ---
  {
    id: "dev-msg-4-1",
    campaign_id: "dev-cmp-4",
    student_id: "dev-DC0001",
    phone: "01090010001",
    status: "발송됨",
    vendor_message_id: "mn-mock-0301",
    cost: 25,
    sent_at: "2026-04-20T09:00:10+09:00",
    delivered_at: null,
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-20T09:00:00+09:00",
  },
  {
    id: "dev-msg-4-2",
    campaign_id: "dev-cmp-4",
    student_id: "dev-DC0002",
    phone: "01090010002",
    status: "대기",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-20T09:00:00+09:00",
  },
  // --- CMP-5 (예약됨, ALIMTALK, group-3 송도) · 아직 발송 전 · 전원 대기 ---
  {
    id: "dev-msg-5-1",
    campaign_id: "dev-cmp-5",
    student_id: "dev-SD0001",
    phone: "01090020001",
    status: "대기",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-18T16:00:00+09:00",
  },
  {
    id: "dev-msg-5-2",
    campaign_id: "dev-cmp-5",
    student_id: "dev-SD0002",
    phone: "01090020002",
    status: "대기",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-18T16:00:00+09:00",
  },
  {
    id: "dev-msg-5-3",
    campaign_id: "dev-cmp-5",
    student_id: "dev-SD0003",
    phone: "01090020003",
    status: "대기",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: null,
    is_test: false,
    created_at: "2026-04-18T16:00:00+09:00",
  },
  // --- CMP-6 (실패, LMS 광고, group-2) · 21:30 야간 광고 차단 시나리오 ---
  {
    id: "dev-msg-6-1",
    campaign_id: "dev-cmp-6",
    student_id: "dev-DC0001",
    phone: "01090010001",
    status: "실패",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: "야간 광고 차단 (21~08)",
    is_test: false,
    created_at: "2026-04-18T21:30:00+09:00",
  },
  {
    id: "dev-msg-6-2",
    campaign_id: "dev-cmp-6",
    student_id: "dev-DC0002",
    phone: "01090010002",
    status: "실패",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: "야간 광고 차단 (21~08)",
    is_test: false,
    created_at: "2026-04-18T21:30:00+09:00",
  },
  {
    id: "dev-msg-6-3",
    campaign_id: "dev-cmp-6",
    student_id: "dev-DC0003",
    phone: "01090010003",
    status: "실패",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: "야간 광고 차단 (21~08)",
    is_test: false,
    created_at: "2026-04-18T21:30:00+09:00",
  },
];

// ─── F3-A 조회 헬퍼 ────────────────────────────────────────

export function findDevTemplateById(id: string): TemplateRow | null {
  return DEV_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * 템플릿 리스트 조회(dev-seed).
 * - q: 템플릿명/본문 부분일치 (대소문자 무시).
 * - type: 정확 일치.
 * - teacher_name: 정확 일치.
 */
export function listDevTemplates(args: {
  q?: string;
  type?: string;
  teacher_name?: string;
}): TemplateRow[] {
  const q = args.q?.trim().toLowerCase() ?? "";
  const type = args.type?.trim() ?? "";
  const teacher = args.teacher_name?.trim() ?? "";
  return DEV_TEMPLATES.filter((t) => {
    if (type && t.type !== type) return false;
    if (teacher && t.teacher_name !== teacher) return false;
    if (q) {
      const hay = `${t.name} ${t.body}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function findDevCampaignById(id: string): CampaignRow | null {
  return DEV_CAMPAIGNS.find((c) => c.id === id) ?? null;
}

/**
 * 캠페인 리스트 조회(dev-seed) + 템플릿·그룹 조인 + 도달·실패 집계.
 * - q: 캠페인 제목 부분일치.
 * - status: 정확 일치.
 * - from/to: sent_at (없으면 scheduled_at) 기준 YYYY-MM-DD 범위.
 */
export function listDevCampaigns(args: {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}): CampaignListItem[] {
  const q = args.q?.trim().toLowerCase() ?? "";
  const status = args.status?.trim() ?? "";
  const from = args.from?.trim() ?? "";
  const to = args.to?.trim() ?? "";

  return DEV_CAMPAIGNS.filter((c) => {
    if (q && !c.title.toLowerCase().includes(q)) return false;
    if (status && c.status !== status) return false;
    const ref = c.sent_at ?? c.scheduled_at;
    if (from || to) {
      if (!ref) return false;
      const day = ref.slice(0, 10); // YYYY-MM-DD
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    return true;
  }).map((c) => {
    const tpl = DEV_TEMPLATES.find((t) => t.id === c.template_id) ?? null;
    const grp = DEV_GROUPS.find((g) => g.id === c.group_id) ?? null;
    const msgs = DEV_CAMPAIGN_MESSAGES.filter((m) => m.campaign_id === c.id);
    return {
      ...c,
      template_name: tpl?.name ?? null,
      group_name: grp?.name ?? null,
      delivered_count: msgs.filter((m) => m.status === "도달").length,
      failed_count: msgs.filter((m) => m.status === "실패").length,
    };
  });
}

/**
 * 특정 캠페인의 메시지 리스트 조회(dev-seed).
 * student_name 은 DEV_STUDENT_PROFILES 에서 조인.
 */
export function listDevCampaignMessages(
  campaignId: string,
): CampaignMessageRow[] {
  return DEV_CAMPAIGN_MESSAGES.filter((m) => m.campaign_id === campaignId).map(
    (m) => {
      const student = m.student_id
        ? DEV_STUDENT_PROFILES.find((p) => p.id === m.student_id)
        : null;
      return {
        ...m,
        student_name: student?.name ?? null,
      };
    },
  );
}

// ─── F4 계정·권한 시드 ─────────────────────────────────────
//
// dev-seed 모드에서 현재 로그인 사용자를 시뮬레이션하기 위한 가상 master.
// middleware·current-user 로더가 isDevSeedMode() 일 때 이 상수를 반환.

export const DEV_VIRTUAL_MASTER: CurrentUser = {
  user_id: "dev-master-0001",
  email: "dev-master@sejung.local",
  name: "개발용 마스터",
  role: "master",
  branch: "대치",
  active: true,
  must_change_password: false,
};

// 계정 관리 UI 시연용 샘플 리스트 (읽기만).
// 구성: master 1 / admin 2(대치·송도) / manager 1 / viewer 1 + 비활성 1.
// email 은 보조 캐시 컬럼을 의도적으로 채움(실DB 에선 sync 트리거가 채움).
export const DEV_ACCOUNTS: AccountListItem[] = [
  {
    user_id: "dev-master-0001",
    name: "개발용 마스터",
    email: "dev-master@sejung.local",
    role: "master",
    branch: "대치",
    active: true,
    must_change_password: false,
    created_at: "2026-01-02T09:00:00+09:00",
    updated_at: "2026-01-02T09:00:00+09:00",
  },
  {
    user_id: "dev-admin-dc-0001",
    name: "김원장",
    email: "admin.dc@sejung.local",
    role: "admin",
    branch: "대치",
    active: true,
    must_change_password: false,
    created_at: "2026-01-05T10:00:00+09:00",
    updated_at: "2026-03-10T11:00:00+09:00",
  },
  {
    user_id: "dev-admin-sd-0001",
    name: "이원장",
    email: "admin.sd@sejung.local",
    role: "admin",
    branch: "송도",
    active: true,
    must_change_password: false,
    created_at: "2026-01-05T10:15:00+09:00",
    updated_at: "2026-03-11T12:00:00+09:00",
  },
  {
    user_id: "dev-manager-dc-0001",
    name: "박실장",
    email: "manager.dc@sejung.local",
    role: "manager",
    branch: "대치",
    active: true,
    must_change_password: true,
    created_at: "2026-04-10T09:00:00+09:00",
    updated_at: "2026-04-10T09:00:00+09:00",
  },
  {
    user_id: "dev-viewer-sd-0001",
    name: "최사용자",
    email: "viewer.sd@sejung.local",
    role: "viewer",
    branch: "송도",
    active: true,
    must_change_password: false,
    created_at: "2026-02-15T14:00:00+09:00",
    updated_at: "2026-02-15T14:00:00+09:00",
  },
  {
    user_id: "dev-viewer-dc-0002",
    name: "정퇴사자",
    email: "retired.dc@sejung.local",
    role: "viewer",
    branch: "대치",
    active: false,
    must_change_password: false,
    created_at: "2025-09-01T09:00:00+09:00",
    updated_at: "2026-03-30T17:00:00+09:00",
  },
];

export function findDevAccountById(userId: string): AccountListItem | null {
  return DEV_ACCOUNTS.find((a) => a.user_id === userId) ?? null;
}

/**
 * 계정 리스트 조회(dev-seed).
 * - q: 이름/이메일 부분일치(대소문자 무시).
 * - role: 정확 일치.
 * - branch: 정확 일치. 빈 문자열/undefined 면 전체.
 * - active: 'true' | 'false' 문자열. undefined 면 전체.
 */
export function listDevAccounts(args: {
  q?: string;
  role?: string;
  branch?: string;
  active?: "true" | "false";
}): AccountListItem[] {
  const q = args.q?.trim().toLowerCase() ?? "";
  const role = args.role?.trim() ?? "";
  const branch = args.branch?.trim() ?? "";
  const activeFilter = args.active;

  return DEV_ACCOUNTS.filter((a) => {
    if (role && a.role !== role) return false;
    if (branch && a.branch !== branch) return false;
    if (activeFilter === "true" && !a.active) return false;
    if (activeFilter === "false" && a.active) return false;
    if (q) {
      const hay = `${a.name} ${a.email ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

