"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  MapPin,
  Ban,
  Clock,
  Info,
  Lock,
} from "lucide-react";
import type {
  LookupInvitationByTokenResult,
  LookupInvitationItem,
  InvitationItemStatus,
} from "@/types/database";
import { formatKstDateTime } from "@/lib/datetime";
import { formatPhone } from "@/lib/phone";
// 0082 invitation 흐름: 학부모 카드 [신청하기] 클릭 → claim_invitation_item RPC.
import { claimInvitationItemAction } from "@/app/(features)/seminars/actions";

/**
 * 학부모 공개 페이지 본체 — invitation 모델(0082).
 *
 * 화면 구조 (Aca2000 식):
 *   ┌──────────────────────────────┐
 *   │  세정학원 · {분원}            │
 *   ├──────────────────────────────┤
 *   │  {학생명} 학생 전용 신청      │
 *   │  {학부모 전화}                │
 *   ├──────────────────────────────┤
 *   │  ⚠️ 본인 전용 — 공유 금지     │
 *   ├──────────────────────────────┤
 *   │  [설명회 카드 1]              │
 *   │    제목 / 일시 / 장소 / 버튼   │
 *   │  [설명회 카드 2] …            │
 *   └──────────────────────────────┘
 *
 * - 폼 입력 없음. 학생 메타는 RPC 가 미리 박아 보내준다.
 * - 카드 [신청하기] 클릭 → Server Action → status 분기.
 * - 낙관적 업데이트 + router.refresh() 로 즉시 반영.
 * - localStorage 기억 로직 없음 — 서버 상태로 멱등 처리(already_signed).
 */
interface Props {
  token: string;
  invitation: LookupInvitationByTokenResult;
  /** 분원 문의 번호 — 데모용 고정값 */
  inquiryPhone: string;
}

interface PendingState {
  /** 클릭 중인 카드의 signup_page_id. 버튼 disabled 표시용. */
  busyPageId: string | null;
  /** 카드별 강제 상태 override (낙관적 업데이트). signup_page_id → status. */
  overrides: Record<string, InvitationItemStatus | "closed" | "ended" | "out_of_window">;
  /** 카드별 안내 메시지(서버에서 받은 reason). */
  reasons: Record<string, string | null>;
}

export function ParentInvitationFlow({
  token,
  invitation,
  inquiryPhone,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingState>({
    busyPageId: null,
    overrides: {},
    reasons: {},
  });
  const [, startTransition] = useTransition();

  // 신청 확인 모달 대상 카드. null 이면 모달 닫힘.
  // 네이티브 window.confirm 대신 인앱 모달을 쓴다 — iOS Safari 가 confirm/alert 에
  // "대화상자 숨기기" 버튼을 붙여, 학부모가 그걸 누르면 이후 신청 확인창이 차단돼
  // 신청이 막히는 문제(2026-06-04 구진규 보고)를 없앤다.
  const [confirmItem, setConfirmItem] = useState<LookupInvitationItem | null>(
    null,
  );
  // 신청 결과 안내 모달 (성공/이미 신청). null 이면 닫힘.
  const [notice, setNotice] = useState<string | null>(null);

  // 중복 신청 허용 여부 (0087). false 면 1개만 신청 가능 — 이미 1개라도 signed
  // 이면 나머지 pending 카드를 잠근다(서버 limit_reached 와 일관).
  const allowMultiple = invitation.allow_multiple;

  // 카드의 "현재 유효 상태"를 server 상태 + 이번 세션 override 로 합성하는 헬퍼.
  // (아래 렌더 분기와 동일 규칙 — "이미 어떤 카드든 signed 인지" 판정에 재사용.)
  const resolveStatus = (
    item: LookupInvitationItem,
  ): InvitationItemStatus | "closed" | "ended" | "out_of_window" => {
    const override = pending.overrides[item.signup_page_id];
    const baseStatus: InvitationItemStatus | "closed" =
      item.page_status === "closed" ? "closed" : item.item_status;
    return override ?? baseStatus;
  };

  // 1개라도 signed(서버 또는 이번 세션 낙관적 override)면 true.
  const hasAnySigned = invitation.items.some(
    (item) => resolveStatus(item) === "signed",
  );

  // allow_multiple=false 인데 이미 1개 signed → 나머지 pending 카드 잠금.
  const lockOthers = !allowMultiple && hasAnySigned;

  // 카드 [신청하기] → 확인 모달 열기.
  const handleClaim = (item: LookupInvitationItem) => {
    if (pending.busyPageId) return;
    setConfirmItem(item);
  };

  // 확인 모달에서 [신청하기] 확정 → 실제 신청 처리.
  const confirmClaim = () => {
    const item = confirmItem;
    setConfirmItem(null);
    if (!item || pending.busyPageId) return;

    setPending((p) => ({ ...p, busyPageId: item.signup_page_id }));

    startTransition(async () => {
      const result = await claimInvitationItemAction({
        token,
        signup_page_id: item.signup_page_id,
      });

      const applyState = (
        status: InvitationItemStatus | "closed" | "ended" | "out_of_window",
        reason: string | null,
      ) => {
        setPending((p) => ({
          busyPageId: null,
          overrides: { ...p.overrides, [item.signup_page_id]: status },
          reasons: { ...p.reasons, [item.signup_page_id]: reason },
        }));
      };

      // backend(0082)의 ClaimInvitationItemActionResult 는 RPC enum 을 status 로
      // 그대로 펼친 flat union 이다 — 'signed' | 'already_signed' | 'closed' | ...
      // 별도 'success' 래퍼가 없으니 status 자체로 분기한다.
      switch (result.status) {
        case "signed":
          applyState("signed", null);
          setNotice(`"${item.name}" 신청이 완료되었습니다.`);
          router.refresh();
          break;
        case "already_signed":
          applyState("signed", null);
          setNotice("이미 신청된 설명회입니다.");
          router.refresh();
          break;
        case "limit_reached":
          // 중복 신청 불가(allow_multiple=false) 인데 이미 다른 카드 signed (0087).
          // 낙관적 signed 처리 금지 — 이 카드는 pending 으로 두고 사유만 표시.
          // 다른 카드가 이미 signed 라 lockOthers 로 버튼은 이미 잠겨 있다.
          applyState(
            item.item_status,
            result.reason ?? "다른 설명회를 이미 신청해 1개만 신청할 수 있어요",
          );
          break;
        case "closed":
          applyState("closed", result.reason ?? "정원이 마감되었습니다");
          break;
        case "ended":
          applyState("ended", result.reason ?? "행사가 종료되었습니다");
          break;
        case "out_of_window":
          applyState(
            "out_of_window",
            result.reason ?? "신청 기간이 아닙니다",
          );
          break;
        case "cancelled":
          applyState("cancelled", result.reason ?? "취소된 설명회입니다");
          break;
        case "invalid":
          applyState(
            item.item_status,
            result.reason ?? "유효하지 않은 신청입니다",
          );
          break;
        case "dev_seed_mode":
          // 시연 모드: 낙관적으로 신청 완료 처리.
          applyState("signed", null);
          setNotice(`"${item.name}" 신청이 완료되었습니다.`);
          break;
        case "failed":
          applyState(
            item.item_status,
            result.reason ?? "신청 처리에 실패했습니다",
          );
          break;
      }
    });
  };

  return (
    <div className="space-y-5">
      {/* 학생 정보 박스 */}
      <section
        aria-label="학생 정보"
        className="
          rounded-2xl border border-[color:var(--border-strong)]
          bg-[color:var(--bg-muted)] p-5
        "
      >
        <p className="text-[13px] text-[color:var(--text-muted)]">
          본인 전용 신청 페이지
        </p>
        <h1 className="mt-1 text-[20px] font-semibold text-[color:var(--text)]">
          {invitation.student_name} 학생
        </h1>
        {invitation.parent_phone && (
          <p className="mt-1.5 text-[14px] text-[color:var(--text-muted)] tabular-nums">
            {formatPhone(invitation.parent_phone)}
          </p>
        )}
      </section>

      {/* 공유 금지 경고 */}
      <div
        role="note"
        className="
          flex items-start gap-2.5
          rounded-xl border border-[color:var(--border)]
          bg-bg-card px-4 py-3
        "
      >
        <AlertCircle
          className="mt-0.5 size-5 shrink-0 text-[color:var(--warning)]"
          strokeWidth={1.75}
          aria-hidden
        />
        <p className="text-[13px] leading-relaxed text-[color:var(--text-muted)]">
          이 링크는 <strong className="text-[color:var(--text)]">본인 전용</strong>
          입니다. 다른 분에게 공유하지 마세요. 공유된 링크로 신청한 경우 학생
          본인 신청과 충돌할 수 있습니다.
        </p>
      </div>

      {/* 1개만 신청 가능 안내 (allow_multiple=false). 공유 금지 경고 바로 아래. */}
      {!allowMultiple && (
        <div
          role="note"
          className="
            flex items-start gap-2.5
            rounded-xl border border-[color:var(--border-strong)]
            bg-[color:var(--bg-muted)] px-4 py-3
          "
        >
          <Info
            className="mt-0.5 size-5 shrink-0 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <p className="text-[14px] leading-relaxed text-[color:var(--text)]">
            <strong className="font-semibold">이 중 한 개만 신청할 수 있어요.</strong>{" "}
            하나를 신청하면 나머지는 신청할 수 없습니다.
          </p>
        </div>
      )}

      {/* 설명회 카드 리스트 */}
      {invitation.items.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--border)] bg-bg-card p-6 text-center">
          <p className="text-[14px] text-[color:var(--text-muted)]">
            신청 가능한 설명회가 없습니다.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="설명회 목록">
          {invitation.items.map((item) => {
            const override = pending.overrides[item.signup_page_id];
            // 페이지가 closed 면 카드 상태가 'pending' 이어도 신청 막아야 함.
            const baseStatus: InvitationItemStatus | "closed" =
              item.page_status === "closed" ? "closed" : item.item_status;
            const effectiveStatus = override ?? baseStatus;
            const reason = pending.reasons[item.signup_page_id] ?? null;
            const isBusy = pending.busyPageId === item.signup_page_id;
            // allow_multiple=false 로 다른 카드가 signed 라면, 이 pending 카드는
            // 잠근다(자기 자신이 signed 면 잠금 아님 — "신청 완료"로 표시).
            const locked = lockOthers && effectiveStatus !== "signed";
            return (
              <li key={item.item_id}>
                <SeminarCard
                  item={item}
                  status={effectiveStatus}
                  reason={reason}
                  busy={isBusy}
                  locked={locked}
                  onClaim={() => handleClaim(item)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* 문의 안내 */}
      <p className="text-center text-[13px] text-[color:var(--text-muted)]">
        문의:{" "}
        <a
          href={`tel:${inquiryPhone.replace(/-/g, "")}`}
          className="text-[color:var(--text)] font-medium hover:underline"
        >
          {inquiryPhone}
        </a>
      </p>

      {/* 신청 확인 모달 — 네이티브 confirm 대체 (iOS '대화상자 숨기기' 제거). */}
      {confirmItem && (
        <Modal
          title="설명회를 신청하시겠습니까?"
          onClose={() => setConfirmItem(null)}
        >
          <div className="space-y-1.5">
            <p className="text-[16px] font-semibold text-[color:var(--text)] leading-snug">
              {confirmItem.name}
            </p>
            {confirmItem.held_at && (
              <p className="text-[14px] text-[color:var(--text-muted)] tabular-nums">
                {formatKstDateTime(confirmItem.held_at)}
              </p>
            )}
          </div>
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={confirmClaim}
              className="
                w-full inline-flex items-center justify-center
                h-12 px-4 rounded-xl
                bg-[color:var(--action)] text-[color:var(--action-text)]
                text-[16px] font-semibold
                hover:bg-[color:var(--action-hover)] transition-colors
              "
            >
              신청하기
            </button>
            <button
              type="button"
              onClick={() => setConfirmItem(null)}
              className="
                w-full inline-flex items-center justify-center
                h-12 px-4 rounded-xl
                border border-[color:var(--border)] bg-bg-card
                text-[15px] font-medium text-[color:var(--text-muted)]
                hover:bg-[color:var(--bg-hover)] transition-colors
              "
            >
              취소
            </button>
          </div>
        </Modal>
      )}

      {/* 신청 결과 안내 모달 — 네이티브 alert 대체. */}
      {notice && (
        <Modal title="안내" onClose={() => setNotice(null)}>
          <div className="flex items-start gap-2.5">
            <CheckCircle2
              className="mt-0.5 size-6 shrink-0 text-[color:var(--success)]"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-[15px] leading-relaxed text-[color:var(--text)]">
              {notice}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="
              mt-5 w-full inline-flex items-center justify-center
              h-12 px-4 rounded-xl
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[16px] font-semibold
              hover:bg-[color:var(--action-hover)] transition-colors
            "
          >
            확인
          </button>
        </Modal>
      )}
    </div>
  );
}

// ─── 인앱 모달 (네이티브 confirm/alert 대체) ─────────────────────
//
// 학부모(모바일·40~60대) 대상이라 큰 버튼·흰검 미니멀. 배경 클릭 시 닫힘,
// role="dialog"+aria-modal 로 접근성 보장.
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="
          w-full max-w-sm rounded-2xl bg-bg-card p-6
          border border-[color:var(--border)] shadow-xl
        "
      >
        <h2 className="text-[17px] font-semibold text-[color:var(--text)]">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

// ─── 설명회 카드 ─────────────────────────────────────────────

type CardStatus =
  | InvitationItemStatus
  | "closed"
  | "ended"
  | "out_of_window";

function SeminarCard({
  item,
  status,
  reason,
  busy,
  locked,
  onClaim,
}: {
  item: LookupInvitationItem;
  status: CardStatus;
  reason: string | null;
  busy: boolean;
  /** allow_multiple=false 로 다른 카드가 이미 signed 라 잠긴 pending 카드. */
  locked: boolean;
  onClaim: () => void;
}) {
  return (
    <article
      className={`
        rounded-2xl border bg-bg-card p-5 space-y-3
        ${status === "cancelled" || status === "ended" || status === "closed" || status === "out_of_window" || locked
          ? "border-[color:var(--border)] opacity-75"
          : "border-[color:var(--border-strong)]"}
      `}
    >
      <header className="space-y-2">
        <h2 className="text-[17px] font-semibold leading-snug text-[color:var(--text)]">
          {item.name}
        </h2>
        <div className="space-y-1.5 text-[14px]">
          {item.held_at && (
            <div className="flex items-start gap-2 text-[color:var(--text-muted)]">
              <Calendar
                className="mt-0.5 size-4 shrink-0 text-[color:var(--text-dim)]"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="text-[color:var(--text)] tabular-nums">
                {formatKstDateTime(item.held_at)}
              </span>
            </div>
          )}
          {item.venue && (
            <div className="flex items-start gap-2 text-[color:var(--text-muted)]">
              <MapPin
                className="mt-0.5 size-4 shrink-0 text-[color:var(--text-dim)]"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="text-[color:var(--text)]">{item.venue}</span>
            </div>
          )}
        </div>
        {item.description && (
          <p className="text-[13px] leading-relaxed text-[color:var(--text-muted)] whitespace-pre-line pt-1">
            {item.description}
          </p>
        )}
      </header>

      <CardAction
        status={status}
        reason={reason}
        busy={busy}
        locked={locked}
        signedAt={item.signed_at}
        onClaim={onClaim}
      />
    </article>
  );
}

function CardAction({
  status,
  reason,
  busy,
  locked,
  signedAt,
  onClaim,
}: {
  status: CardStatus;
  reason: string | null;
  busy: boolean;
  /** allow_multiple=false 로 다른 카드가 signed 라 잠긴 pending 카드. */
  locked: boolean;
  signedAt: string | null;
  onClaim: () => void;
}) {
  if (status === "signed") {
    return (
      <div
        className="
          flex items-center justify-center gap-2
          h-12 px-4 rounded-xl
          bg-[color:var(--success-bg)] text-[color:var(--success)]
          text-[15px] font-semibold
        "
        aria-live="polite"
      >
        <CheckCircle2 className="size-5" strokeWidth={2} aria-hidden />
        신청 완료
        {signedAt && (
          <span className="text-[12px] font-normal tabular-nums opacity-80">
            {formatKstDateTime(signedAt)}
          </span>
        )}
      </div>
    );
  }

  if (status === "cancelled") {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          disabled
          className="
            w-full inline-flex items-center justify-center gap-2
            h-12 px-4 rounded-xl
            bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]
            text-[15px] font-semibold cursor-not-allowed
          "
        >
          <Ban className="size-5" strokeWidth={1.75} aria-hidden />
          취소된 설명회
        </button>
        {reason && (
          <p className="text-[12px] text-[color:var(--text-muted)] text-center">
            {reason}
          </p>
        )}
      </div>
    );
  }

  if (status === "closed") {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          disabled
          className="
            w-full inline-flex items-center justify-center gap-2
            h-12 px-4 rounded-xl
            bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]
            text-[15px] font-semibold cursor-not-allowed
          "
        >
          정원 마감
        </button>
        {reason && (
          <p className="text-[12px] text-[color:var(--text-muted)] text-center">
            {reason}
          </p>
        )}
      </div>
    );
  }

  if (status === "ended") {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          disabled
          className="
            w-full inline-flex items-center justify-center gap-2
            h-12 px-4 rounded-xl
            bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]
            text-[15px] font-semibold cursor-not-allowed
          "
        >
          신청 종료
        </button>
        {reason && (
          <p className="text-[12px] text-[color:var(--text-muted)] text-center">
            {reason}
          </p>
        )}
      </div>
    );
  }

  if (status === "out_of_window") {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          disabled
          className="
            w-full inline-flex items-center justify-center gap-2
            h-12 px-4 rounded-xl
            bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]
            text-[15px] font-semibold cursor-not-allowed
          "
        >
          <Clock className="size-5" strokeWidth={1.75} aria-hidden />
          신청 기간 외
        </button>
        {reason && (
          <p className="text-[12px] text-[color:var(--text-muted)] text-center">
            {reason}
          </p>
        )}
      </div>
    );
  }

  // pending 이지만 allow_multiple=false 로 다른 카드가 이미 signed → 잠금.
  if (locked) {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          disabled
          className="
            w-full inline-flex items-center justify-center gap-2
            h-12 px-4 rounded-xl
            bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]
            text-[15px] font-semibold cursor-not-allowed
          "
        >
          <Lock className="size-5" strokeWidth={1.75} aria-hidden />
          신청 불가
        </button>
        <p className="text-[12px] text-[color:var(--text-muted)] text-center">
          {reason ?? "1개만 신청 가능 (다른 설명회 신청함)"}
        </p>
      </div>
    );
  }

  // pending → 신청 가능.
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onClaim}
        disabled={busy}
        className="
          w-full inline-flex items-center justify-center gap-2
          h-12 px-4 rounded-xl
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[16px] font-semibold
          hover:bg-[color:var(--action-hover)]
          disabled:opacity-60 disabled:cursor-not-allowed
          transition-colors
        "
      >
        {busy ? "신청 중..." : "설명회 신청하기"}
      </button>
      {reason && (
        <p className="text-[12px] text-[color:var(--danger)] text-center">
          {reason}
        </p>
      )}
    </div>
  );
}
