"use client";

import { Loader2 } from "lucide-react";
import type { Grade } from "@/types/database";
import type { ClassOption } from "@/lib/classes/list-class-options";
import type { MatchedRecipient } from "@/app/(features)/compose/actions";
import {
  FilterChipPanel,
  Field,
  type FilterChipValue,
} from "@/components/groups/filter-chip-panel";
import { formatPhone } from "@/lib/phone";

/**
 * F5 · 설명회 발송 Step 2 — 대상(필터) 선택.
 *
 * 옛 "발송 그룹 선택"(저장 그룹 드롭다운)을 제거하고, 일반 SMS /compose 와 동일한
 * 인라인 필터 칩 + 매칭 학생 체크 목록으로 교체. 발송 시점에 backend 가
 * filters(+excludeStudentIds)로 학생을 재조회한다.
 *
 * 상태는 부모(seminar-compose-wizard)가 보유 — 여기서는 controlled UI 만 담당:
 *  - chip / onChipChange      : FilterChipPanel 값
 *  - recipients               : 매칭 명단(부모가 디바운스 조회)
 *  - deselected               : 체크 해제한 학생 id (= filters.excludeStudentIds)
 *  - onToggleRecipient / onSetAll : 체크 토글
 */

interface Props {
  chip: FilterChipValue;
  onChipChange: (next: FilterChipValue) => void;
  branch: string;
  schoolOptions: string[];
  classOptions: ClassOption[];
  availableGrades?: Grade[];
  availableRegions?: string[];
  recipients: MatchedRecipient[];
  /** 전체 매칭 수(head 카운트). recipients 는 표시용 상위 일부. */
  total: number;
  deselected: Set<string>;
  onToggleRecipient: (studentId: string, checked: boolean) => void;
  onSetAll: (checked: boolean) => void;
  listLoading: boolean;
  listError: string | null;
  /** dev-seed 모드면 명단 조회가 빈 배열을 반환하므로 안내문 노출. */
  devMode: boolean;
}

export function SeminarComposeStep2Target({
  chip,
  onChipChange,
  branch,
  schoolOptions,
  classOptions,
  availableGrades,
  availableRegions,
  recipients,
  total,
  deselected,
  onToggleRecipient,
  onSetAll,
  listLoading,
  listError,
  devMode,
}: Props) {
  // 체크 해제는 표시분에만 적용 → 선택 수 = 전체 매칭(total) − 표시분 해제 수.
  const checkedCount = total - deselected.size;
  const allChecked = deselected.size === 0;
  // 서버가 상한까지 이름순으로 전원 내려줌 — 전부 렌더.
  const visibleRecipients = recipients;
  const truncated = total > recipients.length;

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
        발송 대상
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <FilterChipPanel
        value={chip}
        onChange={onChipChange}
        branch={branch}
        schoolOptions={schoolOptions}
        classOptions={classOptions}
        availableGrades={availableGrades}
        availableRegions={availableRegions}
      />

      <Field
        label="매칭 학생"
        hint={
          listLoading
            ? "불러오는 중..."
            : `${total.toLocaleString()}명 중 ${checkedCount.toLocaleString()}명 선택`
        }
      >
        <div className="rounded-lg border border-[color:var(--border)] bg-bg-card">
          <div className="flex items-center justify-between gap-2 px-3 h-10 border-b border-[color:var(--border)]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={recipients.length > 0 && allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = !allChecked && checkedCount > 0;
                }}
                onChange={(e) => onSetAll(e.target.checked)}
                disabled={recipients.length === 0}
                className="size-4 accent-[color:var(--action)]"
              />
              <span className="text-[13px] text-[color:var(--text)]">
                전체 선택
              </span>
            </label>
            {listLoading && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                계산 중...
              </span>
            )}
          </div>

          {listError && (
            <p
              role="alert"
              className="px-3 py-3 text-[13px] text-[color:var(--danger)]"
            >
              {listError}
            </p>
          )}

          {!listError && recipients.length === 0 && !listLoading && (
            <p className="px-3 py-6 text-[13px] text-[color:var(--text-muted)] text-center">
              {devMode
                ? "개발 시드 모드에서는 매칭 명단이 표시되지 않습니다. 발송·테스트는 차단됩니다."
                : "조건에 맞는 학생이 없습니다. 위 필터를 조정해 주세요."}
            </p>
          )}

          {visibleRecipients.length > 0 && (
            <ul className="max-h-[28rem] overflow-auto divide-y divide-[color:var(--border)]">
              {visibleRecipients.map((r) => {
                const checked = !deselected.has(r.studentId);
                const phone = r.parentPhone || r.studentPhone;
                return (
                  <li key={r.studentId}>
                    <label className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-[color:var(--bg-hover)]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          onToggleRecipient(r.studentId, e.target.checked)
                        }
                        className="size-4 accent-[color:var(--action)]"
                      />
                      <span className="text-[13px] font-medium text-[color:var(--text)]">
                        {r.name}
                      </span>
                      <span className="text-[12px] tabular-nums text-[color:var(--text-muted)] ml-auto">
                        {phone ? formatPhone(phone) || phone : "번호 없음"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {truncated && (
            <p className="px-3 py-2 text-[12px] text-[color:var(--text-dim)] border-t border-[color:var(--border)]">
              전체 {total.toLocaleString()}명 중 상위{" "}
              {recipients.length.toLocaleString()}명만 목록에 표시됩니다. 체크
              해제는 표시된 학생에만 적용됩니다.
            </p>
          )}
        </div>
      </Field>
      </div>

      <p className="text-[12px] text-[color:var(--text-dim)] leading-relaxed">
        비활성(탈퇴) · 수신거부 · 번호 결측 학생은 발송 시 자동 제외됩니다.
      </p>
    </div>
  );
}
