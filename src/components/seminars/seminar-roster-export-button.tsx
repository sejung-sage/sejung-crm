"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { ClassStudentRow } from "@/types/database";
import type { ClassSignupParentRow } from "@/lib/seminars/get-class-signup-page";
import { formatPhone, maskPhone } from "@/lib/phone";
import { formatKstDateTime } from "@/lib/datetime";

interface Props {
  /** 파일명·시트명에 쓰일 설명회(강좌)명. */
  className: string;
  /** 아카(Aca2000) 등록 수강생. */
  acaStudents: ClassStudentRow[];
  /** CRM 공개 신청 페이지에서 신청 완료(signed)한 학부모/학생. */
  crmSignups: ClassSignupParentRow[];
  /** 학부모 연락처 풀 노출 권한. master 만 true — false 면 마스킹된 번호로 내보낸다. */
  canRevealPhone: boolean;
}

/** 한 학생의 통합(아카+CRM) 명단 행. */
interface ExportRow {
  이름: string;
  출처: string;
  학교: string;
  학년: string;
  학부모연락처: string;
  출석: string;
  "CRM 신청일시": string;
}

/**
 * 설명회 명단(아카 등록 + CRM 신청)을 하나의 엑셀로 내려받는 버튼.
 *
 * - 두 출처를 student_id 기준으로 합쳐 1행/학생, 출처 컬럼(아카 / CRM / 아카+CRM)으로 구분.
 * - 학부모 연락처는 권한(canRevealPhone)에 따라 원문 또는 마스킹.
 * - xlsx 는 번들 부담이 커 클릭 시 동적 import (가져오기 파서와 동일 라이브러리).
 */
export function SeminarRosterExportButton({
  className,
  acaStudents,
  crmSignups,
  canRevealPhone,
}: Props) {
  const [busy, setBusy] = useState(false);

  const total = acaStudents.length + crmSignups.length;
  const disabled = busy || total === 0;

  const handleDownload = async () => {
    if (disabled) return;
    setBusy(true);
    try {
      const rows = buildRows(acaStudents, crmSignups, canRevealPhone);
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(rows, {
        header: [
          "이름",
          "출처",
          "학교",
          "학년",
          "학부모연락처",
          "출석",
          "CRM 신청일시",
        ],
      });
      // 컬럼 폭 — 한글 가독성 위해 대략치 지정.
      ws["!cols"] = [
        { wch: 10 },
        { wch: 10 },
        { wch: 14 },
        { wch: 8 },
        { wch: 16 },
        { wch: 8 },
        { wch: 18 },
      ];
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
      title={total === 0 ? "내보낼 명단이 없습니다" : "아카·CRM 명단을 엑셀로 받기"}
    >
      <Download className="size-4" strokeWidth={1.75} aria-hidden />
      {busy ? "내보내는 중..." : "엑셀 다운로드"}
    </button>
  );
}

/**
 * 아카·CRM 두 명단을 student_id 기준으로 합쳐 ExportRow[] 로.
 * 양쪽에 있으면 한 행으로 머지하고 출처를 "아카+CRM" 으로 표시.
 * 이름 한글 오름차순 정렬.
 */
function buildRows(
  acaStudents: ClassStudentRow[],
  crmSignups: ClassSignupParentRow[],
  canRevealPhone: boolean,
): ExportRow[] {
  const acaById = new Map(acaStudents.map((s) => [s.id, s]));
  const crmById = new Map(crmSignups.map((p) => [p.student_id, p]));
  const allIds = new Set<string>([...acaById.keys(), ...crmById.keys()]);

  const phoneCell = (raw: string | null): string => {
    if (!raw) return "";
    return canRevealPhone ? formatPhone(raw) || raw : maskPhone(raw);
  };

  const rows: ExportRow[] = [];
  for (const id of allIds) {
    const aca = acaById.get(id);
    const crm = crmById.get(id);
    const source =
      aca && crm ? "아카+CRM" : aca ? "아카" : "CRM";
    rows.push({
      이름: aca?.name ?? crm?.student_name ?? "",
      출처: source,
      학교: aca?.school ?? "",
      학년: aca?.grade ?? "",
      학부모연락처: phoneCell(aca?.parent_phone ?? crm?.parent_phone ?? null),
      출석: aca ? `${aca.attended_count}/${aca.total_count}` : "",
      "CRM 신청일시": crm ? formatKstDateTime(crm.signed_at) : "",
    });
  }

  rows.sort((a, b) => a.이름.localeCompare(b.이름, "ko"));
  return rows;
}

/** 파일명에 못 쓰는 문자 제거. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "설명회";
}
