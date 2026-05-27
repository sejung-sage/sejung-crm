/**
 * F3 · 동일번호 1회 발송(중복 번호 dedupe) collapse 로직.
 *
 * 같은 학부모 번호로 묶인 형제 N명을 1건으로 합쳐 발송하기 위한 순수 함수.
 *
 * 규약 (architect 계약):
 *   - collapse 는 발송 안전 가드(`applyAllGuards`) 통과 **직후** eligible 배열에만 적용.
 *     가드(탈퇴/수신거부/야간/광고삽입)는 collapse 와 독립이며 절대 약화하지 않는다.
 *   - dedupe 기준은 정규화 번호(하이픈 등 비숫자 제거된 `phone`).
 *     호출자는 이미 `\D` 제거된 phone 을 넘긴다고 가정한다.
 *   - 같은 번호 그룹에서 **첫 row 만 유지**한다. 입력 배열은
 *     `loadAllGroupRecipients` 가 `registered_at DESC` 순으로 반환하므로,
 *     그 그룹의 최상위(가장 최근 등록 학생)가 대표로 남는다.
 *   - dedupe OFF 면 collapse 미적용(입력을 그대로 통과 — 기존 동작 동일).
 *   - 개인화({이름}) 와 dedupe 는 상호배타(Zod refine 이 강제)이므로, dedupe ON
 *     시점에는 본문에 {이름} 이 없음이 보장된다. 따라서 어느 형제가 대표로
 *     남든 이름 충돌이 발생하지 않는다.
 *
 * 불변식: collapsed = targetStudents - actualMessages (>= 0).
 *
 * 순수 함수. 외부 IO 없음.
 */

import type { DedupeCounts } from "@/types/messaging";

/** collapse 입력/출력 수신자 최소 형태. studentId/phone/name 만 사용. */
export interface DedupeRecipient {
  studentId: string | null;
  /** 하이픈 없는 정규화 번호(호출자가 `\D` 제거 책임). */
  phone: string;
  name: string;
}

export interface CollapseResult<T extends DedupeRecipient> {
  /** dedupe 적용 후 실제 발송할 수신자 목록. dedupe OFF 면 입력 그대로. */
  recipients: T[];
  /** 카운트 계약(`DedupeCounts`). 비용·UI 표시의 단일 소스. */
  counts: DedupeCounts;
}

/**
 * eligible 수신자 배열을 정규화 번호 기준으로 collapse.
 *
 * @param eligible  가드 통과 후 발송 후보 (registered_at DESC 순 가정).
 * @param dedupeByPhone  campaign.dedupe_by_phone. false 면 collapse 미적용.
 */
export function collapseByPhone<T extends DedupeRecipient>(
  eligible: T[],
  dedupeByPhone: boolean,
): CollapseResult<T> {
  const targetStudents = eligible.length;

  if (!dedupeByPhone) {
    return {
      recipients: eligible,
      counts: {
        dedupeApplied: false,
        targetStudents,
        actualMessages: targetStudents,
        collapsed: 0,
      },
    };
  }

  // 같은 번호 그룹에서 첫 row 만 유지. 입력 순서 보존(Map 삽입 순서).
  const seen = new Set<string>();
  const recipients: T[] = [];
  for (const r of eligible) {
    const key = r.phone;
    // 빈 번호는 dedupe 키로 부적합 — 그대로 통과시키되 합치지 않는다.
    // (정상 경로에선 호출자가 phone 없는 row 를 이미 제거한다.)
    if (!key) {
      recipients.push(r);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(r);
  }

  const actualMessages = recipients.length;
  return {
    recipients,
    counts: {
      dedupeApplied: true,
      targetStudents,
      actualMessages,
      collapsed: targetStudents - actualMessages,
    },
  };
}
