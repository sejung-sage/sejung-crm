/**
 * 수신자 목록 필터 가드.
 *
 * 제외 규칙(사용자 확정 · MVP Phase 0):
 *   1) `status === '탈퇴'` 학생은 제외.
 *   2) `phone` 이 수신거부 목록에 있는 학생은 제외.
 *      - 비교는 **하이픈 제거된 숫자 문자열** 기준으로 정규화 후 수행.
 *
 * "최근 3회 수신자 제외" 는 Phase 1 로 미룸 (여기서 다루지 않음).
 *
 * 이 함수는 순수 함수. 외부 IO 없음.
 */

export interface Recipient {
  /** dev-seed 학생 id ("dev-..." 포함). 비회원 즉석 발송은 null. */
  studentId: string | null;
  /** 하이픈 없는 11자리 휴대폰(e.g. "01012345678"). 호출자가 정규화 책임. */
  phone: string;
  name: string;
  /** 학생 상태(재원생/수강이력자/신규리드/탈퇴 등). */
  status: string;
}

export type ExcludeReason = "탈퇴학생" | "수신거부";

export interface FilterRecipientsResult {
  eligible: Recipient[];
  excluded: { recipient: Recipient; reason: ExcludeReason }[];
}

export function filterRecipients(
  recipients: Recipient[],
  unsubscribedPhones: string[],
): FilterRecipientsResult {
  // 하이픈 제거 정규화 후 Set 으로 빠른 조회.
  const unsubSet = new Set<string>(
    unsubscribedPhones
      .map((p) => normalizePhone(p))
      .filter((p): p is string => p !== null && p.length > 0),
  );

  const eligible: Recipient[] = [];
  const excluded: FilterRecipientsResult["excluded"] = [];

  for (const r of recipients) {
    if (r.status === "탈퇴") {
      excluded.push({ recipient: r, reason: "탈퇴학생" });
      continue;
    }
    const norm = normalizePhone(r.phone);
    if (norm && unsubSet.has(norm)) {
      excluded.push({ recipient: r, reason: "수신거부" });
      continue;
    }
    eligible.push(r);
  }

  return { eligible, excluded };
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
