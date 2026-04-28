"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Pencil, Send, Trash2 } from "lucide-react";
import { deleteGroupAction } from "@/app/(features)/groups/actions";

interface Props {
  groupId: string;
  groupName: string;
}

/**
 * 그룹 상세 상단 우측 액션 그룹 (Client Component).
 * 수정·복제·삭제·발송 버튼 + 삭제 확인 다이얼로그.
 */
export function GroupDetailActions({ groupId, groupName }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onDelete = () => {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await deleteGroupAction(groupId);
      if (result.status === "success") {
        router.push("/groups");
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 삭제되지 않습니다. Supabase 연결 후 동작합니다.",
        );
        setConfirming(false);
      } else {
        setErrorMsg(result.reason);
        setConfirming(false);
      }
    });
  };

  const onDuplicate = () => {
    setNotice(
      "그룹 복제는 Phase 1 에서 제공됩니다. 새 그룹을 만들어 동일한 조건을 선택해 주세요.",
    );
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <Link
          href={`/groups/${groupId}/edit`}
          className="
            inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
            border border-[color:var(--border)] bg-white
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
          수정
        </Link>
        <button
          type="button"
          onClick={onDuplicate}
          className="
            inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
            border border-[color:var(--border)] bg-white
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          <Copy className="size-4" strokeWidth={1.75} aria-hidden />
          복제
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="
            inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
            border border-[color:var(--border)] bg-white
            text-[14px] text-[color:var(--danger)]
            hover:bg-[color:var(--danger-bg)]
            transition-colors
          "
        >
          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
          삭제
        </button>
        <Link
          href={`/compose?groupId=${groupId}`}
          className="
            inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            transition-colors
          "
        >
          <Send className="size-4" strokeWidth={1.75} aria-hidden />
          이 그룹으로 발송
        </Link>
      </div>

      {notice && (
        <p className="text-[13px] text-[color:var(--text-muted)] max-w-md text-right">
          {notice}
        </p>
      )}
      {errorMsg && (
        <p className="text-[13px] text-[color:var(--danger)] max-w-md text-right">
          {errorMsg}
        </p>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirming(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white border border-[color:var(--border)] shadow-lg p-6 space-y-4">
            <h2
              id="delete-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              그룹을 삭제할까요?
            </h2>
            <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
              &lsquo;{groupName}&rsquo; 그룹을 삭제합니다. 이미 발송된 캠페인 기록은 보존됩니다.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-4 rounded-lg
                  border border-[color:var(--border)] bg-white
                  text-[14px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)]
                  disabled:opacity-50 transition-colors
                "
              >
                취소
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-4 rounded-lg
                  bg-[color:var(--danger)] text-white
                  text-[14px] font-medium
                  hover:opacity-90 disabled:opacity-50
                  transition-colors
                "
              >
                {isPending ? "처리 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
