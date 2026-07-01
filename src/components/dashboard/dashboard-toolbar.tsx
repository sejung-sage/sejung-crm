"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { CalendarDays } from "lucide-react";

/**
 * 발송 대시보드 필터 툴바 (클라이언트).
 *
 * 상태는 URL searchParams 로 동기화. 값 변경 시 push + refresh 를 useTransition 으로
 * 감싸 실행한다(prefetch cache stale 방어 — classes-toolbar 와 동일 3종 패턴).
 * 기본값(seminar=all, groupBy=month)은 URL 에서 제거해 canonical URL 을 짧게 유지.
 *
 * 컨트롤: 분원 · 발송자 · 기간(시작/종료) · 설명회 링크 · 집계 기준.
 */

interface SenderOption {
  userId: string;
  name: string;
}

interface Props {
  /** 분원 목록(전체 제외). "전체" 의사옵션은 컴포넌트가 맨 앞에 추가. */
  branches: string[];
  /** 캠페인 발송자 후보. value 는 userId, label 은 name. */
  senders: SenderOption[];
}

const SEMINAR_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "with", label: "있음" },
  { value: "without", label: "없음" },
] as const;

const GROUP_BY_OPTIONS = [
  { value: "month", label: "월별" },
  { value: "branch", label: "분원별" },
  { value: "sender", label: "사람별" },
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function DashboardToolbar({ branches, senders }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const branch = searchParams.get("branch") ?? "전체";
  const sender = searchParams.get("sender") ?? "";
  const seminar = searchParams.get("seminar") ?? "all";
  const groupBy = searchParams.get("groupBy") ?? "month";

  const fromRaw = searchParams.get("from") ?? "";
  const toRaw = searchParams.get("to") ?? "";
  const fromValue = ISO_DATE.test(fromRaw) ? fromRaw : "";
  const toValue = ISO_DATE.test(toRaw) ? toRaw : "";

  const updateParams = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutator(next);
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`);
        router.refresh();
      });
    },
    [router, pathname, searchParams],
  );

  const onBranchChange = (value: string) => {
    updateParams((p) => {
      if (value === "전체") p.delete("branch");
      else p.set("branch", value);
    });
  };

  const onSenderChange = (value: string) => {
    updateParams((p) => {
      if (value) p.set("sender", value);
      else p.delete("sender");
    });
  };

  const onSeminarChange = (value: string) => {
    updateParams((p) => {
      if (value === "all") p.delete("seminar");
      else p.set("seminar", value);
    });
  };

  const onGroupByChange = (value: string) => {
    updateParams((p) => {
      if (value === "month") p.delete("groupBy");
      else p.set("groupBy", value);
    });
  };

  const onFromChange = (value: string) => {
    updateParams((p) => {
      if (value && ISO_DATE.test(value)) p.set("from", value);
      else p.delete("from");
    });
  };

  const onToChange = (value: string) => {
    updateParams((p) => {
      if (value && ISO_DATE.test(value)) p.set("to", value);
      else p.delete("to");
    });
  };

  const selectCls =
    "h-10 min-w-40 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[15px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)] cursor-pointer";
  const dateCls =
    "h-10 min-w-44 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)] cursor-pointer";
  const labelCls =
    "block text-[13px] font-medium text-[color:var(--text-muted)] mb-1";

  return (
    <div
      className={`flex flex-wrap items-end gap-3 transition-opacity ${
        isPending ? "opacity-60 pointer-events-none" : ""
      }`}
      aria-busy={isPending}
    >
      {/* 분원 */}
      <div>
        <label className={labelCls} htmlFor="dashboard-branch">
          분원
        </label>
        <select
          id="dashboard-branch"
          value={branch}
          onChange={(e) => onBranchChange(e.target.value)}
          className={selectCls}
        >
          <option value="전체">전체 분원</option>
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      {/* 발송자 */}
      <div>
        <label className={labelCls} htmlFor="dashboard-sender">
          발송자
        </label>
        <select
          id="dashboard-sender"
          value={sender}
          onChange={(e) => onSenderChange(e.target.value)}
          className={selectCls}
        >
          <option value="">전체 발송자</option>
          {senders.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* 기간 */}
      <div>
        <span className={`${labelCls} inline-flex items-center gap-1.5`}>
          <CalendarDays
            className="size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          기간
        </span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="시작일 선택"
            value={fromValue}
            max="2999-12-31"
            onChange={(e) => onFromChange(e.target.value)}
            className={dateCls}
          />
          <span
            aria-hidden
            className="text-[14px] text-[color:var(--text-muted)] select-none"
          >
            ~
          </span>
          <input
            type="date"
            aria-label="종료일 선택"
            value={toValue}
            max="2999-12-31"
            onChange={(e) => onToChange(e.target.value)}
            className={dateCls}
          />
        </div>
      </div>

      {/* 설명회 링크 */}
      <div>
        <label className={labelCls} htmlFor="dashboard-seminar">
          설명회 링크
        </label>
        <select
          id="dashboard-seminar"
          value={seminar}
          onChange={(e) => onSeminarChange(e.target.value)}
          className={selectCls}
        >
          {SEMINAR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* 집계 기준 */}
      <div>
        <label className={labelCls} htmlFor="dashboard-groupby">
          집계 기준
        </label>
        <select
          id="dashboard-groupby"
          value={groupBy}
          onChange={(e) => onGroupByChange(e.target.value)}
          className={selectCls}
        >
          {GROUP_BY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
