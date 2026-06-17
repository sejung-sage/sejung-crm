"use client";

import { useState, useTransition } from "react";
import { Send, ExternalLink, Copy, Check } from "lucide-react";
import { testSendAction } from "@/app/(features)/compose/actions";
import { seminarTestSendAction } from "@/app/(features)/seminars/actions";
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
 *
 * 설명회 모드:
 *  - `seminarClassIds` 가 length>0 이면 일반 testSendAction 대신
 *    seminarTestSendAction 을 호출한다. 이때 `body` 는 `{초대링크}` 가 든 raw
 *    본문이어야 하며, 서버가 실제 학생 토큰 URL 로 치환한다.
 *  - 서버는 result.inviteUrl 로 생성된 실제 링크를 돌려준다. 발송 성공·실패와
 *    무관하게 이 링크를 카드 하단에 노출해, 실 SMS 가 막혀 있어도 운영자가
 *    페이지를 바로 확인할 수 있게 한다.
 */
interface Props {
  type: TemplateTypeLiteral;
  subject: string | null;
  body: string;
  isAd: boolean;
  /** 부모에서 본문 비었거나 바이트 초과 시 true. 기본 false. */
  disabled?: boolean;
  /**
   * 발송 분원 — 일반 테스트 발송의 발신번호·브랜드 분원 해석용. 미지정 시 본인 분원.
   * (설명회 모드는 선택 강좌의 분원으로 서버가 해석하므로 이 값을 쓰지 않는다.)
   */
  branch?: string;
  /**
   * 설명회 모드 — 선택된 설명회(강좌) ID 목록. length>0 이면 설명회 테스트
   * 경로(seminarTestSendAction)를 사용하고 실제 초대 링크를 받아 노출한다.
   * 이 경우 `body` 는 `{초대링크}` 가 든 raw 본문이어야 한다.
   */
  seminarClassIds?: string[];
  /**
   * 설명회 모드 — 중복 신청 허용 여부 (0087). 위저드 체크박스 값을 그대로 받아
   * 테스트 invitation 에 반영해, 테스트 링크에서도 실제 발송과 동일한 중복신청
   * 동작(false 시 2번째 카드 limit_reached)을 재현한다. 미지정 시 true.
   */
  seminarAllowMultiple?: boolean;
}

export function TestSendCard({
  type,
  subject,
  body,
  isAd,
  disabled = false,
  branch,
  seminarClassIds,
  seminarAllowMultiple,
}: Props) {
  const { show: showToast } = useToast();
  const [phone, setPhone] = useState("");
  const [sending, startSending] = useTransition();
  // 설명회 모드에서 서버가 생성한 실제 테스트 링크. 발송 성공·실패 무관 노출.
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isSeminar = (seminarClassIds?.length ?? 0) > 0;

  const normalized = phone.replace(/\D/g, "");
  const phoneValid = /^01[016789][0-9]{7,8}$/.test(normalized);

  const onCopyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("error", "링크 복사에 실패했어요");
    }
  };

  const onSend = () => {
    if (!phoneValid) {
      showToast("error", "휴대폰 번호 형식이 올바르지 않습니다 (010-...)");
      return;
    }
    startSending(async () => {
      // ── 설명회 모드 ─────────────────────────────────────
      if (isSeminar && seminarClassIds) {
        const result = await seminarTestSendAction({
          classIds: seminarClassIds,
          body,
          subject,
          type,
          isAd,
          toPhone: normalized,
          // 중복 신청 허용 (0087) — 미지정 시 서버가 true 처리.
          allowMultiple: seminarAllowMultiple,
        });
        // 발송 성공·실패와 무관하게 링크가 오면 노출한다.
        setInviteUrl(result.inviteUrl ?? null);
        setCopied(false);

        if (result.status === "success") {
          showToast(
            "success",
            result.inviteUrl
              ? `테스트 발송 완료 · 링크 생성됨 — ${formatPhoneShort(normalized)}`
              : `테스트 발송 완료 — ${formatPhoneShort(normalized)}`,
          );
        } else if (result.status === "scheduled") {
          showToast("success", "테스트 발송이 예약됐어요");
        } else if (result.status === "dev_seed_mode") {
          showToast(
            "error",
            result.inviteUrl
              ? "개발 시드 모드 — 실 발송은 막혔지만 링크는 생성됐어요"
              : "개발 시드 모드 — 실 발송 차단됨",
          );
        } else if (result.status === "blocked") {
          showToast(
            "error",
            `차단: ${"reason" in result ? result.reason : "야간 광고 차단"}`,
          );
        } else {
          showToast(
            "error",
            result.inviteUrl
              ? `발송은 실패했지만 아래 링크로 확인할 수 있어요: ${"reason" in result ? result.reason : "알 수 없는 오류"}`
              : `테스트 발송 실패: ${"reason" in result ? result.reason : "알 수 없는 오류"}`,
          );
        }
        return;
      }

      // ── 일반 모드 (기존 동작 100% 유지) ─────────────────
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
        branch,
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

      {/* 설명회 모드 — 서버가 생성한 실제 테스트 링크. 발송 성공·실패 무관 노출.
          실 SMS 가 막혀 있어도 이 링크로 신청 페이지를 바로 확인할 수 있다. */}
      {isSeminar && inviteUrl && (
        <div className="space-y-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-3 py-2.5">
          <p className="text-[12px] font-medium text-[color:var(--text)]">
            테스트 링크
          </p>
          <div className="flex items-center gap-2">
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="
                inline-flex items-center gap-1.5 min-w-0 flex-1
                text-[13px] text-[color:var(--text)] underline
                decoration-[color:var(--border-strong)] underline-offset-2
                hover:decoration-[color:var(--text)]
                focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)] rounded
              "
            >
              <ExternalLink
                className="size-3.5 shrink-0 text-[color:var(--text-muted)]"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="truncate">{inviteUrl}</span>
            </a>
            <button
              type="button"
              onClick={onCopyLink}
              aria-label="테스트 링크 복사"
              className="
                shrink-0 inline-flex items-center justify-center
                size-8 rounded-md
                border border-[color:var(--border)] bg-bg-card
                text-[color:var(--text-muted)]
                hover:bg-[color:var(--bg-hover)]
                focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]
                transition-colors
              "
            >
              {copied ? (
                <Check className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <Copy className="size-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
          </div>
          <p className="text-[11px] text-[color:var(--text-dim)] leading-relaxed">
            실제 발송 본문에 들어가는 링크와 동일합니다. 새 탭에서 신청 페이지를
            확인하세요.
          </p>
        </div>
      )}
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
