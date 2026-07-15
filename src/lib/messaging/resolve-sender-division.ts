/**
 * 발송 시 유효 발신 division(발신 명의) 최종 결정 — 서버 측 안전선.
 *
 * 계정별 발신 명의(sender_division)를 발송 순간에 강제한다. UI 가 보낸 값은
 * 마스터에게만 의미가 있고, 비마스터는 클라이언트 입력을 무시하고 계정에 고정된
 * 명의(user.sender_division)로 귀결시킨다 — 폼 우회·조작 방어의 최종 레이어.
 *
 * 규칙(사용자 확정 "A 잠금, 마스터만 예외"):
 *  - 마스터: 클라이언트가 고른 requested 를 쓰되 발송 분원에서 사용 가능한
 *    division(branchDivisions) 인지 검증. 아니면 본원(DEFAULT_DIVISION).
 *  - 비마스터: requested 무시. user.sender_division 이 발송 분원에서 사용 가능한
 *    값이면 그 값, 아니면 본원. (예: 수학관 계정이 다른 분원으로 발송하면 그
 *    분원엔 수학관이 없으니 본원. 실제로 비마스터는 자기 분원만 발송하므로
 *    대부분 자기 명의로 귀결.)
 *
 * 순수 함수(부수효과 없음) — 테스트 용이. 모든 미지의 입력은 isDivision 으로 방어.
 */

import {
  DEFAULT_DIVISION,
  branchDivisions,
  isDivision,
  type Division,
} from "@/config/divisions";
import type { CurrentUser } from "@/types/database";

export function resolveSenderDivision(
  user: Pick<CurrentUser, "role" | "sender_division">,
  sendBranch: string | null | undefined,
  requested?: Division | null,
): Division {
  const allowed = branchDivisions(sendBranch);

  // 마스터만 클라이언트 입력을 신뢰(단, 발송 분원에서 유효한 값이어야 함).
  if (user.role === "master") {
    if (isDivision(requested) && allowed.includes(requested)) {
      return requested;
    }
    return DEFAULT_DIVISION;
  }

  // 비마스터: 클라이언트 입력 무시 → 계정 고정 명의로 강제.
  const own = user.sender_division;
  if (isDivision(own) && allowed.includes(own)) {
    return own;
  }
  return DEFAULT_DIVISION;
}
