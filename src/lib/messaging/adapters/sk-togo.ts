/**
 * SK C&C to-go 어댑터 · Phase 1 스텁.
 *
 * MVP(Phase 0) 에서는 실구현 없이 인터페이스만 맞춘다. 팩토리가 분기해
 * 선택하더라도 send / queryStatus 호출 즉시 명시적 Error 를 throw.
 */

import type {
  AdapterMode,
  SmsAdapter,
  SmsSendRequest,
  SmsSendResult,
  SmsStatusQueryResult,
} from "./types";

export interface SkTogoAdapterOptions {
  mode: AdapterMode;
  apiKey?: string;
  fromNumber?: string;
}

export function createSkTogoAdapter(
  _opts: SkTogoAdapterOptions,
): SmsAdapter {
  return {
    name: "sk-togo",

    async send(_req: SmsSendRequest): Promise<SmsSendResult> {
      throw new Error("SK to-go 어댑터는 Phase 1 대상입니다");
    },

    async queryStatus(
      _vendorMessageId: string,
    ): Promise<SmsStatusQueryResult> {
      throw new Error("SK to-go 어댑터는 Phase 1 대상입니다");
    },
  };
}
