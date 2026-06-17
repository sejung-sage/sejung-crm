"use server";

/**
 * F3 Part B · Compose 4단계 위저드 Server Actions
 *
 * 노출 액션:
 *   - previewAction      : 수신자/비용/최종 본문 미리보기 (dev-seed 도 동작)
 *   - testSendAction     : 본인 번호 테스트 1건 (dev-seed 차단)
 *   - sendNowAction      : 즉시 발송 (dev-seed 차단)
 *   - scheduleAction     : 예약 발송 (dev-seed 차단)
 *
 * 공통 정책:
 *   - 모든 액션은 입력을 Zod 로 재검증.
 *   - sendNow / schedule / testSend 는 권한 검사 (`can(user, 'send', 'campaign', branch)`).
 *   - preview 는 dev-seed 모드에서도 통과 (UI 가 카운트/비용을 계속 보여줘야 함).
 */

import { ZodError } from "zod";
import {
  PreviewInputSchema,
  TestSendInputSchema,
  ComposeFinalSchema,
  type PreviewInput,
  type TestSendInput,
  type ComposeFinal,
} from "@/lib/schemas/compose";
import {
  previewRecipients,
  type PreviewResult,
} from "@/lib/messaging/preview-recipients";
import {
  sendCampaign,
  type SendCampaignResult,
} from "@/lib/messaging/send-campaign";
import { testSend } from "@/lib/messaging/test-send";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadRecipientsByFilters } from "@/lib/groups/load-all-group-recipients";
import { countRecipients } from "@/lib/groups/count-recipients";
import { GroupFiltersSchema } from "@/lib/schemas/group";
import { z } from "zod";

// ─── 결과 타입 ──────────────────────────────────────────────

export type PreviewActionResult =
  | { status: "success"; data: PreviewResult }
  | { status: "failed"; reason: string };

// ─── 공통 헬퍼 ─────────────────────────────────────────────

function zodErrorToReason(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "입력 값이 올바르지 않습니다";
  return first.message || "입력 값이 올바르지 않습니다";
}

/**
 * sendNow / schedule 권한 가드.
 * 필터 기반 발송은 그룹이 없으므로 입력 분원(branch) 기준으로 검사.
 */
async function assertSendPermission(
  branch: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, reason: "로그인 후 이용 가능합니다" };

  if (!can(user, "send", "campaign", branch)) {
    return { ok: false, reason: "본 분원 캠페인 발송 권한이 없습니다" };
  }
  return { ok: true };
}

// ─── previewAction ─────────────────────────────────────────

export async function previewAction(
  input: PreviewInput,
): Promise<PreviewActionResult> {
  // dev-seed 도 통과 — 미리보기는 항상 동작
  let parsed: PreviewInput;
  try {
    parsed = PreviewInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  try {
    const data = await previewRecipients({
      filters: parsed.step1.filters,
      branch: parsed.step1.branch,
      body: parsed.step2.body,
      isAd: parsed.step2.isAd,
      type: parsed.step2.type,
      dedupeByPhone: parsed.step2.dedupeByPhone,
      sendToParent: parsed.step2.sendToParent,
      sendToStudent: parsed.step2.sendToStudent,
      scheduledAt: new Date(),
    });
    return { status: "success", data };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "미리보기 산출에 실패했습니다";
    return { status: "failed", reason };
  }
}

// ─── testSendAction ────────────────────────────────────────

export async function testSendAction(
  input: TestSendInput,
): Promise<SendCampaignResult> {
  let parsed: TestSendInput;
  try {
    parsed = TestSendInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 테스트 발송이 차단됩니다",
    };
  }

  // 권한: campaign send 가 본인 분원으로만 허용되는데, 테스트 발송은 그룹이 없음.
  // 따라서 사용자 본인 분원에 대한 send 권한을 검사.
  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (!can(user, "send", "campaign", user.branch)) {
    return { status: "failed", reason: "캠페인 발송 권한이 없습니다" };
  }

  return await testSend({
    body: parsed.step2.body,
    subject: parsed.step2.subject ?? null,
    type: parsed.step2.type,
    isAd: parsed.step2.isAd,
    toPhone: parsed.toPhone,
  });
}

// ─── sendNowAction ─────────────────────────────────────────

export async function sendNowAction(
  input: ComposeFinal,
): Promise<SendCampaignResult> {
  let parsed: ComposeFinal;
  try {
    parsed = ComposeFinalSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  // scheduleAt 이 들어있으면 sendNow 가 아니라 schedule 로 가도록 명시
  if (parsed.scheduleAt) {
    return {
      status: "failed",
      reason: "예약 발송은 scheduleAction 으로 호출하세요",
    };
  }

  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 발송이 차단됩니다",
    };
  }

  const guard = await assertSendPermission(parsed.step1.branch);
  if (!guard.ok) return { status: "failed", reason: guard.reason };

  return await sendCampaign({
    title: parsed.step3.title,
    filters: parsed.step1.filters,
    branch: parsed.step1.branch,
    templateId: parsed.step2.templateId ?? null,
    body: parsed.step2.body,
    subject: parsed.step2.subject ?? null,
    type: parsed.step2.type,
    isAd: parsed.step2.isAd,
    dedupeByPhone: parsed.step2.dedupeByPhone,
    sendToParent: parsed.step2.sendToParent,
    sendToStudent: parsed.step2.sendToStudent,
    scheduledAt: null,
    isTest: false,
  });
}

// ─── scheduleAction ────────────────────────────────────────

export async function scheduleAction(
  input: ComposeFinal,
): Promise<SendCampaignResult> {
  let parsed: ComposeFinal;
  try {
    parsed = ComposeFinalSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  if (!parsed.scheduleAt) {
    return { status: "failed", reason: "예약 시각이 설정되지 않았습니다" };
  }

  // 과거 시각 방지 + sendon 최소 예약 간격(30분) 검증.
  const scheduledAt = new Date(parsed.scheduleAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { status: "failed", reason: "예약 시각 형식이 올바르지 않습니다" };
  }
  // sendon 제약: 예약은 현재로부터 최소 30분 이후만 가능.
  if (scheduledAt.getTime() < Date.now() + 30 * 60_000) {
    return {
      status: "failed",
      reason: "예약 시각은 지금부터 최소 30분 이후여야 합니다",
    };
  }

  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 예약 발송이 차단됩니다",
    };
  }

  const guard = await assertSendPermission(parsed.step1.branch);
  if (!guard.ok) return { status: "failed", reason: guard.reason };

  return await sendCampaign({
    title: parsed.step3.title,
    filters: parsed.step1.filters,
    branch: parsed.step1.branch,
    templateId: parsed.step2.templateId ?? null,
    body: parsed.step2.body,
    subject: parsed.step2.subject ?? null,
    type: parsed.step2.type,
    isAd: parsed.step2.isAd,
    dedupeByPhone: parsed.step2.dedupeByPhone,
    sendToParent: parsed.step2.sendToParent,
    sendToStudent: parsed.step2.sendToStudent,
    scheduledAt,
    isTest: false,
  });
}

// ─── listMatchedRecipientsAction (체크박스 명단) ──────────────

/** 필터로 매칭된 학생 1명 (체크박스 명단용). phone 은 raw — UI 가 마스킹. */
export interface MatchedRecipient {
  studentId: string;
  name: string;
  /** 학부모 대표번호 (raw, 하이픈 없음). NULL 이면 빈 문자열. */
  parentPhone: string;
  /** 학생 개인번호 (raw, 하이픈 없음). NULL 이면 빈 문자열. */
  studentPhone: string;
}

export type ListMatchedRecipientsResult =
  | { status: "success"; recipients: MatchedRecipient[]; total: number }
  | { status: "failed"; reason: string };

const ListMatchedRecipientsInputSchema = z.object({
  filters: GroupFiltersSchema,
  branch: z.string().trim().min(1, "분원을 선택하세요").max(20),
});
export type ListMatchedRecipientsInput = z.infer<
  typeof ListMatchedRecipientsInputSchema
>;

/**
 * 체크박스 명단 페치 상한. 이 분량까지는 매칭 학생을 전부 내려 UI 가 모두 그린다
 * (운영자 요청: 일부만 말고 전원 표시 + 이름 가나다순). 전체 매칭 수(total)는 별도
 * head 카운트로 얻어, 상한을 넘는 초대형 코호트일 때만 "상위 N명만 표시" 안내를 띄운다.
 *
 * 상한을 둔 이유: 수만 명 코호트를 전부 DOM 으로 그리면 브라우저가 멈춘다. 1만은
 * 분원·학년 단위 코호트를 대부분 덮으면서 렌더가 버티는 선. 발송 자체는 서버가
 * 필터로 다시 펼치므로 이 상한과 무관하다.
 */
const MATCHED_LIST_CAP = 10_000;

/**
 * 필터로 매칭된 학생 명단(상위 일부) + 전체 매칭 수를 반환 (필터 발송의 체크박스 UI 용).
 *
 * - recipients: 매칭 학생 (MATCHED_LIST_CAP 까지 전원), 이름 가나다순 정렬.
 *   발송 경로와 동일한 모집단(분원·탈퇴 가드, exclude 차감)을 1:1 공유한다.
 * - total: 전체 매칭 수. previewAction 과 동일한 countRecipients 로 산출해
 *   "N명 중 M명 선택" 카운트가 미리보기 인원수와 일치한다. (체크 해제 학생은
 *   프런트가 filters.excludeStudentIds 로 실어 다음 미리보기/발송에 반영.)
 *
 * 권한: 입력 branch 기준 send 권한 검사.
 */
export async function listMatchedRecipientsAction(
  input: ListMatchedRecipientsInput,
): Promise<ListMatchedRecipientsResult> {
  let parsed: ListMatchedRecipientsInput;
  try {
    parsed = ListMatchedRecipientsInputSchema.parse(input);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const guard = await assertSendPermission(parsed.branch);
  if (!guard.ok) return { status: "failed", reason: guard.reason };

  if (isDevSeedMode()) {
    // dev-seed 는 Supabase 미사용 — 빈 명단. (미리보기는 별도 dev 경로로 동작.)
    return { status: "success", recipients: [], total: 0 };
  }

  try {
    const supabase = await createSupabaseServerClient();
    // 매칭 명단(상한까지 전원)과 전체 매칭 수를 병렬로. total 은 head 카운트라
    // 상한 초과 코호트에서도 정확한 전체 수를 보여준다.
    const [rows, count] = await Promise.all([
      loadRecipientsByFilters(
        supabase,
        parsed.filters,
        parsed.branch,
        MATCHED_LIST_CAP,
      ),
      countRecipients(parsed.filters, parsed.branch),
    ]);
    const recipients: MatchedRecipient[] = rows
      .map((r) => ({
        studentId: r.id,
        name: r.name,
        parentPhone: (r.parent_phone ?? "").replace(/\D/g, ""),
        studentPhone: (r.phone ?? "").replace(/\D/g, ""),
      }))
      // 이름 가나다순 — 동명이인은 안정적이도록 studentId 로 2차 정렬.
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, "ko-KR") ||
          a.studentId.localeCompare(b.studentId),
      );
    return { status: "success", recipients, total: count.total };
  } catch (e) {
    const reason =
      e instanceof Error ? e.message : "수신자 명단 조회에 실패했습니다";
    return { status: "failed", reason };
  }
}
