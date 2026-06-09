"use server";

/**
 * "엑셀 보내기" Server Actions.
 *
 * 업로드 파싱(xlsx → 행 배열)은 클라이언트가 끝내고, 서버는 검증·가드·발송만
 * 담당한다. 인증/권한은 코어(excelSend) 가 다시 확인한다.
 *
 * ⚠️ "use server" 파일은 async 함수만 export — 타입/상수 export·재노출 금지.
 *    (최근 unsubscribes/actions 빌드에러 교훈) 반환 타입은 인라인으로 적고,
 *    구체 타입은 @/lib/messaging/excel-send 등에서 직접 import 한다.
 */

import { revalidatePath } from "next/cache";
import {
  excelSend,
  type ExcelSendResult,
} from "@/lib/messaging/excel-send";
import { ExcelSendInputSchema } from "@/lib/schemas/excel-send";
import { getUnsubscribedPhones } from "@/lib/messaging/unsubscribed-phones";

/**
 * 엑셀 발송 실행. input 을 ExcelSendInputSchema 로 검증(실패 시 failed + 한글
 * reason), 통과하면 excelSend 호출. /campaigns 재검증.
 */
export async function excelSendAction(
  input: unknown,
): Promise<ExcelSendResult> {
  const parsed = ExcelSendInputSchema.safeParse(input);
  if (!parsed.success) {
    const first =
      parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다";
    return {
      status: "failed",
      reason: first,
      skippedInvalid: 0,
      skippedUnsub: 0,
      deduped: 0,
    };
  }

  const result = await excelSend(parsed.data);
  revalidatePath("/campaigns");
  return result;
}

/**
 * 업로드 미리보기에서 수신거부 표시용 — 주어진 번호 중 수신거부인 것만 반환.
 * phones(string[]) 정규화 후 getUnsubscribedPhones 와 정규화 비교 교집합을
 * 돌려준다. 반환되는 번호는 입력 원본 문자열(클라가 그대로 매칭하도록).
 */
export async function checkUnsubscribedPhonesAction(
  phones: unknown,
): Promise<
  | { status: "success"; unsubscribed: string[] }
  | { status: "failed"; reason: string }
> {
  // 입력 방어 — 배열·문자열만 허용.
  if (!Array.isArray(phones)) {
    return { status: "failed", reason: "번호 목록 형식이 올바르지 않습니다" };
  }
  const inputs = phones.filter((p): p is string => typeof p === "string");

  let unsubPhones: string[];
  try {
    unsubPhones = await getUnsubscribedPhones();
  } catch (e) {
    return {
      status: "failed",
      reason:
        e instanceof Error ? e.message : "수신거부 목록 조회에 실패했습니다",
    };
  }

  // 수신거부 번호를 숫자만으로 정규화한 Set.
  const unsubSet = new Set<string>(
    unsubPhones
      .map((p) => p.replace(/\D/g, ""))
      .filter((p) => p.length > 0),
  );

  const matched: string[] = [];
  const seen = new Set<string>();
  for (const raw of inputs) {
    const norm = raw.replace(/\D/g, "");
    if (norm.length === 0) continue;
    if (seen.has(norm)) continue;
    if (unsubSet.has(norm)) {
      matched.push(raw);
      seen.add(norm);
    }
  }

  return { status: "success", unsubscribed: matched };
}
