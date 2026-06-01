"use server";

/**
 * 설명회 발송 위저드용 — 그룹 → 학생 id 배열 펼침 Server Action.
 *
 * backend `createSeminarBroadcastAction` 은 `student_ids: string[]` 를 직접 받기 때문에
 * 위저드 Step 4 가 호출 직전 그룹을 학생 id 로 펼쳐서 넘긴다.
 * 발송 대량 round-trip 최적화는 backend `loadAllGroupRecipients` 에 이미 반영되어
 * 본 액션은 그 결과의 id 만 추출해 반환한다.
 *
 * 권한:
 *  - 일반 발송과 동일 — master/admin/manager 'read' (그룹 열람 권한 기준).
 *  - 실제 발송 차단은 `createSeminarBroadcastAction` 안의 권한·분원 가드가 최종.
 *  - dev-seed 면 그룹 mock 으로 펼친다(시연용).
 *
 * 상한:
 *  - 본 액션은 단순 펼침만. 1회 발송 상한(10,000) 위반은 backend 가 차단.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import {
  loadAllGroupRecipients,
} from "@/lib/groups/load-all-group-recipients";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export type ResolveGroupStudentsResult =
  | { status: "success"; student_ids: string[] }
  | { status: "failed"; reason: string };

/**
 * 발송 위저드용 임의 상한 — backend `MAX_INVITATION_RECIPIENTS` 와 같은 값.
 * 그 이상이면 backend 가 'blocked' 로 거부하므로 미리 컷.
 */
const HARD_LIMIT = 10_000;

export async function resolveGroupStudentsAction(
  groupId: string,
): Promise<ResolveGroupStudentsResult> {
  if (typeof groupId !== "string" || groupId.length === 0) {
    return { status: "failed", reason: "그룹 ID 가 올바르지 않습니다" };
  }

  const user = await getCurrentUser();
  if (!user) return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  if (!user.active) {
    return { status: "failed", reason: "비활성 계정입니다" };
  }
  if (!can(user, "read", "group")) {
    return { status: "failed", reason: "그룹 조회 권한이 없습니다" };
  }

  // dev-seed 는 별도 가짜 펼침(시연 모드 본 발송 차단은 backend 측에서 처리).
  if (isDevSeedMode()) {
    return { status: "success", student_ids: [] };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const recipients = await loadAllGroupRecipients(
      supabase,
      groupId,
      HARD_LIMIT,
    );
    return {
      status: "success",
      student_ids: recipients.map((r) => r.id),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "그룹 펼침에 실패했습니다";
    return { status: "failed", reason: msg };
  }
}
