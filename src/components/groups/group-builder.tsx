"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft } from "lucide-react";
import type { GroupFilters } from "@/lib/schemas/group";
import type { Subject } from "@/types/database";
import type { CountRecipientsResult } from "@/lib/groups/count-recipients";
import {
  countRecipientsAction,
  createGroupAction,
  updateGroupAction,
} from "@/app/(features)/groups/actions";

interface SamplePreview {
  total: number;
  sample: CountRecipientsResult["sample"];
}

interface Props {
  /** 수정 모드일 때 기존 그룹 ID. 신규면 undefined. */
  groupId?: string;
  /** 초기 값. 신규는 기본값. */
  initial: {
    name: string;
    branch: string;
    filters: GroupFilters;
  };
  /** 학교 토글 칩 후보. dev-seed · Supabase 공통으로 상위 후보를 넘겨줌. */
  schoolOptions: string[];
  /** 초기 프리뷰(서버에서 한 번 계산). */
  initialPreview: SamplePreview;
  mode: "create" | "edit";
}

const GRADE_OPTIONS: Array<1 | 2 | 3> = [1, 2, 3];
const SUBJECT_OPTIONS: Subject[] = ["수학", "국어", "영어", "탐구"];
const BRANCH_OPTIONS = ["대치", "송도"] as const;
const SCHOOL_VISIBLE_LIMIT = 8;
const DEBOUNCE_MS = 300;

/**
 * F2-02 · 발송 그룹 세그먼트 빌더 (Client Component).
 *
 * 좌측 패널: 그룹명 · 분원 · 학년(다중) · 학교(다중 토글) · 과목(다중 토글)
 * 우측 패널: 실시간 수신자 수 + 상위 5명 미리보기
 *
 * 디바운스 구현:
 *   - 필터가 바뀔 때마다 `setTimeout(..., 300)` 로 지연 실행.
 *   - 진행 중인 이전 요청은 `requestId` 카운터로 무효화.
 *   - 최신 요청 결과만 state 반영 ("last-write-wins" 방식).
 *
 * 저장:
 *   - create/edit 에 따라 서로 다른 Server Action 호출.
 *   - dev_seed_mode → 회색 박스 안내.
 *   - failed → 폼 하단 빨간 박스 안내 + 버튼 활성 복구.
 */
export function GroupBuilder({
  groupId,
  initial,
  schoolOptions,
  initialPreview,
  mode,
}: Props) {
  const router = useRouter();

  // 폼 상태
  const [name, setName] = useState<string>(initial.name);
  const [branch, setBranch] = useState<string>(initial.branch);
  const [grades, setGrades] = useState<number[]>(initial.filters.grades);
  const [schools, setSchools] = useState<string[]>(initial.filters.schools);
  const [subjects, setSubjects] = useState<string[]>(initial.filters.subjects);
  const [showAllSchools, setShowAllSchools] = useState<boolean>(false);

  // 실시간 프리뷰
  const [preview, setPreview] = useState<SamplePreview>(initialPreview);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 제출 상태
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [devNotice, setDevNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 디바운스·요청 취소
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number>(0);

  // 실제 서버로 보낼 filters
  const filters: GroupFilters = useMemo(
    () => ({
      grades: grades.filter((g): g is 1 | 2 | 3 =>
        g === 1 || g === 2 || g === 3,
      ),
      schools,
      subjects: subjects.filter((s): s is Subject =>
        SUBJECT_OPTIONS.includes(s as Subject),
      ),
    }),
    [grades, schools, subjects],
  );

  // filters/branch 변경 시 디바운스 카운트 호출
  useEffect(() => {
    if (!branch) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewLoading(true);
    setPreviewError(null);

    debounceRef.current = setTimeout(async () => {
      const currentId = ++requestIdRef.current;
      const result = await countRecipientsAction(filters, branch);
      // 최신 요청만 반영
      if (currentId !== requestIdRef.current) return;

      if (result.status === "success") {
        setPreview({
          total: result.data.total,
          sample: result.data.sample,
        });
      } else {
        setPreviewError(result.reason);
      }
      setPreviewLoading(false);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, branch]);

  // 학교 표시 후보
  const visibleSchools = useMemo(() => {
    // 기존에 선택된 학교는 리스트에 없더라도 항상 보여줘야 함
    const base = schoolOptions.slice();
    for (const s of schools) {
      if (!base.includes(s)) base.push(s);
    }
    if (showAllSchools) return base;
    return base.slice(0, SCHOOL_VISIBLE_LIMIT);
  }, [schoolOptions, schools, showAllSchools]);

  const toggleFromList = <T,>(
    list: T[],
    value: T,
    setter: (next: T[]) => void,
  ) => {
    if (list.includes(value)) {
      setter(list.filter((v) => v !== value));
    } else {
      setter([...list, value]);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    setDevNotice(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setSubmitError("그룹명은 필수입니다");
      return;
    }
    if (!branch) {
      setSubmitError("분원은 필수입니다");
      return;
    }

    startTransition(async () => {
      if (mode === "create") {
        const result = await createGroupAction({
          name: trimmed,
          branch,
          filters,
        });
        if (result.status === "success") {
          router.push(`/groups/${result.id}`);
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setDevNotice(
            "개발용 시드 데이터 상태라 실제 저장되지 않습니다. Supabase 연결 후 저장됩니다.",
          );
        } else {
          setSubmitError(result.reason);
        }
      } else {
        if (!groupId) {
          setSubmitError("그룹 ID 가 없습니다");
          return;
        }
        const result = await updateGroupAction({
          id: groupId,
          name: trimmed,
          branch,
          filters,
        });
        if (result.status === "success") {
          router.push(`/groups/${groupId}`);
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setDevNotice(
            "개발용 시드 데이터 상태라 실제 저장되지 않습니다. Supabase 연결 후 저장됩니다.",
          );
        } else {
          setSubmitError(result.reason);
        }
      }
    });
  };

  return (
    <form className="max-w-7xl space-y-6" onSubmit={onSubmit}>
      {/* 헤더 */}
      <div>
        <Link
          href="/groups"
          className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          발송 그룹
        </Link>
        <h1 className="mt-2 text-[20px] font-semibold text-[color:var(--text)]">
          {mode === "create" ? "새 발송 그룹" : "발송 그룹 수정"}
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학년·학교·과목 조건으로 수신자를 지정합니다. 수신거부·탈퇴 학생은 자동 제외됩니다.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* 좌측: 필터 편집 */}
        <div className="space-y-5">
          {/* 기본 정보 */}
          <section className="rounded-xl border border-[color:var(--border)] bg-white p-6 space-y-5">
            <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
              기본 정보
            </h2>

            <Field label="그룹명" required>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="예: 대치 고2 수학 수강생"
                className="
                  w-full h-10 rounded-lg px-3
                  bg-white border border-[color:var(--border)]
                  text-[15px] text-[color:var(--text)]
                  placeholder:text-[color:var(--text-dim)]
                  focus:outline-none focus:border-[color:var(--border-strong)]
                  transition-colors
                "
              />
            </Field>

            <Field label="분원" required>
              <div className="flex gap-1.5">
                {BRANCH_OPTIONS.map((b) => (
                  <Chip
                    key={b}
                    label={b}
                    active={branch === b}
                    onClick={() => setBranch(b)}
                  />
                ))}
              </div>
            </Field>
          </section>

          {/* 필터 */}
          <section className="rounded-xl border border-[color:var(--border)] bg-white p-6 space-y-5">
            <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
              수신자 조건
            </h2>

            <Field
              label="학년"
              hint={grades.length === 0 ? "선택 안 함 = 전 학년" : undefined}
            >
              <div className="flex flex-wrap gap-1.5">
                {GRADE_OPTIONS.map((g) => (
                  <Chip
                    key={g}
                    label={`고${g}`}
                    active={grades.includes(g)}
                    onClick={() =>
                      toggleFromList(grades, g, (next) => setGrades(next))
                    }
                  />
                ))}
              </div>
            </Field>

            <Field
              label="학교"
              hint={schools.length === 0 ? "선택 안 함 = 전 학교" : undefined}
            >
              <div className="flex flex-wrap gap-1.5">
                {visibleSchools.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    active={schools.includes(s)}
                    onClick={() =>
                      toggleFromList(schools, s, (next) => setSchools(next))
                    }
                  />
                ))}
                {schoolOptions.length > SCHOOL_VISIBLE_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllSchools((v) => !v)}
                    className="
                      inline-flex items-center h-8 px-3 rounded-full
                      text-[13px] text-[color:var(--text-muted)]
                      hover:text-[color:var(--text)]
                      hover:bg-[color:var(--bg-hover)]
                      transition-colors
                    "
                  >
                    {showAllSchools ? "접기" : "더보기"}
                  </button>
                )}
              </div>
            </Field>

            <Field
              label="과목"
              hint={subjects.length === 0 ? "선택 안 함 = 전 과목" : undefined}
            >
              <div className="flex flex-wrap gap-1.5">
                {SUBJECT_OPTIONS.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    active={subjects.includes(s)}
                    onClick={() =>
                      toggleFromList(subjects, s, (next) =>
                        setSubjects(next),
                      )
                    }
                  />
                ))}
              </div>
            </Field>
          </section>

          {/* 에러/안내 */}
          {submitError && (
            <div
              role="alert"
              className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-3 text-[14px] text-[color:var(--danger)]"
            >
              {submitError}
            </div>
          )}
          {devNotice && (
            <div
              role="note"
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-3 text-[14px] text-[color:var(--text-muted)]"
            >
              {devNotice}
            </div>
          )}

          {/* 하단 CTA */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Link
              href={mode === "edit" && groupId ? `/groups/${groupId}` : "/groups"}
              className="
                inline-flex items-center h-10 px-4 rounded-lg
                text-[14px] text-[color:var(--text-muted)]
                hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
                transition-colors
              "
            >
              취소
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="
                inline-flex items-center h-10 px-5 rounded-lg
                bg-[color:var(--action)] text-[color:var(--action-text)]
                text-[14px] font-medium
                hover:bg-[color:var(--action-hover)]
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
              "
            >
              {isPending
                ? "저장 중..."
                : mode === "create"
                  ? "그룹 저장"
                  : "변경사항 저장"}
            </button>
          </div>
        </div>

        {/* 우측: 프리뷰 */}
        <aside className="lg:sticky lg:top-6 h-fit">
          <div className="rounded-xl border border-[color:var(--border)] bg-white p-6 space-y-4">
            <h2 className="text-[13px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
              수신자 미리보기
            </h2>

            <div>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[36px] font-semibold tabular-nums text-[color:var(--text)] leading-none"
                  aria-live="polite"
                >
                  {preview.total.toLocaleString()}
                </span>
                <span className="text-[15px] text-[color:var(--text-muted)]">
                  명
                </span>
                {previewLoading && (
                  <span className="ml-auto text-[12px] text-[color:var(--text-dim)]">
                    계산 중...
                  </span>
                )}
              </div>
              {previewError && (
                <p className="mt-2 text-[13px] text-[color:var(--danger)]">
                  {previewError}
                </p>
              )}
            </div>

            {preview.sample.length > 0 && (
              <div className="pt-2 border-t border-[color:var(--border)]">
                <p className="text-[12px] text-[color:var(--text-muted)] mb-2">
                  예시 (상위 {preview.sample.length}명)
                </p>
                <ul className="space-y-1.5">
                  {preview.sample.map((s, i) => (
                    <li
                      key={`${s.name}-${i}`}
                      className="text-[13px] text-[color:var(--text)] flex items-center gap-2"
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[color:var(--text-muted)]">
                        {s.school ?? "-"}
                      </span>
                      <span className="text-[color:var(--text-muted)]">
                        {s.grade ? `고${s.grade}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[12px] text-[color:var(--text-dim)] leading-relaxed pt-1 border-t border-[color:var(--border)]">
              비활성(탈퇴) · 수신거부 학생은 자동 제외됩니다.
            </p>
          </div>
        </aside>
      </div>
    </form>
  );
}

// ─── 내부 소 컴포넌트 ───────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-[13px] font-medium text-[color:var(--text)]">
          {label}
          {required && (
            <span className="ml-0.5 text-[color:var(--danger)]" aria-hidden>
              *
            </span>
          )}
        </label>
        {hint && (
          <span className="text-[12px] text-[color:var(--text-dim)]">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`
        inline-flex items-center h-8 px-3 rounded-full
        text-[14px] font-medium
        border transition-colors
        ${
          active
            ? "bg-[color:var(--action)] text-[color:var(--action-text)] border-[color:var(--action)]"
            : "bg-white text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
        }
      `}
    >
      {label}
    </button>
  );
}
