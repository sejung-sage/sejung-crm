"use client";

import { Calendar, MapPin, Users } from "lucide-react";
import type { ClassSignupOption } from "@/types/database";
import { formatKstDateTime } from "@/lib/datetime";

/**
 * F5 · 설명회 발송 Step 1 — 발송할 강좌(=설명회) 를 1개 이상 다중 선택.
 *
 * 0084 새 모델: 발송 대상은 crm_classes(subject='설명회') 강좌. 학부모 신청
 * 페이지(crm_class_signup_pages)는 발송 시점에 강좌별로 자동 find-or-create
 * (status='open'). 운영자는 강좌 상세에서 페이지 옵션(설명·정원·기간) 후조정 가능.
 *
 * 표시: 분원 컨텍스트의 설명회 강좌만(서버에서 필터됨).
 * 카드 단위 체크박스 + 일시/장소/현재 신청 카운트 노출.
 */
interface Props {
  classes: ClassSignupOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function SeminarComposeStep1Seminars({
  classes,
  selectedIds,
  onChange,
}: Props) {
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((v) => v !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          발송할 설명회 선택
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학부모 페이지에 카드로 표시할 설명회 강좌를 1개 이상 선택해 주세요.
          학생에게 여러 일정을 한 번에 안내할 수 있습니다.
        </p>
      </div>

      {classes.length === 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-5 text-[14px] text-[color:var(--text-muted)] space-y-2"
        >
          <p>현재 분원에 설명회 강좌가 없습니다.</p>
          <p className="text-[13px] text-[color:var(--text-dim)]">
            아카(Aca2000) 에 설명회 강좌를 등록하면 다음 동기화(약 1시간)에
            여기 자동으로 등장합니다.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="설명회 강좌 목록">
          {classes.map((c) => {
            const checked = selectedIds.includes(c.class_id);
            const inputId = `seminar-class-${c.class_id}`;
            return (
              <li key={c.class_id}>
                <label
                  htmlFor={inputId}
                  className={`
                    flex items-start gap-3 rounded-xl border p-4 cursor-pointer
                    ${checked
                      ? "border-[color:var(--text)] bg-[color:var(--bg-muted)]"
                      : "border-[color:var(--border)] bg-bg-card hover:bg-[color:var(--bg-hover)]"}
                    transition-colors
                  `}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.class_id)}
                    className="mt-1 size-5 cursor-pointer accent-[color:var(--action)]"
                    aria-label={`${c.class_name} 선택`}
                  />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[15px] font-semibold text-[color:var(--text)] leading-snug">
                        {c.class_name}
                      </div>
                      {c.signup_page_status &&
                        c.signup_page_status !== "open" && (
                          <PageStatusBadge status={c.signup_page_status} />
                        )}
                      {c.signup_page_id === null && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]">
                          발송 시 페이지 자동 생성
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[color:var(--text-muted)]">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Calendar
                          className="size-3.5 text-[color:var(--text-dim)]"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        {c.held_at ? formatKstDateTime(c.held_at) : "일시 미정"}
                      </span>
                      {c.venue && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin
                            className="size-3.5 text-[color:var(--text-dim)]"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          {c.venue}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Users
                          className="size-3.5 text-[color:var(--text-dim)]"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        {c.signup_count}
                        {c.capacity ? ` / ${c.capacity}` : ""}명 신청
                      </span>
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[12px] text-[color:var(--text-dim)]">
        선택된 설명회 <strong className="text-[color:var(--text)]">{selectedIds.length}</strong>개
        · 학부모 페이지에 카드 순서대로 노출됩니다.
      </p>
    </div>
  );
}

// ─── 신청 페이지 상태 배지 ─────────────────────────────────
// open 은 기본이라 미표시. draft/closed 만 시각적으로 구분.
function PageStatusBadge({ status }: { status: "draft" | "closed" }) {
  if (status === "draft") {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]"
        title="신청 페이지가 비공개 초안 상태입니다"
      >
        draft
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] border border-[color:var(--border)] text-[color:var(--text-muted)] bg-[color:var(--bg-muted)]"
      title="신청 마감 상태"
    >
      마감
    </span>
  );
}
