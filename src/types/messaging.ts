/**
 * SMS/LMS/알림톡 어댑터 인터페이스 타입.
 *
 * 규약:
 *  - 본 인터페이스는 벤더 중립. 벤더별 구현은 src/lib/messaging/adapters/* 에 위치.
 *  - 안전 가드([광고] prefix / 080 footer / 야간 차단 / 수신거부 제외 등)는
 *    어댑터 "이전" 레이어에서 이미 본문에 적용된 상태로 전달되어야 함.
 *    어댑터는 단순 송출 책임만 진다.
 *  - 현재 'sendon' 단일 벤더. live 모드는 Part B (API 문서 수령 후) 대기.
 *  - AdapterMode='mock' 일 때 실제 HTTP 를 쏘지 않고 고정 응답만 리턴.
 */

export type SmsType = "SMS" | "LMS" | "ALIMTALK";

/**
 * 동일번호 1회 발송(중복 번호 dedupe) 카운트 계약.
 *
 * 미리보기/발송 인원 표시에서 "원래 N명 → 실제 M건(중복 K건 합침)" 을
 * 일관되게 보여주기 위한 공용 타입. backend(preview-recipients/send-campaign)
 * 가 산출해 반환하고, frontend(미리보기·발송 확인 UI) 가 그대로 표시한다.
 *
 * 불변식: collapsed = targetStudents - actualMessages (>= 0).
 *  - dedupeByPhone=false 이거나 합쳐질 중복이 없으면 collapsed=0,
 *    actualMessages = targetStudents.
 *  - 가드(탈퇴/수신거부/야간) 제외는 이 계약 "이전"에 이미 적용됐다고 본다.
 *    즉 targetStudents 는 가드 통과 후 발송 후보 학생 수다.
 */
export interface DedupeCounts {
  /** 동일번호 1회 발송이 적용됐는지(=campaign.dedupe_by_phone). */
  dedupeApplied: boolean;
  /** 가드 통과 후 발송 후보 학생 수 (합치기 전). */
  targetStudents: number;
  /** 실제 발송(큐 적재) 건수. dedupe ON 이면 고유 번호 수, OFF 면 = targetStudents. */
  actualMessages: number;
  /** 동일번호로 합쳐져 발송되지 않은 중복 건수 = targetStudents - actualMessages. */
  collapsed: number;
}

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
  /**
   * 광고성 발송 여부. sendon API 의 `isAd` 필드에 그대로 매핑.
   * sendon 스펙 default 가 `true` 라 명시하지 않으면 모든 발송이 광고로 분류된다.
   * 정보성/광고성 분리를 위해 호출자(=drain-campaign 등) 가 반드시 채워서 전달할 것.
   */
  isAd: boolean;
};

export type SmsSendResult =
  | { status: "queued"; vendorMessageId: string; cost: number }
  | { status: "failed"; reason: string };

/**
 * batch 발송용 수신자 객체. sendon `Receiver` 타입에 1:1 매핑.
 * 이름 기반 개인화(`{이름}` 치환) 가 필요한 캠페인에서 사용한다.
 *  - phone : 하이픈 없는 11자리(01012345678).
 *  - name  : sendon `Receiver.name`. 비어 있으면 어댑터가 fallback 처리.
 */
export type SmsBatchRecipient = {
  phone: string;
  name?: string;
};

/**
 * 다중 수신자 일괄 발송 요청.
 * sendon `SendMessageRequestDto.to: Array<...>` 1회 API 호출에 매핑.
 *
 * 수신자 표현은 두 가지:
 *  - `string[]`               : 이름 치환 불필요. 가장 단순한 경로.
 *  - `SmsBatchRecipient[]`    : `{이름}` 치환이 필요한 캠페인. 수신자별 name 동봉.
 *
 * 수신자별 개별 vendor_message_id 가 필요하면 send() 를 N번 호출해야 한다.
 * 본 batch 는 1 groupId 를 N건이 공유 — Status polling 시 groupId 단위 조회.
 */
export type SmsBatchSendRequest = {
  /** 수신자. 문자열 배열(이름 치환 X) 또는 객체 배열(이름 치환 O). */
  to: string[] | SmsBatchRecipient[];
  /**
   * 안전 가드까지 모두 적용 완료된 최종 본문.
   * `hasNamePlaceholder=true` 인 경우, 이미 sendon 문법 `#{이름}` 으로 변환된 상태여야 한다.
   */
  body: string;
  /** LMS/알림톡 제목. SMS 는 null. */
  subject: string | null;
  /** 메시지 유형. */
  type: SmsType;
  /** 발신번호. 사전에 벤더에 등록된 번호. */
  fromNumber: string;
  /**
   * 광고성 발송 여부. sendon `isAd` 필드 매핑.
   * sendon 스펙 default = true → 미설정 시 모든 발송이 광고로 분류된다.
   */
  isAd: boolean;
  /**
   * 본문에 `#{이름}` placeholder 가 있어 sendon `userParameters.replaces` 를
   * 적용해야 하는지. true 이면 어댑터가 to 를 `Array<Receiver>` 로 보내고
   * userParameters 를 함께 전달한다.
   */
  hasNamePlaceholder?: boolean;
};

/**
 * 다중 수신자 일괄 발송 결과.
 * - queued : 모든 수신자가 벤더 큐에 적재됨. vendorMessageId 는 N건이 공유.
 * - failed : 일괄 실패. 어떤 수신자 때문에 실패했는지는 본 결과만으로 모름
 *            (필요 시 sendon `find` API 로 groupId 조회).
 */
export type SmsBatchSendResult =
  | {
      status: "queued";
      /** 벤더의 groupId. N건이 모두 같은 값을 공유. */
      vendorMessageId: string;
      /** 1건당 단가 (총 비용은 호출자가 to.length 곱해서 계산). */
      unitCost: number;
    }
  | { status: "failed"; reason: string };

export type SmsStatusQueryResult =
  | {
      status: "queued" | "sent" | "delivered" | "failed";
      deliveredAt?: string;
      failedReason?: string;
    };

export interface SmsAdapter {
  readonly name: "sendon";
  send(req: SmsSendRequest): Promise<SmsSendResult>;
  /**
   * 다중 수신자 일괄 발송. 벤더 API 1회 호출로 다수 수신자에게 동시 적재.
   * 6만+ 대량 발송에서 send() N회 호출 (= N round-trip) 을 1회로 축소하는 핵심.
   */
  sendBatch(req: SmsBatchSendRequest): Promise<SmsBatchSendResult>;
  queryStatus(vendorMessageId: string): Promise<SmsStatusQueryResult>;
}

/**
 * 어댑터 동작 모드.
 *  - 'mock': 실제 벤더 호출 없이 고정 응답. 개발/테스트용.
 *  - 'live': 실제 벤더 API 호출.
 */
export type AdapterMode = "mock" | "live";
