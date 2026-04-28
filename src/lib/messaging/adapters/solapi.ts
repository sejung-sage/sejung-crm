/**
 * 솔라피(SOLAPI) 어댑터.
 *
 * MVP 1순위 실구현 대상. 가격 우위(SMS 8원 / LMS 14원 / 알림톡 13원).
 *
 * Part A:
 *   - `mode: 'mock'` 에서는 실제 HTTP 호출 없이 고정 응답.
 *
 * Part B (현재):
 *   - `mode: 'live'` 에서 SolapiMessageService 로 실제 송출.
 *   - `send()` 는 1건 발송 시 SDK 의 `send([message])` 호출.
 *     SDK 응답 (`DetailGroupMessageResponse`) 에서 messageId / 실패 사유를 추출.
 *   - 알림톡(ALIMTALK) 은 `kakaoOptions.pfId` + `kakaoOptions.templateId` 필수.
 *     본 어댑터는 단순 메시지 전송만 다루므로 templateId 가 없으면
 *     "알림톡 템플릿 ID 가 설정되지 않았습니다" 한글 안내로 즉시 failed 반환.
 *     (Phase 1: 사전 등록된 알림톡 템플릿 ID 를 호출자가 전달)
 *
 * 보안 (CLAUDE.md 규약 #9):
 *   - API Key / Secret / 발신번호 / PFID 는 인자로 주입받음. 본 파일에서 env 직접 접근 금지.
 *   - 어떠한 로그/에러 메시지에도 KEY/SECRET 노출 금지. 외부 SDK 가 throw 하는
 *     Error 의 message 만 추출해 한글 래핑하여 사용한다.
 *
 * 정책 가드([광고] prefix / 080 footer / 야간 차단 / 수신거부 제외)는
 * 어댑터 상위 레이어(`guards/`) 책임. 어댑터는 단순 송출.
 */

import { randomUUID } from "node:crypto";
import { SolapiMessageService } from "solapi";
import type {
  AdapterMode,
  SmsAdapter,
  SmsSendRequest,
  SmsSendResult,
  SmsStatusQueryResult,
  SmsType,
} from "./types";

/**
 * mock 모드 단가 — 솔라피 실 단가 기준 (2026-04 기준).
 * 실제 청구는 live 모드에서 벤더 응답 cost 를 사용.
 */
const SOLAPI_MOCK_UNIT_COST: Record<SmsType, number> = {
  SMS: 8,
  LMS: 14,
  ALIMTALK: 13,
};

export interface SolapiAdapterOptions {
  mode: AdapterMode;
  /** live 모드 전용. mock 모드에서는 optional. */
  apiKey?: string;
  /** live 모드 전용. mock 모드에서는 optional. */
  apiSecret?: string;
  /** 사전 등록·통신사 검증된 발신번호. live 모드에서 필수. */
  fromNumber?: string;
  /** 알림톡 발송 시 카카오 비즈채널 PFID. 미설정이면 알림톡 호출 시 즉시 failed. */
  kakaoPfid?: string;
}

export function createSolapiAdapter(opts: SolapiAdapterOptions): SmsAdapter {
  const mode: AdapterMode = opts.mode;

  return {
    name: "solapi",

    async send(req: SmsSendRequest): Promise<SmsSendResult> {
      if (mode === "mock") {
        return sendMock(req);
      }
      return await sendLive(req, opts);
    },

    async queryStatus(
      vendorMessageId: string,
    ): Promise<SmsStatusQueryResult> {
      if (mode === "mock") {
        return {
          status: "delivered",
          deliveredAt: new Date().toISOString(),
        };
      }
      // live 상태 조회는 Phase 1 (Webhook + getMessages 폴링).
      return {
        status: "queued",
        failedReason: `상태 조회 미구현 (id=${vendorMessageId})`,
      };
    },
  };
}

// ─── live 발송 ──────────────────────────────────────────────

async function sendLive(
  req: SmsSendRequest,
  opts: SolapiAdapterOptions,
): Promise<SmsSendResult> {
  if (!opts.apiKey || !opts.apiSecret) {
    return {
      status: "failed",
      reason: "솔라피 API 인증 정보가 설정되지 않았습니다",
    };
  }
  if (!opts.fromNumber) {
    return {
      status: "failed",
      reason: "솔라피 발신번호가 설정되지 않았습니다",
    };
  }

  // 알림톡 호출 시 PFID 필수
  if (req.type === "ALIMTALK" && !opts.kakaoPfid) {
    return {
      status: "failed",
      reason: "알림톡 발송에 필요한 PFID(카카오 비즈채널 ID)가 설정되지 않았습니다",
    };
  }

  // 알림톡은 사전 등록된 템플릿 ID 가 필요한데 본 어댑터의 SmsSendRequest 에는
  // 템플릿 ID 가 노출되지 않음. Phase 1 에서 SmsSendRequest 확장 필요.
  if (req.type === "ALIMTALK") {
    return {
      status: "failed",
      reason:
        "알림톡 발송은 사전 등록된 템플릿 ID 가 필요합니다 (Phase 1 지원 예정)",
    };
  }

  let service: SolapiMessageService;
  try {
    service = new SolapiMessageService(opts.apiKey, opts.apiSecret);
  } catch {
    return {
      status: "failed",
      reason: "솔라피 클라이언트 초기화에 실패했습니다",
    };
  }

  // SDK 메시지 형식 구성. 한 건만 보내므로 messages 배열에 1개만.
  // type 필드: SMS / LMS 는 그대로, 알림톡은 ATA.
  const sdkType = req.type === "SMS" ? "SMS" : req.type === "LMS" ? "LMS" : "ATA";

  const messagePayload: Record<string, unknown> = {
    to: req.to,
    from: opts.fromNumber,
    text: req.body,
    type: sdkType,
  };
  if (req.subject !== null && req.type !== "SMS") {
    messagePayload.subject = req.subject;
  }

  try {
    // SDK 의 send 시그니처는 RequestSendMessagesSchema (배열 또는 단일).
    // 타입 호환성을 위해 unknown cast — 외부 SDK 의 깊은 schema 를 우리쪽에서
    // 그대로 만족시키기 어렵고, 실패 시 try/catch 로 한글 래핑한다.
    const response = (await (
      service.send as unknown as (
        m: unknown,
      ) => Promise<{
        groupInfo?: { groupId?: string };
        messageList?: { messageId?: string; statusCode?: string }[];
        failedMessageList?: {
          to?: string;
          statusCode?: string;
          statusMessage?: string;
        }[];
      }>
    )([messagePayload])) ?? {};

    const failed = response.failedMessageList ?? [];
    if (failed.length > 0) {
      const first = failed[0];
      const reason = `솔라피 접수 실패 (코드 ${first?.statusCode ?? "?"})`;
      return { status: "failed", reason };
    }

    const list = response.messageList ?? [];
    const first = list[0];
    const messageId =
      first?.messageId ?? response.groupInfo?.groupId ?? `solapi-${randomUUID()}`;

    // 솔라피 응답 cost 가 일관되지 않으므로 자체 단가표 사용.
    const cost = SOLAPI_MOCK_UNIT_COST[req.type];

    return {
      status: "queued",
      vendorMessageId: messageId,
      cost,
    };
  } catch (e: unknown) {
    // 솔라피 SDK 는 failedMessageList 가 있어도 throw 함. 에러 객체 안의
    // statusCode / statusMessage 를 우선 추출해서 운영자가 거절 사유를 알 수 있게.
    const candidate = e as {
      failedMessageList?: unknown;
    };
    if (Array.isArray(candidate.failedMessageList) && candidate.failedMessageList.length > 0) {
      const first = candidate.failedMessageList[0] as {
        statusCode?: unknown;
        statusMessage?: unknown;
      };
      const code = typeof first?.statusCode === "string" ? first.statusCode : "?";
      const sdkMsg = typeof first?.statusMessage === "string" ? first.statusMessage : "";
      return {
        status: "failed",
        reason: sdkMsg
          ? `솔라피 접수 거절 (코드 ${code}): ${sanitizeErrorMessage(sdkMsg)}`
          : `솔라피 접수 거절 (코드 ${code})`,
      };
    }

    const raw = e instanceof Error ? e.message : "";
    const safe = sanitizeErrorMessage(raw);
    return {
      status: "failed",
      reason: safe ? `솔라피 발송 실패: ${safe}` : "솔라피 발송에 실패했습니다",
    };
  }
}

/**
 * 외부 에러 메시지에서 민감 정보 제거.
 * - "apiKey", "apiSecret", "Bearer " 등 키워드 주변 문자열을 마스킹.
 */
function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "";
  let out = msg.slice(0, 200); // 길이 제한
  out = out.replace(/(api[_-]?key)[^\s,;]+/gi, "$1=***");
  out = out.replace(/(api[_-]?secret)[^\s,;]+/gi, "$1=***");
  out = out.replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1***");
  return out;
}

// ─── mock 발송 ──────────────────────────────────────────────

/**
 * mock 응답 생성. 항상 성공을 반환하도록 구성.
 * 필요 시 env 플래그로 확률적 실패를 도입할 수 있으나 MVP 에선 단순화.
 */
function sendMock(req: SmsSendRequest): SmsSendResult {
  const cost = SOLAPI_MOCK_UNIT_COST[req.type];
  const vendorMessageId = `mock-solapi-${randomUUID()}`;
  return {
    status: "queued",
    vendorMessageId,
    cost,
  };
}
