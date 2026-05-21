"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useTransition } from "react";
import { Plus, Search } from "lucide-react";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "전체 상태" },
  { value: "임시저장", label: "임시저장" },
  { value: "예약됨", label: "예약됨" },
  { value: "발송중", label: "발송중" },
  { value: "완료", label: "완료" },
  { value: "실패", label: "실패" },
  { value: "취소", label: "취소" },
];

interface SenderOption {
  userId: string;
  name: string;
}

interface Props {
  /** 발송자 옵션 — server prefetch. 지금까지 캠페인 1건+ 발송한 사용자만. */
  senders?: SenderOption[];
}

/**
 * F3-02 · 캠페인 리스트 상단 툴바.
 *
 * - 좌: 제목 검색 · 상태 드롭다운 · 기간(from/to) · 발송자
 * - URL `?q=&status=&from=&to=&sender=` 동기화. 값 변경 시 page=1 리셋.
 */
export function CampaignsToolbar({ senders = [] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const teacher = searchParams.get("teacher") ?? "";
  const klass = searchParams.get("klass") ?? "";
  const status = searchParams.get("status") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const sender = searchParams.get("sender") ?? "";

  // 폼 input 들의 현재 값을 status/date onChange 시점에도 읽어 보존하기 위함.
  // 사용자가 q 텍스트를 입력하고 Enter 안 누른 상태로 status 만 바꾸면 텍스트가
  // 풀려나가지 않도록 한다.
  const formRef = useRef<HTMLFormElement>(null);
  const readFormText = useCallback(() => {
    const el = formRef.current;
    if (!el) return { q, teacher, klass };
    const fd = new FormData(el);
    return {
      q: String(fd.get("q") ?? "").trim(),
      teacher: String(fd.get("teacher") ?? "").trim(),
      klass: String(fd.get("klass") ?? "").trim(),
    };
  }, [q, teacher, klass]);

  const setTextParams = useCallback(
    (p: URLSearchParams) => {
      const t = readFormText();
      if (t.q) p.set("q", t.q);
      else p.delete("q");
      if (t.teacher) p.set("teacher", t.teacher);
      else p.delete("teacher");
      if (t.klass) p.set("klass", t.klass);
      else p.delete("klass");
    },
    [readFormText],
  );

  const updateParams = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutator(next);
      next.delete("page");
      startTransition(() => {
        // memory/feedback_filter_refresh — push + refresh + isPending 3종 패턴.
        // Next prefetch cache stale 방어 (강사 chip 제거 회귀와 동일).
        router.push(`${pathname}?${next.toString()}`);
        router.refresh();
      });
    },
    [router, pathname, searchParams],
  );

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const qVal = String(data.get("q") ?? "").trim();
    const teacherVal = String(data.get("teacher") ?? "").trim();
    const klassVal = String(data.get("klass") ?? "").trim();
    updateParams((p) => {
      if (qVal) p.set("q", qVal);
      else p.delete("q");
      if (teacherVal) p.set("teacher", teacherVal);
      else p.delete("teacher");
      if (klassVal) p.set("klass", klassVal);
      else p.delete("klass");
    });
  };

  const onStatusChange = (value: string) => {
    updateParams((p) => {
      setTextParams(p);
      if (value) p.set("status", value);
      else p.delete("status");
    });
  };

  const onDateChange = (key: "from" | "to", value: string) => {
    updateParams((p) => {
      setTextParams(p);
      if (value) p.set(key, value);
      else p.delete(key);
    });
  };

  const onSenderChange = (value: string) => {
    updateParams((p) => {
      setTextParams(p);
      if (value) p.set("sender", value);
      else p.delete("sender");
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={onSearchSubmit}
      className={`flex flex-col md:flex-row md:flex-wrap md:items-center gap-3 transition-opacity ${isPending ? "opacity-60 pointer-events-none" : ""}`}
      aria-busy={isPending}
    >
      {/* 1행: 제목·내용 통합 검색 (q) — 가장 자주 쓰는 자유 텍스트 */}
      <label className="relative block flex-1 min-w-[240px]">
        <span className="sr-only">제목 또는 내용 검색</span>
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="제목/내용 검색 (Enter)"
          className="
            w-full h-10 rounded-lg
            pl-9 pr-3
            bg-bg-card
            border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors
          "
        />
      </label>

      {/* 강사 — 본문에 강사명 포함된 캠페인만 노출 */}
      <label className="block">
        <span className="sr-only">강사명 검색</span>
        <input
          name="teacher"
          type="search"
          defaultValue={teacher}
          placeholder="강사명"
          className="
            h-10 w-40 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors
          "
        />
      </label>

      {/* 강좌/반명 — 본문에 강좌명 포함된 캠페인만 노출 */}
      <label className="block">
        <span className="sr-only">강좌·반명 검색</span>
        <input
          name="klass"
          type="search"
          defaultValue={klass}
          placeholder="강좌·반명"
          className="
            h-10 w-40 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors
          "
        />
      </label>

      {/* 검색 버튼 — Enter 외 마우스 사용자 동선 보장 */}
      <button
        type="submit"
        className="
          inline-flex items-center h-10 px-4 rounded-lg
          bg-[color:var(--bg-muted)] text-[color:var(--text)]
          border border-[color:var(--border)]
          text-[14px] font-medium
          hover:bg-[color:var(--bg-hover)]
          transition-colors
        "
      >
        검색
      </button>

      <select
        aria-label="상태 선택"
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="
          h-10 min-w-36 rounded-lg px-3
          bg-bg-card border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          cursor-pointer
        "
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-[color:var(--text-muted)]">
          <span className="sr-only">기간 시작일</span>
          <input
            type="date"
            value={from}
            onChange={(e) => onDateChange("from", e.target.value)}
            onClick={(e) => {
              const el = e.currentTarget as HTMLInputElement & {
                showPicker?: () => void;
              };
              el.showPicker?.();
            }}
            className="
              h-10 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
              text-[14px] text-[color:var(--text)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              cursor-pointer
            "
          />
        </label>
        <span className="text-[13px] text-[color:var(--text-muted)]">~</span>
        <label className="flex items-center gap-2 text-[13px] text-[color:var(--text-muted)]">
          <span className="sr-only">기간 종료일</span>
          <input
            type="date"
            value={to}
            onChange={(e) => onDateChange("to", e.target.value)}
            onClick={(e) => {
              const el = e.currentTarget as HTMLInputElement & {
                showPicker?: () => void;
              };
              el.showPicker?.();
            }}
            className="
              h-10 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
              text-[14px] text-[color:var(--text)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              cursor-pointer
            "
          />
        </label>
      </div>

      {senders.length > 0 && (
        <select
          aria-label="발송자 선택"
          value={sender}
          onChange={(e) => onSenderChange(e.target.value)}
          className="
            h-10 min-w-32 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            cursor-pointer
          "
        >
          <option value="">전체 발송자</option>
          {senders.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <Link
        href="/compose"
        className="
          inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[14px] font-medium
          hover:bg-[color:var(--action-hover)]
          transition-colors
          md:ml-auto
        "
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden />
        새 발송
      </Link>
    </form>
  );
}
