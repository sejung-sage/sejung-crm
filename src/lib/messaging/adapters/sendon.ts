/**
 * sendon 어댑터.
 *
 * 운영 단일 벤더. 공식 SDK `@alipeople/sendon-sdk-typescript` 사용.
 *
 * 인증:
 *   - id      : 콘솔 로그인 ID (SENDON_USER_ID)
 *   - apikey  : 콘솔 → 마이페이지 → 개발자 센터 → API KEY 관리 (SENDON_API_KEY)
 *
 * 환경변수 (live 모드 활성 시 필수):
 *   SMS_PROVIDER         = "sendon"  (호환성 — 코드는 항상 sendon)
 *   SMS_ADAPTER_MODE     = "live"
 *   SENDON_USER_ID       = sendon 콘솔 사용자 ID
 *   SENDON_API_KEY       = sendon API Key
 *   SENDON_FROM_NUMBER   = 사전 등록 발신번호 (하이픈 X)
 *
 * 보안 (CLAUDE.md 규약 #9):
 *   - id / apikey / 발신번호는 인자로 주입 (env 직접 접근 금지).
 *   - 로그/에러 메시지에 KEY 노출 금지 → `sanitizeErrorMessage` 통과 후 사용.
 *
 * 정책 가드([광고] prefix / 080 footer / 야간 차단 / 수신거부 제외)는 어댑터
 * 상위 레이어(`guards/`) 책임. 어댑터는 단순 송출.
 *
 * 알림톡(ALIMTALK):
 *   sendon SDK 는 `kakao.send` 별도 API + 사전 등록 템플릿 ID/PFID 가 필수.
 *   본 어댑터의 SmsSendRequest 에 그 메타가 없어 현재는 명시적 failed 반환
 *   (Phase 1 — 호출자 측 SmsSendRequest 확장 + sendon.kakao 분기 작업).
 */

import { randomUUID } from "node:crypto";
import {
  Sendon,
  SmsMessageType,
  type SendMessageRequestDto,
} from "@alipeople/sendon-sdk-typescript";
import type {
  AdapterMode,
  SmsAdapter,
  SmsBatchSendRequest,
  SmsBatchSendResult,
  SmsSendRequest,
  SmsSendResult,
  SmsStatusQueryResult,
  SmsType,
} from "./types";

/**
 * mock 모드 단가 — `cost-rates.ts` 의 SENDON_UNIT_COST 와 동기 유지.
 * 세정학원 전용 sendon 단가 (부가세 별도, 단위: 원). 소수 가능.
 * DB(messages.cost INT) 저장 시점에 송출 파이프라인이 Math.round 책임.
 */
const SENDON_MOCK_UNIT_COST: Record<SmsType, number> = {
  SMS: 7.4,
  LMS: 24,
  ALIMTALK: 6.4,
};

export interface SendonAdapterOptions {
  mode: AdapterMode;
  /** 콘솔 로그인 ID. live 모드 필수. */
  userId?: string;
  /** API Key. live 모드 필수. */
  apiKey?: string;
  /** 사전 등록된 발신번호. live 모드 필수. */
  fromNumber?: string;
  /** 엔드포인트 base URL override (테스트/스테이징 용 — 현 SDK 미지원, 향후 대비). */
  apiBase?: string;
}

export function createSendonAdapter(opts: SendonAdapterOptions): SmsAdapter {
  const mode: AdapterMode = opts.mode;

  return {
    name: "sendon",

    async send(req: SmsSendRequest): Promise<SmsSendResult> {
      if (mode === "mock") {
        return sendMock(req);
      }
      return await sendLive(req, opts);
    },

    async sendBatch(req: SmsBatchSendRequest): Promise<SmsBatchSendResult> {
      if (mode === "mock") {
        return sendBatchMock(req);
      }
      return await sendBatchLive(req, opts);
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
      return await queryStatusLive(vendorMessageId, opts);
    },
  };
}

// ─── live 발송 ──────────────────────────────────────────────

async function sendLive(
  req: SmsSendRequest,
  opts: SendonAdapterOptions,
): Promise<SmsSendResult> {
  if (!opts.userId) {
    return {
      status: "failed",
      reason: "sendon USER ID 가 설정되지 않았습니다",
    };
  }
  if (!opts.apiKey) {
    return {
      status: "failed",
      reason: "sendon API KEY 가 설정되지 않았습니다",
    };
  }
  if (!opts.fromNumber) {
    return {
      status: "failed",
      reason: "sendon 발신번호가 설정되지 않았습니다",
    };
  }

  // 알림톡: SDK kakao.send 별도 — 본 어댑터 인터페이스 미지원 (Phase 1).
  if (req.type === "ALIMTALK") {
    return {
      status: "failed",
      reason:
        "sendon 알림톡 발송은 사전 등록된 템플릿 ID 가 필요합니다 (Phase 1 지원 예정)",
    };
  }

  let client: Sendon;
  try {
    client = new Sendon({
      id: opts.userId,
      apikey: opts.apiKey,
      debug: false,
    });
  } catch {
    return {
      status: "failed",
      reason: "sendon 클라이언트 초기화에 실패했습니다",
    };
  }

  // SDK 의 SmsMessageType 매핑. SMS / LMS 만 — ALIMTALK 은 위에서 컷.
  const sdkType =
    req.type === "SMS" ? SmsMessageType.SMS : SmsMessageType.LMS;

  const payload: SendMessageRequestDto = {
    type: sdkType,
    from: opts.fromNumber,
    to: [req.to],
    message: req.body,
    // sendon `isAd` default 는 true → 미명시 시 정보성 발송도 광고로 분류됨.
    // 호출자(drain-campaign)가 campaign.is_ad 를 그대로 흘려보낸다.
    isAd: req.isAd,
  };
  // LMS/MMS 제목 필수 — req.subject 가 없으면 sendon 측에서 거절될 수 있어
  // 빈 문자열 대신 본문 앞 20자 fallback 으로 채워 넣는다 (운영 안전망).
  if (req.type === "LMS") {
    payload.title =
      req.subject && req.subject.trim().length > 0
        ? req.subject.trim()
        : req.body.slice(0, 20);
  }

  try {
    const result = await client.sms.send(payload);
    if (result.code === 200 && result.data?.groupId) {
      const cost = SENDON_MOCK_UNIT_COST[req.type];
      return {
        status: "queued",
        vendorMessageId: result.data.groupId,
        cost,
      };
    }
    const reason = sanitizeErrorMessage(
      result.message ?? `code ${result.code}`,
    );
    return {
      status: "failed",
      reason: reason
        ? `sendon 접수 실패 (코드 ${result.code}): ${reason}`
        : `sendon 접수 실패 (코드 ${result.code})`,
    };
  } catch (e: unknown) {
    // AxiosError 또는 일반 Error.
    const raw = extractErrorMessage(e);
    const safe = sanitizeErrorMessage(raw);
    return {
      status: "failed",
      reason: safe ? `sendon 발송 실패: ${safe}` : "sendon 발송에 실패했습니다",
    };
  }
}

// ─── live batch 발송 (다중 수신자 1회 API) ───────────────────

async function sendBatchLive(
  req: SmsBatchSendRequest,
  opts: SendonAdapterOptions,
): Promise<SmsBatchSendResult> {
  if (!opts.userId) {
    return { status: "failed", reason: "sendon USER ID 가 설정되지 않았습니다" };
  }
  if (!opts.apiKey) {
    return { status: "failed", reason: "sendon API KEY 가 설정되지 않았습니다" };
  }
  if (!opts.fromNumber) {
    return { status: "failed", reason: "sendon 발신번호가 설정되지 않았습니다" };
  }
  if (req.to.length === 0) {
    return { status: "failed", reason: "수신자 배열이 비어 있습니다" };
  }

  if (req.type === "ALIMTALK") {
    return {
      status: "failed",
      reason:
        "sendon 알림톡 batch 발송은 사전 등록된 템플릿 ID 가 필요합니다 (Phase 1 지원 예정)",
    };
  }

  let client: Sendon;
  try {
    client = new Sendon({
      id: opts.userId,
      apikey: opts.apiKey,
      debug: false,
    });
  } catch {
    return {
      status: "failed",
      reason: "sendon 클라이언트 초기화에 실패했습니다",
    };
  }

  const sdkType =
    req.type === "SMS" ? SmsMessageType.SMS : SmsMessageType.LMS;

  const payload: SendMessageRequestDto = {
    type: sdkType,
    from: opts.fromNumber,
    to: req.to,
    message: req.body,
    // sendon `isAd` default = true → 명시하지 않으면 광고로 분류됨.
    isAd: req.isAd,
  };
  if (req.type === "LMS") {
    payload.title =
      req.subject && req.subject.trim().length > 0
        ? req.subject.trim()
        : req.body.slice(0, 20);
  }

  try {
    const result = await client.sms.send(payload);
    if (result.code === 200 && result.data?.groupId) {
      const unitCost = SENDON_MOCK_UNIT_COST[req.type];
      return {
        status: "queued",
        vendorMessageId: result.data.groupId,
        unitCost,
      };
    }
    const reason = sanitizeErrorMessage(
      result.message ?? `code ${result.code}`,
    );
    return {
      status: "failed",
      reason: reason
        ? `sendon batch 접수 실패 (코드 ${result.code}): ${reason}`
        : `sendon batch 접수 실패 (코드 ${result.code})`,
    };
  } catch (e: unknown) {
    const raw = extractErrorMessage(e);
    const safe = sanitizeErrorMessage(raw);
    return {
      status: "failed",
      reason: safe
        ? `sendon batch 발송 실패: ${safe}`
        : "sendon batch 발송에 실패했습니다",
    };
  }
}

// ─── live 상태 조회 ─────────────────────────────────────────

async function queryStatusLive(
  vendorMessageId: string,
  opts: SendonAdapterOptions,
): Promise<SmsStatusQueryResult> {
  if (!opts.userId || !opts.apiKey) {
    return {
      status: "queued",
      failedReason: "sendon 인증 정보가 설정되지 않았습니다",
    };
  }
  let client: Sendon;
  try {
    client = new Sendon({
      id: opts.userId,
      apikey: opts.apiKey,
      debug: false,
    });
  } catch {
    return {
      status: "queued",
      failedReason: "sendon 클라이언트 초기화 실패",
    };
  }

  try {
    const result = await client.sms.find(vendorMessageId);
    if (result.code !== 200) {
      return {
        status: "queued",
        failedReason: sanitizeErrorMessage(
          result.message ?? `code ${result.code}`,
        ),
      };
    }
    const info = result.data;
    // 우리는 1건씩 발송하므로 카운트는 0/1 중 하나.
    if ((info.succeededCount ?? 0) > 0) {
      return {
        status: "delivered",
        deliveredAt: new Date().toISOString(),
      };
    }
    if ((info.failedCount ?? 0) > 0) {
      return {
        status: "failed",
        failedReason: sanitizeErrorMessage(info.message ?? "발송 실패"),
      };
    }
    if ((info.canceledCount ?? 0) > 0) {
      return { status: "failed", failedReason: "취소됨" };
    }
    if ((info.blockedCount ?? 0) > 0) {
      return { status: "failed", failedReason: "수신거부" };
    }
    if ((info.sendingCount ?? 0) > 0) {
      return { status: "sent" };
    }
    // 기본 — 대기 중.
    return { status: "queued" };
  } catch (e: unknown) {
    const safe = sanitizeErrorMessage(extractErrorMessage(e));
    return {
      status: "queued",
      failedReason: safe || "sendon 상태 조회 실패",
    };
  }
}

// ─── 유틸 ───────────────────────────────────────────────────

/**
 * 외부 에러 메시지에서 민감 정보 제거.
 * sendon SDK 가 throw 하는 AxiosError 의 message / response.data 에 KEY 가
 * 노출되지 않는다는 보장이 없어 송출 파이프라인 사용자 노출 전 반드시 거치도록 export.
 */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "";
  let out = msg.slice(0, 200); // 길이 제한
  out = out.replace(/(api[_-]?key)[^\s,;]+/gi, "$1=***");
  out = out.replace(/(authorization|bearer)\s+[A-Za-z0-9._-]+/gi, "$1 ***");
  return out;
}

/**
 * AxiosError 또는 일반 Error 에서 사람이 읽을 수 있는 메시지 추출.
 * Axios 응답 본문(`response.data.message`) 우선, 없으면 Error.message.
 */
function extractErrorMessage(e: unknown): string {
  if (typeof e !== "object" || e === null) return "";
  const cand = e as {
    response?: { data?: { message?: unknown } };
    message?: unknown;
  };
  const responseMsg = cand.response?.data?.message;
  if (typeof responseMsg === "string" && responseMsg.length > 0) {
    return responseMsg;
  }
  if (typeof cand.message === "string") return cand.message;
  return "";
}

// ─── mock 발송 ──────────────────────────────────────────────

/**
 * mock 응답 생성. 항상 성공을 반환하도록 구성.
 * 필요 시 env 플래그로 확률적 실패를 도입할 수 있으나 MVP 에선 단순화.
 */
function sendMock(req: SmsSendRequest): SmsSendResult {
  const cost = SENDON_MOCK_UNIT_COST[req.type];
  const vendorMessageId = `mock-sendon-${randomUUID()}`;
  return {
    status: "queued",
    vendorMessageId,
    cost,
  };
}

/**
 * mock batch 응답 — 단일 groupId 발급, 모든 수신자 동일 vendor_message_id 공유.
 */
function sendBatchMock(req: SmsBatchSendRequest): SmsBatchSendResult {
  if (req.to.length === 0) {
    return { status: "failed", reason: "수신자 배열이 비어 있습니다" };
  }
  const unitCost = SENDON_MOCK_UNIT_COST[req.type];
  return {
    status: "queued",
    vendorMessageId: `mock-sendon-batch-${randomUUID()}`,
    unitCost,
  };
}
