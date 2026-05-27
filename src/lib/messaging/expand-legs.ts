/**
 * F3 · 발송 대상 번호 선택(학부모/학생) 레그(leg) 확장 (0077).
 *
 * 학생 row 1개 → 최대 2개의 발송 레그(Recipient)로 확장한다:
 *   - 학부모 레그: send_to_parent && parent_phone 존재 → phone = parent_phone(정규화)
 *   - 학생   레그: send_to_student && phone 존재        → phone = student.phone(정규화)
 * 번호가 없는 레그는 스킵(학생 1명이 0·1·2 레그가 될 수 있다).
 *
 * ── 레그별 수신거부 (가드 강화, 약화 아님) ──────────────────
 *   종전 파이프라인은 SQL 단에서 parent_phone 기준으로 수신거부를 걸렀다.
 *   레그 모델에서는 학부모 번호 수신거부가 학생 번호 레그를 죽이면 안 되므로,
 *   수신거부 제외를 "학생 row 제외"가 아니라 "레그 제외"로 이동한다.
 *   두 번호를 모두 로드한 뒤 레그를 펼치는 본 함수에서 레그의 번호를 기준으로
 *   독립 판정한다. (탈퇴 학생은 행 자체 제외 — `loadAllGroupRecipients` 가 SQL
 *   단에서 status='탈퇴' 를 이미 거른다. 레그 무관.)
 *
 * ── {이름} 개인화 ───────────────────────────────────────────
 *   학부모·학생 어느 레그든 name = 해당 학생 이름. dedupe ↔ {이름} 상호배타
 *   규칙은 불변(Zod refine 이 강제).
 *
 * 산출 순서(architect 계약): 레그 확장(본 함수) → 발송 안전 가드 → dedupe.
 * 따라서 본 함수의 출력은 그대로 `applyAllGuards({ recipients })` 입력이 된다.
 * (본 함수가 이미 레그별 수신거부를 적용하므로 가드에는 unsubscribedPhones=[]
 *  를 넘긴다. 가드는 탈퇴/야간/본문 변환만 책임.)
 *
 * 순수 함수. 외부 IO 없음 (수신거부 목록은 호출자가 주입).
 */

import type { Recipient } from "./guards";
import type { GroupRecipient } from "@/lib/groups/load-all-group-recipients";

export interface ExpandLegsOptions {
  /** 학부모 대표번호(parent_phone) 레그 생성 여부. campaign.send_to_parent. */
  sendToParent: boolean;
  /** 학생 개인번호(phone) 레그 생성 여부. campaign.send_to_student. */
  sendToStudent: boolean;
  /**
   * 수신거부 번호(하이픈 유무 무관). 레그별 번호 기준으로 독립 판정해 제외.
   * 미주입(기본 빈 배열)이면 레그별 수신거부 필터 미적용.
   */
  unsubscribedPhones?: string[];
}

/**
 * GroupRecipient(학생 row) 배열 → 발송 레그(Recipient) 배열.
 *
 * 입력 순서를 보존하되, 한 학생에서 학부모 레그를 먼저, 학생 레그를 다음에
 * push 한다. `loadAllGroupRecipients` 가 registered_at DESC 순으로 반환하므로
 * 후속 dedupe(collapseByPhone) 의 "첫 row 대표 유지" 규약과 자연스럽게 맞는다.
 *
 * @param rows  탈퇴 제외된 학생 row (parent_phone·phone 모두 SELECT 된 상태).
 * @param opts  발송 대상 토글 + 수신거부 목록.
 */
export function expandRecipientLegs(
  rows: GroupRecipient[],
  opts: ExpandLegsOptions,
): Recipient[] {
  const { sendToParent, sendToStudent } = opts;
  const unsubSet = buildUnsubSet(opts.unsubscribedPhones ?? []);

  const legs: Recipient[] = [];
  for (const r of rows) {
    if (sendToParent) {
      pushLeg(legs, r, r.parent_phone, unsubSet);
    }
    if (sendToStudent) {
      pushLeg(legs, r, r.phone, unsubSet);
    }
  }
  return legs;
}

/**
 * 한 레그를 검증·정규화 후 push.
 *   - 번호 결측/빈 값 → 스킵.
 *   - 레그 번호가 수신거부 목록에 있으면 → 스킵(레그별 독립 판정).
 */
function pushLeg(
  out: Recipient[],
  row: GroupRecipient,
  rawPhone: string | null,
  unsubSet: Set<string>,
): void {
  const norm = normalizePhone(rawPhone);
  if (!norm) return;
  if (unsubSet.has(norm)) return;
  out.push({
    studentId: row.id,
    phone: norm,
    name: row.name,
    // 탈퇴는 loadAllGroupRecipients 가 SQL 단에서 이미 제외. 안전상 status 동봉.
    status: row.status,
  });
}

/**
 * 레그 배열에서 고유 학생 수(사람 수)를 센다. null studentId 는 각각 1명으로 계수.
 * collapseByPhone 의 targetStudents 주입용 — 레그 0개인 학생은 자동 제외되어
 * 불변식 legs >= targetStudents 가 보장된다.
 */
export function countDistinctStudents(
  legs: { studentId: string | null }[],
): number {
  const ids = new Set<string>();
  let nullCount = 0;
  for (const r of legs) {
    if (r.studentId === null) nullCount += 1;
    else ids.add(r.studentId);
  }
  return ids.size + nullCount;
}

function buildUnsubSet(unsubscribedPhones: string[]): Set<string> {
  const set = new Set<string>();
  for (const p of unsubscribedPhones) {
    const norm = normalizePhone(p);
    if (norm) set.add(norm);
  }
  return set;
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
