"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Send, UserMinus } from "lucide-react";
import type { ClassStudentRow } from "@/types/database";
import { formatPhone, maskPhone } from "@/lib/phone";

interface Props {
  /**
   * 이미 `isLapsedStudent(status)` 로 걸러진 이탈 학생만.
   * (status ∈ {수강이력자, 수강 x, 탈퇴} — 재원생 제외)
   * 필터는 부모 Server Component 에서 수행하고, 여기서는 표시만.
   */
  lapsedStudents: ClassStudentRow[];
  /** 강좌 id — "이 학생들에게 발송" 버튼 prefill 경로용. */
  classId: string;
  /** 학부모 연락처 풀 노출 권한. master 만 true. */
  canRevealPhone?: boolean;
  /**
   * "이 학생들에게 발송" 버튼 노출 권한.
   * 헤더의 "이 강좌로 발송" 과 동일 게이팅(master/admin)만 true.
   */
  canSend?: boolean;
}

/**
 * 강좌 상세 · "다음 시즌 미등록 학생" 섹션 (Client Component — 토글만 상호작용).
 *
 * 배경(박은주 부원장 2026-05-27): 종강 강좌에서 다음 시즌에 다시 등록하지 않은
 * (이탈한) 학생을 추려 재등록 안내 문자를 보내고 싶다.
 *
 * 이탈 판정은 `isLapsedStudent(status) => status !== '재원생'` (group 스키마 단일 소스).
 * 재원생은 어딘가 진행 중 수강이 있어 "다음 시즌도 다니는 중" 이라 제외된다.
 *
 * 표시 규약:
 *  - 기본은 접힌 상태. 헤더에 이탈 인원 카운트. 클릭/Enter/Space 로 펼침.
 *  - 명단은 수강생 명단(`class-students-panel.tsx`) 톤을 그대로 미러
 *    (이름→/students/[id], 학교, 학부모 연락처 마스킹).
 *  - **탈퇴 학생**은 회색 dim + "탈퇴" 칩 + "발송 제외" 보조 표기.
 *    명단엔 보이지만 발송 가드가 자동 제외 — 그 괴리를 시각적으로 미리 알린다.
 *  - 이탈 1명 이상 + 발송 권한일 때만 "이 학생들에게 발송" 버튼 →
 *    /groups/new?class=<id>&filter=lapsed (이탈 학생만 prefill).
 *
 * 이탈 0명이면 섹션 자체를 부모가 렌더하지 않으므로 여기서는 항상 ≥1 가정.
 */
export function ClassLapsedPanel({
  lapsedStudents,
  classId,
  canRevealPhone = false,
  canSend = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const count = lapsedStudents.length;
  const withdrawnCount = lapsedStudents.filter(
    (s) => s.status === "탈퇴",
  ).length;

  return (
    <section
      className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden"
      aria-label="다음 시즌 미등록 학생"
    >
      <h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="
            flex w-full items-center gap-3 px-4 py-4 text-left
            hover:bg-[color:var(--bg-hover)] transition-colors
            focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-[color:var(--border-strong)] focus-visible:ring-offset-2
          "
        >
          <UserMinus
            className="size-5 shrink-0 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="text-[16px] font-semibold text-[color:var(--text)]">
              다음 시즌 미등록 학생
            </span>
            <span className="ml-2 text-[15px] font-medium text-[color:var(--text-muted)] tabular-nums">
              {count}명
            </span>
            <span className="mt-0.5 block text-[13px] text-[color:var(--text-muted)]">
              이 강좌를 듣고 다음 시즌에 다시 등록하지 않은 학생입니다.
            </span>
          </span>
          <ChevronDown
            className={`
              size-5 shrink-0 text-[color:var(--text-muted)] transition-transform
              ${open ? "rotate-180" : ""}
            `}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
      </h2>

      {open && (
        <div className="border-t border-[color:var(--border)]">
          {canSend && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
              <p className="text-[13px] text-[color:var(--text-muted)]">
                선택한 학생에게 재등록 안내 문자를 보낼 수 있습니다.
              </p>
              <Link
                href={`/compose?class=${classId}&filter=lapsed`}
                aria-label={`미등록 학생 ${count}명에게 문자 보내기`}
                className="
                  inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
                  bg-[color:var(--action)] text-[color:var(--action-text)]
                  text-[14px] font-medium
                  hover:bg-[color:var(--action-hover)] transition-colors
                "
              >
                <Send className="size-4" strokeWidth={1.75} aria-hidden />
                이 학생들에게 발송
                <span className="ml-1 text-[12px] opacity-80 tabular-nums">
                  ({count})
                </span>
              </Link>
            </div>
          )}

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
                <Th>이름</Th>
                <Th>학교</Th>
                <Th className="w-20 text-center">학년</Th>
                <Th className="w-40">학부모 연락처</Th>
                <Th className="w-32 text-right">상태</Th>
              </tr>
            </thead>
            <tbody>
              {lapsedStudents.map((s) => {
                const withdrawn = s.status === "탈퇴";
                return (
                  <tr
                    key={s.id}
                    className={`
                      border-b border-[color:var(--border)] last:border-b-0
                      hover:bg-[color:var(--bg-hover)] transition-colors
                      ${withdrawn ? "opacity-60" : ""}
                    `}
                  >
                    <Td>
                      <Link
                        href={`/students/${s.id}`}
                        className={`
                          font-medium hover:underline
                          ${
                            withdrawn
                              ? "text-[color:var(--text-muted)]"
                              : "text-[color:var(--text)]"
                          }
                        `}
                      >
                        {s.name}
                      </Link>
                    </Td>
                    <Td className="text-[color:var(--text-muted)]">
                      {s.school ?? "—"}
                    </Td>
                    <Td className="text-center text-[color:var(--text)]">
                      {s.grade ?? "—"}
                    </Td>
                    <Td className="text-[color:var(--text-muted)] tabular-nums">
                      {s.parent_phone
                        ? canRevealPhone
                          ? formatPhone(s.parent_phone) || "—"
                          : maskPhone(s.parent_phone)
                        : "—"}
                    </Td>
                    <Td className="text-right">
                      <StatusCell status={s.status} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="px-4 py-3 text-[13px] text-[color:var(--text-muted)] border-t border-[color:var(--border)]">
            {withdrawnCount > 0 ? (
              <>
                <span className="font-medium text-[color:var(--text)]">
                  탈퇴
                </span>{" "}
                학생({withdrawnCount}명)은 명단에는 보이지만 발송 시 자동으로
                제외됩니다. 수신거부한 학부모도 함께 제외됩니다.
              </>
            ) : (
              <>수신거부한 학부모는 발송 시 자동으로 제외됩니다.</>
            )}
          </p>
        </div>
      )}
    </section>
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
      scope="col"
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

/**
 * 상태 셀. 탈퇴는 회색 "탈퇴" 칩 + "발송 제외" 보조 표기로
 * "명단엔 보이는데 발송엔 안 간다" 는 괴리를 미리 알린다.
 * 그 외 이탈 상태(수강이력자/수강 x)는 라벨 텍스트만.
 */
function StatusCell({ status }: { status: ClassStudentRow["status"] }) {
  if (status === "탈퇴") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className="
            inline-flex items-center px-2 py-0.5 rounded-md
            text-[12px] font-medium
            bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]
            border border-[color:var(--border)]
          "
        >
          탈퇴
        </span>
        <span className="text-[12px] text-[color:var(--text-dim)]">
          발송 제외
        </span>
      </span>
    );
  }
  return (
    <span className="text-[13px] text-[color:var(--text-muted)]">{status}</span>
  );
}
