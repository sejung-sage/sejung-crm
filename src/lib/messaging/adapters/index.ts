/**
 * SMS 어댑터 팩토리.
 *
 * 환경변수:
 *   - SMS_PROVIDER     : 'sendon'   (현재 단일 벤더, 알 수 없는 값도 sendon 폴백)
 *   - SMS_ADAPTER_MODE : 'mock' | 'live'   (기본 'mock')
 *   - SENDON_USER_ID        : sendon 콘솔 로그인 ID (live 모드 필수, SDK 인증 id)
 *   - SENDON_API_KEY        : sendon API Key (콘솔 → 마이페이지 → 개발자 센터)
 *   - SENDON_FROM_NUMBER    : sendon 사전 등록 발신번호
 *   - SENDON_API_BASE       : (선택) sendon 엔드포인트 override
 *
 * 미사용 어댑터(솔라피/문자나라/SK to-go/Sendwise)는 sendon 단일 운영 정책에 따라
 * 모두 제거됨 (2026-05-08). 필요 시 git history 에서 복원.
 *
 * 신규 벤더 추가 시 이 파일에서 한 줄 추가하면 됨.
 * 벤더별 구현 파일은 어댑터 내부에서 env 를 직접 건드리지 않고 이 팩토리가 주입.
 */

import { createSendonAdapter } from "./sendon";
import type { AdapterMode, SmsAdapter } from "./types";

type ProviderName = "sendon";

function readProvider(): ProviderName {
  // 현재 단일 벤더라 무조건 sendon. SMS_PROVIDER env 는 향후 다중 벤더 복귀 대비 보존.
  return "sendon";
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
    case "sendon":
      return createSendonAdapter({
        mode,
        userId: process.env.SENDON_USER_ID,
        apiKey: process.env.SENDON_API_KEY,
        fromNumber: process.env.SENDON_FROM_NUMBER,
        apiBase: process.env.SENDON_API_BASE,
      });
  }
}

export type { SmsAdapter } from "./types";
