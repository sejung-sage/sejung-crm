"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Lock, Ban } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { SeminarStatus } from "@/types/database";
import { changeSeminarStatusAction } from "@/app/(features)/seminars/actions";

/**
 * 설명회 상세 화면 우측 보조 액션.
 *
 * - "수동 마감" → status='closed' (open 상태일 때만).
 * - "취소"     → status='cancelled' (이미 취소/종료 아닐 때만).
 *
 * 둘 다 confirm 다이얼로그 + Server Action + revalidate + toast.
 */
export function SeminarDetailActions({
  seminarId,
  status,
}: {
  seminarId: string;
  status: SeminarStatus;
}) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const handleChangeStatus = (
    next: SeminarStatus,
    confirmMessage: string,
    successMessage: string,
  ) => {
    if (!confirm(confirmMessage)) return;
    startTransition(async () => {
      const result = await changeSeminarStatusAction({
        seminar_id: seminarId,
        status: next,
      });
      switch (result.status) {
        case "success":
          showToast("success", successMessage);
          router.refresh();
          break;
        case "dev_seed_mode":
          showToast(
            "success",
            "개발 시드 모드입니다. 실제 변경은 일어나지 않았습니다",
          );
          break;
        case "failed":
          showToast("error", result.reason ?? "상태 변경에 실패했습니다");
          break;
      }
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {status === "open" && (
        <button
          type="button"
          onClick={() =>
            handleChangeStatus(
              "closed",
              "이 설명회의 신청을 마감할까요? 학부모는 더 이상 신청할 수 없게 됩니다.",
              "설명회 신청을 마감했습니다",
            )
          }
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
          onClick={() =>
            handleChangeStatus(
              "cancelled",
              "이 설명회를 취소할까요? 기존 신청 내역은 보존되지만 학부모 페이지에서 안내가 변경됩니다.",
              "설명회를 취소했습니다",
            )
          }
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
