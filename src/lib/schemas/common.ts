import { z } from "zod";

/**
 * 공통 enum Zod 스키마
 * PRD 섹션 4.1 CHECK 제약과 1:1 대응. DB 와 일치 여부 정기 감사.
 */

export const BranchSchema = z.string().min(1, "분원은 필수입니다");

/**
 * 학년 정규화 enum (9종).
 * 0012 마이그레이션에서 자유형식 TEXT → enum 으로 전환됨.
 *  - 중1/중2/중3 : 학교명이 "○○중" / "○○중학교" 로 끝나는 경우의 1·2·3
 *  - 고1/고2/고3 : 그 외(고/NULL/기타) 1·2·3 또는 명시적 "고3"
 *  - 재수      : 아카 원값 "4"
 *  - 졸업      : 아카 원값 "0"/"5"~"10"/"졸" (장기 재수와 통합)
 *  - 미정      : NULL / 알 수 없는 값 (방어적 분류)
 */
export const GRADE_VALUES = [
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
 * 학교급 (중/고/기타).
 * derive_school_level(grade_raw, school) 의 도메인.
 * UI 1차 필터(중등/고등 분리)에서 사용.
 */
export const SCHOOL_LEVEL_VALUES = ["중", "고", "기타"] as const;
export const SchoolLevelSchema = z.enum(SCHOOL_LEVEL_VALUES);
export type SchoolLevel = z.infer<typeof SchoolLevelSchema>;

/**
 * 기본 숨김 학년 집합.
 * 정규 운영 학생만 보고 싶을 때 (졸업·미정 제외).
 * `?include_hidden=1` 로 토글.
 */
export const HIDDEN_GRADES_BY_DEFAULT: ReadonlyArray<Grade> = ["졸업", "미정"];

export const TrackSchema = z.enum(["문과", "이과"]);

export const StudentStatusSchema = z.enum([
  "재원생",
  "수강이력자",
  "신규리드",
  "탈퇴",
]);

export const SubjectSchema = z.enum(["수학", "국어", "영어", "탐구"]);

export const AttendanceStatusSchema = z.enum([
  "출석",
  "지각",
  "결석",
  "조퇴",
]);

export const TemplateTypeSchema = z.enum(["SMS", "LMS", "ALIMTALK"]);

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
