/**
 * SMS/LMS/알림톡 어댑터 인터페이스 타입.
 *
 * 규약:
 *  - 본 인터페이스는 벤더 중립. 벤더별 구현은 src/lib/messaging/adapters/* 에 위치.
 *  - 안전 가드([광고] prefix / 080 footer / 야간 차단 / 수신거부 제외 등)는
 *    어댑터 "이전" 레이어에서 이미 본문에 적용된 상태로 전달되어야 함.
 *    어댑터는 단순 송출 책임만 진다.
 *  - MVP 는 'solapi' 만 실구현 예정. 'munjanara' / 'sk-togo' / 'sendwise' 는 Phase 1 스텁.
 *  - AdapterMode='mock' 일 때 실제 HTTP 를 쏘지 않고 고정 응답만 리턴.
 */

export type SmsType = "SMS" | "LMS" | "ALIMTALK";

export type SmsSendRequest = {
  /** 수신자 번호. 하이픈 없는 11자리(01012345678). */
  to: string;
  /** 안전 가드까지 모두 적용 완료된 최종 본문. */
  body: string;
  /** LMS/알림톡 제목. SMS 는 null. */
  subject: string | null;
  /** 메시지 유형. */
  type: SmsType;
  /** 발신번호. 사전에 벤더에 등록된 번호. */
  fromNumber: string;
};

export type SmsSendResult =
  | { status: "queued"; vendorMessageId: string; cost: number }
  | { status: "failed"; reason: string };

export type SmsStatusQueryResult =
  | {
      status: "queued" | "sent" | "delivered" | "failed";
      deliveredAt?: string;
      failedReason?: string;
    };

export interface SmsAdapter {
  readonly name: "solapi" | "munjanara" | "sk-togo" | "sendwise";
  send(req: SmsSendRequest): Promise<SmsSendResult>;
  queryStatus(vendorMessageId: string): Promise<SmsStatusQueryResult>;
}

/**
 * 어댑터 동작 모드.
 *  - 'mock': 실제 벤더 호출 없이 고정 응답. 개발/테스트용.
 *  - 'live': 실제 벤더 API 호출.
 */
export type AdapterMode = "mock" | "live";
