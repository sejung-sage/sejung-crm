/**
 * 발신 division(발신 정체성) 상수 (단일 소스 of truth).
 *
 * 같은 분원(branch)·같은 sendon 계정을 쓰면서도 문자를 여러 발신 정체성으로
 * 보낼 수 있게 하는 축이다. 예: 대치분원은 "세정학원"(본원)과 "세정학원 수학관"
 * 두 정체성으로 발송한다 — 계정은 같고 발신번호·표시명만 다르다.
 *
 * 2축 모델: branch 는 sendon 계정(USER_ID/API_KEY)을 결정(기존 그대로),
 * division 은 발신번호(sender-numbers.ts)와 표시 브랜드명(insert-ad-tag.ts)을 결정.
 *
 * 분원 추가·division 추가 시 이 파일만 수정하면 선택지·검증이 동시에 반영된다.
 */

import type { Branch } from "./branches";

/** 발신 division 목록. 본원=기본, 수학관=대치 수학관(향후 다른 분원 확장 가능). */
export const DIVISIONS = ["본원", "수학관"] as const;
export type Division = (typeof DIVISIONS)[number];

/** 기본 division. NULL/미지정은 항상 본원으로 해석한다. */
export const DEFAULT_DIVISION: Division = "본원";

/**
 * 분원별 사용 가능한 division 목록.
 * 미등록 분원은 기본 [본원] 만. 대치는 본원 + 수학관.
 * 향후 송도 수학관 등은 여기에 분원 키를 추가하면 된다.
 */
const BRANCH_DIVISIONS: Partial<Record<Branch, readonly Division[]>> = {
  대치: ["본원", "수학관"],
};

/**
 * 분원 → 선택 가능한 division 목록. 미등록/없음이면 [본원] 기본.
 * UI 의 division 선택지와 검증이 이 함수를 단일 소스로 쓴다.
 */
export function branchDivisions(branch?: string | null): Division[] {
  if (!branch) return [DEFAULT_DIVISION];
  const list = (BRANCH_DIVISIONS as Record<string, readonly Division[]>)[branch];
  return list ? [...list] : [DEFAULT_DIVISION];
}

/**
 * 외부 입력(Zod·폼·쿼리)이 유효한 Division 인지 좁힘 검증.
 * null/undefined/미지의 값은 false → 호출부가 기본(본원)으로 대체할 수 있다.
 */
export function isDivision(v: unknown): v is Division {
  return typeof v === "string" && (DIVISIONS as readonly string[]).includes(v);
}
