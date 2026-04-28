/**
 * F1-03 · CSV/XLSX 파일 파싱 유틸
 *
 * 책임:
 *  - 확장자별로 papaparse / xlsx 라이브러리 분기
 *  - 첫 행 헤더를 한/영 양쪽에서 수용하도록 정규화
 *  - 반환은 `Record<string, unknown>[]` + `headerNormalizationMap`
 *
 * 책임 밖:
 *  - 도메인 검증(Zod) — validate.ts 담당
 *  - DB 적용 — apply.ts 담당
 */
import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ParsedRawRow = Record<string, unknown>;

export type ParseResult = {
  rows: ParsedRawRow[];
  headerNormalizationMap: Record<string, string>;
};

/**
 * 허용 확장자.
 */
const CSV_EXTENSIONS = new Set([".csv"]);
const XLSX_EXTENSIONS = new Set([".xlsx", ".xls"]);

/**
 * 헤더 한/영 매핑.
 *  - key: 사용자가 업로드 파일에 적을 수 있는 헤더 (한글/영문 모두)
 *  - value: DB/스키마 상의 영문 필드명
 *
 * 동일 영문 필드에 다수 한글 표현이 매핑될 수 있음.
 * "상태" 는 students.status / attendances.status 에 동시 매핑되므로
 * 문맥상 동일한 영문명("status") 사용. 하위 validator 에서 문맥별로 파싱.
 */
const HEADER_MAP: Record<string, string> = {
  // 학생
  "학부모 연락처": "parent_phone",
  학부모연락처: "parent_phone",
  부모번호: "parent_phone",
  학부모번호: "parent_phone",
  parent_phone: "parent_phone",
  "학생 이름": "name",
  학생이름: "name",
  이름: "name",
  name: "name",
  학교: "school",
  school: "school",
  학년: "grade",
  grade: "grade",
  계열: "track",
  track: "track",
  "재원 상태": "status",
  재원상태: "status",
  상태: "status",
  status: "status",
  분원: "branch",
  branch: "branch",
  등록일: "registered_at",
  registered_at: "registered_at",
  "아카2000 ID": "aca2000_id",
  "아카2000 아이디": "aca2000_id",
  아카2000id: "aca2000_id",
  aca2000_id: "aca2000_id",
  "학생 연락처": "phone",
  학생연락처: "phone",
  "학생 번호": "phone",
  학생번호: "phone",
  phone: "phone",

  // 수강/결제
  "수업 내용": "course_name",
  수업내용: "course_name",
  강좌명: "course_name",
  과목명: "course_name",
  course_name: "course_name",
  강사명: "teacher_name",
  선생님: "teacher_name",
  teacher_name: "teacher_name",
  과목: "subject",
  subject: "subject",
  금액: "amount",
  "결제 금액": "amount",
  결제금액: "amount",
  amount: "amount",
  결제일: "paid_at",
  paid_at: "paid_at",
  개강일: "start_date",
  start_date: "start_date",
  종강일: "end_date",
  end_date: "end_date",

  // 출석
  출석일: "attended_at",
  attended_at: "attended_at",
  "출석 상태": "status",
  출석상태: "status",
};

/**
 * 헤더 문자열 → 표준 키 변환.
 *  - 공백/BOM 제거
 *  - 소문자 비교는 하지 않음 (한글 키와 혼동 방지, 영문 키는 원본 준수)
 *  - 매핑에 없으면 원본(trim) 그대로 반환
 */
export function normalizeHeader(header: string): string {
  const cleaned = stripBom(String(header)).trim();
  if (cleaned === "") return "";
  // 공백을 제거한 키와 그대로의 키 두 가지를 모두 시도
  const collapsed = cleaned.replace(/\s+/g, " ");
  if (HEADER_MAP[collapsed]) return HEADER_MAP[collapsed];
  const stripped = cleaned.replace(/\s+/g, "");
  if (HEADER_MAP[stripped]) return HEADER_MAP[stripped];
  return cleaned;
}

function stripBom(s: string): string {
  return s.replace(/^﻿/, "");
}

function extOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.[^.]+$/);
  return m ? m[0] : "";
}

/**
 * File → ParseResult.
 * 비어있거나 헤더만 있는 경우에도 에러를 던지지 않고 빈 rows 반환.
 */
export async function parseFile(file: File): Promise<ParseResult> {
  const ext = extOf(file.name);
  if (CSV_EXTENSIONS.has(ext)) {
    return parseCsv(file);
  }
  if (XLSX_EXTENSIONS.has(ext)) {
    return parseXlsx(file);
  }
  throw new Error(
    `지원하지 않는 파일 형식입니다: ${ext || "(확장자 없음)"} · CSV/XLSX 만 허용`,
  );
}

async function parseCsv(file: File): Promise<ParseResult> {
  const text = stripBom(await file.text());

  // 1) 헤더만 먼저 파싱해서 정규화 맵 만든 뒤
  //    raw 를 object mode 로 다시 파싱 (transformHeader 는 callback 형태만 가능).
  const map: Record<string, string> = {};
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => {
      const normalized = normalizeHeader(h);
      map[h] = normalized;
      return normalized;
    },
  });

  const rows: ParsedRawRow[] = (result.data ?? []).filter(
    (r): r is ParsedRawRow =>
      r !== null && typeof r === "object" && !Array.isArray(r),
  );

  return { rows, headerNormalizationMap: map };
}

async function parseXlsx(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], headerNormalizationMap: {} };
  }
  const sheet = wb.Sheets[firstSheetName];
  if (!sheet) {
    return { rows: [], headerNormalizationMap: {} };
  }

  // header:1 로 2차원 배열 뽑아 헤더 직접 정규화.
  // raw:false → 셀 값을 문자열로 강제 (날짜 서식 유지). 단 defval 은 빈 문자열.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  if (aoa.length === 0) {
    return { rows: [], headerNormalizationMap: {} };
  }

  const rawHeaders = (aoa[0] as unknown[]).map((h) =>
    h === null || h === undefined ? "" : String(h),
  );
  const map: Record<string, string> = {};
  const normalizedHeaders = rawHeaders.map((h) => {
    const n = normalizeHeader(h);
    map[h] = n;
    return n;
  });

  const rows: ParsedRawRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    // 빈 행(모든 셀이 ""/null) 은 스킵
    if (
      !row ||
      row.every(
        (v) =>
          v === null || v === undefined || (typeof v === "string" && v.trim() === ""),
      )
    ) {
      continue;
    }
    const obj: ParsedRawRow = {};
    for (let j = 0; j < normalizedHeaders.length; j++) {
      const key = normalizedHeaders[j];
      if (!key) continue;
      obj[key] = row[j] ?? "";
    }
    rows.push(obj);
  }

  return { rows, headerNormalizationMap: map };
}
