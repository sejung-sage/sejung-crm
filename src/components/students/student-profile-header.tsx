import { MessageCircle } from "lucide-react";
import type { StudentProfileRow } from "@/types/database";
import { StudentStatusBadge } from "@/components/students/status-badge";
import { PhoneReveal } from "@/components/students/phone-reveal";

interface Props {
  profile: StudentProfileRow;
}

/**
 * 학생 상세 상단 프로필 헤더.
 * 이름·배지·메타정보·학부모 연락처·우측 문자 보내기 버튼.
 */
export function StudentProfileHeader({ profile }: Props) {
  const metaParts: string[] = [];
  metaParts.push(profile.branch);
  if (profile.grade) metaParts.push(`고${profile.grade}`);
  if (profile.track) metaParts.push(profile.track);
  if (profile.school) metaParts.push(profile.school);

  return (
    <section
      className="rounded-xl border border-[color:var(--border)] bg-white p-6"
      aria-label="학생 프로필"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              className="text-[28px] font-semibold leading-tight text-[color:var(--text)]"
            >
              {profile.name}
            </h1>
            <StudentStatusBadge status={profile.status} />
          </div>

          <p className="text-[14px] text-[color:var(--text-muted)]">
            {metaParts.join(" · ")}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <span className="text-[13px] font-medium text-[color:var(--text-muted)] shrink-0">
              학부모 연락처
            </span>
            <PhoneReveal phone={profile.parent_phone} />
          </div>
        </div>

        <div className="shrink-0">
          <button
            type="button"
            disabled
            title="F3 문자 발송 모듈 완성 시 활성화"
            aria-label="이 학생에게 문자 보내기 (준비 중)"
            className="
              inline-flex items-center gap-1.5
              h-10 px-4 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            <MessageCircle className="size-4" strokeWidth={1.75} aria-hidden />
            이 학생에게 문자 보내기
          </button>
        </div>
      </div>
    </section>
  );
}
