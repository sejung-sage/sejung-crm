"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MinusCircle, X } from "lucide-react";
import type { Grade, StudentStatus } from "@/types/database";
import type { ClassOption } from "@/lib/classes/list-class-options";
import {
  groupBuilderFilterOptionsAction,
  listClassOptionsAction,
} from "@/app/(features)/groups/actions";
import { MultiSelectDropdown } from "@/components/shell/multi-select-dropdown";
import { REGION_OPTIONS } from "@/config/regions";

/**
 * 공용 필터 칩 패널 — 발송 그룹 빌더(group-builder)와 /compose 인라인 발송이
 * 동일한 "수신자 조건 + 제외 조건" UI 를 공유하기 위한 추출 컴포넌트.
 *
 * 이전에는 group-builder.tsx 안에 인라인으로 들어 있던 'filter'(조건 동기화)
 * 종류의 칩 섹션을 그대로 옮겨, 두 소비처가 한 소스를 쓰게 한다. custom(고정
 * 명단) 검색·diff·저장 로직은 group-builder 에 그대로 남기고, 여기서는 칩 UI 와
 * 칩에 따른 동적 옵션(학교/학년/지역/강좌) 좁힘만 담당한다.
 *
 * 상태 모델: 완전 controlled. value(FilterChipValue) + onChange 만 받아
 * 부모가 GroupFilters 로 합성한다.
 *
 * 동적 옵션:
 *  - branch / statuses 변경 시 groupBuilderFilterOptionsAction 으로 학교·학년·
 *    지역 옵션을 좁힌다(디바운스). 강좌 제외 옵션은 branch 변경 시 재페치.
 *  - 초기값은 부모가 prop 으로 내려준다(서버 prefetch).
 */

// ── 칩 옵션 상수 (group-builder 에서 이동) ────────────────────
const GRADE_OPTIONS_HIGH: Grade[] = ["고1", "고2", "고3", "재수"];
const GRADE_OPTIONS_MID: Grade[] = ["중1", "중2", "중3"];
const GRADE_OPTIONS_ELEM: Grade[] = ["초등"];
const GRADE_OPTIONS_HIDDEN: Grade[] = ["졸업", "미정"];
const GRADE_OPTIONS_ALL: Grade[] = [
  ...GRADE_OPTIONS_ELEM,
  ...GRADE_OPTIONS_MID,
  ...GRADE_OPTIONS_HIGH,
];
// 발송 그룹 필터 UI 가 노출하는 과목 — 7종.
export const SUBJECT_OPTIONS = [
  "국어",
  "영어",
  "수학",
  "과탐",
  "사탐",
  "컨설팅",
  "기타",
] as const;
export type FilterSubject = (typeof SUBJECT_OPTIONS)[number];

const STATUS_OPTIONS: StudentStatus[] = ["재원생", "수강이력자", "수강 x"];

const DEBOUNCE_MS = 300;
const SCHOOL_CHIP_LIMIT = 20;

/** 학교명에서 학교급(고/중/초) 추론. */
function inferSchoolLevel(school: string): "고" | "중" | "초" | "기타" {
  const s = school.trim();
  if (s.endsWith("고") || s.endsWith("여고") || s.includes("고등학교")) return "고";
  if (s.endsWith("초") || s.includes("초등")) return "초";
  if (s.endsWith("중") || s.endsWith("여중")) return "중";
  return "기타";
}

/** 학년 선택값에서 허용 학교급 set 추론. */
function gradesToSchoolLevels(
  grades: Grade[],
): Array<"고" | "중" | "초" | "기타"> | null {
  if (grades.length === 0) return null;
  const levels = new Set<"고" | "중" | "초" | "기타">();
  for (const g of grades) {
    if (
      g === "고1" ||
      g === "고2" ||
      g === "고3" ||
      g === "재수" ||
      g === "졸업" ||
      g === "미정"
    ) {
      levels.add("고");
    } else if (g === "중1" || g === "중2" || g === "중3") {
      levels.add("중");
    } else if (g === "초등") {
      levels.add("초");
    }
  }
  levels.add("기타");
  return Array.from(levels);
}

// ── value 타입 ────────────────────────────────────────────────
/**
 * 칩 패널이 다루는 필터 필드. GroupFilters 의 부분집합 — kind/include·exclude
 * StudentIds 처럼 칩 UI 가 직접 손대지 않는 필드는 부모가 합성한다.
 */
export interface FilterChipValue {
  grades: Grade[];
  schools: string[];
  subjects: string[];
  regions: string[];
  statuses: StudentStatus[];
  excludeSchools: string[];
  /** 강좌별 제외 — 칩 라벨 표시용 메타도 함께 보관. */
  excludeClasses: ClassOption[];
  unmappedSchool: boolean;
  mappedSchool: boolean;
}

interface Props {
  value: FilterChipValue;
  onChange: (next: FilterChipValue) => void;
  /** 발송/조회 분원. 옵션 좁힘·강좌 재페치의 기준. */
  branch: string;
  /** 학교 토글 칩 후보(서버 prefetch). */
  schoolOptions: string[];
  /** 강좌별 제외 드롭다운 후보(서버 prefetch). */
  classOptions: ClassOption[];
  /** 분원 매칭 학생이 있는 학년 set. 미전달 시 전체 노출. */
  availableGrades?: Grade[];
  /** 분원 매칭 학생이 있는 지역 set. 미전달 시 전체 노출. */
  availableRegions?: string[];
}

export function FilterChipPanel({
  value,
  onChange,
  branch,
  schoolOptions,
  classOptions,
  availableGrades,
  availableRegions,
}: Props) {
  const {
    grades,
    schools,
    subjects,
    regions,
    statuses,
    excludeSchools,
    excludeClasses,
    unmappedSchool,
    mappedSchool,
  } = value;

  const patch = (p: Partial<FilterChipValue>) => onChange({ ...value, ...p });

  const toggleFromList = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((v) => v !== item) : [...list, item];

  // '졸업·미정' 학년 영역 expand.
  const [showHiddenGrades, setShowHiddenGrades] = useState<boolean>(() =>
    grades.some((g) => GRADE_OPTIONS_HIDDEN.includes(g)),
  );

  // 동적 옵션 — branch/statuses 변경 시 좁힘.
  const [dynamicSchoolOptions, setDynamicSchoolOptions] =
    useState<string[]>(schoolOptions);
  const [dynamicSchoolGroups, setDynamicSchoolGroups] = useState<
    Array<{ region: string; schools: string[] }>
  >([]);
  const [dynamicGrades, setDynamicGrades] = useState<Grade[] | undefined>(
    availableGrades,
  );
  const [dynamicRegions, setDynamicRegions] = useState<string[] | undefined>(
    availableRegions,
  );
  const optionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsReqIdRef = useRef<number>(0);

  const [dynamicClassOptions, setDynamicClassOptions] =
    useState<ClassOption[]>(classOptions);
  const classOptionsReqIdRef = useRef<number>(0);
  const classOptionsBranchRef = useRef<string>(branch);

  // branch / statuses 변경 시 학교·학년·지역 옵션 재페치 (디바운스).
  useEffect(() => {
    if (!branch) return;
    if (optionsDebounceRef.current) clearTimeout(optionsDebounceRef.current);
    optionsDebounceRef.current = setTimeout(async () => {
      const myReq = ++optionsReqIdRef.current;
      const result = await groupBuilderFilterOptionsAction(branch, statuses);
      if (myReq !== optionsReqIdRef.current) return;
      if (result.status === "success") {
        setDynamicSchoolOptions(result.data.schools);
        setDynamicSchoolGroups(result.data.schoolGroups);
        setDynamicGrades(result.data.availableGrades);
        setDynamicRegions(result.data.availableRegions);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (optionsDebounceRef.current) clearTimeout(optionsDebounceRef.current);
    };
  }, [branch, statuses]);

  // branch 변경 시 강좌별 제외 후보 재페치. 첫 마운트(prop 동일)는 스킵.
  useEffect(() => {
    if (!branch) return;
    if (classOptionsBranchRef.current === branch) return;
    classOptionsBranchRef.current = branch;
    const myReq = ++classOptionsReqIdRef.current;
    (async () => {
      const result = await listClassOptionsAction(branch);
      if (myReq !== classOptionsReqIdRef.current) return;
      if (result.status === "success") {
        setDynamicClassOptions(result.data);
      }
    })();
  }, [branch]);

  // region 으로 좁힌 학교 옵션.
  const visibleSchoolOptions = useMemo(() => {
    if (regions.length === 0 || dynamicSchoolGroups.length === 0) {
      return dynamicSchoolOptions;
    }
    const set = new Set<string>();
    for (const g of dynamicSchoolGroups) {
      if (regions.includes(g.region)) {
        for (const s of g.schools) set.add(s);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [regions, dynamicSchoolOptions, dynamicSchoolGroups]);

  return (
    <div className="space-y-5">
      {/* 수신자 조건 */}
      <section className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-5">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          수신자 조건
        </h2>

        <Field
          label="학년"
          hint={grades.length === 0 ? "선택 안 함 = 전 학년" : undefined}
        >
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {GRADE_OPTIONS_ALL.filter(
                (g) =>
                  !dynamicGrades ||
                  dynamicGrades.includes(g) ||
                  grades.includes(g),
              ).map((g) => (
                <Chip
                  key={g}
                  label={g}
                  active={grades.includes(g)}
                  onClick={() => patch({ grades: toggleFromList(grades, g) })}
                />
              ))}
            </div>

            {(!dynamicGrades ||
              GRADE_OPTIONS_HIDDEN.some(
                (g) => dynamicGrades.includes(g) || grades.includes(g),
              )) && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowHiddenGrades((v) => !v)}
                  aria-expanded={showHiddenGrades}
                  className="
                    inline-flex items-center gap-1
                    text-[12px] text-[color:var(--text-muted)]
                    hover:text-[color:var(--text)]
                    transition-colors
                  "
                >
                  {showHiddenGrades ? "− 졸업·미정 숨기기" : "+ 졸업·미정 포함"}
                </button>
                {showHiddenGrades && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {GRADE_OPTIONS_HIDDEN.filter(
                      (g) =>
                        !dynamicGrades ||
                        dynamicGrades.includes(g) ||
                        grades.includes(g),
                    ).map((g) => (
                      <Chip
                        key={g}
                        label={g}
                        active={grades.includes(g)}
                        onClick={() =>
                          patch({ grades: toggleFromList(grades, g) })
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Field>

        <Field
          label="학교"
          hint={schools.length === 0 ? "선택 안 함 = 전 학교" : undefined}
        >
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={mappedSchool}
                onClick={() =>
                  patch({
                    mappedSchool: !mappedSchool,
                    unmappedSchool: !mappedSchool ? false : unmappedSchool,
                  })
                }
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium border transition-colors ${
                  mappedSchool
                    ? "bg-[color:var(--bg-hover)] text-[color:var(--text)] border-[color:var(--border-strong)]"
                    : "bg-bg-card text-[color:var(--text-muted)] border-[color:var(--border)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
                }`}
              >
                학교 등록만
              </button>
              <button
                type="button"
                aria-pressed={unmappedSchool}
                onClick={() =>
                  patch({
                    unmappedSchool: !unmappedSchool,
                    mappedSchool: !unmappedSchool ? false : mappedSchool,
                  })
                }
                title="학교 정보가 비어 있거나 '고/중/고등학교' 같이 학교명이 정확하지 않은 학생만"
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium border transition-colors ${
                  unmappedSchool
                    ? "bg-[color:var(--bg-hover)] text-[color:var(--text)] border-[color:var(--border-strong)]"
                    : "bg-bg-card text-[color:var(--text-muted)] border-[color:var(--border)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
                }`}
              >
                학교 미등록만
              </button>
            </div>
            <GroupSchoolSearchPanel
              schoolOptions={visibleSchoolOptions}
              selected={schools}
              grades={grades}
              onToggle={(s) => patch({ schools: toggleFromList(schools, s) })}
              onSelectMany={(list) =>
                patch({ schools: Array.from(new Set([...schools, ...list])) })
              }
              onClearMany={(list) => {
                const remove = new Set(list);
                patch({ schools: schools.filter((s) => !remove.has(s)) });
              }}
            />
          </div>
        </Field>

        <Field
          label="재원 상태"
          hint={
            statuses.length === 0
              ? "선택 안 함 = 재원생 (기본)"
              : statuses.join(" · ")
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((s) => (
              <Chip
                key={s}
                label={s}
                active={statuses.includes(s)}
                onClick={() => patch({ statuses: toggleFromList(statuses, s) })}
              />
            ))}
          </div>
        </Field>

        <Field
          label="지역"
          hint={regions.length === 0 ? "선택 안 함 = 전 지역" : undefined}
        >
          <div className="flex flex-wrap gap-1.5">
            {REGION_OPTIONS.filter(
              (r) =>
                !dynamicRegions ||
                dynamicRegions.includes(r) ||
                regions.includes(r),
            ).map((r) => (
              <Chip
                key={r}
                label={r}
                active={regions.includes(r)}
                onClick={() => patch({ regions: toggleFromList(regions, r) })}
              />
            ))}
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
                onClick={() => patch({ subjects: toggleFromList(subjects, s) })}
              />
            ))}
          </div>
        </Field>
      </section>

      {/* 제외 조건 */}
      <section className="rounded-xl border border-danger/40 bg-[color:var(--danger-bg)] p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold text-[color:var(--danger)]">
            <MinusCircle className="size-4" strokeWidth={2} aria-hidden />
            제외 조건
          </h2>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            위 조건으로 잡힌 수신자 중, 아래에 해당하는 학생은 발송에서 빠집니다.
          </p>
        </div>

        <Field
          label="이 학교 제외"
          hint={
            excludeSchools.length === 0
              ? "선택한 학교의 학생은 발송 대상에서 제외됩니다"
              : `${excludeSchools.length}개 학교 제외`
          }
        >
          <ExcludeSchoolPanel
            schoolOptions={visibleSchoolOptions}
            selected={excludeSchools}
            onToggle={(s) =>
              patch({ excludeSchools: toggleFromList(excludeSchools, s) })
            }
            onRemove={(s) =>
              patch({ excludeSchools: excludeSchools.filter((x) => x !== s) })
            }
            onClearMany={(list) => {
              const remove = new Set(list);
              patch({
                excludeSchools: excludeSchools.filter((x) => !remove.has(x)),
              });
            }}
          />
        </Field>

        <Field
          label="이 강좌 수강생 제외"
          hint={
            excludeClasses.length === 0
              ? "선택한 강좌를 듣는 학생은 발송 대상에서 제외됩니다"
              : `${excludeClasses.length}개 강좌 수강생 제외`
          }
        >
          <ExcludeClassPicker
            options={dynamicClassOptions}
            selected={excludeClasses}
            onToggle={(c) =>
              patch({
                excludeClasses: excludeClasses.find((x) => x.id === c.id)
                  ? excludeClasses.filter((x) => x.id !== c.id)
                  : [...excludeClasses, c],
              })
            }
            onRemove={(id) =>
              patch({
                excludeClasses: excludeClasses.filter((x) => x.id !== id),
              })
            }
          />
        </Field>
      </section>
    </div>
  );
}

// ─── 내부 소 컴포넌트 (group-builder 에서 이동) ───────────────

export function Field({
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

export function Chip({
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
            : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
        }
      `}
    >
      {label}
    </button>
  );
}

function GroupSchoolSearchPanel({
  schoolOptions,
  selected,
  grades,
  onToggle,
  onSelectMany,
  onClearMany,
}: {
  schoolOptions: string[];
  selected: string[];
  grades: Grade[];
  onToggle: (s: string) => void;
  onSelectMany: (schools: string[]) => void;
  onClearMany: (schools: string[]) => void;
}) {
  const merged = useMemo(() => {
    const set = new Set(schoolOptions);
    for (const s of selected) set.add(s);
    return Array.from(set);
  }, [schoolOptions, selected]);
  const allowedLevels = useMemo(() => gradesToSchoolLevels(grades), [grades]);
  const dropdownOptions = useMemo(() => {
    const list =
      allowedLevels === null
        ? merged
        : merged.filter(
            (s) =>
              selected.includes(s) ||
              allowedLevels.includes(inferSchoolLevel(s)),
          );
    return [...list].sort((a, b) => a.localeCompare(b, "ko"));
  }, [merged, allowedLevels, selected]);

  const tooMany = selected.length > SCHOOL_CHIP_LIMIT;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectDropdown
          label="학교 선택"
          options={dropdownOptions}
          selected={selected}
          onToggle={onToggle}
          onSelectAll={(visible) => onSelectMany(visible)}
          onClearAll={(visible) => onClearMany(visible)}
          searchable
          searchPlaceholder="학교명 검색 (예: 휘문, 단대부)"
          emptyHint="표시할 학교가 없습니다"
        />
        <span className="text-[12px] text-[color:var(--text-muted)]">
          총 {dropdownOptions.length.toLocaleString()}개 학교
          {selected.length > 0 && (
            <>
              <span className="mx-1.5 text-[color:var(--text-dim)]">·</span>
              <span>선택 {selected.length}개</span>
            </>
          )}
        </span>
      </div>

      {selected.length > 0 &&
        (tooMany ? (
          <div className="inline-flex items-center gap-2 h-8 pl-3 pr-1.5 rounded-full bg-[color:var(--bg-muted)] text-[13px] font-medium text-[color:var(--text)] border border-[color:var(--border)]">
            <span>학교 {selected.length.toLocaleString()}개 선택됨</span>
            <button
              type="button"
              onClick={() => onClearMany(selected)}
              className="ml-0.5 inline-flex items-center h-6 px-2 rounded-full text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
            >
              전체 해제
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((s) => (
              <SelectedSchoolChip
                key={s}
                label={s}
                onRemove={() => onToggle(s)}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

function SelectedSchoolChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full bg-[color:var(--bg-muted)] text-[13px] font-medium text-[color:var(--text)] border border-[color:var(--border)]">
      <span className="truncate max-w-[12rem]">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${label} 제거`}
        className="ml-0.5 size-5 inline-flex items-center justify-center rounded-full text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  );
}

function ExcludeSchoolPanel({
  schoolOptions,
  selected,
  onToggle,
  onRemove,
  onClearMany,
}: {
  schoolOptions: string[];
  selected: string[];
  onToggle: (s: string) => void;
  onRemove: (s: string) => void;
  onClearMany: (schools: string[]) => void;
}) {
  const dropdownOptions = useMemo(() => {
    const set = new Set(schoolOptions);
    for (const s of selected) set.add(s);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [schoolOptions, selected]);

  const tooMany = selected.length > SCHOOL_CHIP_LIMIT;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectDropdown
          label="제외할 학교 선택"
          options={dropdownOptions}
          selected={selected}
          onToggle={onToggle}
          onClearAll={(visible) => onClearMany(visible)}
          searchable
          searchPlaceholder="제외할 학교명 검색 (예: 휘문, 단대부)"
          emptyHint="표시할 학교가 없습니다"
        />
        {selected.length > 0 && (
          <span className="text-[12px] text-[color:var(--text-muted)]">
            {selected.length}개 학교 제외
          </span>
        )}
      </div>

      {selected.length > 0 && tooMany && (
        <div className="inline-flex items-center gap-2 h-8 pl-3 pr-1.5 rounded-full border border-[color:var(--danger)] bg-bg-card text-[13px] font-medium text-[color:var(--danger)]">
          <span>학교 {selected.length.toLocaleString()}개 제외</span>
          <button
            type="button"
            onClick={() => onClearMany(selected)}
            className="ml-0.5 inline-flex items-center h-6 px-2 rounded-full text-[12px] text-[color:var(--danger)] hover:bg-[color:var(--danger-bg)]"
          >
            전체 해제
          </button>
        </div>
      )}

      {selected.length > 0 && !tooMany && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full border border-[color:var(--danger)] bg-bg-card text-[13px] font-medium text-[color:var(--danger)]"
            >
              <span className="line-through truncate max-w-[12rem]">{s}</span>
              <button
                type="button"
                onClick={() => onRemove(s)}
                aria-label={`${s} 제외 해제`}
                className="ml-0.5 size-5 inline-flex items-center justify-center rounded-full text-[color:var(--danger)] hover:bg-[color:var(--danger-bg)]"
              >
                <X className="size-3.5" strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ExcludeClassPicker({
  options,
  selected,
  onToggle,
  onRemove,
}: {
  options: ClassOption[];
  selected: ClassOption[];
  onToggle: (c: ClassOption) => void;
  onRemove: (id: string) => void;
}) {
  const labelOf = (c: ClassOption) =>
    c.teacher_name ? `${c.name} · ${c.teacher_name}` : c.name;

  const merged = useMemo(() => {
    const byId = new Map<string, ClassOption>();
    for (const c of options) byId.set(c.id, c);
    for (const c of selected) if (!byId.has(c.id)) byId.set(c.id, c);
    return Array.from(byId.values());
  }, [options, selected]);

  const optionByLabel = useMemo(() => {
    const m = new Map<string, ClassOption>();
    for (const c of merged) {
      const label = labelOf(c);
      if (!m.has(label)) m.set(label, c);
    }
    return m;
  }, [merged]);

  const labelOptions = useMemo(
    () =>
      Array.from(optionByLabel.keys()).sort((a, b) => a.localeCompare(b, "ko")),
    [optionByLabel],
  );
  const selectedLabels = useMemo(() => selected.map(labelOf), [selected]);

  return (
    <div className="space-y-2">
      <MultiSelectDropdown
        label="제외할 강좌 선택"
        options={labelOptions}
        selected={selectedLabels}
        onToggle={(label) => {
          const c = optionByLabel.get(label);
          if (c) onToggle(c);
        }}
        searchable
        searchPlaceholder="강좌명·강사 검색..."
        emptyHint="이 분원에 진행 중 강좌가 없습니다"
      />

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selected.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full border border-[color:var(--danger)] bg-bg-card text-[13px] font-medium text-[color:var(--danger)]"
            >
              <span className="line-through">{c.name}</span>
              {c.teacher_name && (
                <span className="text-[11px] text-[color:var(--text-muted)] no-underline">
                  {c.teacher_name}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                aria-label={`${c.name} 제외 해제`}
                className="ml-0.5 size-5 inline-flex items-center justify-center rounded-full text-[color:var(--danger)] hover:bg-[color:var(--danger-bg)]"
              >
                <X className="size-3.5" strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
