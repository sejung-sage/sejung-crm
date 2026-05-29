/**
 * 설명회 신청 시스템 · UI 셸용 목 데이터 (UI MOCKUP ONLY)
 *
 * ⚠️ 백엔드·DB·마이그레이션 일체 미연동. 운영자에게 흐름 시연 후
 * 정식 architect → backend 단계에서 별도로 설계됨.
 *
 * 모든 데이터는 in-memory 상수. 함수형 lookup 만 제공.
 * 실제 DB 시드(`students-dev-seed.ts`) 와 완전히 분리.
 */

import type { Branch } from "@/config/branches";

/** 설명회 상태 */
export type SeminarStatus = "open" | "closed" | "ended" | "cancelled";

/** 신청 상태 */
export type SignupStatus = "active" | "cancelled";

export interface MockSeminar {
  id: string;
  /** 학부모 공개 URL `/s/[token]` 의 토큰. ID 와 별개 — 추측 방지용 */
  token: string;
  name: string;
  branch: Branch;
  /** ISO 일시 — 진행 일시 (선택) */
  starts_at: string | null;
  /** 장소 (선택) */
  venue: string | null;
  /** 정원 (선택, null = 무제한) */
  capacity: number | null;
  /** 신청 마감 일시 (선택) */
  application_deadline: string | null;
  /** 학부모 페이지에 표시할 안내문 */
  description: string | null;
  status: SeminarStatus;
  /** 작성자 이름 */
  created_by_name: string;
  /** 생성 일시 (ISO) */
  created_at: string;
}

export interface MockSignup {
  id: string;
  seminar_id: string;
  /** 자녀 이름 */
  student_name: string;
  /** 학부모 전화번호 (010-XXXX-XXXX 포맷) */
  parent_phone: string;
  /** 신청 시각 (ISO) */
  signed_up_at: string;
  status: SignupStatus;
  /**
   * 기존 학생 매칭 (있으면 표시). 없으면 null.
   * 예: "대치 고2 홍길동" — 어드민이 신청자가 우리 학원생인지 즉시 확인용.
   */
  matched_student_label: string | null;
}

/** 어드민 리스트용 — 신청 수 집계 포함 */
export interface MockSeminarListRow extends MockSeminar {
  signup_count: number;
}

// ─── 시드 데이터 ─────────────────────────────────────────────

const SEMINARS: MockSeminar[] = [
  {
    id: "sem_001",
    token: "tok_whimun_g1_2026",
    name: "2026 휘문 1학년 입시설명회",
    branch: "대치",
    starts_at: "2026-06-08T19:00:00+09:00",
    venue: "대치 본원 3층 대강의실",
    capacity: 40,
    application_deadline: "2026-06-07T18:00:00+09:00",
    description:
      "2026학년도 휘문 1학년 학부모님을 모시고 입시 흐름과 1학기 내신 전략을 안내해 드립니다. 자녀 동반은 불가하며, 학부모 한 분만 입장 가능합니다. 자세한 안내는 신청 후 안내 문자로 다시 보내드립니다.",
    status: "open",
    created_by_name: "명경아 원장",
    created_at: "2026-05-22T10:14:00+09:00",
  },
  {
    id: "sem_002",
    token: "tok_banpo_predaeip_2026",
    name: "반포 예비고1 학기 운영 안내회",
    branch: "반포",
    starts_at: "2026-06-15T19:30:00+09:00",
    venue: "반포 분원 2층 세미나실",
    capacity: 25,
    application_deadline: "2026-06-14T20:00:00+09:00",
    description:
      "예비 고1 학생·학부모 대상 1학기 커리큘럼과 수업 운영 방식을 안내합니다.",
    status: "open",
    created_by_name: "박은주 부원장",
    created_at: "2026-05-24T16:02:00+09:00",
  },
  {
    id: "sem_003",
    token: "tok_songdo_summer_2026",
    name: "송도 여름방학 특강 설명회",
    branch: "송도",
    starts_at: "2026-06-22T19:00:00+09:00",
    venue: "송도 분원 5층 대강의실",
    capacity: 60,
    application_deadline: "2026-06-21T18:00:00+09:00",
    description:
      "여름방학 특강 커리큘럼과 시간표, 환불 정책을 한 자리에서 안내해 드립니다.",
    status: "closed",
    created_by_name: "이정훈 실장",
    created_at: "2026-05-10T11:30:00+09:00",
  },
  {
    id: "sem_004",
    token: "tok_bangbae_g3_finished",
    name: "방배 고3 입시상담회",
    branch: "방배",
    starts_at: "2026-05-18T19:00:00+09:00",
    venue: "방배 분원 4층 회의실",
    capacity: 20,
    application_deadline: "2026-05-17T18:00:00+09:00",
    description: "방배 분원 고3 학부모 대상 입시 상담 안내회입니다.",
    status: "ended",
    created_by_name: "최유리 팀장",
    created_at: "2026-04-30T09:00:00+09:00",
  },
  {
    id: "sem_005",
    token: "tok_daechi_middle_2026",
    name: "대치 중등 신학기 설명회 (취소)",
    branch: "대치",
    starts_at: "2026-05-25T19:00:00+09:00",
    venue: null,
    capacity: 30,
    application_deadline: "2026-05-24T18:00:00+09:00",
    description: "일정 변경으로 취소되었습니다. 추후 재공지 예정.",
    status: "cancelled",
    created_by_name: "명경아 원장",
    created_at: "2026-05-05T15:21:00+09:00",
  },
];

const SIGNUPS: MockSignup[] = [
  // sem_001 (대치 휘문 1학년) — 7명
  {
    id: "sgn_001",
    seminar_id: "sem_001",
    student_name: "김민준",
    parent_phone: "010-1234-5678",
    signed_up_at: "2026-05-26T09:12:00+09:00",
    status: "active",
    matched_student_label: "대치 고1 김민준",
  },
  {
    id: "sgn_002",
    seminar_id: "sem_001",
    student_name: "이서연",
    parent_phone: "010-2345-6789",
    signed_up_at: "2026-05-26T11:08:00+09:00",
    status: "active",
    matched_student_label: "대치 고1 이서연",
  },
  {
    id: "sgn_003",
    seminar_id: "sem_001",
    student_name: "박지호",
    parent_phone: "010-3456-7890",
    signed_up_at: "2026-05-27T08:45:00+09:00",
    status: "active",
    matched_student_label: null,
  },
  {
    id: "sgn_004",
    seminar_id: "sem_001",
    student_name: "정하윤",
    parent_phone: "010-4567-8901",
    signed_up_at: "2026-05-27T13:22:00+09:00",
    status: "active",
    matched_student_label: "대치 고1 정하윤",
  },
  {
    id: "sgn_005",
    seminar_id: "sem_001",
    student_name: "최도윤",
    parent_phone: "010-5678-9012",
    signed_up_at: "2026-05-28T10:01:00+09:00",
    status: "cancelled",
    matched_student_label: null,
  },
  {
    id: "sgn_006",
    seminar_id: "sem_001",
    student_name: "윤채원",
    parent_phone: "010-6789-0123",
    signed_up_at: "2026-05-28T14:55:00+09:00",
    status: "active",
    matched_student_label: null,
  },
  {
    id: "sgn_007",
    seminar_id: "sem_001",
    student_name: "강서준",
    parent_phone: "010-7890-1234",
    signed_up_at: "2026-05-29T07:30:00+09:00",
    status: "active",
    matched_student_label: "대치 고1 강서준",
  },
  // sem_002 — 3명
  {
    id: "sgn_011",
    seminar_id: "sem_002",
    student_name: "조하은",
    parent_phone: "010-1111-2222",
    signed_up_at: "2026-05-25T20:10:00+09:00",
    status: "active",
    matched_student_label: "반포 중3 조하은",
  },
  {
    id: "sgn_012",
    seminar_id: "sem_002",
    student_name: "장은우",
    parent_phone: "010-2222-3333",
    signed_up_at: "2026-05-26T19:42:00+09:00",
    status: "active",
    matched_student_label: null,
  },
  {
    id: "sgn_013",
    seminar_id: "sem_002",
    student_name: "한지안",
    parent_phone: "010-3333-4444",
    signed_up_at: "2026-05-27T21:08:00+09:00",
    status: "active",
    matched_student_label: null,
  },
  // sem_003 — 8명 (마감 상태)
  {
    id: "sgn_021",
    seminar_id: "sem_003",
    student_name: "임수아",
    parent_phone: "010-1010-2020",
    signed_up_at: "2026-05-15T10:00:00+09:00",
    status: "active",
    matched_student_label: "송도 고2 임수아",
  },
  {
    id: "sgn_022",
    seminar_id: "sem_003",
    student_name: "오시우",
    parent_phone: "010-2020-3030",
    signed_up_at: "2026-05-16T11:11:00+09:00",
    status: "active",
    matched_student_label: "송도 고2 오시우",
  },
  // sem_004 (종료된 행사) — 4명
  {
    id: "sgn_031",
    seminar_id: "sem_004",
    student_name: "신예린",
    parent_phone: "010-9000-1000",
    signed_up_at: "2026-05-12T18:22:00+09:00",
    status: "active",
    matched_student_label: "방배 고3 신예린",
  },
  {
    id: "sgn_032",
    seminar_id: "sem_004",
    student_name: "권태윤",
    parent_phone: "010-9000-2000",
    signed_up_at: "2026-05-14T09:01:00+09:00",
    status: "active",
    matched_student_label: null,
  },
  // sem_005 (취소된 행사) — 신청자 없음
];

// ─── public API ─────────────────────────────────────────────

/** 어드민 리스트 — 분원 필터(전체 = undefined) */
export function listMockSeminars(branch?: Branch): MockSeminarListRow[] {
  const rows = branch
    ? SEMINARS.filter((s) => s.branch === branch)
    : SEMINARS;
  return rows.map((s) => ({
    ...s,
    signup_count: SIGNUPS.filter(
      (g) => g.seminar_id === s.id && g.status === "active",
    ).length,
  }));
}

export function findMockSeminarById(id: string): MockSeminar | null {
  return SEMINARS.find((s) => s.id === id) ?? null;
}

export function findMockSeminarByToken(token: string): MockSeminar | null {
  return SEMINARS.find((s) => s.token === token) ?? null;
}

export function listMockSignups(seminarId: string): MockSignup[] {
  // 신청 시각 역순 (최신이 위)
  return SIGNUPS.filter((g) => g.seminar_id === seminarId).sort((a, b) =>
    b.signed_up_at.localeCompare(a.signed_up_at),
  );
}

/** 학부모 공개 페이지 URL — 시연용 base는 location.origin 으로 client 에서 보정 */
export function buildPublicSignupUrl(token: string, origin = ""): string {
  return `${origin}/s/${token}`;
}

/** 상태 → 한국어 라벨 */
export function seminarStatusLabel(s: SeminarStatus): string {
  switch (s) {
    case "open":
      return "모집중";
    case "closed":
      return "마감";
    case "ended":
      return "종료";
    case "cancelled":
      return "취소";
  }
}
