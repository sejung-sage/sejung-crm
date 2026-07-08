"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeUnsubscribeAction } from "@/app/(features)/students/actions";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatPhone } from "@/lib/phone";
import { formatKstDateTime } from "@/lib/datetime";

/** backend 제공 행 타입 (actions 모듈에서 export 되지만 표시용으로 로컬 재정의). */
export interface UnsubscribeRow {
  phone: string;
  unsubscribed_at: string;
  reason: string | null;
  student_name: string | null;
}

interface Props {
  rows: UnsubscribeRow[];
  /** "해제" 권한 — master 만 true. false 면 해제 버튼 미표시. */
  canRemove: boolean;
}

/**
 * 수신거부 목록 표 (Client Component).
 *
 * 컬럼: 번호 · 학생명 · 사유 · 등록일시 · 해제.
 *  - 번호는 관리 화면이므로 원문(formatPhone) 표시. 학생 명단의 마스킹 정책과 별개.
 *  - 해제는 canRemove(master)만. ConfirmDialog 재확인 → removeUnsubscribeAction.
 *  - forbidden 응답은 안내 토스트(서버가 권한 한 번 더 검증).
 *
 * 접근성:
 *  - 해제 버튼 ≥40px, 포커스 링, aria-label 에 번호 포함.
 *  - 빈 목록 안내 문구.
 */
export function UnsubscribesTable({ rows, canRemove }: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const confirmRemove = () => {
    if (!pendingPhone) return;
    const target = pendingPhone;
    startTransition(async () => {
      const result = await removeUnsubscribeAction({ phone: target });
      if (result.status === "success") {
        setPendingPhone(null);
        showToast("success", "수신거부를 해제했어요");
        router.refresh();
      } else if (result.status === "forbidden") {
        setPendingPhone(null);
        showToast("error", "수신거부 해제 권한이 없어요 (최고관리자만 가능)");
      } else if (result.status === "dev_seed_mode") {
        setPendingPhone(null);
        showToast("error", "개발용 시드 데이터라 실제 반영되지 않습니다");
      } else {
        setPendingPhone(null);
        showToast(
          "error",
          `수신거부 해제에 실패했어요${result.reason ? `: ${result.reason}` : ""}`,
        );
      }
    });
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          수신거부로 등록된 번호가 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          위의 &lsquo;수신거부 번호 추가&rsquo; 에서 제외할 번호를 등록할 수
          있습니다.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[color:var(--border)]">
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[13px] font-medium text-[color:var(--text-muted)]"
                >
                  번호
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[13px] font-medium text-[color:var(--text-muted)]"
                >
                  학생명
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[13px] font-medium text-[color:var(--text-muted)]"
                >
                  사유
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[13px] font-medium text-[color:var(--text-muted)]"
                >
                  등록일시
                </th>
                {canRemove && (
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-[13px] font-medium text-[color:var(--text-muted)] text-right"
                  >
                    관리
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {rows.map((row) => (
                <tr
                  key={row.phone}
                  className="hover:bg-[color:var(--bg-hover)] transition-colors"
                >
                  <td className="px-4 py-3 text-[15px] font-medium text-[color:var(--text)] tabular-nums whitespace-nowrap">
                    {formatPhone(row.phone)}
                  </td>
                  <td className="px-4 py-3 text-[15px] text-[color:var(--text)]">
                    {row.student_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[14px] text-[color:var(--text-muted)]">
                    {row.reason ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[14px] text-[color:var(--text-muted)] tabular-nums whitespace-nowrap">
                    {formatKstDateTime(row.unsubscribed_at)}
                  </td>
                  {canRemove && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setPendingPhone(row.phone)}
                        aria-label={`${formatPhone(row.phone)} 수신거부 해제`}
                        className="
                          inline-flex items-center justify-center
                          h-10 px-3 rounded-lg
                          border border-[color:var(--border)] bg-bg-card
                          text-[14px] text-[color:var(--text)]
                          hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
                          focus:outline-none focus:ring-2 focus:ring-[color:var(--action)]
                          transition-colors
                        "
                      >
                        해제
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pendingPhone && (
        <ConfirmDialog
          title="수신거부를 해제할까요?"
          description={
            <>
              <span className="font-medium text-[color:var(--text)]">
                {formatPhone(pendingPhone)}
              </span>{" "}
              번호의 수신거부를 해제합니다. 해제하면 이후 문자 발송 대상에 다시
              포함됩니다.
            </>
          }
          confirmLabel="해제"
          confirmTone="danger"
          busy={isPending}
          onCancel={() => {
            if (!isPending) setPendingPhone(null);
          }}
          onConfirm={confirmRemove}
        />
      )}
    </>
  );
}
