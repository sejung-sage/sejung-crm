/**
 * Sendwise 어댑터 · Phase 1 스텁.
 *
 * MVP 범위 밖. 팩토리 분기 시 선택되더라도 호출 즉시 명시적 Error 를 throw.
 */

import type {
  AdapterMode,
  SmsAdapter,
  SmsSendRequest,
  SmsSendResult,
  SmsStatusQueryResult,
} from "./types";

export interface SendwiseAdapterOptions {
  mode: AdapterMode;
  apiKey?: string;
  fromNumber?: string;
}

export function createSendwiseAdapter(
  _opts: SendwiseAdapterOptions,
): SmsAdapter {
  return {
    name: "sendwise",

    async send(_req: SmsSendRequest): Promise<SmsSendResult> {
      throw new Error("Sendwise 어댑터는 Phase 1 대상입니다");
    },

    async queryStatus(
      _vendorMessageId: string,
    ): Promise<SmsStatusQueryResult> {
      throw new Error("Sendwise 어댑터는 Phase 1 대상입니다");
    },
  };
}
