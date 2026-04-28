/**
 * SMS 어댑터 팩토리.
 *
 * 환경변수 기반 분기:
 *   - SMS_PROVIDER     : 'solapi' | 'munjanara' | 'sk-togo' | 'sendwise'   (기본 'solapi')
 *   - SMS_ADAPTER_MODE : 'mock' | 'live'                                    (기본 'mock')
 *   - SOLAPI_API_KEY        : 솔라피 API Key (live 모드에서 필수)
 *   - SOLAPI_API_SECRET     : 솔라피 API Secret (live 모드에서 필수)
 *   - SOLAPI_FROM_NUMBER    : 솔라피 사전 등록 발신번호 (live 모드에서 필수)
 *   - SOLAPI_KAKAO_PFID     : 알림톡 PFID (알림톡 발송 시 필수)
 *   - MUNJANARA_API_KEY     : 문자나라 API Key (Phase 1+, 백업)
 *   - MUNJANARA_FROM_NUMBER : 문자나라 발신번호 (Phase 1+, 백업)
 *
 * 신규 벤더 추가 시 이 파일에서만 분기 한 줄 추가하면 됨.
 * 벤더별 구현 파일은 어댑터 내부에서 env 를 직접 건드리지 않고 이 팩토리가 주입.
 */

import { createMunjanaraAdapter } from "./munjanara";
import { createSendwiseAdapter } from "./sendwise";
import { createSkTogoAdapter } from "./sk-togo";
import { createSolapiAdapter } from "./solapi";
import type { AdapterMode, SmsAdapter } from "./types";

type ProviderName = "solapi" | "munjanara" | "sk-togo" | "sendwise";

function readProvider(): ProviderName {
  const raw = process.env.SMS_PROVIDER?.trim().toLowerCase() ?? "solapi";
  if (
    raw === "solapi" ||
    raw === "munjanara" ||
    raw === "sk-togo" ||
    raw === "sendwise"
  ) {
    return raw;
  }
  // 알 수 없는 벤더 이름은 1순위 솔라피로 폴백 (안전 실패)
  return "solapi";
}

function readMode(): AdapterMode {
  const raw = process.env.SMS_ADAPTER_MODE?.trim().toLowerCase() ?? "mock";
  return raw === "live" ? "live" : "mock";
}

/**
 * 현재 환경변수 기준으로 구성된 SmsAdapter 인스턴스를 반환.
 * 호출자는 반환값을 계속 재사용해도 되고, 매 요청마다 새로 만들어도 된다
 * (어댑터 자체는 상태를 보유하지 않음).
 */
export function createSmsAdapter(): SmsAdapter {
  const provider = readProvider();
  const mode = readMode();

  switch (provider) {
    case "solapi":
      return createSolapiAdapter({
        mode,
        apiKey: process.env.SOLAPI_API_KEY,
        apiSecret: process.env.SOLAPI_API_SECRET,
        fromNumber: process.env.SOLAPI_FROM_NUMBER,
        kakaoPfid: process.env.SOLAPI_KAKAO_PFID,
      });
    case "munjanara":
      return createMunjanaraAdapter({
        mode,
        apiKey: process.env.MUNJANARA_API_KEY,
        fromNumber: process.env.MUNJANARA_FROM_NUMBER,
      });
    case "sk-togo":
      return createSkTogoAdapter({
        mode,
        apiKey: process.env.SK_TOGO_API_KEY,
        fromNumber: process.env.SK_TOGO_FROM_NUMBER,
      });
    case "sendwise":
      return createSendwiseAdapter({
        mode,
        apiKey: process.env.SENDWISE_API_KEY,
        fromNumber: process.env.SENDWISE_FROM_NUMBER,
      });
  }
}

export type { SmsAdapter } from "./types";
