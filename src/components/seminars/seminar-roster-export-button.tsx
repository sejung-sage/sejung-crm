"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { ClassStudentRow } from "@/types/database";
import type { ClassSignupParentRow } from "@/lib/seminars/get-class-signup-page";
import { formatPhone } from "@/lib/phone";

interface Props {
  /** 파일명·시트명에 쓰일 설명회(강좌)명. */
  className: string;
  /** 아카(Aca2000) 등록 수강생. */
  acaStudents: ClassStudentRow[];
  /** CRM 공개 신청 페이지에서 신청 완료(signed)한 학부모/학생. */
  crmSignups: ClassSignupParentRow[];
}

/** 인쇄용 명단의 한 사람. 아카+CRM 을 student_id 로 합친 중복 제거 결과. */
interface Person {
  name: string;
  school: string;
  grade: string;
  phone: string;
}

const BLOCK_SIZE = 50; // 세로 한 묶음 인원
const HEADERS = ["순번", "이름", "학교", "학년", "전화번호"] as const;
const GAP = 1; // 묶음 사이 빈 열
const STRIDE = HEADERS.length + GAP; // 묶음 하나가 차지하는 열 수(6)

// A3 인쇄 시 50행이 한 면에 들어가도록 한 행 높이(pt). 11pt 글꼴 기준 가독성 유지.
const ROW_TITLE = 22; // 제목 배너
const ROW_HEADER = 18; // 헤더(순번·이름…)
const ROW_DATA = 14; // 데이터 행 (50행이 A3 한 면에 들어가도록 약간 컴팩트)

/**
 * 설명회 명단(아카 등록 + CRM 신청)을 A3/B4 인쇄용 엑셀로 내려받는 버튼.
 *
 * 양식: 세로 50명씩 한 묶음, 묶음을 오른쪽으로 나란히 붙여 한 장에 많이 인쇄.
 *  - 아카·CRM 을 student_id 로 합쳐 중복 1회 (이름 한글 오름차순).
 *  - 컬럼: 순번 · 이름 · 학교 · 학년 · 전화번호.
 *  - 전화번호는 호명·연락 용도라 마스킹 없이 전부 노출.
 *  - xlsx 는 번들 부담이 커 클릭 시 동적 import.
 */
export function SeminarRosterExportButton({
  className,
  acaStudents,
  crmSignups,
}: Props) {
  const [busy, setBusy] = useState(false);

  const total = acaStudents.length + crmSignups.length;
  const disabled = busy || total === 0;

  const handleDownload = async () => {
    if (disabled) return;
    setBusy(true);
    try {
      const people = buildPeople(acaStudents, crmSignups);
      // 색상·병합(제목) 지원 위해 xlsx-js-style 사용(가져오기 파서의 xlsx 와 별개).
      const XLSX = await import("xlsx-js-style");
      const blocks = Math.max(1, Math.ceil(people.length / BLOCK_SIZE));
      const usedCols = blocks * STRIDE - GAP; // 맨 끝 간격 열 제외

      // 1행: 제목(설명회명) 배너 → 헤더 → 데이터.
      const aoa: (string | number)[][] = [[className], ...buildSheetAoa(people)];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = buildColWidths(people.length);
      // 제목을 전체 폭으로 병합.
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, usedCols - 1) } },
      ];

      // A3 한 면에 50행이 다 들어가도록 — 행 높이를 약간 줄이고 여백을 좁힌다.
      // (xlsx-js-style 은 page fit-to 설정을 못 써서, 행 높이·여백으로 맞춘다.
      //  기본 여백 상하 1.9cm 씩을 0.25" 로 줄이면 행을 5~6개 더 넣을 수 있다.)
      ws["!rows"] = aoa.map((_, r) =>
        r === 0
          ? { hpt: ROW_TITLE }
          : r === 1
            ? { hpt: ROW_HEADER }
            : { hpt: ROW_DATA },
      );
      ws["!margins"] = {
        left: 0.2,
        right: 0.2,
        top: 0.25,
        bottom: 0.25,
        header: 0.1,
        footer: 0.1,
      };

      // 2) 셀 스타일 — 제목/헤더/번호칸 색 + 테두리.
      applyStyles(XLSX, ws, aoa, usedCols);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "명단");
      XLSX.writeFile(wb, `${safeFileName(className)}_명단.xlsx`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={disabled}
      className="
        inline-flex items-center justify-center gap-1.5
        h-9 px-3 rounded-lg
        text-[14px] font-medium
        text-[color:var(--text-muted)]
        border border-[color:var(--border)] bg-bg-card
        hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-colors
      "
      title={total === 0 ? "내보낼 명단이 없습니다" : undefined}
    >
      <Download className="size-4" strokeWidth={1.75} aria-hidden />
      {busy ? "내보내는 중..." : "엑셀 다운로드"}
    </button>
  );
}

/**
 * 아카·CRM 두 명단을 student_id 기준으로 합쳐 중복 1회. 이름 한글 오름차순.
 * 학교·학년·전화번호는 아카 값 우선, 없으면 CRM 신청 값 사용.
 */
function buildPeople(
  acaStudents: ClassStudentRow[],
  crmSignups: ClassSignupParentRow[],
): Person[] {
  const acaById = new Map(acaStudents.map((s) => [s.id, s]));
  const crmById = new Map(crmSignups.map((p) => [p.student_id, p]));
  const allIds = new Set<string>([...acaById.keys(), ...crmById.keys()]);

  const people: Person[] = [];
  for (const id of allIds) {
    const aca = acaById.get(id);
    const crm = crmById.get(id);
    const rawPhone = aca?.parent_phone ?? crm?.parent_phone ?? null;
    people.push({
      name: aca?.name ?? crm?.student_name ?? "",
      school: aca?.school ?? crm?.school ?? "",
      grade: String(aca?.grade ?? crm?.grade ?? ""),
      phone: rawPhone ? formatPhone(rawPhone) || rawPhone : "",
    });
  }

  people.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return people;
}

/**
 * 사람 목록을 50명씩 끊어 오른쪽으로 나란히 배치한 시트(AoA)로.
 * 묶음 b 는 [b*STRIDE .. b*STRIDE+4] 열을 쓰고, 그 옆 한 열은 빈 칸(간격).
 */
function buildSheetAoa(people: Person[]): (string | number)[][] {
  const blocks = Math.max(1, Math.ceil(people.length / BLOCK_SIZE));
  const aoa: (string | number)[][] = [];

  const header: (string | number)[] = [];
  for (let b = 0; b < blocks; b++) {
    HEADERS.forEach((h, ci) => {
      header[b * STRIDE + ci] = h;
    });
  }
  aoa.push(header);

  for (let r = 0; r < BLOCK_SIZE; r++) {
    const row: (string | number)[] = [];
    let any = false;
    for (let b = 0; b < blocks; b++) {
      const idx = b * BLOCK_SIZE + r;
      const p = people[idx];
      if (!p) continue;
      any = true;
      const base = b * STRIDE;
      row[base + 0] = idx + 1; // 순번(전체 통산)
      row[base + 1] = p.name;
      row[base + 2] = p.school;
      row[base + 3] = p.grade;
      row[base + 4] = p.phone;
    }
    if (any) aoa.push(row);
  }
  return aoa;
}

/** 묶음 수만큼 컬럼 폭을 반복 지정(간격 열 포함). */
function buildColWidths(personCount: number): { wch: number }[] {
  const blocks = Math.max(1, Math.ceil(personCount / BLOCK_SIZE));
  const per = [
    { wch: 5 }, // 순번
    { wch: 10 }, // 이름
    { wch: 14 }, // 학교
    { wch: 7 }, // 학년
    { wch: 16 }, // 전화번호
  ];
  const cols: { wch: number }[] = [];
  for (let b = 0; b < blocks; b++) {
    cols.push(...per);
    if (b < blocks - 1) cols.push({ wch: 2 }); // 묶음 간격
  }
  return cols;
}

// ─── 셀 스타일(xlsx-js-style) ───────────────────────────────

const THIN = { style: "thin", color: { rgb: "B7B7B7" } };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/** 제목 배너 — 연한 파랑, 굵게, 가운데. */
const TITLE_STYLE = {
  font: { bold: true, sz: 14 },
  alignment: { horizontal: "center", vertical: "center" },
  fill: { fgColor: { rgb: "BDD7EE" } },
};
/** 헤더(순번·이름·학교·학년·전화번호) — 초록, 굵게, 가운데, 테두리. */
const HEADER_STYLE = {
  font: { bold: true },
  alignment: { horizontal: "center", vertical: "center" },
  fill: { fgColor: { rgb: "A9D08E" } },
  border: BORDER,
};
/** 번호(순번) 칸 — 연초록, 가운데, 테두리. */
const NUMBER_STYLE = {
  alignment: { horizontal: "center", vertical: "center" },
  fill: { fgColor: { rgb: "C6E0B4" } },
  border: BORDER,
};
/** 일반 데이터 칸 — 테두리만. */
const DATA_STYLE = {
  alignment: { vertical: "center" },
  border: BORDER,
};

/**
 * 시트 셀에 스타일 적용. 제목(0행) / 헤더(1행) / 데이터(2행~).
 * 빈 칸(블록 간격 열·마지막 블록 빈자리)은 건너뛴다.
 */
function applyStyles(
  XLSX: typeof import("xlsx-js-style"),
  ws: Record<string, unknown>,
  aoa: (string | number)[][],
  usedCols: number,
): void {
  const titleRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[titleRef]) (ws[titleRef] as { s?: unknown }).s = TITLE_STYLE;

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    for (let c = 0; c < usedCols; c++) {
      const v = row[c];
      if (v === undefined || v === null || v === "") continue;
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref] as { s?: unknown } | undefined;
      if (!cell) continue;
      const isHeader = r === 1;
      const isNumberCol = c % STRIDE === 0;
      cell.s = isHeader
        ? HEADER_STYLE
        : isNumberCol
          ? NUMBER_STYLE
          : DATA_STYLE;
    }
  }
}

/** 파일명에 못 쓰는 문자 제거. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "설명회";
}
