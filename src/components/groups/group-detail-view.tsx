import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { GroupRow, StudentProfileRow } from "@/types/database";
import type { GroupFilters } from "@/lib/schemas/group";
import { BranchBadge } from "@/components/groups/branch-badge";
import { GroupDetailActions } from "@/components/groups/group-detail-actions";
import { GroupStudentsTable } from "@/components/groups/group-students-table";
import { Pagination } from "@/components/students/pagination";

/**
 * F2-03 · 발송 그룹 상세 뷰 (Server Component).
 *
 * 구성:
 *  1. 브레드크럼 ← 발송 그룹
 *  2. 상단 카드: 그룹명 + 분원 + 필터 요약 + 총 인원 · 최근 발송 정보
 *  3. 우측 액션(수정·복제·삭제·발송)
 *  4. 소속 학생 리스트 + 페이지네이션
 */
interface Props {
  group: GroupRow;
  students: StudentProfileRow[];
  studentsTotal: number;
  currentPage: number;
  pageSize: number;
}

export function GroupDetailView({
  group,
  students,
  studentsTotal,
  currentPage,
  pageSize,
}: Props) {
  return (
    <div className="max-w-7xl space-y-6">
      {/* 브레드크럼 */}
      <Link
        href="/groups"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        발송 그룹
      </Link>

      {/* 상단 카드 */}
      <section
        className="rounded-xl border border-[color:var(--border)] bg-white p-6"
        aria-label="발송 그룹 요약"
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[24px] font-semibold leading-tight text-[color:var(--text)]">
                {group.name}
              </h1>
              <BranchBadge branch={group.branch} />
            </div>

            <p className="text-[14px] text-[color:var(--text-muted)]">
              {summarizeFilters(group.filters)}
            </p>

            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pt-2">
              <div>
                <span className="text-[13px] text-[color:var(--text-muted)] mr-2">
                  총 인원
                </span>
                <span className="text-[24px] font-semibold tabular-nums text-[color:var(--text)]">
                  {studentsTotal.toLocaleString()}
                </span>
                <span className="text-[14px] text-[color:var(--text-muted)] ml-1">
                  명
                </span>
              </div>
              <div className="text-[13px] text-[color:var(--text-muted)]">
                <span className="mr-2">최근 발송</span>
                <span className="tabular-nums text-[color:var(--text)]">
                  {formatDate(group.last_sent_at) ?? "—"}
                </span>
              </div>
            </div>

            {group.last_message_preview && (
              <p className="text-[13px] text-[color:var(--text-muted)] pt-1 line-clamp-2 max-w-2xl">
                마지막 내용: {group.last_message_preview}
              </p>
            )}
          </div>

          <div className="shrink-0">
            <GroupDetailActions groupId={group.id} groupName={group.name} />
          </div>
        </div>
      </section>

      {/* 소속 학생 */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            소속 학생
          </h2>
          <p className="text-[12px] text-[color:var(--text-dim)]">
            비활성(탈퇴) · 수신거부 학생은 자동 제외됩니다.
          </p>
        </div>

        <GroupStudentsTable rows={students} />

        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={studentsTotal}
        />
      </section>
    </div>
  );
}

/**
 * 필터 요약 문자열.
 * 예: "고2 · 휘문고 · 수학" / "전 학년 · 전 학교 · 수학"
 */
function summarizeFilters(f: GroupFilters): string {
  const parts: string[] = [];
  parts.push(
    f.grades.length > 0 ? f.grades.map((g) => `고${g}`).join("·") : "전 학년",
  );
  parts.push(f.schools.length > 0 ? f.schools.join("·") : "전 학교");
  parts.push(
    f.subjects.length > 0 ? f.subjects.join("·") : "전 과목",
  );
  return parts.join(" · ");
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
