/**
 * 분원별 sendon 발신번호 (단일 소스 of truth).
 *
 * 분원마다 sendon 에 등록·검수 통과한 발신번호가 다르다. 각 분원 번호는 환경변수로
 * 주입하고, 이 파일이 "분원 → 환경변수 키" 매핑과 폴백 규칙을 통제한다.
 *
 * 환경변수 (값은 하이픈 없는 숫자만. sendon 사전 등록·검수 '정상' 번호여야 발송됨):
 *   SENDON_FROM_NUMBER          기본/폴백 (분원 키가 비어 있으면 이 값 사용)
 *   SENDON_FROM_NUMBER_DAECHI   대치  · 예) 025670606  (02-567-0606)
 *   SENDON_FROM_NUMBER_BANPO    반포  · 예) 0262420909 (02-6242-0909)
 *   SENDON_FROM_NUMBER_BANGBAE  방배  · 예) 025326552  (02-532-6552)
 *   SENDON_FROM_NUMBER_SONGDO   송도  · 예) 0328580005 (032-858-0005)
 *
 * 폴백 정책: 분원 키가 비어 있으면 SENDON_FROM_NUMBER 로 폴백한다. 따라서 분원
 * 번호를 아직 안 넣었거나 검수 대기 중이면 기존 단일 번호로 나간다(발송이 막히지
 * 않음). 단 SENDON_FROM_NUMBER 도 비면 null → 호출부(drain/test 등)가 발송을 거부.
 *
 * 주의: 환경변수 키는 ASCII 만 허용(Vercel). 그래서 분원 한글명을 로마자 키에 매핑한다.
 */

import type { Branch } from "./branches";

/** 분원 한글명 → 환경변수 키(ASCII). 새 분원 추가 시 여기만 손대면 된다. */
const BRANCH_FROM_NUMBER_ENV: Record<Branch, string> = {
  대치: "SENDON_FROM_NUMBER_DAECHI",
  반포: "SENDON_FROM_NUMBER_BANPO",
  방배: "SENDON_FROM_NUMBER_BANGBAE",
  송도: "SENDON_FROM_NUMBER_SONGDO",
};

/**
 * 분원별 sendon 계정(USER_ID / API_KEY) 환경변수 키.
 *
 * 분원마다 sendon 계정이 다르면(충전·발신번호가 분원별로 분리) 발송도 그 분원 계정으로
 * 가야 한다. 발신번호와 동일한 폴백 정책: 분원 키가 비어 있으면 기본 SENDON_USER_ID /
 * SENDON_API_KEY 로 폴백한다. 따라서 분원 계정을 아직 안 넣었으면 기존 단일 계정으로
 * 그대로 발송된다(회귀 없음).
 *
 * 환경변수(값은 sendon 콘솔의 로그인 ID / API Key):
 *   SENDON_USER_ID  / SENDON_API_KEY                기본/폴백
 *   SENDON_USER_ID_DAECHI  / SENDON_API_KEY_DAECHI  대치
 *   SENDON_USER_ID_BANPO   / SENDON_API_KEY_BANPO   반포
 *   SENDON_USER_ID_BANGBAE / SENDON_API_KEY_BANGBAE 방배
 *   SENDON_USER_ID_SONGDO  / SENDON_API_KEY_SONGDO  송도
 */
const BRANCH_USER_ID_ENV: Record<Branch, string> = {
  대치: "SENDON_USER_ID_DAECHI",
  반포: "SENDON_USER_ID_BANPO",
  방배: "SENDON_USER_ID_BANGBAE",
  송도: "SENDON_USER_ID_SONGDO",
};
const BRANCH_API_KEY_ENV: Record<Branch, string> = {
  대치: "SENDON_API_KEY_DAECHI",
  반포: "SENDON_API_KEY_BANPO",
  방배: "SENDON_API_KEY_BANGBAE",
  송도: "SENDON_API_KEY_SONGDO",
};

/** 환경변수 값에서 숫자만 추출(하이픈·공백 방어). 빈 값이면 null. */
function digitsOnly(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/[^0-9]/g, "");
  return d.length > 0 ? d : null;
}

/** 환경변수 값 trim. 빈 값이면 undefined. (계정 ID/KEY 용 — 숫자 추출 X) */
function envText(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  return t && t.length > 0 ? t : undefined;
}

/**
 * 분원의 sendon 계정 키를 환경변수에서 해석(분원 키 → 기본 키 폴백).
 * envByBranch 가 분원→env키 매핑, fallbackEnv 가 기본 키 이름.
 */
function resolveBranchEnv(
  branch: string | null | undefined,
  envByBranch: Record<string, string>,
  fallbackEnv: string,
): string | undefined {
  const fallback = envText(process.env[fallbackEnv]);
  if (!branch) return fallback;
  const key = envByBranch[branch];
  if (!key) return fallback;
  return envText(process.env[key]) ?? fallback;
}

/** 분원의 sendon 로그인 ID(USER_ID). 분원 키 없으면 SENDON_USER_ID 폴백. */
export function sendonUserId(branch?: string | null): string | undefined {
  return resolveBranchEnv(branch, BRANCH_USER_ID_ENV, "SENDON_USER_ID");
}

/** 분원의 sendon API Key. 분원 키 없으면 SENDON_API_KEY 폴백. */
export function sendonApiKey(branch?: string | null): string | undefined {
  return resolveBranchEnv(branch, BRANCH_API_KEY_ENV, "SENDON_API_KEY");
}

/**
 * 분원의 sendon 발신번호를 환경변수에서 해석한다.
 *  - branch 의 전용 키(SENDON_FROM_NUMBER_*)가 있으면 그 값.
 *  - 없거나 비어 있으면 SENDON_FROM_NUMBER 로 폴백.
 *  - 둘 다 비면 null → 호출부가 발송을 거부한다.
 *
 * branch 가 없거나(전체/마스터) 알 수 없는 값이면 폴백(SENDON_FROM_NUMBER)을 쓴다.
 */
export function sendonFromNumber(branch?: string | null): string | null {
  const fallback = digitsOnly(process.env.SENDON_FROM_NUMBER);
  if (!branch) return fallback;
  const key = (BRANCH_FROM_NUMBER_ENV as Record<string, string>)[branch];
  if (!key) return fallback;
  return digitsOnly(process.env[key]) ?? fallback;
}
