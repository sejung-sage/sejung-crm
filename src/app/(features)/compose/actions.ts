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
import { getGroup } from "@/lib/groups/get-group";

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
 * 그룹 분원과 사용자 분원 일치 검사 포함.
 */
async function assertSendPermission(
  groupId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, reason: "로그인 후 이용 가능합니다" };

  const group = await getGroup(groupId);
  if (!group) return { ok: false, reason: "존재하지 않는 그룹입니다" };

  if (!can(user, "send", "campaign", group.branch)) {
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
      groupId: parsed.groupId,
      body: parsed.step2.body,
      isAd: parsed.step2.isAd,
      type: parsed.step2.type,
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

  const guard = await assertSendPermission(parsed.step1.groupId);
  if (!guard.ok) return { status: "failed", reason: guard.reason };

  return await sendCampaign({
    title: parsed.step3.title,
    groupId: parsed.step1.groupId,
    templateId: parsed.step2.templateId ?? null,
    body: parsed.step2.body,
    subject: parsed.step2.subject ?? null,
    type: parsed.step2.type,
    isAd: parsed.step2.isAd,
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

  // 과거 시각 방지
  const scheduledAt = new Date(parsed.scheduleAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { status: "failed", reason: "예약 시각 형식이 올바르지 않습니다" };
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return {
      status: "failed",
      reason: "예약 시각은 현재 이후여야 합니다",
    };
  }

  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 예약 발송이 차단됩니다",
    };
  }

  const guard = await assertSendPermission(parsed.step1.groupId);
  if (!guard.ok) return { status: "failed", reason: guard.reason };

  return await sendCampaign({
    title: parsed.step3.title,
    groupId: parsed.step1.groupId,
    templateId: parsed.step2.templateId ?? null,
    body: parsed.step2.body,
    subject: parsed.step2.subject ?? null,
    type: parsed.step2.type,
    isAd: parsed.step2.isAd,
    scheduledAt,
    isTest: false,
  });
}
