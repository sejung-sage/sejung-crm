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
import {
  sendonFromNumber,
  sendonUserId,
  sendonApiKey,
} from "@/config/sender-numbers";
import type { Division } from "@/config/divisions";

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
 *
 * branch 를 주면 그 분원의 sendon 계정(USER_ID/API_KEY)과 발신번호를 주입한다.
 * 분원마다 sendon 계정·충전·발신번호가 다른 운영을 지원(분원 키 없으면 기본값 폴백 —
 * 회귀 없음). branch 미지정(전체/마스터/유틸 경로)이면 기본 단일 계정을 쓴다.
 *
 * 호출자는 반환값을 계속 재사용해도 되고, 매 요청마다 새로 만들어도 된다
 * (어댑터 자체는 상태를 보유하지 않음). 단 분원이 다르면 분원별로 새로 만들어야 한다.
 *
 * division(발신 정체성)은 계정(userId/apiKey)과 무관하고 발신번호만 좌우한다.
 * 미지정/본원이면 분원 본원 번호 — 기존 동작과 100% 동일(무회귀).
 */
export function createSmsAdapter(
  branch?: string | null,
  division?: Division | null,
): SmsAdapter {
  const provider = readProvider();
  const mode = readMode();

  const userId = sendonUserId(branch);
  const apiKey = sendonApiKey(branch);
  const fromNumber = sendonFromNumber(branch, division) ?? undefined;

  // 진단 로그 — Vercel 함수 로그에서 mode/provider/분원/division 확인용. 키 값은 노출 X.
  console.log(
    `[sms-adapter] provider=${provider} mode=${mode} branch=${branch ?? "-"} ` +
      `division=${division ?? "-"} ` +
      `userId=${userId ? "set" : "MISSING"} ` +
      `apiKey=${apiKey ? "set" : "MISSING"} ` +
      `fromNumber=${fromNumber ? "set" : "MISSING"} ` +
      `rawModeEnv=${JSON.stringify(process.env.SMS_ADAPTER_MODE ?? null)}`,
  );

  switch (provider) {
    case "sendon":
      return createSendonAdapter({
        mode,
        userId,
        apiKey,
        fromNumber,
        apiBase: process.env.SENDON_API_BASE,
      });
  }
}

export type { SmsAdapter } from "./types";
