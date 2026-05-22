/**
 * 발송 본문 변수 치환 (개인화 토큰).
 *
 * 지원 토큰:
 *   - `{이름}` : 학생 이름 (crm_students.name). null 이면 '학부모님' fallback.
 *   - `{날짜}` : 캠페인 발송 시점 KST 'M월 D일' (예: '5월 22일').
 *               scheduled_at 있으면 그 날짜, 없으면 sent_at 또는 now().
 *
 * 분기 전략 (sendon SDK 스펙 확인 결과):
 *   - `{날짜}` 는 모든 학생에게 동일 → finalBody 생성 시 1회 미리 치환.
 *   - `{이름}` 은 학생별 다름 → sendon batch API 의 `userParameters.replaces` 로
 *     벤더 측 치환에 위임. 본문은 sendon 문법(`#{이름}`) 으로 변환 후 to 배열에
 *     `{phone, name}` 을 함께 실어 보낸다 (drain-campaign 참조).
 *   - 1:1 단건 발송(테스트 발송 등) 에서는 `applyNameToken` 으로 미리 치환.
 *
 * 순수 함수만 export. DB 접근 없음.
 */

/** 본문에 `{이름}` 토큰이 포함되어 있는지. */
export function hasNameToken(body: string): boolean {
  return body.includes("{이름}");
}

/** 본문에 `{날짜}` 토큰이 포함되어 있는지. */
export function hasDateToken(body: string): boolean {
  return body.includes("{날짜}");
}

/**
 * `{날짜}` 토큰을 KST 기준 'M월 D일' 형태로 치환.
 * Intl 로 KST 변환 후 'M월'/'D일' 두 파트만 조합한다 (한국 로케일은 'M월 D일').
 *
 * 모든 수신자가 동일 결과 → batch send 전 1회 호출하면 충분.
 */
export function applyDateToken(body: string, kstDate: Date): string {
  if (!body.includes("{날짜}")) return body;
  const month = kstDate.toLocaleString("ko-KR", {
    month: "long",
    timeZone: "Asia/Seoul",
  });
  const day = kstDate.toLocaleString("ko-KR", {
    day: "numeric",
    timeZone: "Asia/Seoul",
  });
  // 'ko-KR' 의 'long' 월 + 'numeric' 일 = "5월" + "22일" → "5월 22일"
  return body.split("{날짜}").join(`${month} ${day}`);
}

/**
 * `{이름}` 토큰 치환. name 이 null/공백이면 '학부모님' fallback.
 * 단건 발송(테스트 발송) 처럼 sendon userParameters 를 못 쓰는 경우 호출.
 * batch 대량 발송 경로는 `toSendonNameSyntax` 로 변환 후 벤더 측에서 치환한다.
 */
export function applyNameToken(body: string, name: string | null): string {
  if (!body.includes("{이름}")) return body;
  const safe = name?.trim() || "학부모님";
  return body.split("{이름}").join(safe);
}

/**
 * 사용자 친화 토큰 `{이름}` 을 sendon 치환 문법 `#{이름}` 으로 변환.
 *
 * sendon batch API 의 `userParameters.replaces[].src` 는 `#{변수명}` 형식만
 * 인식하므로 (SDK 의 `Replace` 인터페이스 주석 참조), batch 송출 직전 본문을
 * 한 번 변환해서 어댑터에 넘긴다. 토큰이 없는 본문은 그대로 반환.
 *
 * 주의: 이 함수는 치환을 수행하지 않는다 — 실제 치환은 sendon 측에서 수신자별
 * Receiver.name 값으로 이루어진다.
 */
export function toSendonNameSyntax(body: string): string {
  if (!body.includes("{이름}")) return body;
  return body.split("{이름}").join("#{이름}");
}
