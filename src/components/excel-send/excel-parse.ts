/**
 * 엑셀 보내기 전용 파싱·검증 유틸 (순수 함수).
 *
 * - 업로드 파일(.xlsx/.xls)의 첫 시트에서 이름/연락처 2열을 뽑아낸다.
 * - 헤더명은 유연하게 매칭(이름/성명, 연락처/전화/휴대폰/번호).
 * - 번호 정규화·정규식 검증·중복 표시까지 담당.
 *
 * xlsx 라이브러리는 번들 부담이 커 호출부에서 동적 import 해 넘겨준다.
 * 이 파일은 IO/환경변수/Supabase 접근 없음.
 */

/** 한 행의 검증 상태. 우선순위: 잘못된 번호 > 중복 > 수신거부 > 정상. */
export type ExcelRowStatus = "ok" | "invalid" | "duplicate" | "unsubscribed";

/** 미리보기·발송에 쓰이는 파싱된 한 행. */
export interface ParsedRecipientRow {
  /** 0부터 시작하는 원본 행 인덱스(데이터 행 기준). */
  index: number;
  /** 엑셀에 적힌 이름 원문(공백 trim). 빈 값 허용. */
  name: string;
  /** 표시용 정규화 전 원문 연락처. */
  rawPhone: string;
  /** 숫자만 남긴 정규화 번호. 검증·발송·중복 판정 기준. */
  phone: string;
  status: ExcelRowStatus;
}

/** 헤더명 유연 매칭 — 이름 컬럼 후보. */
const NAME_HEADERS = ["이름", "성명", "name"];
/** 헤더명 유연 매칭 — 연락처 컬럼 후보. */
const PHONE_HEADERS = ["연락처", "전화", "전화번호", "휴대폰", "핸드폰", "번호", "phone"];

/** 휴대폰 정규식(숫자만 기준). 010/011/016/017/018/019 + 7~8자리. */
const MOBILE_RE = /^01[016789][0-9]{7,8}$/;

/** xlsx 의 sheet_to_json(header:1) 산출물 형태. */
type SheetAoa = unknown[][];

/** 셀 값을 문자열로 정규화. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** 헤더 문자열을 비교용으로 정규화(공백 제거 + 소문자). */
function headerKey(h: string): string {
  return cell(h).replace(/\s+/g, "").toLowerCase();
}

/** 번호에서 숫자만 추출. */
export function normalizeDigits(raw: string): string {
  return cell(raw).replace(/\D/g, "");
}

/** 휴대폰 형식 여부. */
export function isValidMobile(digits: string): boolean {
  return MOBILE_RE.test(digits);
}

/**
 * 헤더 후보 목록 중 첫 일치 컬럼 인덱스를 찾는다. 없으면 -1.
 * 정확 일치 우선, 없으면 부분 포함으로 한 번 더 시도.
 */
function findColumn(headers: string[], candidates: string[]): number {
  const keys = headers.map(headerKey);
  const cands = candidates.map((c) => c.toLowerCase());
  // 1) 정확 일치
  for (let i = 0; i < keys.length; i++) {
    if (cands.includes(keys[i])) return i;
  }
  // 2) 부분 포함 (예: "학부모연락처" 안에 "연락처")
  for (let i = 0; i < keys.length; i++) {
    if (cands.some((c) => keys[i].includes(c))) return i;
  }
  return -1;
}

export type ExtractResult =
  | { ok: true; rows: ParsedRecipientRow[] }
  | { ok: false; reason: string };

/**
 * xlsx 의 sheet_to_json(header:1) 2차원 배열에서 이름/연락처를 추출.
 * 검증·중복 판정까지 끝낸 ParsedRecipientRow[] 반환.
 * 수신거부 플래그는 이후 서버 조회 결과로 applyUnsubscribed() 가 입힌다.
 */
export function extractRecipients(aoa: SheetAoa): ExtractResult {
  if (!aoa || aoa.length === 0) {
    return { ok: false, reason: "빈 파일입니다. 이름과 연락처가 담긴 엑셀을 올려주세요." };
  }

  const headerRow = (aoa[0] ?? []).map((c) => cell(c));
  const phoneCol = findColumn(headerRow, PHONE_HEADERS);
  if (phoneCol === -1) {
    return {
      ok: false,
      reason:
        "연락처 열을 찾지 못했습니다. 첫 행에 '연락처'(또는 전화/휴대폰/번호) 머리글이 있어야 합니다.",
    };
  }
  const nameCol = findColumn(headerRow, NAME_HEADERS);

  const rows: ParsedRecipientRow[] = [];
  const seen = new Set<string>();

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const rawPhone = cell(row[phoneCol]);
    const name = nameCol >= 0 ? cell(row[nameCol]) : "";
    // 이름·연락처 모두 빈 행은 건너뛴다.
    if (rawPhone === "" && name === "") continue;

    const phone = normalizeDigits(rawPhone);
    let status: ExcelRowStatus;
    if (!isValidMobile(phone)) {
      status = "invalid";
    } else if (seen.has(phone)) {
      status = "duplicate";
    } else {
      seen.add(phone);
      status = "ok";
    }

    rows.push({ index: rows.length, name, rawPhone, phone, status });
  }

  if (rows.length === 0) {
    return {
      ok: false,
      reason: "발송할 행이 없습니다. 머리글 아래에 명단을 입력했는지 확인해주세요.",
    };
  }

  return { ok: true, rows };
}

/**
 * 서버에서 받은 수신거부 번호 집합을 미리보기 행에 반영.
 * status 가 "ok" 인 행만 대상으로 unsubscribed 로 강등(잘못된 번호·중복은 유지).
 * 입력 phones 는 정규화된 숫자 문자열 집합이어야 한다.
 */
export function applyUnsubscribed(
  rows: ParsedRecipientRow[],
  unsubscribed: ReadonlySet<string>,
): ParsedRecipientRow[] {
  if (unsubscribed.size === 0) return rows;
  return rows.map((row) =>
    row.status === "ok" && unsubscribed.has(row.phone)
      ? { ...row, status: "unsubscribed" as const }
      : row,
  );
}

/** 상태별 집계. 요약 줄·발송 버튼 활성 판정에 사용. */
export interface RecipientSummary {
  total: number;
  /** 실제 발송 대상(ok + unsubscribed — 수신거부는 서버가 거르지만 포함해 보냄). */
  sendable: number;
  ok: number;
  invalid: number;
  duplicate: number;
  unsubscribed: number;
}

export function summarize(rows: ParsedRecipientRow[]): RecipientSummary {
  let ok = 0;
  let invalid = 0;
  let duplicate = 0;
  let unsubscribed = 0;
  for (const row of rows) {
    if (row.status === "ok") ok++;
    else if (row.status === "invalid") invalid++;
    else if (row.status === "duplicate") duplicate++;
    else unsubscribed++;
  }
  return {
    total: rows.length,
    sendable: ok + unsubscribed,
    ok,
    invalid,
    duplicate,
    unsubscribed,
  };
}

/**
 * 서버 액션으로 보낼 수신자 목록을 만든다.
 * - 잘못된 번호 제외, 중복 제외(1회로 정리), 수신거부는 포함(서버가 실패로 기록).
 */
export function buildSendRecipients(
  rows: ParsedRecipientRow[],
): { name: string; phone: string }[] {
  return rows
    .filter((row) => row.status === "ok" || row.status === "unsubscribed")
    .map((row) => ({ name: row.name, phone: row.phone }));
}
