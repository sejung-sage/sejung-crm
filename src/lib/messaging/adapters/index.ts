/**
 * SMS 어댑터 팩토리.
 *
 * 환경변수 기반 분기:
 *   - SMS_PROVIDER     : 'solapi' | 'sendon'   (기본 'solapi')
 *   - SMS_ADAPTER_MODE : 'mock' | 'live'        (기본 'mock')
 *   - SOLAPI_API_KEY        : 솔라피 API Key (live 모드에서 필수)
 *   - SOLAPI_API_SECRET     : 솔라피 API Secret (live 모드에서 필수)
 *   - SOLAPI_FROM_NUMBER    : 솔라피 사전 등록 발신번호 (live 모드에서 필수)
 *   - SOLAPI_KAKAO_PFID     : 알림톡 PFID (알림톡 발송 시 필수)
 *   - SENDON_API_KEY        : sendon API Key (콘솔 → 마이페이지 → 개발자 센터)
 *   - SENDON_FROM_NUMBER    : sendon 사전 등록 발신번호
 *   - SENDON_API_BASE       : (선택) sendon 엔드포인트 override
 *
 * 신규 벤더 추가 시 이 파일에서만 분기 한 줄 추가하면 됨.
 * 벤더별 구현 파일은 어댑터 내부에서 env 를 직접 건드리지 않고 이 팩토리가 주입.
 *
 * 운영에서 미사용된 백업 어댑터(문자나라/SK to-go/Sendwise)는 코드 정리 차원에서
 * 제거됨 (2026-05-08). 필요 시 git history 에서 복원.
 */

import { createSendonAdapter } from "./sendon";
import { createSolapiAdapter } from "./solapi";
import type { AdapterMode, SmsAdapter } from "./types";

type ProviderName = "solapi" | "sendon";

function readProvider(): ProviderName {
  const raw = process.env.SMS_PROVIDER?.trim().toLowerCase() ?? "solapi";
  if (raw === "solapi" || raw === "sendon") {
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
    case "sendon":
      return createSendonAdapter({
        mode,
        apiKey: process.env.SENDON_API_KEY,
        fromNumber: process.env.SENDON_FROM_NUMBER,
        apiBase: process.env.SENDON_API_BASE,
      });
  }
}

export type { SmsAdapter } from "./types";
