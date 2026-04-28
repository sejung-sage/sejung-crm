import { z } from "zod";

/**
 * 공통 enum Zod 스키마
 * PRD 섹션 4.1 CHECK 제약과 1:1 대응. DB 와 일치 여부 정기 감사.
 */

export const BranchSchema = z.string().min(1, "분원은 필수입니다");

export const GradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

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
