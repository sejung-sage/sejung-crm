"use client";

import { useTransition } from "react";
import { Pencil, Lock, Ban } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { SeminarStatus } from "@/lib/seminars/dev-seed";

/**
 * 설명회 상세 화면 우측 보조 액션 — UI MOCKUP ONLY.
 *
 * - "수정": placeholder. 향후 `/seminars/[id]/edit` 라우트.
 * - "수동 마감": 모집중 상태일 때만. 확인 다이얼로그 + toast.
 * - "취소": cancelled 가 아닐 때만. 확인 다이얼로그 + toast.
 *
 * 모든 동작은 실제 DB 호출 없이 setTimeout 으로 시뮬레이션.
 */
export function SeminarDetailActions({
  seminarId,
  status,
}: {
  seminarId: string;
  status: SeminarStatus;
}) {
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  void seminarId; // 시연용 — 실제 mutation 시 사용 예정

  const handleEdit = () => {
    showToast("success", "수정 화면은 운영자 확정 후 연동 예정입니다 (시연용)");
  };

  const handleClose = () => {
    if (!confirm("이 설명회의 신청을 마감할까요? 학부모는 더 이상 신청할 수 없게 됩니다.")) return;
    startTransition(async () => {
      await new Promise((r) => setTimeout(r, 400));
      showToast("success", "설명회 신청을 마감했습니다 (시연용)");
    });
  };

  const handleCancel = () => {
    if (!confirm("이 설명회를 취소할까요? 기존 신청 내역은 보존되지만 학부모 페이지에서 안내가 변경됩니다.")) return;
    startTransition(async () => {
      await new Promise((r) => setTimeout(r, 400));
      showToast("success", "설명회를 취소했습니다 (시연용)");
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={handleEdit}
        disabled={isPending}
        className={btnClass}
      >
        <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
        수정
      </button>
      {status === "open" && (
        <button
          type="button"
          onClick={handleClose}
          disabled={isPending}
          className={btnClass}
        >
          <Lock className="size-4" strokeWidth={1.75} aria-hidden />
          수동 마감
        </button>
      )}
      {status !== "cancelled" && status !== "ended" && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={isPending}
          className={`${btnClass} hover:text-[color:var(--danger)] hover:border-[color:var(--danger)]`}
        >
          <Ban className="size-4" strokeWidth={1.75} aria-hidden />
          취소
        </button>
      )}
    </div>
  );
}

const btnClass = `
  inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
  border border-[color:var(--border-strong)] bg-bg-card
  text-[14px] text-[color:var(--text)]
  hover:bg-[color:var(--bg-hover)]
  disabled:opacity-50
  transition-colors
`;
