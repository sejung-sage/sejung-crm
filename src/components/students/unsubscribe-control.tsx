"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BellOff, Loader2, ShieldX } from "lucide-react";
import {
  addUnsubscribeAction,
  removeUnsubscribeAction,
} from "@/app/(features)/students/actions";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  /** 대상 학부모 연락처 (원본). */
  phone: string;
  /** 최초 렌더 시 수신거부 등록 여부 (서버에서 조회). */
  initialUnsubscribed: boolean;
  /** 수신거부 "등록" 권한. viewer 는 false. */
  canManage: boolean;
  /** 수신거부 "해제" 권한. master 만 true. */
  canRemove: boolean;
}

/**
 * 학생 상세 헤더의 수신거부 등록/해제 컨트롤 (Client Component).
 *
 * 상태:
 *  - 수신거부됨: 연한 빨강 톤 뱃지 "수신거부됨" 표시.
 *      · master(canRemove) 면 옆에 [해제] 버튼.
 *  - 정상: canManage 면 [수신거부 등록] 아웃라인 버튼.
 *      · 클릭 시 인앱 확인 다이얼로그(ConfirmDialog)로 재확인 후 등록.
 *      · viewer 는 버튼 미표시.
 *
 * 안전·접근성:
 *  - useTransition 으로 로딩·중복클릭 방지.
 *  - window.confirm 금지(프로젝트 정책). ConfirmDialog 가 포커스·Esc·스크롤 잠금 처리.
 *  - dev_seed_mode / forbidden 응답은 회색 안내 토스트.
 *  - 성공 시 router.refresh() 로 서버 상태 재동기화.
 */
export function UnsubscribeControl({
  phone,
  initialUnsubscribed,
  canManage,
  canRemove,
}: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onAdd = () => {
    startTransition(async () => {
      const result = await addUnsubscribeAction({ phone });
      if (result.status === "success") {
        showToast("success", "이 번호를 수신거부에 등록했어요");
        setConfirming(false);
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        showToast("error", "개발용 시드 데이터라 실제 반영되지 않습니다");
        setConfirming(false);
      } else {
        showToast(
          "error",
          `수신거부 등록에 실패했어요${result.reason ? `: ${result.reason}` : ""}`,
        );
        setConfirming(false);
      }
    });
  };

  const onRemove = () => {
    startTransition(async () => {
      const result = await removeUnsubscribeAction({ phone });
      if (result.status === "success") {
        showToast("success", "수신거부를 해제했어요");
        router.refresh();
      } else if (result.status === "forbidden") {
        showToast("error", "수신거부 해제 권한이 없어요 (최고관리자만 가능)");
      } else if (result.status === "dev_seed_mode") {
        showToast("error", "개발용 시드 데이터라 실제 반영되지 않습니다");
      } else {
        showToast(
          "error",
          `수신거부 해제에 실패했어요${result.reason ? `: ${result.reason}` : ""}`,
        );
      }
    });
  };

  // ── 수신거부됨 상태 ───────────────────────────────────────────
  if (initialUnsubscribed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="
            inline-flex items-center gap-1.5
            h-8 px-2.5 rounded-md
            border border-dashed border-[color:var(--danger)]
            bg-[color:var(--danger-bg)]
            text-[13px] font-medium text-[color:var(--danger)]
          "
          // 색만으로 정보 전달 금지 → 아이콘 + 텍스트 병기
        >
          <ShieldX className="size-4" strokeWidth={1.75} aria-hidden />
          수신거부됨
        </span>

        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={isPending}
            aria-label="이 번호의 수신거부 해제"
            className="
              inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
              border border-[color:var(--border)] bg-bg-card
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
              focus:outline-none focus:ring-2 focus:ring-[color:var(--action)]
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
            ) : null}
            {isPending ? "처리 중..." : "해제"}
          </button>
        )}
      </div>
    );
  }

  // ── 정상 상태 ────────────────────────────────────────────────
  if (!canManage) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={isPending}
        aria-label="이 학부모 번호를 수신거부에 등록"
        className="
          inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
          border border-[color:var(--border)] bg-bg-card
          text-[14px] text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
          focus:outline-none focus:ring-2 focus:ring-[color:var(--action)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
        "
      >
        <BellOff className="size-4" strokeWidth={1.75} aria-hidden />
        수신거부 등록
      </button>

      {confirming && (
        <ConfirmDialog
          title="이 학부모 번호를 수신거부에 등록할까요?"
          description="등록 후 이 번호로는 문자가 발송되지 않고 '실패(수신거부)'로 표시됩니다."
          confirmLabel="수신거부 등록"
          confirmTone="danger"
          busy={isPending}
          onCancel={() => {
            if (!isPending) setConfirming(false);
          }}
          onConfirm={onAdd}
        />
      )}
    </>
  );
}
