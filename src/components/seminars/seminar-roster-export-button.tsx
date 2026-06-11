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
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(buildSheetAoa(people));
      ws["!cols"] = buildColWidths(people.length);
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

/** 파일명에 못 쓰는 문자 제거. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "설명회";
}
