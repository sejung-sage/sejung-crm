"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, X, Trash2 } from "lucide-react";
import type { MockSignup } from "@/lib/seminars/dev-seed";
import { useToast } from "@/components/ui/toast";
import { formatKstDateTime } from "@/lib/datetime";
import { maskPhone, formatPhone } from "@/lib/phone";

/**
 * 설명회 신청 명단 테이블 — UI MOCKUP ONLY.
 *
 * - 검색(이름/전화)은 클라이언트에서 in-memory 필터.
 * - 신청 취소는 mock 처리: 로컬 state 업데이트 + toast.
 * - 정렬: 신청시각 역순(최신 위) 고정. props 가 이미 정렬된 상태로 옴.
 */
interface Props {
  signups: MockSignup[];
  /** master 만 평문 전화 노출. 그 외(admin)는 마스킹. */
  canRevealPhone: boolean;
}

export function SignupsTable({ signups, canRevealPhone }: Props) {
  const [query, setQuery] = useState("");
  const [localSignups, setLocalSignups] = useState<MockSignup[]>(signups);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { show: showToast } = useToast();

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return localSignups;
    const digits = q.replace(/\D/g, "");
    return localSignups.filter((s) => {
      if (s.student_name.includes(q)) return true;
      if (digits.length >= 2 && s.parent_phone.replace(/\D/g, "").includes(digits)) {
        return true;
      }
      return false;
    });
  }, [query, localSignups]);

  const handleCancel = (id: string, name: string) => {
    if (!confirm(`${name} 학생의 신청을 취소할까요?`)) return;
    setPendingId(id);
    startTransition(async () => {
      await new Promise((r) => setTimeout(r, 400));
      setLocalSignups((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "cancelled" } : s)),
      );
      setPendingId(null);
      showToast("success", `${name} 학생의 신청을 취소했습니다`);
    });
  };

  const handleDownload = () => {
    showToast("success", "엑셀 다운로드를 시작합니다 (시연용 · 실제 파일 생성 X)");
  };

  if (localSignups.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-14 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          아직 신청자가 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          학부모에게 발송 링크를 보내 신청을 받아보세요.
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
          className="
            inline-flex items-center h-10 px-4 rounded-lg
            border border-[color:var(--border-strong)] bg-bg-card
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          엑셀 다운로드
        </button>
      </div>

      <p className="text-[13px] text-[color:var(--text-muted)]">
        총 <strong className="text-[color:var(--text)]">{filtered.length}</strong>건
        {query && ` · 전체 ${localSignups.length}건 중 검색`}
      </p>

      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
              <Th>학생 이름</Th>
              <Th className="w-44">학부모 전화</Th>
              <Th>기존 학생 매칭</Th>
              <Th className="w-44">신청 시각</Th>
              <Th className="w-24">상태</Th>
              <Th className="w-16 text-right">작업</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-[14px] text-[color:var(--text-muted)]"
                >
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((s) => {
                const isCancelled = s.status === "cancelled";
                const phoneDisplay = canRevealPhone
                  ? formatPhone(s.parent_phone)
                  : maskPhone(s.parent_phone);
                return (
                  <tr
                    key={s.id}
                    className={`
                      border-b border-[color:var(--border)] last:border-b-0
                      hover:bg-[color:var(--bg-hover)] transition-colors
                      ${isCancelled ? "opacity-60" : ""}
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
                    <Td>
                      {s.matched_student_label ? (
                        <span className="text-[13px] text-[color:var(--text-muted)]">
                          {s.matched_student_label}
                        </span>
                      ) : (
                        <span className="text-[13px] text-[color:var(--text-dim)]">
                          신규
                        </span>
                      )}
                    </Td>
                    <Td className="tabular-nums text-[13px] text-[color:var(--text-muted)]">
                      {formatKstDateTime(s.signed_up_at)}
                    </Td>
                    <Td>
                      {isCancelled ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
                          style={{
                            backgroundColor: "var(--danger-bg)",
                            color: "var(--danger)",
                          }}
                        >
                          취소됨
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
                          style={{
                            backgroundColor: "var(--success-bg)",
                            color: "var(--success)",
                          }}
                        >
                          신청
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {!isCancelled && (
                        <button
                          type="button"
                          onClick={() => handleCancel(s.id, s.student_name)}
                          disabled={pendingId === s.id}
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
