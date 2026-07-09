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
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  buildSearchRecipientsParams,
  callSearchRecipientsBulk,
} from "@/lib/groups/search-recipients-rpc";
import { GroupFiltersSchema } from "@/lib/schemas/group";
import {
  SCHEDULE_MIN_LEAD_MS,
  SCHEDULE_MIN_LEAD_LABEL,
} from "@/lib/messaging/schedule-window";
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

  // 미리보기는 내부적으로 service 클라이언트(RLS 우회)로 조회하므로, 실모드에서는
  // 분원 발송 권한을 여기서 검사한다(dev-seed 는 Supabase 미사용이라 통과).
  if (!isDevSeedMode()) {
    const guard = await assertSendPermission(parsed.step1.branch);
    if (!guard.ok) return { status: "failed", reason: guard.reason };
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
    branch: parsed.branch,
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

  // 과거 시각 방지 + 최소 리드타임 검증.
  const scheduledAt = new Date(parsed.scheduleAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { status: "failed", reason: "예약 시각 형식이 올바르지 않습니다" };
  }
  // 최소 리드타임: 5분(5~30분은 자체 지연발송, 30분 이상은 sendon 네이티브 예약).
  if (scheduledAt.getTime() < Date.now() + SCHEDULE_MIN_LEAD_MS) {
    return {
      status: "failed",
      reason: `예약 시각은 지금부터 최소 ${SCHEDULE_MIN_LEAD_LABEL} 이후여야 합니다`,
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
 * 체크박스 명단 페치 상한(안전선). search_recipients_bulk 가 매칭 전원을 1회 호출로
 * 반환하고(0095), 프런트는 가상 스크롤로 렌더하므로 1만 명 너머도 전부 보여준다.
 * 분원 최대 코호트(대치 ~64k)도 덮도록 10만으로 둔다. 이 선을 넘는 초대형 코호트만
 * "상위 N명만 표시" 안내가 뜬다(현실적으로 도달 안 함).
 */
const MATCHED_LIST_CAP = 100_000;

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
    // 권한은 위 assertSendPermission 에서 이미 검사했으므로 조회는 service 클라이언트로
    // (RLS 우회). 사용자 세션(RLS)으로 RPC 를 호출하면 RLS 정책이 함수 안에서 비효율적
    // 으로 평가돼 서버 액션이 지연/타임아웃되는 문제가 있어 service 로 일원화한다.
    // 분원 격리는 RPC 의 p_branch 가 보장(타 분원 학생은 매칭되지 않음).
    const supabase = createSupabaseServiceClient();
    // 매칭 전원 + 전체 수를 search_recipients_bulk 1회 호출로(jsonb, max_rows 미적용).
    // 학부모 번호 없는 학생도 명단엔 보여야 하므로 requireParentPhone=false.
    // excludeUnsubscribed=true — 수신거부 번호는 명단에서 번호 단위로 가려지고, 보낼 수
    // 있는 번호가 하나도 없는 학생은 행 자체가 빠진다(0106).
    const { rows, total } = await callSearchRecipientsBulk(
      supabase,
      buildSearchRecipientsParams(parsed.filters, parsed.branch, false, true),
      MATCHED_LIST_CAP,
    );
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
    return { status: "success", recipients, total };
  } catch (e) {
    const reason =
      e instanceof Error ? e.message : "수신자 명단 조회에 실패했습니다";
    return { status: "failed", reason };
  }
}
