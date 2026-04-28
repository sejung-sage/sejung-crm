"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

type TabKey = "enrollments" | "attendances" | "messages";

const TABS: { key: TabKey; label: string }[] = [
  { key: "enrollments", label: "수강 이력" },
  { key: "attendances", label: "출석" },
  { key: "messages", label: "발송 이력" },
];

interface Props {
  enrollmentsPanel: React.ReactNode;
  attendancesPanel: React.ReactNode;
  messagesPanel: React.ReactNode;
}

/**
 * 학생 상세 탭 스위처.
 * URL ?tab=enrollments|attendances|messages 기반 상태.
 * 탭 패널 자체는 Server Component로 유지되도록 children 으로 주입받는다.
 */
export function StudentDetailTabs({
  enrollmentsPanel,
  attendancesPanel,
  messagesPanel,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const raw = searchParams.get("tab");
  const active: TabKey = useMemo(() => {
    if (raw === "attendances" || raw === "messages") return raw;
    return "enrollments";
  }, [raw]);

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(searchParams.toString());
    if (key === "enrollments") next.delete("tab");
    else next.set("tab", key);
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return (
    <section aria-label="학생 상세 탭" aria-busy={isPending}>
      <div
        role="tablist"
        aria-label="학생 상세 정보 구분"
        className="flex items-end gap-1 border-b border-[color:var(--border)]"
      >
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${t.key}`}
              id={`tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`
                inline-flex items-center min-h-11 px-4
                text-[15px] font-medium
                border-b-2 -mb-px
                transition-colors
                ${
                  isActive
                    ? "border-[color:var(--text)] text-[color:var(--text)]"
                    : "border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
                }
              `}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="pt-5">
        <div
          role="tabpanel"
          id="panel-enrollments"
          aria-labelledby="tab-enrollments"
          hidden={active !== "enrollments"}
        >
          {enrollmentsPanel}
        </div>
        <div
          role="tabpanel"
          id="panel-attendances"
          aria-labelledby="tab-attendances"
          hidden={active !== "attendances"}
        >
          {attendancesPanel}
        </div>
        <div
          role="tabpanel"
          id="panel-messages"
          aria-labelledby="tab-messages"
          hidden={active !== "messages"}
        >
          {messagesPanel}
        </div>
      </div>
    </section>
  );
}
