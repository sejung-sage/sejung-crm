/**
 * 문자나라(MunJaNaRa) 어댑터.
 *
 * Phase 1+ 백업 옵션, MVP 는 솔라피(SOLAPI)를 사용. 본 어댑터는 스텁만 유지.
 *
 * Part A 범위:
 *   - `mode: 'mock'` 에서는 실제 HTTP 호출 없이 고정 응답.
 *     `send()` → `status: 'queued'` + `vendorMessageId: mock-{uuid}` + 유형별 mock 단가.
 *     `queryStatus()` → `status: 'delivered'`.
 *   - `mode: 'live'` 호출 시 **Part B 에서 구현 예정** 안내 Error throw.
 *
 * 보안:
 *   - API Key / 발신번호는 인자로 주입받음. 이 파일 내부에서 env 직접 접근하지 않음
 *     (팩토리 `index.ts` 에서 주입). 로그에 API Key 출력 금지.
 *
 * 정책 가드([광고] prefix / 080 footer / 야간 차단 / 수신거부 제외)는
 * 어댑터 상위 레이어(`guards/`) 책임. 어댑터는 단순 송출.
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

/** mock 모드에서 반환할 유형별 1건 단가. 실제 요금표와 별개. */
const MOCK_UNIT_COST: Record<SmsType, number> = {
  SMS: 20,
  LMS: 25,
  ALIMTALK: 15,
};

export interface MunjanaraAdapterOptions {
  mode: AdapterMode;
  /** live 모드 전용. mock 모드에서는 optional. */
  apiKey?: string;
  /** 사전 등록된 발신번호. live 모드에서 필수. */
  fromNumber?: string;
}

export function createMunjanaraAdapter(
  opts: MunjanaraAdapterOptions,
): SmsAdapter {
  const mode: AdapterMode = opts.mode;

  return {
    name: "munjanara",

    async send(req: SmsSendRequest): Promise<SmsSendResult> {
      if (mode === "mock") {
        return sendMock(req);
      }
      // live 모드 — Part B 에서 실 API 호출로 교체
      throw new Error("문자나라 live 모드는 Part B 에서 구현됩니다");
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
      throw new Error(
        `문자나라 live 모드 상태 조회는 Part B 에서 구현됩니다 (id=${vendorMessageId})`,
      );
    },
  };
}

/**
 * mock 응답 생성. 항상 성공을 반환하도록 구성.
 * 필요 시 env 플래그로 확률적 실패를 도입할 수 있으나 MVP 에선 단순화.
 */
function sendMock(req: SmsSendRequest): SmsSendResult {
  const cost = MOCK_UNIT_COST[req.type];
  const vendorMessageId = `mock-${randomUUID()}`;
  return {
    status: "queued",
    vendorMessageId,
    cost,
  };
}
