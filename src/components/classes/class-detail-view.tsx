import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ClassDetail } from "@/types/database";
import { ClassDetailHeader } from "@/components/classes/class-detail-header";
import { ClassKpiCards } from "@/components/classes/class-kpi-cards";
import { ClassStudentsPanel } from "@/components/classes/class-students-panel";
import { ClassAttendanceGrid } from "@/components/classes/class-attendance-grid";

interface Props {
  detail: ClassDetail;
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
export function ClassDetailView({ detail }: Props) {
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

      <ClassDetailHeader cls={detail.class} />

      <ClassKpiCards detail={detail} />

      <section className="space-y-3" aria-label="수강생 명단">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          수강생 명단
        </h2>
        <ClassStudentsPanel students={detail.students} />
      </section>

      <section className="space-y-3" aria-label="학생별 일자 출결">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          학생 × 일자 출결
        </h2>
        <ClassAttendanceGrid
          students={detail.students}
          attendances={detail.attendances}
        />
      </section>
    </div>
  );
}
