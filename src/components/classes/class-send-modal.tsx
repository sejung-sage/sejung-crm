"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Send, AlertTriangle, CheckCircle2, X, Loader2 } from "lucide-react";
import { excelSendAction } from "@/app/(features)/excel-send/actions";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import type { TemplateRow } from "@/types/database";
import { LegacyTokenWarning } from "@/components/messaging/legacy-token-warning";

interface Recipient {
  name: string;
  phone: string;
}

interface Props {
  /** 발송 대상 (선택된 학생). name + 학부모 연락처. */
  recipients: Recipient[];
  /** 헤더 맥락 (예: "5회차 · 6월 13일" / "전체 수강생"). */
  contextLabel: string;
  /** 이 분원의 저장된 상용문구. 빈 배열이면 불러오기 셀렉트 미노출. */
  templates?: TemplateRow[];
  onClose: () => void;
}

type Result =
  | { kind: "success"; campaignId: string; sent: number }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "dev_seed"; reason: string };

const TYPE_OPTIONS: Array<{ value: TemplateTypeLiteral; label: string }> = [
  { value: "SMS", label: "SMS · 단문" },
  { value: "LMS", label: "LMS · 장문" },
];

/**
 * 강좌/회차 명단에서 선택한 학생에게 바로 문자 발송 — 우측 슬라이드 패널.
 *
 * 그룹 생성·페이지 이동 없이 ad-hoc 발송(excelSendAction) 재사용 — group_id=null
 * 캠페인 + 드레인 워커가 백그라운드 발송, 진행률은 캠페인 상세에서 확인.
 * 발송 안전 가드(광고 prefix/080 footer/야간 차단/수신거부 제외)는 서버에서 적용.
 *
 * 중앙 팝업이 아니라 우측 슬라이드인 이유: 뒤의 명단(누구에게 보내는지)이 가려지지
 * 않아야 운영자가 대상을 확인하면서 본문을 쓸 수 있다.
 */
export function ClassSendModal({
  recipients,
  contextLabel,
  templates = [],
  onClose,
}: Props) {
  const [type, setType] = useState<TemplateTypeLiteral>("SMS");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [isAd, setIsAd] = useState(false);
  const [templateId, setTemplateId] = useState("");
  // SMS 한도를 넘겨 자동 전환된 직후인지 — 비용이 3배로 뛰므로 반드시 알린다.
  const [autoSwitched, setAutoSwitched] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [isPending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const bytes = countEucKrBytes(body);
  const limit = BYTE_LIMITS[type];
  const overflow = bytes > limit;

  // SMS 한도(90B) 초과 시 LMS 로 자동 전환. 예전 동작(무조건 자동)과 달리 전환
  // 사실을 배너로 알린다 — SMS 7.4원 → LMS 24원이라 조용히 바뀌면 안 된다.
  useEffect(() => {
    if (type === "SMS" && bytes > BYTE_LIMITS.SMS) {
      setType("LMS");
      setAutoSwitched(true);
    }
  }, [type, bytes]);

  // ESC 로 닫기 (발송 중에는 무시).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPending, onClose]);

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    if (!id) return;
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setType(t.type === "SMS" ? "SMS" : "LMS");
    setBody(t.body);
    setSubject(t.subject ?? "");
    setIsAd(t.is_ad);
    setAutoSwitched(false);
  };

  /** `{이름}` 을 커서 위치에 삽입. 발송 시 수신자 이름으로 치환된다. */
  const insertNameToken = () => {
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + "{이름}");
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + "{이름}" + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + "{이름}".length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleSend = () => {
    if (body.trim().length === 0 || overflow) return;
    setResult(null);
    startTransition(async () => {
      const res = await excelSendAction({
        recipients,
        type,
        subject: type === "LMS" && subject.trim() ? subject.trim() : null,
        body: body.trim(),
        isAd,
      });
      switch (res.status) {
        case "success":
          setResult({
            kind: "success",
            campaignId: res.campaignId,
            sent: res.sent,
          });
          break;
        case "scheduled":
          // ad-hoc 발송은 예약을 쓰지 않지만 타입 호환 위해 방어.
          setResult({ kind: "success", campaignId: res.campaignId, sent: 0 });
          break;
        case "blocked":
          setResult({ kind: "blocked", reason: res.reason });
          break;
        case "dev_seed_mode":
          setResult({ kind: "dev_seed", reason: res.reason });
          break;
        case "failed":
          setResult({ kind: "failed", reason: res.reason });
          break;
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 배경 — 클릭하면 닫힘. 뒤 명단이 비치도록 옅게. */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={() => {
          if (!isPending) onClose();
        }}
        aria-hidden
      />

      {/* 슬라이드 패널 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-send-title"
        className="
          relative h-full w-full max-w-md
          bg-bg-card border-l border-[color:var(--border-strong)] shadow-xl
          flex flex-col
          motion-safe:animate-[slideInRight_180ms_ease-out]
        "
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[color:var(--border)]">
          <div>
            <h2
              id="class-send-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              문자 발송
            </h2>
            <p className="mt-0.5 text-[13px] text-[color:var(--text-muted)]">
              {contextLabel} ·{" "}
              <strong className="text-[color:var(--text)] tabular-nums">
                {recipients.length.toLocaleString()}명
              </strong>
              에게 발송
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="닫기"
            className="inline-flex items-center justify-center size-8 rounded-md text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)] transition-colors disabled:opacity-50"
          >
            <X className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {result?.kind === "success" ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <SuccessBox
              campaignId={result.campaignId}
              recipientCount={recipients.length}
              onClose={onClose}
            />
          </div>
        ) : (
          <>
            {/* 본문 영역 (스크롤) */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* 상용문구 불러오기 */}
              {templates.length > 0 && (
                <label className="block space-y-1.5">
                  <span className="text-[13px] text-[color:var(--text-muted)]">
                    저장된 상용문구 불러오기 (선택)
                  </span>
                  <select
                    value={templateId}
                    onChange={(e) => pickTemplate(e.target.value)}
                    className="w-full h-11 rounded-lg px-2 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)] cursor-pointer"
                  >
                    <option value="">직접 입력</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.type}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* 유형 (SMS / LMS) */}
              <fieldset className="space-y-1.5">
                <legend className="text-[14px] font-medium text-[color:var(--text)]">
                  유형
                </legend>
                <div className="flex gap-1.5">
                  {TYPE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        setType(o.value);
                        setAutoSwitched(false);
                      }}
                      aria-pressed={type === o.value}
                      className={`
                        h-10 px-4 rounded-full border text-[14px] transition-colors
                        ${
                          type === o.value
                            ? "border-[color:var(--border-strong)] bg-[color:var(--bg-hover)] font-medium text-[color:var(--text)]"
                            : "border-[color:var(--border)] bg-bg-card text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)]"
                        }
                      `}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {autoSwitched && (
                <p
                  role="status"
                  className="flex items-start gap-1.5 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-bg)] px-3 py-2 text-[12px] leading-relaxed text-[color:var(--text)]"
                >
                  <AlertTriangle
                    className="size-3.5 mt-0.5 shrink-0 text-[color:var(--warning)]"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  본문이 SMS 한도({BYTE_LIMITS.SMS}바이트)를 넘어 LMS(장문)로
                  바꿨습니다. 건당 요금이 올라갑니다.
                </p>
              )}

              {/* LMS 제목 */}
              {type === "LMS" && (
                <label className="block space-y-1.5">
                  <span className="text-[14px] font-medium text-[color:var(--text)]">
                    제목{" "}
                    <span className="text-[12px] font-normal text-[color:var(--text-dim)]">
                      (선택)
                    </span>
                  </span>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="장문(LMS) 제목 — 비우면 본문 앞부분 사용"
                    maxLength={120}
                    className="w-full h-11 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[15px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)]"
                  />
                </label>
              )}

              {/* 본문 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="class-send-body"
                    className="text-[14px] font-medium text-[color:var(--text)]"
                  >
                    본문
                  </label>
                  <button
                    type="button"
                    onClick={insertNameToken}
                    className="inline-flex items-center h-8 px-3 rounded-full border border-[color:var(--border)] bg-bg-card text-[12px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] transition-colors"
                  >
                    {"{이름}"} 넣기
                  </button>
                </div>
                <textarea
                  id="class-send-body"
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={9}
                  placeholder="보낼 내용을 입력하세요"
                  className="w-full rounded-lg px-3 py-2.5 bg-bg-card border border-[color:var(--border)] text-[15px] leading-relaxed text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:border-[color:var(--border-strong)] resize-y"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-[color:var(--text-muted)]">
                    {"{이름}"} 은 받는 학생 이름으로 바뀝니다.
                  </span>
                  <span
                    className={`text-[12px] tabular-nums ${
                      overflow
                        ? "text-[color:var(--danger)] font-medium"
                        : "text-[color:var(--text-muted)]"
                    }`}
                    aria-live="polite"
                  >
                    {type} · {bytes.toLocaleString()} /{" "}
                    {limit.toLocaleString()}바이트
                  </span>
                </div>
                {overflow && (
                  <p
                    role="alert"
                    className="flex items-center gap-1.5 text-[12px] text-[color:var(--danger)]"
                  >
                    <AlertTriangle
                      className="size-3.5"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {type} 한도({limit.toLocaleString()}바이트)를 초과했습니다.
                  </p>
                )}
                {/* Aca2000 문구(%%학생) 를 붙여넣는 경우가 잦아 발송 전에 잡아준다. */}
                <LegacyTokenWarning body={body} onConvert={setBody} />
              </div>

              {/* 광고 토글 */}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAd}
                  onChange={(e) => setIsAd(e.target.checked)}
                  className="mt-0.5 size-4 cursor-pointer accent-[color:var(--action)]"
                />
                <span className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
                  광고성 문자로 발송 — (광고) 표기·무료수신거부 안내가 자동
                  삽입됩니다.
                </span>
              </label>

              {/* 결과(차단/실패/시드) */}
              {result?.kind === "blocked" && (
                <ResultNote tone="warning" reason={result.reason} />
              )}
              {result?.kind === "failed" && (
                <ResultNote tone="danger" reason={result.reason} />
              )}
              {result?.kind === "dev_seed" && (
                <ResultNote tone="muted" reason={result.reason} />
              )}
            </div>

            {/* 액션 (하단 고정) */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[color:var(--border)]">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="inline-flex items-center h-11 px-4 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] disabled:opacity-50 transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={isPending || body.trim().length === 0 || overflow}
                title={
                  body.trim().length === 0
                    ? "보낼 내용을 입력하세요."
                    : overflow
                      ? "본문이 바이트 한도를 넘었습니다."
                      : undefined
                }
                className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? (
                  <Loader2
                    className="size-4 animate-spin"
                    strokeWidth={2}
                    aria-hidden
                  />
                ) : (
                  <Send className="size-4" strokeWidth={1.75} aria-hidden />
                )}
                {isPending
                  ? "발송 중..."
                  : `${recipients.length}명에게 발송`}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function SuccessBox({
  campaignId,
  recipientCount,
  onClose,
}: {
  campaignId: string;
  recipientCount: number;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[color:var(--success)] bg-[color:var(--success-bg)] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2
            className="size-5 text-[color:var(--success)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
            발송을 시작했습니다
          </h3>
        </div>
        <p className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
          {recipientCount.toLocaleString()}명에게 발송이 시작되었습니다. 실제
          발송은 백그라운드에서 진행되며 진행 상황은 발송 내역에서 확인할 수
          있습니다.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center h-11 px-4 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] transition-colors"
        >
          닫기
        </button>
        <Link
          href={`/campaigns/${campaignId}`}
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] transition-colors"
        >
          발송 진행 상황 보기
        </Link>
      </div>
    </div>
  );
}

function ResultNote({
  tone,
  reason,
}: {
  tone: "warning" | "danger" | "muted";
  reason: string;
}) {
  const cls =
    tone === "danger"
      ? "border-[color:var(--danger)] bg-[color:var(--danger-bg)] text-[color:var(--danger)]"
      : tone === "warning"
        ? "border-[color:var(--warning)] bg-[color:var(--warning-bg)] text-[color:var(--text)]"
        : "border-[color:var(--border)] bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]";
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] ${cls}`}
    >
      {tone !== "muted" && (
        <AlertTriangle
          className="size-4 shrink-0 mt-0.5"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <span className="leading-relaxed">{reason}</span>
    </div>
  );
}
