/**
 * 관리자 비밀번호 재설정용 임시 평문 생성기.
 *
 * 정책:
 *  - 12자 기본 길이.
 *  - 영문 대소문자 + 숫자 + 안전 특수문자(시각적 헷갈림이 적은 것만).
 *    제외: 0/O, 1/l/I, ` " ' \ / 등 인쇄·구술 시 혼동·이스케이프 위험.
 *  - 각 문자 종류 최소 1개 보장 (서버 Zod 는 길이만 검증하지만,
 *    사용자가 임시값을 직접 보고 외워 입력해야 하므로 가독성·강도 동시 확보).
 *  - 난수원: Web Crypto API `crypto.getRandomValues`. Math.random 금지.
 *
 * 이 함수는 **클라이언트 컴포넌트 전용** 이다 (Server Action 에서 호출 X).
 * 평문은 절대 서버 로그/DB 에 남기지 않는다.
 */

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I, O 제외
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // l 제외
const DIGIT = "23456789"; // 0, 1 제외
const SYMBOL = "!@#$%^&*-_=+?";

const ALL = UPPER + LOWER + DIGIT + SYMBOL;

function pickFrom(charset: string): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const idx = buf[0]! % charset.length;
  return charset[idx]!;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  // Fisher-Yates with crypto.getRandomValues
  for (let i = arr.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0]! % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * 12자(기본) 임시 비밀번호 생성. 각 문자 종류 최소 1개 포함.
 */
export function generateTempPassword(length: number = 12): string {
  if (length < 8) length = 8;
  if (length > 32) length = 32;

  const chars: string[] = [
    pickFrom(UPPER),
    pickFrom(LOWER),
    pickFrom(DIGIT),
    pickFrom(SYMBOL),
  ];
  while (chars.length < length) {
    chars.push(pickFrom(ALL));
  }
  return shuffleInPlace(chars).join("");
}
