import type { MessageStatus, StudentMessageRow } from "@/types/database";
import { maskPhone } from "@/lib/phone";

interface Props {
  messages: StudentMessageRow[];
}

/**
 * 학생 상세 · 발송 이력 패널.
 */
export function StudentMessagesPanel({ messages }: Props) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          이 학생 학부모에게 발송된 문자가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
            <Th>캠페인 제목</Th>
            <Th className="w-44">수신 번호</Th>
            <Th className="w-28">상태</Th>
            <Th className="w-44">발송시각</Th>
          </tr>
        </thead>
        <tbody>
          {messages.map((m) => (
            <tr
              key={m.id}
              className="border-b border-[color:var(--border)] last:border-b-0"
            >
              <Td className="text-[color:var(--text)]">{m.campaign_title}</Td>
              <Td className="text-[color:var(--text-muted)] tabular-nums">
                {maskPhone(m.phone) || "—"}
              </Td>
              <Td>
                <MessageStatusBadge status={m.status} />
              </Td>
              <Td className="text-[color:var(--text-muted)] tabular-nums">
                {formatSentAt(m.sent_at)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function formatSentAt(iso: string | null): string {
  if (!iso) return "—";
  // ISO 문자열에서 YYYY-MM-DD HH:MM 까지만 보여준다.
  const d = iso.replace("T", " ");
  if (d.length >= 16) return d.slice(0, 16);
  return d;
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`
        px-4 py-3 text-left text-[13px] font-medium
        text-[color:var(--text-muted)] uppercase tracking-wide
        ${className}
      `}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-[15px] ${className}`}>{children}</td>;
}
