/**
 * 분원 상수 (단일 소스 of truth).
 *
 * DB (branch TEXT NOT NULL) 와 Zod (BranchSchema) 는 자유형 텍스트라
 * 제약을 두지 않는다. UI 의 선택지만 이 파일에서 통제한다.
 *
 * 분원 추가·제거 시 이 파일만 수정하면 모든 화면이 동시에 반영된다.
 */

/** 실제 분원 목록 (학생·계정·발송 그룹 생성 시 선택지). */
export const BRANCHES = ["대치", "송도", "반포", "방배"] as const;
export type Branch = (typeof BRANCHES)[number];

/** 필터·툴바용 — "전체" 의사옵션을 맨 앞에 둔다. */
export const BRANCH_FILTER_OPTIONS = ["전체", ...BRANCHES] as const;
export type BranchFilterOption = (typeof BRANCH_FILTER_OPTIONS)[number];
