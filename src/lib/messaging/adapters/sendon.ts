/**
 * sendon 어댑터 (https://sendon.io 추정).
 *
 * 사용자가 sendon 콘솔에서 API KEY 를 발급받아 환경변수로 주입한다.
 * Part A (현재): mock 모드만 완전 구현. live 모드는 명시적 실패 메시지 반환.
 * Part B: sendon 공식 API 문서를 받은 뒤 live 송출/상태 조회 구현 예정.
 *
 * 환경변수 (live 모드 활성 시 필수):
 *   SMS_PROVIDER         = "sendon"
 *   SMS_ADAPTER_MODE     = "live"
 *   SENDON_API_KEY       = sendon 콘솔 → 마이페이지 → 개발자 센터 → API KEY
 *   SENDON_FROM_NUMBER   = sendon 에 사전 등록된 발신번호 (하이픈 X)
 *   SENDON_API_BASE      = (선택) 기본 엔드포인트 override
 *
 * 보안 (CLAUDE.md 규약 #9):
 *   - API Key / 발신번호는 인자로 주입 (env 직접 접근 금지).
 *   - 로그/에러 메시지에 KEY 노출 금지 → `sanitizeErrorMessage` 통과 후 사용.
 *
 * 정책 가드([광고] prefix / 080 footer / 야간 차단 / 수신거부 제외)는 어댑터
 * 상위 레이어(`guards/`) 책임. 어댑터는 단순 송출.
 */

import { randomUUID } from "node:crypto";
import type {
  AdapterMode,
  SmsAdapter,
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
  /** live 모드 전용. mock 모드에서는 optional. */
  apiKey?: string;
  /** 사전 등록된 발신번호. live 모드에서 필수. */
  fromNumber?: string;
  /** 엔드포인트 base URL override (테스트/스테이징 용). */
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

    async queryStatus(
      vendorMessageId: string,
    ): Promise<SmsStatusQueryResult> {
      if (mode === "mock") {
        return {
          status: "delivered",
          deliveredAt: new Date().toISOString(),
        };
      }
      // Part B 구현 예정 — 현재는 명시적 placeholder.
      return {
        status: "queued",
        failedReason: `sendon 상태 조회 미구현 (id=${vendorMessageId})`,
      };
    },
  };
}

// ─── live 발송 (Part B 대기) ────────────────────────────────
//
// 현재는 API 문서 미수령 → live 호출 시 명시적 failed 반환.
// 캠페인 발송 파이프라인은 failed 결과를 안전하게 처리한다 (재시도 가능).
//
// API 문서 받은 뒤 보강 항목:
//   - HTTP 메서드/엔드포인트 확정 (예: POST /api/v1/messages)
//   - 인증 헤더 형태 (Authorization: Bearer / API-Key 헤더 / signature 등)
//   - 요청 페이로드 스키마 (sender / receiver / type / message / subject)
//   - 응답 messageId 추출 경로
//   - 거절 코드/사유 매핑

async function sendLive(
  req: SmsSendRequest,
  opts: SendonAdapterOptions,
): Promise<SmsSendResult> {
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

  // 알림톡: sendon 도 보통 PFID/템플릿 ID 가 필요 — 현 SmsSendRequest 에는 없음.
  if (req.type === "ALIMTALK") {
    return {
      status: "failed",
      reason:
        "sendon 알림톡 발송은 사전 등록된 템플릿 ID 가 필요합니다 (Part B 지원 예정)",
    };
  }

  // Part B: 실제 HTTP 호출. 현재는 미구현 안내.
  void req; // unused 가드
  void opts.apiBase;
  return {
    status: "failed",
    reason: "sendon live 모드는 API 문서 수령 후 Part B 에서 구현됩니다",
  };
}

/**
 * 외부 에러 메시지에서 민감 정보 제거.
 * Part B HTTP 호출 응답을 사용자에게 노출하기 전 반드시 거치도록 export.
 */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "";
  let out = msg.slice(0, 200); // 길이 제한
  out = out.replace(/(api[_-]?key)[^\s,;]+/gi, "$1=***");
  out = out.replace(/(authorization|bearer)\s+[A-Za-z0-9._-]+/gi, "$1 ***");
  return out;
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
