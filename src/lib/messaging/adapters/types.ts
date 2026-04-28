/**
 * 어댑터 전용 타입 re-export.
 *
 * 관용적으로 `src/lib/messaging/adapters/types.ts` 에서 어댑터 구현이
 * import 할 수 있도록 통로를 열어둔다. 원본은 `src/types/messaging.ts`.
 * 벤더 구현은 반드시 이 파일에서만 타입을 끌어다 쓸 것.
 */

export type {
  AdapterMode,
  SmsAdapter,
  SmsSendRequest,
  SmsSendResult,
  SmsStatusQueryResult,
  SmsType,
} from "@/types/messaging";
