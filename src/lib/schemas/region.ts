import { z } from "zod";

/**
 * 학교 → 지역 매핑 (school_regions) Upsert 입력 스키마.
 *
 * admin UI 에서 "학교 → 지역" 매핑을 신규 추가하거나 수정할 때 사용.
 * Server Action 은 이 스키마를 통과한 입력을 받아 Supabase
 * `INSERT ... ON CONFLICT (school) DO UPDATE` 로 멱등 처리한다.
 *
 * 컬럼 의미:
 *  - school : 학교명 (PK). students.school 과 정확 일치하는 자연키.
 *  - region : 지역명. 운영자가 자유 입력 (예: "강남구", "분당구" 등 신규 가능).
 *
 * 검증 규칙:
 *  - 둘 다 trim 후 길이 ≥ 1 (DB 의 nonblank CHECK 와 동일 의도).
 *  - school 50자 / region 30자 상한 — UI 입력창 길이 가드.
 */
export const SchoolRegionUpsertSchema = z.object({
  /** 학교명 PK (예: "휘문고"). students.school 과 정확 일치. */
  school: z.string().trim().min(1, "학교명은 필수입니다").max(50),
  /** 지역명 (예: "강남구"). 자유 텍스트. */
  region: z.string().trim().min(1, "지역명은 필수입니다").max(30),
});

export type SchoolRegionUpsert = z.infer<typeof SchoolRegionUpsertSchema>;
