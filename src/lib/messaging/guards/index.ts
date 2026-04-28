/**
 * 발송 안전 가드 통합.
 *
 * 어댑터 호출 직전 반드시 이 레이어를 거쳐 입력을 변환·검증한다.
 * 가드의 개별 책임:
 *   - insertAdTag           : (광고) prefix 자동 삽입
 *   - insertUnsubscribeFooter: 무료수신거부 080 footer 자동 삽입
 *   - checkQuietHours       : 야간(21~08) 광고 차단
 *   - filterRecipients      : 탈퇴 학생 + 수신거부 번호 제외
 *
 * 이 파일은 단일 진입점(`applyAllGuards`) 을 export. 순수 함수.
 */

import { insertAdTag } from "./insert-ad-tag";
import { insertUnsubscribeFooter } from "./insert-unsubscribe-footer";
import { checkQuietHours } from "./check-quiet-hours";
import {
  filterRecipients,
  type FilterRecipientsResult,
  type Recipient,
} from "./filter-recipients";

export { insertAdTag } from "./insert-ad-tag";
export { insertUnsubscribeFooter } from "./insert-unsubscribe-footer";
export { checkQuietHours } from "./check-quiet-hours";
export type { QuietHoursResult } from "./check-quiet-hours";
export {
  filterRecipients,
  type Recipient,
  type ExcludeReason,
  type FilterRecipientsResult,
} from "./filter-recipients";

export interface ApplyGuardsInput {
  /** 원본 본문(템플릿 치환까지 이미 끝난 상태). */
  body: string;
  /** 광고성 여부. template.is_ad 값을 그대로 전달. */
  isAd: boolean;
  /** 발송 예정 시각. 즉시 발송이면 new Date(). */
  scheduledAt: Date;
  /** 후보 수신자(탈퇴/수신거부 제외 전). */
  recipients: Recipient[];
  /** 수신거부 번호(하이픈 유무 무관). */
  unsubscribedPhones: string[];
  /** 선택: 무료수신거부 안내용 080 번호 override. */
  optOutNumber?: string;
  /** 선택: 야간 차단 판정 타임존(기본 KST). */
  timezone?: string;
}

export interface ApplyGuardsOutput {
  /** (광고) prefix + 무료수신거부 footer 가 반영된 최종 본문. */
  finalBody: string;
  /** 야간 차단 등으로 발송 자체가 불가한지. */
  allowedToSend: boolean;
  /** 차단 사유(allowedToSend=false 일 때만). */
  blockReason?: string;
  /** 발송 대상 목록(제외 적용 후). */
  eligible: Recipient[];
  /** 제외된 목록 + 사유. 관찰성 로그/대시보드용. */
  excluded: FilterRecipientsResult["excluded"];
}

export function applyAllGuards(input: ApplyGuardsInput): ApplyGuardsOutput {
  // 1) 본문 변환: prefix → footer 순서 (prefix 가 포함된 본문에 footer 붙는 형태)
  const withAdTag = insertAdTag(input.body, input.isAd);
  const finalBody = insertUnsubscribeFooter(
    withAdTag,
    input.isAd,
    input.optOutNumber,
  );

  // 2) 야간 차단 판정
  const quiet = checkQuietHours(
    input.scheduledAt,
    input.isAd,
    input.timezone,
  );

  // 3) 수신자 필터
  const { eligible, excluded } = filterRecipients(
    input.recipients,
    input.unsubscribedPhones,
  );

  return {
    finalBody,
    allowedToSend: quiet.allowed,
    blockReason: quiet.reason,
    eligible,
    excluded,
  };
}
