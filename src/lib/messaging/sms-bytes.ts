/**
 * EUC-KR 기준 문자 본문 바이트 카운터.
 *
 * 규약:
 *   - 한글 완성형(가~힣, U+AC00~U+D7A3)·한글 자모·CJK 공통 = 2바이트
 *   - ASCII (U+0000~U+007F) = 1바이트
 *   - 기타 BMP 문자(라틴 확장·기호·히라가나/가타카나 등) = 보수적으로 2바이트
 *   - 서로게이트 페어(이모지 등 U+10000 이상) = 보수적으로 4바이트
 *
 * `for...of` 로 코드포인트 단위 순회해 JS UTF-16 서로게이트 페어를 안전히 분리.
 * 실 벤더(문자나라)의 EUC-KR 미지원 문자(예: 이모지)는 벤더측에서 LMS 로 강등되거나
 * 거절될 수 있으나, 계산은 "초과 여부" 판정에 유리하도록 보수적으로 잡는다.
 *
 * 이 파일은 순수 함수만. 외부 IO / 환경변수 / Supabase 접근 금지.
 */

import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";

/** 한글 완성형(가~힣) 범위. */
const HANGUL_SYLLABLES_START = 0xac00;
const HANGUL_SYLLABLES_END = 0xd7a3;
/** 한글 자모 (U+1100~U+11FF). */
const HANGUL_JAMO_START = 0x1100;
const HANGUL_JAMO_END = 0x11ff;
/** 한글 호환 자모 (U+3130~U+318F). */
const HANGUL_COMPAT_JAMO_START = 0x3130;
const HANGUL_COMPAT_JAMO_END = 0x318f;
/** CJK 통합 한자. */
const CJK_UNIFIED_START = 0x4e00;
const CJK_UNIFIED_END = 0x9fff;

/**
 * EUC-KR 기준 바이트 카운트. 순수 함수.
 *
 * 참고:
 *   - 비어있거나 null-like 입력은 0 반환.
 *   - BMP 밖 문자(이모지, U+10000~)는 4바이트로 추정 → 과대평가로 안전 쪽.
 *   - 제어문자(탭/개행 등)는 ASCII 1바이트로 계산.
 */
export function countEucKrBytes(text: string): number {
  if (!text) return 0;
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;

    // 서로게이트 페어(이모지 등 BMP 외) → 4바이트 추정.
    if (cp > 0xffff) {
      bytes += 4;
      continue;
    }

    // ASCII 포함 제어문자(0x00~0x7F) → 1바이트.
    if (cp < 0x80) {
      bytes += 1;
      continue;
    }

    // 한글/CJK → 2바이트.
    if (
      (cp >= HANGUL_SYLLABLES_START && cp <= HANGUL_SYLLABLES_END) ||
      (cp >= HANGUL_JAMO_START && cp <= HANGUL_JAMO_END) ||
      (cp >= HANGUL_COMPAT_JAMO_START && cp <= HANGUL_COMPAT_JAMO_END) ||
      (cp >= CJK_UNIFIED_START && cp <= CJK_UNIFIED_END)
    ) {
      bytes += 2;
      continue;
    }

    // 기타 BMP(라틴 확장·문장부호·CJK 기호 등) → 보수적으로 2바이트.
    bytes += 2;
  }
  return bytes;
}

/**
 * 유형별 바이트 한도 초과 여부.
 * 한도 **정확히 같은 경우는 허용**(허용 경계 닫힘).
 */
export function exceedsLimit(
  text: string,
  type: TemplateTypeLiteral,
): boolean {
  return countEucKrBytes(text) > BYTE_LIMITS[type];
}

/**
 * 유형별 바이트 진행률.
 * `ratio` 는 0 이상 실수. 1 초과 가능(초과 경고 표시에 활용).
 */
export function byteProgress(
  text: string,
  type: TemplateTypeLiteral,
): { bytes: number; limit: number; ratio: number } {
  const bytes = countEucKrBytes(text);
  const limit = BYTE_LIMITS[type];
  const ratio = limit > 0 ? bytes / limit : 0;
  return { bytes, limit, ratio };
}
