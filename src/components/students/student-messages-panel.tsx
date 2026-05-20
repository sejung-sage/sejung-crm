import type { MessageStatus, StudentMessageRow } from "@/types/database";
import { formatPhone, maskPhone } from "@/lib/phone";

interface Props {
  messages: StudentMessageRow[];
  /** 학부모 연락처 풀 노출 권한. master 만 true. */
  canRevealPhone?: boolean;
}

/**
 * 학생 상세 · 발송 이력 패널.
 *
 * 카드 list + `<details>` accordion 구조 — 출석 패널과 일관.
 * 헤더에는 캠페인 제목 · 작성자 · 수신 번호 · 상태 · 발송시각.
 * 펼치면 캠페인 본문(`whitespace-pre-wrap`) · 유형 · 작성자 라벨 노출.
 *
 * `<details>` 사용 — 키보드 접근성·스크린리더·CSS open state 모두 무료.
 * Server Component (상태 없음).
 */
export function StudentMessagesPanel({
  messages,
  canRevealPhone = false,
}: Props) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          이 학생 학부모에게 발송된 문자가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="발송 이력" className="space-y-3">
      <p className="text-[13px] text-[color:var(--text-muted)]">
        행을 클릭하면 발송된 문자 본문과 작성자를 펼쳐서 확인할 수 있습니다.
      </p>

      <ul className="space-y-2">
        {messages.map((m) => (
          <li key={m.id}>
            <MessageAccordion message={m} canRevealPhone={canRevealPhone} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── accordion ────────────────────────────────────────────

function MessageAccordion({
  message,
  canRevealPhone,
}: {
  message: StudentMessageRow;
  canRevealPhone: boolean;
}) {
  const phoneText = canRevealPhone
    ? formatPhone(message.phone) || "—"
    : maskPhone(message.phone) || "—";

  return (
    <details className="group rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
      <summary
        className="
          list-none cursor-pointer select-none
          grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-3
          hover:bg-[color:var(--bg-muted)]
          focus-visible:outline-none focus-visible:bg-[color:var(--bg-muted)]
        "
      >
        {/* 1열 — 캠페인 제목 + 작성자 부제 */}
        <div className="min-w-0">
          <div className="text-[15px] text-[color:var(--text)] truncate">
            {message.campaign_title || "제목 없음"}
          </div>
          <div className="mt-0.5 text-[12px] text-[color:var(--text-muted)] truncate">
            보낸 사람 · {message.sender_name ?? "—"}
          </div>
        </div>

        {/* 2열 — 수신 번호 */}
        <div className="text-[13px] text-[color:var(--text-muted)] tabular-nums whitespace-nowrap">
          {phoneText}
        </div>

        {/* 3열 — 상태 */}
        <MessageStatusBadge status={message.status} />

        {/* 4열 — 발송시각 */}
        <div className="text-[13px] text-[color:var(--text-muted)] tabular-nums whitespace-nowrap">
          {formatSentAt(message.sent_at)}
        </div>

        {/* 5열 — 토글 아이콘 */}
        <ChevronIcon className="shrink-0 text-[color:var(--text-muted)] transition-transform group-open:rotate-180" />
      </summary>

      {/* 펼친 영역 — 본문 · 유형 · 작성자 */}
      <div className="border-t border-[color:var(--border)] px-4 py-4 bg-[color:var(--bg)]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-[14px]">
          <Dt>유형</Dt>
          <Dd>
            <CampaignTypeBadge type={message.campaign_type} />
          </Dd>

          <Dt>작성자</Dt>
          <Dd>{message.sender_name ?? "—"}</Dd>

          <Dt>본문</Dt>
          <Dd>
            {message.campaign_body ? (
              <p className="whitespace-pre-wrap leading-relaxed text-[color:var(--text)]">
                {message.campaign_body}
              </p>
            ) : (
              <p className="text-[color:var(--text-muted)]">
                본문 정보 없음
              </p>
            )}
          </Dd>
        </dl>
      </div>
    </details>
  );
}

// ─── 헬퍼 컴포넌트 ────────────────────────────────────────

function Dt({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-[13px] text-[color:var(--text-muted)] pt-0.5 whitespace-nowrap">
      {children}
    </dt>
  );
}

function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="min-w-0">{children}</dd>;
}

function MessageStatusBadge({ status }: { status: MessageStatus }) {
  switch (status) {
    case "도달":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium bg-[color:var(--action)] text-[color:var(--action-text)]">
          도달
        </span>
      );
    case "발송됨":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]">
          발송됨
        </span>
      );
    case "실패":
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium border"
          style={{
            borderColor: "var(--danger)",
            color: "var(--danger)",
            backgroundColor: "var(--bg)",
          }}
        >
          실패
        </span>
      );
    case "대기":
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium border border-dashed"
          style={{
            borderColor: "var(--border-strong)",
            color: "var(--text-muted)",
            backgroundColor: "var(--bg)",
          }}
        >
          대기
        </span>
      );
  }
}

/**
 * 캠페인 유형 배지 (SMS / LMS / ALIMTALK / NULL).
 * 흑백 미니멀 · TemplateTypeBadge 와 같은 톤 유지.
 * type=null 인 옛 캠페인은 dim placeholder.
 */
function CampaignTypeBadge({
  type,
}: {
  type: "SMS" | "LMS" | "ALIMTALK" | null;
}) {
  if (!type) {
    return (
      <span className="text-[13px] text-[color:var(--text-muted)]">—</span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium tabular-nums"
      style={{
        backgroundColor: "var(--bg-muted)",
        color: "var(--text-muted)",
      }}
    >
      {type}
    </span>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function formatSentAt(iso: string | null): string {
  if (!iso) return "—";
  // ISO 문자열에서 YYYY-MM-DD HH:MM 까지만 보여준다.
  const d = iso.replace("T", " ");
  if (d.length >= 16) return d.slice(0, 16);
  return d;
}
