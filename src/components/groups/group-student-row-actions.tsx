"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { removeStudentFromGroupAction } from "@/app/(features)/groups/actions";
import { useToast } from "@/components/ui/toast";

interface Props {
  groupId: string;
  studentId: string;
  studentName: string;
}

/**
 * 그룹 상세 학생 행 우측 액션 (Client Component).
 *
 * 휴지통 아이콘 → 확인 다이얼로그 → `removeStudentFromGroupAction` 호출.
 * 성공 시 `router.refresh()` 로 상세 데이터 재페치.
 *
 * - 키보드: Tab 으로 진입, Enter/Space 로 클릭, Esc 로 다이얼로그 닫기.
 * - 로딩 중에는 휴지통 → Spinner 로 교체, 모든 컨트롤 비활성.
 * - 실패 시 토스트로 사유 노출, 다이얼로그는 자동 닫힘.
 * - dev_seed_mode 면 회색 토스트 안내.
 */
export function GroupStudentRowActions({
  groupId,
  studentId,
  studentName,
}: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // 다이얼로그 열릴 때 confirm 버튼에 포커스 (Esc 잘 동작 + 즉시 Enter 가능).
  useEffect(() => {
    if (confirming) {
      confirmBtnRef.current?.focus();
    }
  }, [confirming]);

  const onConfirm = () => {
    startTransition(async () => {
      const result = await removeStudentFromGroupAction(groupId, studentId);
      if (result.status === "success") {
        showToast("success", `${studentName} 학생을 그룹에서 제외했어요`);
        setConfirming(false);
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        showToast(
          "error",
          "개발용 시드 데이터라 실제 반영되지 않습니다",
        );
        setConfirming(false);
      } else {
        showToast("error", `학생 제외 실패: ${result.reason}`);
        setConfirming(false);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={isPending}
        aria-label={`${studentName} 학생을 그룹에서 제외`}
        className="
          inline-flex items-center justify-center
          size-7 rounded-md
          text-[color:var(--text-muted)]
          hover:text-[color:var(--danger)] hover:bg-[color:var(--bg-hover)]
          focus:outline-none focus:ring-2 focus:ring-[color:var(--action)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
          opacity-0 group-hover:opacity-100 focus:opacity-100
        "
      >
        {isPending ? (
          <Loader2
            className="size-4 animate-spin"
            strokeWidth={1.75}
            aria-hidden
          />
        ) : (
          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
        )}
      </button>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`remove-title-${studentId}`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) {
              setConfirming(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isPending) setConfirming(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg p-6 space-y-4">
            <h2
              id={`remove-title-${studentId}`}
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              이 학생을 그룹에서 제외하시겠습니까?
            </h2>
            <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
              <strong className="text-[color:var(--text)]">{studentName}</strong>
              {" "}학생을 이 그룹에서 제외합니다. 학생 데이터는 그대로 유지되며,
              앞으로 이 그룹으로 발송할 때 수신자에서 빠집니다.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-4 rounded-lg
                  border border-[color:var(--border)] bg-bg-card
                  text-[14px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)]
                  disabled:opacity-50 transition-colors
                "
              >
                취소
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={onConfirm}
                disabled={isPending}
                className="
                  inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
                  bg-[color:var(--danger)] text-white
                  text-[14px] font-medium
                  hover:opacity-90 disabled:opacity-50
                  transition-colors
                "
              >
                {isPending && (
                  <Loader2
                    className="size-4 animate-spin"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                )}
                {isPending ? "처리 중..." : "그룹에서 제외"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
