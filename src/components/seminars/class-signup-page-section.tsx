"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Send,
  Calendar,
  ChevronDown,
  ChevronUp,
  Users,
} from "lucide-react";
import type { ClassSignupPageDetail } from "@/lib/seminars/get-class-signup-page";
import { upsertClassSignupPageAction } from "@/app/(features)/seminars/actions";
import { useToast } from "@/components/ui/toast";
import { formatKstDateTime } from "@/lib/datetime";
import { formatPhone, maskPhone } from "@/lib/phone";

/**
 * 강좌 상세 (`/classes/[id]`) 의 "공개 신청 페이지" 섹션 (0084/0085 새 모델).
 *
 * subject='설명회' 강좌에만 노출. 안의 동작:
 *  - 페이지 상태(draft/open/closed) 토글
 *  - 행사 일시 / 신청 기간 / 정원 override / 설명 편집
 *  - 신청자 명단(signed) 표시
 *  - "이 설명회로 발송" 버튼 → /seminars/compose?class=X
 *
 * 페이지가 아직 없으면(page=null) 안내 카드 + "지금 만들기" 행위.
 * 발송 액션이 자동 find-or-create 하므로 운영자가 직접 만들지 않아도 무방하지만,
 * 발송 전 일정·정원을 미리 잡아두려는 케이스를 위해 명시 진입을 둔다.
 */

interface Props {
  classId: string;
  branch: string;
  className: string;
  detail: ClassSignupPageDetail;
  canEdit: boolean;
  canRevealPhone: boolean;
}

type StatusValue = "draft" | "open" | "closed";

export function ClassSignupPageSection({
  classId,
  branch,
  className,
  detail,
  canEdit,
  canRevealPhone,
}: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  // 신청자 있으면 기본 펼침 — 운영자가 곧장 명단 확인 가능.
  const [expanded, setExpanded] = useState<boolean>(
    detail.signed_count > 0 || detail.page === null,
  );

  // 폼 상태 — 페이지 없으면 sensible defaults.
  const [status, setStatus] = useState<StatusValue>(detail.page?.status ?? "open");
  const [heldAt, setHeldAt] = useState<string>(
    toDatetimeLocal(detail.page?.held_at ?? null),
  );
  const [opensAt, setOpensAt] = useState<string>(
    toDatetimeLocal(detail.page?.signup_opens_at ?? null),
  );
  const [closesAt, setClosesAt] = useState<string>(
    toDatetimeLocal(detail.page?.signup_closes_at ?? null),
  );
  const [capacityStr, setCapacityStr] = useState<string>(
    detail.page?.capacity_override?.toString() ?? "",
  );
  const [description, setDescription] = useState<string>(
    detail.page?.description ?? "",
  );

  const sendHref = `/seminars/compose?class=${encodeURIComponent(classId)}`;

  // 진행률 (capacity 있을 때만).
  const ratioLabel = useMemo(() => {
    const cap = parseInt(capacityStr, 10);
    if (!Number.isFinite(cap) || cap <= 0) return null;
    return `${detail.signed_count} / ${cap}`;
  }, [capacityStr, detail.signed_count]);

  const handleSave = () => {
    if (!canEdit) return;
    const capacityNum = capacityStr.trim().length === 0
      ? null
      : parseInt(capacityStr, 10);
    if (capacityStr.trim().length > 0 && (!Number.isFinite(capacityNum) || (capacityNum as number) <= 0)) {
      showToast("error", "정원은 1 이상의 정수여야 합니다");
      return;
    }
    startTransition(async () => {
      const res = await upsertClassSignupPageAction({
        class_id: classId,
        branch,
        status,
        held_at: fromDatetimeLocal(heldAt),
        signup_opens_at: fromDatetimeLocal(opensAt),
        signup_closes_at: fromDatetimeLocal(closesAt),
        description: description.trim().length === 0 ? null : description,
        capacity_override: capacityNum,
      });
      switch (res.status) {
        case "success":
          showToast(
            "success",
            res.created ? "신청 페이지를 만들었습니다" : "저장되었습니다",
          );
          router.refresh();
          break;
        case "dev_seed_mode":
          showToast("success", "개발 시드 모드 — 저장은 일어나지 않았습니다");
          break;
        case "failed":
          showToast("error", res.reason);
          break;
      }
    });
  };

  return (
    <section
      aria-label="공개 신청 페이지"
      className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden"
    >
      {/* 헤더 — 항상 표시 */}
      <div className="flex items-center gap-3 px-5 py-4">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          공개 신청 페이지
        </h2>
        {detail.page && <PageStatusBadge status={detail.page.status} />}
        {!detail.page && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]">
            미생성
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] tabular-nums">
          <Users className="size-3.5 text-[color:var(--text-dim)]" strokeWidth={1.75} aria-hidden />
          {ratioLabel ?? `${detail.signed_count}명 신청`}
        </span>
        <div className="flex-1" />
        {canEdit && (
          <Link
            href={sendHref}
            className="
              inline-flex items-center justify-center gap-1.5
              h-10 px-4 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              transition-colors
            "
          >
            <Send className="size-4" strokeWidth={1.75} aria-hidden />
            이 설명회로 발송
          </Link>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`signup-page-body-${classId}`}
          className="
            inline-flex items-center justify-center h-10 w-10 rounded-lg
            border border-[color:var(--border)] bg-bg-card
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          {expanded ? (
            <ChevronUp className="size-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </div>

      {/* 펼친 본문 */}
      {expanded && (
        <div
          id={`signup-page-body-${classId}`}
          className="border-t border-[color:var(--border)] p-5 space-y-6 bg-[color:var(--bg)]"
        >
          {!detail.page && (
            <p className="text-[13px] text-[color:var(--text-muted)]">
              발송 위저드를 사용하면 자동으로 생성됩니다. 일정·정원을 미리
              지정하려면 아래 항목을 입력해 저장하세요.
            </p>
          )}

          {/* 편집 폼 */}
          {canEdit && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="상태">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusValue)}
                  className="h-10 px-3 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)]"
                >
                  <option value="draft">초안(비공개)</option>
                  <option value="open">공개 신청 받는 중</option>
                  <option value="closed">마감</option>
                </select>
              </Field>
              <Field label="행사 일시">
                <input
                  type="datetime-local"
                  value={heldAt}
                  onChange={(e) => setHeldAt(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] tabular-nums"
                />
              </Field>
              <Field label="신청 시작">
                <input
                  type="datetime-local"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] tabular-nums"
                />
              </Field>
              <Field label="신청 마감">
                <input
                  type="datetime-local"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] tabular-nums"
                />
              </Field>
              <Field label="정원 (선택)">
                <input
                  type="number"
                  min={1}
                  value={capacityStr}
                  onChange={(e) => setCapacityStr(e.target.value)}
                  placeholder="비워두면 강좌 정원 사용"
                  className="h-10 px-3 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] tabular-nums"
                />
              </Field>
              <Field label="설명 (선택)" full>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="학부모 페이지에 노출되는 추가 안내"
                  className="px-3 py-2 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] leading-relaxed resize-y"
                />
              </Field>
              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className="
                    inline-flex items-center h-10 px-5 rounded-lg
                    bg-[color:var(--action)] text-[color:var(--action-text)]
                    text-[14px] font-medium
                    hover:bg-[color:var(--action-hover)]
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors
                  "
                >
                  {isPending ? "저장 중..." : detail.page ? "저장" : "지금 만들기"}
                </button>
              </div>
            </div>
          )}

          {/* 신청자 명단 */}
          <div className="space-y-2">
            <h3 className="text-[14px] font-semibold text-[color:var(--text)]">
              신청 완료 명단
            </h3>
            {detail.signed_parents.length === 0 ? (
              <p className="text-[13px] text-[color:var(--text-muted)]">
                아직 신청한 학부모가 없습니다.
              </p>
            ) : (
              <ul className="divide-y divide-[color:var(--border)] rounded-lg border border-[color:var(--border)] bg-bg-card">
                {detail.signed_parents.map((p) => (
                  <li
                    key={p.item_id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="font-medium text-[14px] text-[color:var(--text)] truncate">
                      {p.student_name}
                    </span>
                    <span className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
                      {canRevealPhone
                        ? formatPhone(p.parent_phone) || "—"
                        : maskPhone(p.parent_phone) || "—"}
                    </span>
                    <div className="flex-1" />
                    <span className="inline-flex items-center gap-1 text-[12px] text-[color:var(--text-dim)] tabular-nums">
                      <Calendar className="size-3" strokeWidth={1.75} aria-hidden />
                      {formatKstDateTime(p.signed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <span className="hidden" data-class-name={className} />
    </section>
  );
}

// ─── 헬퍼 ───────────────────────────────────────────────────

function PageStatusBadge({ status }: { status: StatusValue }) {
  if (status === "open") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium bg-[color:var(--action)] text-[color:var(--action-text)]">
        공개 중
      </span>
    );
  }
  if (status === "closed") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] border border-[color:var(--border)] text-[color:var(--text-muted)] bg-[color:var(--bg-muted)]">
        마감
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]">
      초안
    </span>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label
      className={`flex flex-col gap-1 ${full ? "sm:col-span-2" : ""}`}
    >
      <span className="text-[12px] font-medium text-[color:var(--text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * ISO timestamptz → `<input type="datetime-local">` 값 ("YYYY-MM-DDTHH:mm").
 * 빈 입력은 ""; 입력 위젯이 비어있게 표시.
 */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `<input type="datetime-local">` 값 → ISO. 빈 값은 null.
 * 로컬 타임존(=KST 운영 가정)으로 해석돼 toISOString 으로 UTC ISO 반환.
 */
function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
