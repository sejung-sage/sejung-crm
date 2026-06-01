"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Trash2, Download } from "lucide-react";
import type { InvitationItemStatus } from "@/types/database";
import type { InvitationSignupRow } from "@/lib/seminars/list-signups";
import { useToast } from "@/components/ui/toast";
import { formatKstDateTime } from "@/lib/datetime";
import { maskPhone, formatPhone } from "@/lib/phone";
import {
  cancelSignupAction,
  exportSignupsAction,
} from "@/app/(features)/seminars/actions";

/**
 * 설명회 신청 명단 테이블 (invitation 모델, 0082).
 *
 * 백엔드 변경:
 *  - `listSignups(seminarId)` 가 invitation_items JOIN 으로 재작성.
 *    한 행 = invitation_item 1개. invitation_id 포함.
 *  - cancelSignupAction 의 입력 키가 `signup_id` → `item_id` 로 변경.
 *  - exportSignupsAction 은 동일 시그니처(seminarId).
 *
 * 행 모양 (backend export):
 *  { item_id, invitation_id, student_id, student_name, parent_phone,
 *    status: InvitationItemStatus, signed_at, created_at? }
 *
 * - 검색(이름/전화)은 클라이언트에서 in-memory 필터(현재 페이지 한정).
 * - 카드 취소: confirm → cancelSignupAction({ item_id }) → revalidate.
 * - 엑셀 다운로드: exportSignupsAction (서버에서 권한별 마스킹 처리).
 * - 정렬: 신청 시각 역순(최신 위) — 서버 정렬 가정.
 */

interface Props {
  seminarId: string;
  signups: InvitationSignupRow[];
  /** master 만 평문 전화 노출. 그 외(admin)는 마스킹. */
  canRevealPhone: boolean;
}

export function SignupsTable({ seminarId, signups, canRevealPhone }: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return signups;
    const digits = q.replace(/\D/g, "");
    return signups.filter((s) => {
      if (s.student_name.includes(q)) return true;
      if (
        digits.length >= 2 &&
        s.parent_phone.replace(/\D/g, "").includes(digits)
      ) {
        return true;
      }
      return false;
    });
  }, [query, signups]);

  const handleCancel = (item_id: string, name: string) => {
    if (!confirm(`${name} 학생의 신청을 취소할까요?`)) return;
    setPendingId(item_id);
    startTransition(async () => {
      // backend(0082): CancelSignupInputSchema 의 `signup_id` 필드는 호환 유지용
      // 이름이고 실제로는 `crm_seminar_invitation_items.id`(=item_id) 를 받는다.
      const result = await cancelSignupAction({ signup_id: item_id });
      setPendingId(null);
      switch (result.status) {
        case "success":
          showToast("success", `${name} 학생의 신청을 취소했습니다`);
          router.refresh();
          break;
        case "dev_seed_mode":
          showToast(
            "success",
            "개발 시드 모드입니다. 실제 취소는 일어나지 않았습니다",
          );
          break;
        case "failed":
          showToast("error", result.reason ?? "취소에 실패했습니다");
          break;
      }
    });
  };

  const handleDownload = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportSignupsAction(seminarId);
      if (result.status === "dev_seed_mode") {
        showToast(
          "success",
          "개발 시드 모드입니다. 실제 파일은 생성되지 않았습니다",
        );
        return;
      }
      if (result.status === "failed") {
        showToast("error", result.reason ?? "다운로드에 실패했습니다");
        return;
      }
      // result.status === "success"
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("success", `엑셀 파일을 다운로드했습니다 (${result.rowCount}건)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "다운로드에 실패했습니다";
      showToast("error", msg);
    } finally {
      setIsExporting(false);
    }
  };

  if (signups.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-14 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          아직 발송된 초대가 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          좌측 메뉴 &lsquo;설명회 문자&rsquo; 에서 이 설명회로 발송해 보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 검색 + 다운로드 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 전화번호 검색"
            aria-label="신청자 검색"
            className="
              w-full h-10 pl-9 pr-9 rounded-lg
              bg-bg-card border border-[color:var(--border-strong)]
              text-[14px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--text)]
              transition-colors
            "
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex size-6 items-center justify-center rounded text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)]"
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={isExporting}
          className="
            inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
            border border-[color:var(--border-strong)] bg-bg-card
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            disabled:opacity-50
            transition-colors
          "
        >
          <Download className="size-4" strokeWidth={1.75} aria-hidden />
          {isExporting ? "다운로드 중..." : "엑셀 다운로드"}
        </button>
      </div>

      <p className="text-[13px] text-[color:var(--text-muted)]">
        총 <strong className="text-[color:var(--text)]">{filtered.length}</strong>건
        {query && ` · 전체 ${signups.length}건 중 검색`}
      </p>

      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
              <Th>학생 이름</Th>
              <Th className="w-44">학부모 전화</Th>
              <Th className="w-44">신청 시각</Th>
              <Th className="w-24">상태</Th>
              <Th className="w-16 text-right">작업</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-[14px] text-[color:var(--text-muted)]"
                >
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((s) => {
                const phoneRaw = s.parent_phone;
                const phoneDisplay = phoneRaw
                  ? canRevealPhone
                    ? formatPhone(phoneRaw)
                    : maskPhone(phoneRaw)
                  : "—";
                return (
                  <tr
                    key={s.item_id}
                    className={`
                      border-b border-[color:var(--border)] last:border-b-0
                      hover:bg-[color:var(--bg-hover)] transition-colors
                      ${s.status === "cancelled" ? "opacity-60" : ""}
                    `}
                  >
                    <Td>
                      <span className="font-medium text-[color:var(--text)]">
                        {s.student_name}
                      </span>
                    </Td>
                    <Td className="tabular-nums text-[color:var(--text-muted)]">
                      {phoneDisplay}
                    </Td>
                    <Td className="tabular-nums text-[13px] text-[color:var(--text-muted)]">
                      {s.signed_at
                        ? formatKstDateTime(s.signed_at)
                        : "—"}
                    </Td>
                    <Td>
                      <StatusBadge status={s.status} />
                    </Td>
                    <Td className="text-right">
                      {s.status === "signed" && (
                        <button
                          type="button"
                          onClick={() => handleCancel(s.item_id, s.student_name)}
                          disabled={pendingId === s.item_id}
                          aria-label={`${s.student_name} 신청 취소`}
                          title="신청 취소"
                          className="
                            inline-flex size-9 items-center justify-center rounded-md
                            text-[color:var(--text-muted)]
                            hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--danger)]
                            disabled:opacity-40
                            transition-colors
                          "
                        >
                          <Trash2
                            className="size-4"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: InvitationItemStatus }) {
  if (status === "signed") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
        style={{
          backgroundColor: "var(--success-bg)",
          color: "var(--success)",
        }}
      >
        신청
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
        style={{
          backgroundColor: "var(--danger-bg)",
          color: "var(--danger)",
        }}
      >
        취소됨
      </span>
    );
  }
  // pending — 발송 완료 / 미신청.
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
      style={{
        backgroundColor: "var(--bg-muted)",
        color: "var(--text-muted)",
      }}
    >
      미신청
    </span>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`
        px-4 py-3 text-left text-[13px] font-medium
        text-[color:var(--text-muted)] uppercase tracking-wide
        ${className}
      `}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-[15px] ${className}`}>{children}</td>;
}
