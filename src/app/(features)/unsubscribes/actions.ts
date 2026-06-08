"use server";

/**
 * 수신거부 관리 페이지 Server Actions.
 *
 * 조회는 RLS(읽기 전체)에 위임 — 권한 가드는 페이지(server component)가
 * master/admin 으로 막는다. 등록/해제는 students/actions 의 기존 액션 재사용:
 *   - addUnsubscribeAction: 로그인 필요 (게이팅은 UI 책임)
 *   - removeUnsubscribeAction: master 전용 (서버에서 역할 재확인)
 *
 * 페이지가 한 곳에서 import 하도록 두 액션을 편의 재노출.
 */

import {
  listUnsubscribes,
  type UnsubscribeRow,
} from "@/lib/messaging/list-unsubscribes";

/**
 * 수신거부 목록 조회. search 가 문자열 아니면 "" 로 정규화.
 * 실패 시 failed 로 감싸 UI 가 빈 표 fallback 을 결정.
 *
 * ⚠️ "use server" 파일은 async 함수만 export 가능 — 타입 export·재노출 금지.
 *    반환 타입은 인라인, 등록/해제(addUnsubscribeAction/removeUnsubscribeAction)는
 *    호출부가 @/app/(features)/students/actions 에서 직접 import 한다(단일 소스).
 */
export async function listUnsubscribesAction(
  search: unknown,
): Promise<
  | { status: "success"; data: UnsubscribeRow[] }
  | { status: "failed"; reason: string }
> {
  const term = typeof search === "string" ? search : "";
  try {
    const data = await listUnsubscribes(term);
    return { status: "success", data };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "수신거부 목록 조회 실패";
    return { status: "failed", reason };
  }
}
