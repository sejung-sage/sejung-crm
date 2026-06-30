import { z } from "zod";

/**
 * 공통 enum Zod 스키마
 * PRD 섹션 4.1 CHECK 제약과 1:1 대응. DB 와 일치 여부 정기 감사.
 */

export const BranchSchema = z.string().min(1, "분원은 필수입니다");

/**
 * 학년 정규화 enum (10종).
 * 0012 자유 TEXT → enum, 0041 초1~초6 추가, 0043 초등 단일값으로 통합.
 *  - 초등    : 학교명이 "○○초" / "○○초등학교" 로 끝나는 모든 학생 (학년 무관)
 *  - 중1~중3 : 학교명이 "○○중" / "○○중학교" 인 경우의 1·2·3
 *  - 고1~고3 : 그 외(고/NULL/기타) 1·2·3 또는 명시적 "고3"
 *  - 재수    : 아카 원값 "4"
 *  - 졸업    : 아카 원값 "0"/"5"~"10"/"졸"
 *  - 미정    : NULL / 알 수 없는 값
 */
export const GRADE_VALUES = [
  "초등",
  "중1",
  "중2",
  "중3",
  "고1",
  "고2",
  "고3",
  "재수",
  "졸업",
  "미정",
] as const;
export const GradeSchema = z.enum(GRADE_VALUES);
export type Grade = z.infer<typeof GradeSchema>;

/**
 * 학교급 (초/중/고/기타).
 * derive_school_level(grade_raw, school) 의 도메인. 0041 에서 초 추가.
 * UI 1차 필터(초등/중등/고등 분리)에서 사용.
 */
export const SCHOOL_LEVEL_VALUES = ["초", "중", "고", "기타"] as const;
export const SchoolLevelSchema = z.enum(SCHOOL_LEVEL_VALUES);
export type SchoolLevel = z.infer<typeof SchoolLevelSchema>;

/**
 * 기본 숨김 학년 집합.
 * 정규 운영 학생만 보고 싶을 때 (졸업·미정 제외).
 * `?include_hidden=1` 로 토글.
 */
export const HIDDEN_GRADES_BY_DEFAULT: ReadonlyArray<Grade> = ["졸업", "미정"];

/**
 * '학교 미등록' 으로 간주할 placeholder 학교명 set.
 * 운영자가 학교 정보를 못 적었을 때 ETL 이 받아오는 형태 — 정상 학교명이
 * 아닌 일반어. school IS NULL 과 함께 OR 매칭해 미등록 학생 필터에 사용.
 *
 * 운영 raw 분포 (2026-05-21):
 *   '고' 8,540 / '대학교' 1,122 / '중' 1,068 / '재수' 10 등
 */
export const UNMAPPED_SCHOOL_PATTERNS: ReadonlyArray<string> = [
  "고",
  "고고",
  "고등학교",
  "중",
  "중중",
  "중학교",
  "초",
  "초등",
  "초등학교",
  "대학교",
  "재수",
];

export const StudentStatusSchema = z.enum([
  "재원생",
  "수강이력자",
  "수강 x",
  "탈퇴",
]);

export const SUBJECT_VALUES = [
  "국어",
  "영어",
  "수학",
  "과탐",
  "사탐",
  "컨설팅",
  "기타",
] as const;
export const SubjectSchema = z.enum(SUBJECT_VALUES);

/**
 * 강좌명 접두 코드 필터 — Aca2000 강좌명은 '(종)' 접두를 떼면
 * [연도2자][#|@][R|S][N|Y|D...] 로 시작한다.
 *  - CLASS_MARK_VALUES: 두 번째 기호 (# / @).
 *  - CLASS_KIND_VALUES: 세 번째 글자 (R≈정규 / S≈특강).
 * 매칭은 search_students_by_region RPC(0100) 가 강좌명을 파싱해 처리.
 */
export const CLASS_MARK_VALUES = ["#", "@"] as const;
export const ClassMarkSchema = z.enum(CLASS_MARK_VALUES);
export const CLASS_KIND_VALUES = ["R", "S"] as const;
export const ClassKindSchema = z.enum(CLASS_KIND_VALUES);

/**
 * subjects 필터가 7종 enum 모두 포함되어 있는지 — "조건 없음(전체)" 해석용.
 * 운영자 UX: 7종 다 체크 = 전체 의미. enrollment 0건이거나 classes.subject NULL
 * 인 학생도 포함되도록 backend 가 subjects 필터 미적용으로 정규화.
 */
export function isAllSubjects(subjects: readonly string[]): boolean {
  if (subjects.length !== SUBJECT_VALUES.length) return false;
  const set = new Set(subjects);
  return SUBJECT_VALUES.every((s) => set.has(s));
}

export const AttendanceStatusSchema = z.enum([
  "출석",
  "지각",
  "결석",
  "조퇴",
]);

/**
 * 템플릿 발송 유형 enum.
 * 0059 마이그에서 ALIMTALK 제거 — sendon.kakao API + 사전 등록 템플릿이 필요한
 * 알림톡은 Phase 1 으로 보류. 신규/수정 입력은 SMS / LMS 만 허용.
 */
export const TemplateTypeSchema = z.enum(["SMS", "LMS"]);

export const CampaignStatusSchema = z.enum([
  "임시저장",
  "예약됨",
  "발송중",
  "완료",
  "실패",
  "취소",
]);

export const MessageStatusSchema = z.enum([
  "대기",
  "발송됨",
  "도달",
  "실패",
]);

export const UserRoleSchema = z.enum(["master", "admin", "manager", "viewer"]);

/**
 * 한국 휴대폰 번호 간이 검증.
 * 하이픈 포함 형태와 숫자만 있는 형태 모두 허용.
 * 예: "010-1234-5678", "01012345678"
 */
export const PhoneSchema = z
  .string()
  .min(9)
  .max(13)
  .regex(/^(01[016789])-?\d{3,4}-?\d{4}$/, "올바른 휴대폰 번호 형식이 아닙니다");
