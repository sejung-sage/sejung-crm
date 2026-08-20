"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addUnsubscribeAction } from "@/app/(features)/students/actions";
import { lookupStudentsByPhoneAction } from "@/app/(features)/unsubscribes/actions";
import { useToast } from "@/components/ui/toast";

/**
 * 수신거부 번호 추가 폼 (Client Component).
 *
 * UX:
 *  - 번호 input(필수) + 사유 input(선택) + 추가 버튼.
 *  - 빈 번호 방지(클라이언트 1차 검증, 최종 검증은 Server Action).
 *  - 성공 → 토스트 + 입력 비우기 + router.refresh().
 *  - dev_seed_mode / failed 응답은 회색·빨강 안내 토스트.
 *
 * 접근성:
 *  - 모든 컨트롤 높이 ≥40px(h-10), 포커스 링.
 *  - useTransition 으로 로딩·중복 클릭 방지.
 */
export function UnsubscribeAddForm() {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 입력한 번호가 누구인지 되비추기 (운영 요청 2026-08-20 — "누군지도 모르고
  // 차단하고 있다"). 등록을 막지는 않는다: 못 찾아도 그대로 등록 가능하다
  // (타 분원 학생이거나 학원 등록이 없는 번호일 수 있음).
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 9) {
      setMatches(null);
      setLooking(false);
      return;
    }
    // 타이핑 중 매 글자마다 조회하지 않도록 400ms 디바운스.
    let alive = true;
    setLooking(true);
    const t = window.setTimeout(async () => {
      const res = await lookupStudentsByPhoneAction({ phone: digits });
      if (!alive) return;
      setLooking(false);
      setMatches(res.status === "success" ? res.students : null);
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [phone]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const trimmedPhone = phone.trim();
    const trimmedReason = reason.trim();

    if (trimmedPhone.length === 0) {
      setError("번호를 입력하세요.");
      return;
    }
    // 숫자가 하나도 없으면 형식 안내(최종 검증은 서버).
    if (!/\d/.test(trimmedPhone)) {
      setError("번호 형식이 올바르지 않습니다. 예: 010-1234-5678");
      return;
    }

    startTransition(async () => {
      const result = await addUnsubscribeAction({
        phone: trimmedPhone,
        reason: trimmedReason || undefined,
      });

      if (result.status === "success") {
        showToast("success", "이 번호를 수신거부에 등록했어요");
        setPhone("");
        setReason("");
        setMatches(null);
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        showToast("error", "개발용 시드 데이터라 실제 반영되지 않습니다");
      } else {
        showToast(
          "error",
          `수신거부 등록에 실패했어요${result.reason ? `: ${result.reason}` : ""}`,
        );
      }
    });
  };

  return (
    <section
      aria-label="수신거부 번호 추가"
      className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 md:p-5"
    >
      <h2 className="text-[16px] font-semibold text-[color:var(--text)] mb-3">
        수신거부 번호 추가
      </h2>
      <form
        onSubmit={onSubmit}
        className="flex flex-col md:flex-row md:items-end gap-3"
      >
        <label className="md:w-56">
          <span className="block text-[13px] font-medium text-[color:var(--text-muted)] mb-1">
            번호
          </span>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-1234-5678"
            maxLength={20}
            disabled={isPending}
            className="
              w-full h-10 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              disabled:bg-[color:var(--bg-muted)] disabled:opacity-60
              transition-colors
            "
          />
        </label>

        <label className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium text-[color:var(--text-muted)] mb-1">
            사유 <span className="text-[color:var(--text-dim)]">(선택)</span>
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 학부모 요청"
            maxLength={100}
            disabled={isPending}
            className="
              w-full h-10 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              disabled:bg-[color:var(--bg-muted)] disabled:opacity-60
              transition-colors
            "
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="
            inline-flex items-center justify-center gap-1.5
            h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            focus:outline-none focus:ring-2 focus:ring-[color:var(--action)]
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden />
          {isPending ? "추가 중..." : "추가"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[color:var(--danger)]">
          {error}
        </p>
      )}
      <p className="mt-3 text-[12px] text-[color:var(--text-dim)] leading-relaxed">
        하이픈(-)은 있어도 없어도 됩니다. 등록 즉시 이후 모든 문자 발송에서
        제외됩니다.
      </p>
      {/* 입력한 번호의 주인 되비추기 — 잘못 차단 방지 */}
      {(looking || matches !== null) && (
        <div
          aria-live="polite"
          className="mt-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-3 py-2.5"
        >
          {looking ? (
            <p className="text-[13px] text-[color:var(--text-muted)]">
              번호 확인 중…
            </p>
          ) : matches && matches.length > 0 ? (
            <>
              <p className="text-[13px] font-medium text-[color:var(--text)] mb-1.5">
                이 번호의 학생 {matches.length}명
              </p>
              <ul className="space-y-1">
                {matches.map((m) => (
                  <li
                    key={m.id}
                    className="text-[14px] text-[color:var(--text)] flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                  >
                    <span className="font-medium">{m.name ?? "이름 없음"}</span>
                    <span className="text-[13px] text-[color:var(--text-muted)]">
                      {[
                        m.school,
                        m.grade,
                        m.branches.length > 0 ? m.branches.join("/") : null,
                        m.status,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="text-[12px] text-[color:var(--text-dim)]">
                      {m.matchedAs} 번호
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[13px] text-[color:var(--text-muted)]">
              이 번호로 등록된 학생을 찾지 못했습니다. 다른 분원 학생이거나
              학원에 없는 번호일 수 있습니다 — 그대로 등록할 수 있습니다.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** 번호 조회 결과 한 건. lookupStudentsByPhoneAction 반환 원소와 같은 모양. */
interface Match {
  id: string;
  name: string | null;
  school: string | null;
  grade: string | null;
  branches: string[];
  status: string | null;
  matchedAs: "학부모" | "학생";
}
