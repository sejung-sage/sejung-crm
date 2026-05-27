"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { testSendAction } from "@/app/(features)/compose/actions";
import { useToast } from "@/components/ui/toast";
import type { TemplateTypeLiteral } from "@/lib/schemas/template";

/**
 * 본인 또는 임의 휴대폰 번호 1건으로 즉시 테스트 발송 — 인라인 카드.
 *
 * 사용처:
 *  - 템플릿 수정 화면의 미리보기 패널 위 (template-form)
 *  - 발송 작성 step3 미리보기 영역 (compose-step-3-preview)
 *
 * 두 곳이 같은 컴포넌트를 쓰면 동작·디자인이 1:1 일치.
 *
 * 동작:
 *  - 입력 번호 → testSendAction → is_test=true 캠페인 INSERT + sendon 1회 호출
 *  - 광고 가드·야간 차단·prefix·080 모두 server 단에서 동일 적용
 *  - dev-seed 모드면 실 발송 차단
 *
 * 활성 조건:
 *  - 본문이 비어있지 않고 바이트 한도 통과 (disabled prop 으로 부모에서 가드)
 *  - 전화번호 형식 010~019 7~8자리
 *
 * 비용 안내: SMS 7.4원 / LMS 24원. 테스트 모드라도 실 비용 발생.
 */
interface Props {
  type: TemplateTypeLiteral;
  subject: string | null;
  body: string;
  isAd: boolean;
  /** 부모에서 본문 비었거나 바이트 초과 시 true. 기본 false. */
  disabled?: boolean;
}

export function TestSendCard({
  type,
  subject,
  body,
  isAd,
  disabled = false,
}: Props) {
  const { show: showToast } = useToast();
  const [phone, setPhone] = useState("");
  const [sending, startSending] = useTransition();

  const normalized = phone.replace(/\D/g, "");
  const phoneValid = /^01[016789][0-9]{7,8}$/.test(normalized);

  const onSend = () => {
    if (!phoneValid) {
      showToast("error", "휴대폰 번호 형식이 올바르지 않습니다 (010-...)");
      return;
    }
    startSending(async () => {
      const result = await testSendAction({
        // 테스트 발송은 본인 번호 1건 — dedupe·발송대상 무관. refine 통과용으로
        // sendToParent=true 고정(학생 레그 없음). 실제 발송 대상은 테스트에 영향 없음.
        step2: {
          type,
          subject,
          body,
          isAd,
          dedupeByPhone: false,
          sendToParent: true,
          sendToStudent: false,
        },
        toPhone: normalized,
      });
      if (result.status === "success") {
        showToast(
          "success",
          `테스트 발송 완료 — ${formatPhoneShort(normalized)}`,
        );
      } else if (result.status === "scheduled") {
        showToast("success", "테스트 발송이 예약됐어요");
      } else if (result.status === "dev_seed_mode") {
        showToast("error", "개발 시드 모드 — 실 발송 차단됨");
      } else if (result.status === "blocked") {
        showToast(
          "error",
          `차단: ${"reason" in result ? result.reason : "야간 광고 차단"}`,
        );
      } else {
        showToast(
          "error",
          `테스트 발송 실패: ${"reason" in result ? result.reason : "알 수 없는 오류"}`,
        );
      }
    });
  };

  return (
    <section
      aria-label="테스트 발송"
      className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Send
          className="size-4 text-[color:var(--text-muted)]"
          strokeWidth={1.75}
          aria-hidden
        />
        <h3 className="text-[13px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
          테스트 발송
        </h3>
      </div>
      <div className="flex gap-2">
        <input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="010-0000-0000"
          aria-label="테스트 수신 번호"
          className="
            flex-1 min-w-0 h-10 px-3 rounded-lg
            border border-[color:var(--border)] bg-bg-card
            text-[14px] text-[color:var(--text)] tabular-nums
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
          "
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !phoneValid || sending}
          className="
            shrink-0 inline-flex items-center justify-center
            h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed
            transition-opacity
          "
        >
          {sending ? "발송 중…" : "보내기"}
        </button>
      </div>
      <p className="text-[12px] text-[color:var(--text-dim)] leading-relaxed">
        입력한 번호로 1건만 보냅니다. is_test 캠페인으로 기록되어 통계에는 섞이지 않으나
        실 발송 비용은 발생합니다 (SMS 7.4원 / LMS 24원).
      </p>
    </section>
  );
}

function formatPhoneShort(digits: string): string {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}
