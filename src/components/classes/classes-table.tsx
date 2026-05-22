"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClassListItem } from "@/types/database";
import { BranchBadge } from "@/components/groups/branch-badge";
import { SEASON_VALUES, type Season } from "@/lib/schemas/common";
import { updateClassSeasonAction } from "@/app/(features)/classes/actions";
import { useToast } from "@/components/ui/toast";

interface Props {
  rows: ClassListItem[];
  /** 시즌 인라인 수정 노출 여부 — master/admin 만 true (page.tsx 에서 판단). */
  canEditSeason: boolean;
  /** 로그인 사용자 분원 (admin 분원 교차 검증용). master 는 무시. */
  userBranch: string | null;
  /** 로그인 사용자 역할 — master 면 모든 분원 강좌 시즌 수정 가능. */
  userRole: "master" | "admin" | "manager" | "viewer" | null;
  /** 개발용 시드 모드 — 시즌 변경 액션이 즉시 dev_seed_mode 반환. UI 안내용. */
  devMode: boolean;
}

/**
 * F0 · 강좌 리스트 테이블 (Client Component).
 *
 * 컬럼 (좌→우):
 *   반명 · 분원 · 과목 · 시즌 · 강사 · 요일/시간 · 회당단가 · 총회차 · 정가 · 수강생
 *
 * - 반명 셀에 `/classes/[id]` 로 링크.
 * - 미사용 강좌(active=false)는 회색조 dim. (`active=0` 토글 시에만 노출됨)
 * - 시즌 셀:
 *     - master  → 모든 분원 강좌 시즌 dropdown 으로 인라인 편집.
 *     - admin   → 본인 분원 강좌만 편집, 다른 분원은 read-only chip.
 *     - manager/viewer/비로그인 → 항상 read-only chip.
 *   변경은 updateClassSeasonAction 호출 + toast + router.refresh.
 *   dev-seed 모드는 액션이 즉시 dev_seed_mode 반환 — toast 로 안내.
 * - 빈 상태: "검색 조건에 해당하는 강좌가 없습니다."
 */
export function ClassesTable({
  rows,
  canEditSeason,
  userBranch,
  userRole,
  devMode,
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          검색 조건에 해당하는 강좌가 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          검색어를 지우거나 필터를 조정해 보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
            <Th>반명</Th>
            <Th className="w-20">분원</Th>
            <Th className="w-20 text-center">과목</Th>
            <Th className="w-36 text-center">시즌</Th>
            <Th className="w-28">강사</Th>
            <Th className="w-36">요일/시간</Th>
            <Th className="w-28 text-right">회당단가</Th>
            <Th className="w-20 text-right">총회차</Th>
            <Th className="w-28 text-right">정가</Th>
            <Th className="w-20 text-right">수강생</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const dim = !r.active;
            // 현재 사용자가 이 강좌의 시즌을 편집 가능한가?
            //   - canEditSeason=false → 즉시 read-only
            //   - master → 모든 분원 OK
            //   - admin → 본인 분원만 OK
            const editable =
              canEditSeason &&
              (userRole === "master" || r.branch === userBranch);

            return (
              <tr
                key={r.id}
                className={`
                  border-b border-[color:var(--border)] last:border-b-0
                  hover:bg-[color:var(--bg-hover)] transition-colors
                  ${dim ? "bg-[color:var(--bg-muted)]" : ""}
                `}
              >
                <Td>
                  <Link
                    href={`/classes/${r.id}`}
                    className={`font-medium hover:underline ${
                      dim
                        ? "text-[color:var(--text-muted)]"
                        : "text-[color:var(--text)]"
                    }`}
                  >
                    {r.name}
                  </Link>
                  {!r.active && (
                    <span
                      className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[color:var(--bg-muted)] text-[color:var(--text-muted)] border border-[color:var(--border)]"
                      title="V_class_list.미사용반구분 = Y (종강·폐강 처리된 강좌)"
                    >
                      종강
                    </span>
                  )}
                </Td>
                <Td>
                  <BranchBadge branch={r.branch} />
                </Td>
                <Td
                  className={`text-center ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }`}
                >
                  {r.subject ?? "—"}
                </Td>
                <Td className="text-center">
                  <SeasonCell
                    classId={r.id}
                    season={r.season}
                    editable={editable}
                    dim={dim}
                    devMode={devMode}
                  />
                </Td>
                <Td
                  className={
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }
                >
                  {r.teacher_name ?? "—"}
                </Td>
                <Td
                  className={
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }
                >
                  <ScheduleCell
                    days={r.schedule_days}
                    time={r.schedule_time}
                  />
                </Td>
                <Td
                  className={`text-right tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text)]"
                  }`}
                >
                  {formatWon(r.amount_per_session)}
                </Td>
                <Td
                  className={`text-right tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text)]"
                  }`}
                >
                  {formatSessions(r.total_sessions)}
                </Td>
                <Td
                  className={`text-right tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }`}
                >
                  {formatWon(r.total_amount)}
                </Td>
                <Td
                  className={`text-right tabular-nums font-medium ${
                    dim
                      ? "text-[color:var(--text-muted)]"
                      : "text-[color:var(--text)]"
                  }`}
                >
                  {r.enrolled_student_count.toLocaleString()}명
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── 시즌 셀 (인라인 편집) ───────────────────────────────────

/**
 * "" sentinel → DB NULL.
 * <select> 의 value 는 문자열만 가능하므로 NULL 을 빈 문자열로 매핑한다.
 */
const SEASON_NULL_SENTINEL = "" as const;

interface SeasonCellProps {
  classId: string;
  season: string | null;
  editable: boolean;
  dim: boolean;
  devMode: boolean;
}

/**
 * 시즌 셀:
 *  - editable=true → <select> dropdown (변경 즉시 server action).
 *  - editable=false → read-only chip (값 또는 "—").
 *
 * UX 디테일:
 *  - dev-seed 모드면 action 이 즉시 dev_seed_mode 반환 → toast 로 안내 + 값 원복.
 *  - 실패 시 toast 에러 + 값 원복 (낙관적 업데이트 X — 단순화 우선).
 *  - 성공 시 toast 성공 + router.refresh() 로 서버 캐시 무효화 동기.
 *  - 변경 중에는 select disable + opacity-60.
 */
function SeasonCell({
  classId,
  season,
  editable,
  dim,
  devMode,
}: SeasonCellProps) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [value, setValue] = useState<string>(season ?? SEASON_NULL_SENTINEL);
  const [isPending, startTransition] = useTransition();

  if (!editable) {
    // 읽기 전용 — 값이 있으면 chip, 없으면 "—".
    if (!season) {
      return (
        <span
          className={
            dim
              ? "text-[color:var(--text-dim)]"
              : "text-[color:var(--text-muted)]"
          }
        >
          —
        </span>
      );
    }
    return (
      <span
        className={`
          inline-flex items-center px-2 py-0.5 rounded-md text-[12px]
          border border-[color:var(--border)] bg-bg-card
          ${
            dim
              ? "text-[color:var(--text-dim)]"
              : "text-[color:var(--text)]"
          }
        `}
      >
        {season}
      </span>
    );
  }

  const handleChange = (next: string) => {
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const nextSeason: Season | null =
        next === SEASON_NULL_SENTINEL ? null : (next as Season);
      const result = await updateClassSeasonAction({
        id: classId,
        season: nextSeason,
      });
      if (result.status === "success") {
        showToast(
          "success",
          nextSeason
            ? `시즌을 '${nextSeason}' 으로 바꿨어요`
            : "시즌을 미분류로 되돌렸어요",
        );
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        // dev-seed 모드 — 변경 무효, UI 만 되돌림.
        setValue(prev);
        showToast(
          "error",
          "개발용 시드 모드에서는 시즌을 변경할 수 없습니다",
        );
      } else {
        setValue(prev);
        showToast("error", result.reason ?? "시즌 변경에 실패했습니다");
      }
    });
  };

  return (
    <select
      aria-label="시즌 선택"
      value={value}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value)}
      title={devMode ? "개발용 시드 모드에서는 변경되지 않습니다" : undefined}
      className={`
        h-9 w-full max-w-[10rem] rounded-md px-2
        bg-bg-card border border-[color:var(--border)]
        text-[13px] text-[color:var(--text)]
        focus:outline-none focus:border-[color:var(--border-strong)]
        cursor-pointer
        disabled:opacity-60 disabled:cursor-wait
        ${dim ? "opacity-70" : ""}
      `}
    >
      <option value={SEASON_NULL_SENTINEL}>미분류</option>
      {SEASON_VALUES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

// ─── 내부 소 컴포넌트·포매터 ────────────────────────────────

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
 * 요일 + 시간 한 셀에 두 줄 표시.
 * 둘 다 없으면 "—". 한쪽만 있으면 그 한 줄만.
 */
function ScheduleCell({
  days,
  time,
}: {
  days: string | null;
  time: string | null;
}) {
  if (!days && !time) return <span>—</span>;
  return (
    <div className="leading-tight">
      {days && <div>{days}</div>}
      {time && (
        <div className="text-[13px] text-[color:var(--text-dim)] tabular-nums">
          {time}
        </div>
      )}
    </div>
  );
}

/** null/0 이면 "—". 그 외에는 천단위 콤마 + "원". */
function formatWon(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "—";
  return `${v.toLocaleString()}원`;
}

/**
 * 총회차 표시: 정수면 정수, 소수면 한 자리만.
 * decimal 원본이라 1.0 같은 케이스도 1 로 정리.
 */
function formatSessions(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
}
