import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ClassDetail } from "@/types/database";
import { isLapsedStudent } from "@/lib/schemas/group";
import { ClassDetailHeader } from "@/components/classes/class-detail-header";
import { ClassKpiCards } from "@/components/classes/class-kpi-cards";
import { ClassStudentsPanel } from "@/components/classes/class-students-panel";
import { ClassLapsedPanel } from "@/components/classes/class-lapsed-panel";
import { ClassAttendanceGrid } from "@/components/classes/class-attendance-grid";
import { ClassSignupPageSection } from "@/components/seminars/class-signup-page-section";
import type { ClassSignupPageDetail } from "@/lib/seminars/get-class-signup-page";

interface Props {
  detail: ClassDetail;
  /** 학부모 연락처 풀 노출 권한. master 만 true. */
  canRevealPhone?: boolean;
  /**
   * "이 강좌로 발송" 진입 버튼 노출 권한.
   * 그 분원에 발송 그룹 생성(write/group) 가능한 사용자(master/admin)만 true.
   * false 면 헤더 발송 버튼을 아예 숨긴다.
   */
  canSendToClass?: boolean;
  /**
   * 0084 새 모델: subject='설명회' 강좌면 공개 신청 페이지 데이터.
   * 그 외 강좌면 null — 섹션 자체 미렌더.
   */
  signupPageDetail?: ClassSignupPageDetail | null;
}

/**
 * 강좌 상세 화면 컨테이너 (Server Component).
 *
 * 학생 상세 컨테이너(`student-detail-view.tsx`) 의 톤·간격을 그대로 미러.
 * 브레드크럼 → 헤더 → KPI → 수강생 명단 → 학생×일자 출결 격자 순.
 *
 * 학생 상세는 탭으로 수강/출석/발송을 분리했지만, 강좌 상세에서는
 * 영역 간 정보 의존(명단의 학생을 격자에서 다시 찾아본다)이 강해
 * 한 페이지에 풀어두는 편이 운영자에게 더 자연스럽다.
 */
export function ClassDetailView({
  detail,
  canRevealPhone = false,
  canSendToClass = false,
  signupPageDetail = null,
}: Props) {
  // 다음 시즌 미등록(이탈) 학생 — 추가 fetch 없이 detail.students 를
  // status 술어(isLapsedStudent: status !== '재원생')로 거른다.
  // 단일 소스: groups/new prefill(filter=lapsed)과 동일한 판정.
  const lapsedStudents = detail.students.filter((s) =>
    isLapsedStudent(s.status),
  );

  return (
    <div className="max-w-7xl space-y-6">
      <nav aria-label="이동 경로">
        <Link
          href="/classes"
          className="
            inline-flex items-center gap-1 h-9 -ml-2 px-2 rounded-md
            text-[14px] text-[color:var(--text-muted)]
            hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          강좌 목록
        </Link>
      </nav>

      <ClassDetailHeader
        cls={detail.class}
        studentCount={detail.students.length}
        canSend={canSendToClass}
      />

      {/* 설명회 강좌일 때만 공개 신청 페이지 섹션. */}
      {signupPageDetail && (
        <ClassSignupPageSection
          classId={detail.class.id}
          branch={detail.class.branch}
          className={detail.class.name}
          detail={signupPageDetail}
          canEdit={canSendToClass}
          canRevealPhone={canRevealPhone}
        />
      )}

      <ClassKpiCards detail={detail} />

      <section className="space-y-3" aria-label="수강생 명단">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          수강생 명단
        </h2>
        <ClassStudentsPanel students={detail.students} canRevealPhone={canRevealPhone} />
      </section>

      {lapsedStudents.length > 0 && (
        <ClassLapsedPanel
          lapsedStudents={lapsedStudents}
          classId={detail.class.id}
          canRevealPhone={canRevealPhone}
          canSend={canSendToClass}
        />
      )}

      <section className="space-y-3" aria-label="학생별 일자 출결">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          학생 × 일자 출결
        </h2>
        <ClassAttendanceGrid
          students={detail.students}
          attendances={detail.attendances}
          branch={detail.class.branch}
        />
      </section>
    </div>
  );
}
