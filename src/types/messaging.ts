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
 * 발송 카운트 계약 (레그 확장 + 동일번호 dedupe 통합).
 *
 * 미리보기/발송 인원 표시에서 "대상 학생 N명 → 실제 발송 M건" 을 일관되게
 * 보여주기 위한 공용 타입. backend(preview-recipients/send-campaign) 가
 * 산출해 반환하고, frontend(미리보기·발송 확인 UI) 가 그대로 표시한다.
 *
 * ── 레그(leg) 모델 (0077, 발송 대상 번호 선택) ───────────────
 * 한 학생은 send_to_parent / send_to_student 선택에 따라 0~2개의 발송
 * 레그로 확장된다(학부모 레그 + 학생 레그). 번호가 없는 레그는 스킵.
 * 따라서 종전 "학생 1명 = 1건" 가정이 깨지고, 학생 1명이 0·1·2건이 된다.
 *
 * ── 산출 순서 (backend 구현 계약) ────────────────────────────
 *   레그 확장 → 발송 안전 가드(레그별 번호 기준) → dedupe(collapseByPhone).
 *   - targetStudents : 가드 통과 후 발송 후보 "학생" 수 (레그 아님). 사람 수.
 *   - legs           : 위 학생들에서 펼쳐진 레그(번호) 합계. 번호 없는 레그
 *                      스킵 후 값. dedupe 적용 "전". (targetStudents 의 1~2배)
 *   - actualMessages : 실제 발송(큐 적재) 건수. dedupe OFF 면 = legs,
 *                      dedupe ON 이면 고유 정규화 번호 수 (<= legs).
 *   - collapsed      : dedupe 로 합쳐져 발송되지 않은 건수 = legs - actualMessages.
 *
 * ── 불변식 ──────────────────────────────────────────────────
 *   actualMessages = legs - collapsed   (collapsed >= 0)
 *   legs >= targetStudents              (레그 1개 이상인 학생만 후보로 셈)
 *   비용은 actualMessages(레그/큐 적재 기준) × 단가.
 *
 * 단일 대상(학부모만, 기존 동작)일 때: legs = targetStudents 이고,
 * dedupe OFF 면 actualMessages = legs = targetStudents (종전과 동일).
 *
 * 가드(탈퇴/수신거부/야간) 제외는 이 계약 "이전"에 적용됐다고 본다.
 */
export interface DedupeCounts {
  /** 동일번호 1회 발송이 적용됐는지(=campaign.dedupe_by_phone). */
  dedupeApplied: boolean;
  /** 가드 통과 후 발송 후보 "학생" 수 (사람 수, 레그 아님). */
  targetStudents: number;
  /**
   * 레그 확장 결과 발송 후보 레그(번호) 합계. dedupe 적용 전.
   * 단일 대상(학부모만)이면 targetStudents 와 같다.
   * 학부모·학생 동시 선택이면 최대 targetStudents 의 2배 (번호 결측 레그 차감).
   */
  legs: number;
  /** 실제 발송(큐 적재) 건수. dedupe ON 이면 고유 번호 수, OFF 면 = legs. */
  actualMessages: number;
  /** 동일번호로 합쳐져 발송되지 않은 중복 건수 = legs - actualMessages. */
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
  /**
   * 예약 발송 시각 (ISO 8601). 지정하면 sendon `reservation.datetime` 으로 전달돼
   * 해당 시각에 sendon 이 직접 발송한다. 미지정(undefined) 이면 즉시 발송.
   * sendon 제약: 현재로부터 최소 30분 이후.
   */
  reservationDatetime?: string;
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
  /**
   * 예약 발송 시각 (ISO 8601). 지정 시 sendon `reservation.datetime` 으로 전달돼
   * 해당 시각에 sendon 이 직접 발송한다. 미지정이면 즉시 발송.
   * sendon 제약: 현재로부터 최소 30분 이후.
   */
  reservationDatetime?: string;
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

/**
 * 한 groupId(batch 발송 단위, 보통 1,000건)의 sendon 실제 처리 카운트.
 *
 * 발송 시점에 우리는 sendon 접수(200)를 받으면 "발송됨" 으로 기록하지만, sendon 이
 * 그 후 비동기로 처리 실패(예: 잔액 부족)시킨 건은 추적하지 못한다. 이 조회로 sendon
 * 측 실제 상태를 가져와 우리 DB 와 대조한다(sendon `find` API).
 */
export interface SmsGroupCounts {
  /** sendon 조회 성공 여부. false 면 reason 에 사유. */
  ok: boolean;
  /** 발송 성공 건수(succeededCount). */
  succeeded: number;
  /** 발송 실패 건수(failedCount). */
  failed: number;
  /** 취소 건수(canceledCount). */
  canceled: number;
  /** 수신거부 차단 건수(blockedCount). */
  blocked: number;
  /** 발송 중 건수(sendingCount). */
  sending: number;
  /** 예약 대기 등 그 외 건수(전체 - 위 합). */
  pending: number;
  /** 그룹 전체 건수(totalCount). */
  total: number;
  /** 조회 실패 사유(ok=false 일 때). */
  reason?: string;
}

/**
 * groupId 안의 개별 메시지 1건(sendon listGroupMessages).
 * 실패 건 추적·재발송에 필요한 최소 필드만 추린다.
 */
export interface SmsGroupMessage {
  /** 수신번호(하이픈 포함 가능 — 사용 측에서 정규화). */
  to: string;
  /** sendon 결과 코드. */
  resultCode: string;
  /** sendon 결과 사유(사람이 읽는 문구). 예: "포인트 부족". */
  resultText: string;
}

/**
 * groupId 의 특정 상태(FAILED 등) 메시지 목록 조회 결과.
 * 한 groupId 가 수천 건이라 페이지네이션을 어댑터 내부에서 끝내고 합쳐서 돌려준다.
 */
export interface SmsGroupMessagesResult {
  /** 조회 성공 여부. false 면 reason 에 사유. */
  ok: boolean;
  /** 조회된 메시지 목록. */
  messages: SmsGroupMessage[];
  /** 조회 실패 사유(ok=false 일 때). */
  reason?: string;
}

/**
 * 예약 발송 취소 결과.
 *  - cancelled : sendon 예약이 정상 취소됨.
 *  - failed    : 취소 실패(이미 발송됨/발송 10분 전 경과/네트워크 등).
 */
export type SmsCancelResult =
  | { status: "cancelled" }
  | { status: "failed"; reason: string };

export interface SmsAdapter {
  readonly name: "sendon";
  send(req: SmsSendRequest): Promise<SmsSendResult>;
  /**
   * 다중 수신자 일괄 발송. 벤더 API 1회 호출로 다수 수신자에게 동시 적재.
   * 6만+ 대량 발송에서 send() N회 호출 (= N round-trip) 을 1회로 축소하는 핵심.
   */
  sendBatch(req: SmsBatchSendRequest): Promise<SmsBatchSendResult>;
  queryStatus(vendorMessageId: string): Promise<SmsStatusQueryResult>;
  /**
   * groupId 의 실제 처리 카운트 조회(sendon find API). 캠페인을 sendon 측 실제
   * 성공/실패와 대조하는 데 사용. queryStatus 는 1건 가정으로 status 하나만 주지만,
   * 본 메서드는 batch(보통 1,000건)의 카운트 분포를 그대로 돌려준다.
   */
  queryGroupCounts(vendorMessageId: string): Promise<SmsGroupCounts>;
  /**
   * groupId 안에서 특정 상태(messageStatus, 예: "FAILED")인 개별 메시지 목록 조회.
   * queryGroupCounts 는 합계만 주지만, 본 메서드는 실제 수신번호·실패 사유까지 준다.
   * 실패 건 재발송 대상을 sendon 기준으로 확정하는 데 쓴다(우리 DB 가 실패를 모를 때).
   * 어댑터 내부에서 페이지를 순회해 합쳐 돌려준다.
   *
   * @param maxMessages 이만큼 모이면 조기 중단(샘플 용도). 미지정이면 전 페이지 순회.
   *   사유 표시처럼 표본만 필요할 때 작은 값을 줘 라운드트립·지연을 줄인다.
   */
  listGroupMessages(
    vendorMessageId: string,
    messageStatus: string,
    maxMessages?: number,
  ): Promise<SmsGroupMessagesResult>;
  /**
   * 예약 발송 취소. groupId(vendorMessageId) 로 sendon 예약을 취소한다.
   * sendon 제약: 예약 발송 시각 10분 전까지만 가능.
   */
  cancel(vendorMessageId: string): Promise<SmsCancelResult>;
}

/**
 * 어댑터 동작 모드.
 *  - 'mock': 실제 벤더 호출 없이 고정 응답. 개발/테스트용.
 *  - 'live': 실제 벤더 API 호출.
 */
export type AdapterMode = "mock" | "live";
