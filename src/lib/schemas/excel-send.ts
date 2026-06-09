/**
 * "엑셀 보내기" 입력 Zod 스키마 (F3 세 번째 발송 방식).
 *
 * 업로드 파싱(xlsx → 행 배열)은 frontend(클라) 책임. 서버는 이 스키마로 재검증한
 * 뒤 발송 안전 가드를 적용한다. DB 스키마 변경 없이 crm_campaigns(group_id NULL
 * 허용) · crm_messages 를 재사용한다.
 *
 * 정책:
 *  - phone 은 하이픈 유무 무관 — 서버에서 숫자만 정규화 후 휴대폰 형식 검증.
 *  - LMS 가 아니면 subject 는 무시(코어에서 SMS 일 때 null 처리).
 *  - 바이트 한도(SMS 90 / LMS 2000)는 입력 단계가 아니라 발송 직전 코어에서
 *    한 번 더 검증해 초과 시 해당 건을 '실패' 처리한다.
 *  - 한 번에 최대 5,000명 (대량 발송 상한 · CLAUDE.md 발송 안전 가드).
 *
 * 메시지는 모두 한글(40~60대 사용자 배려).
 */

import { z } from "zod";

/** 엑셀 한 행 = 수신자 1명. name 은 선택, phone 은 필수. */
export const ExcelRecipientSchema = z.object({
  name: z.string().trim().max(40).default(""),
  phone: z.string().trim().min(1),
});

export type ExcelRecipient = z.infer<typeof ExcelRecipientSchema>;

/** 엑셀 보내기 발송 입력 전체. */
export const ExcelSendInputSchema = z.object({
  recipients: z
    .array(ExcelRecipientSchema)
    .min(1, "수신자가 없습니다")
    .max(5000, "한 번에 최대 5,000명까지 보낼 수 있습니다"),
  type: z.enum(["SMS", "LMS"]),
  subject: z.string().trim().max(120).nullable().default(null),
  body: z.string().trim().min(1, "본문은 필수입니다"),
  isAd: z.boolean().default(false),
});

export type ExcelSendInput = z.infer<typeof ExcelSendInputSchema>;
