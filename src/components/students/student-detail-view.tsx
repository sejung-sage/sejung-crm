import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { StudentDetail } from "@/types/database";
import { StudentProfileHeader } from "@/components/students/student-profile-header";
import { StudentKpiCards } from "@/components/students/student-kpi-cards";
import { StudentDetailTabs } from "@/components/students/student-detail-tabs";
import { StudentEnrollmentsPanel } from "@/components/students/student-enrollments-panel";
import { StudentAttendancesPanel } from "@/components/students/student-attendances-panel";
import { StudentMessagesPanel } from "@/components/students/student-messages-panel";

interface Props {
  detail: StudentDetail;
  /** 학부모 연락처 풀 노출 권한. master 만 true. */
  canRevealPhone?: boolean;
  /** 학부모 번호가 수신거부에 등록돼 있는지. */
  parentUnsubscribed?: boolean;
  /** 수신거부 등록 권한. viewer 외 true. */
  canManageUnsubscribe?: boolean;
  /** 수신거부 해제 권한. master 만 true. */
  canRemoveUnsubscribe?: boolean;
}

/**
 * 학생 상세 화면 컨테이너 (Server Component).
 * 브레드크럼 · 프로필 헤더 · KPI · 탭(수강/출석/발송) 순으로 배치.
 */
export function StudentDetailView({
  detail,
  canRevealPhone = false,
  parentUnsubscribed = false,
  canManageUnsubscribe = false,
  canRemoveUnsubscribe = false,
}: Props) {
  return (
    <div className="max-w-7xl space-y-6">
      <nav aria-label="이동 경로">
        <Link
          href="/students"
          className="
            inline-flex items-center gap-1 h-9 -ml-2 px-2 rounded-md
            text-[14px] text-[color:var(--text-muted)]
            hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          학생 명단
        </Link>
      </nav>

      <StudentProfileHeader
        profile={detail.profile}
        canRevealPhone={canRevealPhone}
        parentUnsubscribed={parentUnsubscribed}
        canManageUnsubscribe={canManageUnsubscribe}
        canRemoveUnsubscribe={canRemoveUnsubscribe}
      />

      <StudentKpiCards detail={detail} />

      <StudentDetailTabs
        enrollmentsPanel={
          <StudentEnrollmentsPanel enrollments={detail.enrollments} />
        }
        attendancesPanel={
          <StudentAttendancesPanel
            attendances={detail.attendances}
            expectedSessions={detail.expectedSessions}
            branch={detail.profile.branch}
          />
        }
        messagesPanel={
          <StudentMessagesPanel
            messages={detail.messages}
            canRevealPhone={canRevealPhone}
            studentName={detail.profile.name}
          />
        }
      />
    </div>
  );
}
