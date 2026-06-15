"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronLeft,
  Loader2,
  MinusCircle,
  Search,
  X,
} from "lucide-react";
import type { GroupFilters, GroupKind } from "@/lib/schemas/group";
import type { Grade, StudentStatus } from "@/types/database";
import type {
  CountRecipientsResult,
  DiffRecipientsResult,
} from "@/lib/groups/count-recipients";
import {
  countRecipientsAction,
  createGroupAction,
  diffRecipientsAction,
  searchStudentsAction,
  updateGroupAction,
} from "@/app/(features)/groups/actions";
import type { ClassOption } from "@/lib/classes/list-class-options";
import type { StudentSearchHit } from "@/lib/profile/search-students-for-group";
import {
  Chip,
  Field,
  FilterChipPanel,
  SUBJECT_OPTIONS,
  type FilterSubject,
} from "@/components/groups/filter-chip-panel";
import { BRANCHES } from "@/config/branches";
import { formatPhone, maskPhone } from "@/lib/phone";
import { BranchBadge } from "@/components/students/branch-badge";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DirectStudent {
  id: string;
  name: string;
  parent_phone: string | null;
  school: string | null;
  grade: Grade | null;
}

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
    filters: GroupFilters & {
      /** 직접 추가한 학생들의 메타 (수정 모드에서 칩 표시용 prefetch) */
      includeStudents?: DirectStudent[];
    };
  };
  /** 학교 토글 칩 후보. dev-seed · Supabase 공통으로 상위 후보를 넘겨줌. */
  schoolOptions: string[];
  /**
   * 강좌별 제외 드롭다운 후보 (진행 중 강좌만, id+이름). 분원 기준 prefetch.
   * master 가 분원 칩을 바꾸면 listClassOptionsAction 으로 재페치한다.
   */
  classOptions: ClassOption[];
  /**
   * 수정 모드에서 이미 저장된 excludeClassIds 의 칩 라벨 prefill.
   * 종강 등으로 진행 중 classOptions 에서 빠진 강좌라도 칩으로 보여줘 해제 가능.
   * 신규 모드면 undefined.
   */
  prefilledExcludeClasses?: ClassOption[];
  /** 초기 프리뷰(서버에서 한 번 계산). */
  initialPreview: SamplePreview;
  mode: "create" | "edit";
  /**
   * 수정 모드 전용 — DB 에 저장된 기존(=old) filters.
   * 이걸로 변경 차이(diff) 를 계산: 새 필터로 +N 추가 / -M 제외.
   * create 모드면 undefined.
   */
  oldFilters?: GroupFilters;
  /**
   * 수정 모드에서 페이지 마운트 시 서버가 한 번 계산해서 넘긴 초기 diff.
   * 사용자가 필터를 손대지 않은 시점엔 added=0, removed=0 이라 UI 에 표시 안 함.
   * 사용자가 "변경 확인" 버튼을 누르면 client 에서 재계산 → 갱신.
   */
  initialDiff?: DiffRecipientsResult;
  /**
   * 분원 칩 변경 가능 여부.
   *  - master: true (다른 분원 그룹도 만들 수 있음)
   *  - non-master: false (자기 분원으로 강제, 칩 비활성)
   * 미지정 시 true (호환 default — 호출부에서 명시 권장).
   */
  canPickBranch?: boolean;
  /**
   * 학부모 연락처 풀 노출 권한. master 만 true.
   * false 면 검색 결과·칩에서 010-****-1234 마스킹.
   */
  canRevealPhone?: boolean;
  /**
   * 그룹의 branch 에 매칭되는 학생을 가진 학년·지역 set.
   * UI 학년 칩·지역 칩 가시화에 사용. 현재 선택된 칩은 매칭 없어도 유지.
   * 미전달 시 (옛 호출부 호환) 전체 옵션 노출.
   */
  availableGrades?: Grade[];
  availableRegions?: string[];
}

// 필터/카운트 디바운스 간격. 칩 옵션·학교급 추론 등 'filter' 칩 UI 관련
// 상수·헬퍼는 공용 FilterChipPanel 로 이동했다.
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
  classOptions,
  prefilledExcludeClasses,
  initialPreview,
  mode,
  oldFilters,
  initialDiff,
  canPickBranch = true,
  canRevealPhone = false,
  availableGrades,
  availableRegions,
}: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();

  // 폼 상태
  const [name, setName] = useState<string>(initial.name);
  const [branch, setBranch] = useState<string>(initial.branch);
  const [grades, setGrades] = useState<Grade[]>(initial.filters.grades);
  const [schools, setSchools] = useState<string[]>(initial.filters.schools);
  // 학교 미등록/등록 토글 — 학생 명단과 동일 로직.
  // 옛 그룹 JSONB 에 없으면 false (백워드 호환).
  const [unmappedSchool, setUnmappedSchool] = useState<boolean>(
    initial.filters.unmappedSchool ?? false,
  );
  const [mappedSchool, setMappedSchool] = useState<boolean>(
    initial.filters.mappedSchool ?? false,
  );
  const [subjects, setSubjects] = useState<string[]>(initial.filters.subjects);
  // regions 는 5종 고정 칩 — 자유 입력 X. 옛 그룹 데이터엔 필드가 없을 수 있어 ?? [] 가드.
  const [regions, setRegions] = useState<string[]>(
    initial.filters.regions ?? [],
  );
  const [includeStudents, setIncludeStudents] = useState<DirectStudent[]>(
    initial.filters.includeStudents ?? [],
  );
  // 그룹 종류: 'filter'(조건 동기화) | 'custom'(고정 명단).
  //  - 수동 그룹 생성(prefill 없음) → 'filter' 기본 (옛 그룹 JSONB 의 kind 미지정도 포함)
  //  - prefill(강좌별 #5 / 종강 미등록 #6 / 학생 직접) 진입 → page 가 'custom' 으로 내려줌
  // 2026-06-04 (사용자 요청): create 모드에서 "조건으로 만들기"↔"학생 검색으로
  //   만들기" 토글을 다시 허용한다(2026-05 의 "토글 숨김" 결정을 되돌림). 따라서
  //   kind 는 state 로 둔다. edit 모드는 기존 그룹 의미 변질 방지를 위해 마운트
  //   시점 kind 를 고정(아래 토글 UI 를 create 모드에서만 노출).
  const [kind, setKind] = useState<GroupKind>(
    initial.filters.kind ?? "filter",
  );
  // 재원 상태 — 다중 선택. 빈 배열 = default 재원생 만 (수신자 산정 단에서 처리).
  // 옛 그룹 JSONB 에 statuses 키 없으면 빈 배열 → 기존 동작 보존.
  const [statuses, setStatuses] = useState<StudentStatus[]>(
    initial.filters.statuses ?? [],
  );
  // ── 제외 조건 (0076, 박은주 부원장 요청) ──────────────────
  // 학교별 제외: 포함(schools) 과 동일한 학교 옵션 소스에서 선택. 빨강/취소선 톤.
  // 학교 검색은 MultiSelectDropdown 패널 내부 상태로 위임 (별도 query state 불필요).
  const [excludeSchools, setExcludeSchools] = useState<string[]>(
    initial.filters.excludeSchools ?? [],
  );
  // 강좌별 제외: crm_classes.id 선택. 칩 라벨 표시를 위해 {id,name} 메타도 보관.
  // 초기값 = 저장된 excludeClassIds 의 메타(prefilledExcludeClasses).
  const [excludeClasses, setExcludeClasses] = useState<ClassOption[]>(
    prefilledExcludeClasses ?? [],
  );

  // 실시간 프리뷰
  const [preview, setPreview] = useState<SamplePreview>(initialPreview);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 변경 차이 미리보기 (edit 모드 전용).
  // 자동 debounce 는 비용 부담 → 사용자가 명시적으로 "변경 확인" 눌렀을 때만 재계산.
  // 단, 필터가 바뀌면 기존 diff 는 stale 이므로 클리어해서 잘못된 정보 노출 방지.
  const [diff, setDiff] = useState<DiffRecipientsResult | null>(
    initialDiff ?? null,
  );
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  // 사용자가 폼을 손댄 적이 있나? — 손대지 않았으면 "변경 확인" 버튼 의미 없음.
  const [dirty, setDirty] = useState(false);

  // 제출 상태
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [devNotice, setDevNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // 그룹 수정 저장 확인 — 사용자 요청(2026-05-21): 수신자 조건 변경은 발송
  // 영향이 크므로 한 번 더 확인. 신규는 즉시 저장.
  const [confirmingSave, setConfirmingSave] = useState(false);

  // 디바운스·요청 취소
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number>(0);

  // 학교/학년/지역·강좌 옵션의 동적 좁힘(branch/statuses 변경 시 재페치)은
  // 공용 FilterChipPanel 내부로 이동했다 — 여기서는 초기 prop 만 그대로 넘긴다.

  // 실제 서버로 보낼 filters.
  // excludeStudentIds 는 그룹 상세 화면의 "개별 학생 제거" 액션이 관리 →
  // 빌더 폼에서는 직접 편집 안 함. 수정 모드에선 초기값에 들어있는 제외
  // 목록을 그대로 유지해 저장 시 손실되지 않게 한다.
  const initialExcludeIds = initial.filters.excludeStudentIds ?? [];
  // 학교별/강좌별 제외 (0076) 는 아래 폼 상태(excludeSchools/excludeClasses)에서 관리.
  // excludeClassIds 는 excludeClasses 메타에서 id 만 추려 만든다.
  const excludeClassIds = useMemo(
    () => excludeClasses.map((c) => c.id),
    [excludeClasses],
  );
  // 종류 분기 — custom 이면 직접 명단만, filter 면 조건만 노출/해석.
  const isCustom = kind === "custom";
  // custom 인데 명단이 비면 저장 불가 (서버 refine 과 동일 규칙 — UX 선차단).
  const customEmpty = isCustom && includeStudents.length === 0;
  const filters: GroupFilters = useMemo(
    () => ({
      kind,
      grades,
      schools,
      subjects: subjects.filter((s): s is FilterSubject =>
        (SUBJECT_OPTIONS as readonly string[]).includes(s),
      ),
      regions,
      statuses,
      includeStudentIds: includeStudents.map((s) => s.id),
      excludeStudentIds: initialExcludeIds,
      excludeSchools,
      excludeClassIds,
      unmappedSchool,
      mappedSchool,
    }),
    [
      kind,
      grades,
      schools,
      subjects,
      regions,
      statuses,
      includeStudents,
      initialExcludeIds,
      excludeSchools,
      excludeClassIds,
      unmappedSchool,
      mappedSchool,
    ],
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

  // edit 모드 전용 — 필터 변경 시 stale diff 클리어 + dirty 마킹.
  // 초기 마운트 (filters == oldFilters) 에선 변화가 없으므로 깊은 비교가 정밀하지만,
  // 비용 작은 JSON 비교로 충분 (필터 객체 평탄·소형).
  useEffect(() => {
    if (mode !== "edit" || !oldFilters) return;
    const isSame = JSON.stringify(filters) === JSON.stringify(oldFilters);
    setDirty(!isSame);
    if (!isSame) {
      // 사용자가 새 변경을 가했으니 이전 diff 는 의미 없음.
      setDiff(null);
      setDiffError(null);
    } else {
      // 다시 원래 값으로 복귀 — 서버 초기 diff (0/0) 로 되돌리고 정리.
      setDiff(initialDiff ?? null);
      setDiffError(null);
    }
  }, [filters, mode, oldFilters, initialDiff]);

  const recomputeDiff = async () => {
    if (mode !== "edit" || !oldFilters || !branch) return;
    setDiffLoading(true);
    setDiffError(null);
    const r = await diffRecipientsAction(oldFilters, filters, branch);
    if (r.status === "success") {
      setDiff(r.data);
    } else {
      setDiffError(r.reason);
    }
    setDiffLoading(false);
  };

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
    // 고정 명단 그룹은 학생 1명 이상 필수 (서버 refine 과 동일 — 선차단).
    if (customEmpty) {
      setSubmitError("발송할 학생이 1명 이상 있어야 저장할 수 있습니다");
      return;
    }

    // 수정 모드는 발송 영향이 크므로 한 번 더 확인. 신규는 즉시 저장.
    if (mode === "edit") {
      setConfirmingSave(true);
      return;
    }
    doSave();
  };

  const doSave = () => {
    const trimmed = name.trim();
    startTransition(async () => {
      if (mode === "create") {
        const result = await createGroupAction({
          name: trimmed,
          branch,
          filters,
        });
        if (result.status === "success") {
          showToast("success", `'${trimmed}' 그룹을 만들었어요`);
          router.push(`/groups/${result.id}`);
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setDevNotice(
            "개발용 시드 데이터 상태라 실제 저장되지 않습니다. Supabase 연결 후 저장됩니다.",
          );
        } else {
          setSubmitError(result.reason);
          showToast("error", `그룹 생성 실패: ${result.reason}`);
        }
      } else {
        if (!groupId) {
          setSubmitError("그룹 ID 가 없습니다");
          setConfirmingSave(false);
          return;
        }
        const result = await updateGroupAction({
          id: groupId,
          name: trimmed,
          branch,
          filters,
        });
        if (result.status === "success") {
          showToast("success", `'${trimmed}' 그룹을 수정했어요`);
          router.push(`/groups/${groupId}`);
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setDevNotice(
            "개발용 시드 데이터 상태라 실제 저장되지 않습니다. Supabase 연결 후 저장됩니다.",
          );
          setConfirmingSave(false);
        } else {
          setSubmitError(result.reason);
          showToast("error", `그룹 수정 실패: ${result.reason}`);
          setConfirmingSave(false);
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
          {isCustom
            ? "미리 담긴 학생만 발송하는 고정 명단입니다. 수신거부·탈퇴 학생은 자동 제외됩니다."
            : "학년·학교·지역·과목 조건으로 수신자를 지정합니다. 수신거부·탈퇴 학생은 자동 제외됩니다."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* 좌측: 필터 편집 */}
        <div className="space-y-5">
          {/* 기본 정보 */}
          <section className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-5">
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
                  bg-bg-card border border-[color:var(--border)]
                  text-[15px] text-[color:var(--text)]
                  placeholder:text-[color:var(--text-dim)]
                  focus:outline-none focus:border-[color:var(--border-strong)]
                  transition-colors
                "
              />
            </Field>

            <Field
              label="분원"
              required
              hint={
                !canPickBranch
                  ? "본인 분원으로 자동 설정됩니다 (다른 분원 그룹은 master 만 만들 수 있어요)"
                  : undefined
              }
            >
              <div className="flex gap-1.5">
                {BRANCHES.map((b) => {
                  const isCurrent = branch === b;
                  // non-master: 본인 분원 칩만 active 로 보여주고 변경 잠금.
                  if (!canPickBranch && !isCurrent) return null;
                  return (
                    <Chip
                      key={b}
                      label={b}
                      active={isCurrent}
                      onClick={() => {
                        if (!canPickBranch) return;
                        if (b === branch) return;
                        setBranch(b);
                        // 분원이 바뀌면 직접 담은 학생 명단을 초기화한다 — 발송 그룹은
                        // 같은 분원 학생끼리만 담을 수 있다(검색도 분원별). 타 분원 학생이
                        // 명단에 남아 미리보기/발송에서 걸러지는 혼선을 막는다.
                        setIncludeStudents([]);
                      }}
                    />
                  );
                })}
              </div>
            </Field>
          </section>

          {/* 만들기 방식 토글 — create 모드에서만 자유 전환.
              edit 모드는 기존 그룹의 종류(kind)를 고정해 의미 변질을 막는다
              (저장된 'filter'/'custom' 시맨틱이 바뀌면 발송 대상이 달라지므로). */}
          {mode === "create" && (
            <section className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-3">
              <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
                만들기 방식
              </h2>
              <div
                role="radiogroup"
                aria-label="발송 그룹 만들기 방식"
                className="inline-flex rounded-lg border border-[color:var(--border)] p-1 bg-[color:var(--bg-muted)]"
              >
                <ModeToggleButton
                  active={!isCustom}
                  label="조건으로 만들기"
                  onClick={() => setKind("filter")}
                />
                <ModeToggleButton
                  active={isCustom}
                  label="학생 검색으로 만들기"
                  onClick={() => setKind("custom")}
                />
              </div>
              <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
                학생 검색 모드는 선택한 학생만 발송 대상입니다 — 조건 미선택 시
                전체가 되지 않습니다.
              </p>
            </section>
          )}

          {/* 필터 — 'filter' 종류에서만 노출 (조건 동기화 그룹).
              칩 UI 는 공용 FilterChipPanel 로 추출 (/compose 인라인 발송과 공유). */}
          {!isCustom && (
            <FilterChipPanel
              value={{
                grades,
                schools,
                subjects,
                regions,
                statuses,
                excludeSchools,
                excludeClasses,
                unmappedSchool,
                mappedSchool,
              }}
              onChange={(next) => {
                setGrades(next.grades);
                setSchools(next.schools);
                setSubjects(next.subjects);
                setRegions(next.regions);
                setStatuses(next.statuses);
                setExcludeSchools(next.excludeSchools);
                setExcludeClasses(next.excludeClasses);
                setUnmappedSchool(next.unmappedSchool);
                setMappedSchool(next.mappedSchool);
              }}
              branch={branch}
              schoolOptions={schoolOptions}
              classOptions={classOptions}
              availableGrades={availableGrades}
              availableRegions={availableRegions}
            />
          )}

          {/* 담긴 학생 명단 — 'custom' 종류에서만 노출.
              강좌별 발송(#5)·종강 미등록 추적(#6)·학생 직접 진입으로 미리 담긴
              명단을 검토(칩 + X 개별 제거)한다.
              2026-06-04 (사용자 요청): 빌더에서 학생 검색·직접 추가 UI 를 다시
              허용한다(2026-05 의 "free-form 추가 제거" 결정을 되돌림). 상단에
              이름·연락처 검색 입력을 두고, 검색 결과를 클릭해 명단에 담는다. */}
          {isCustom && (
          <section className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
                담긴 학생 명단
              </h2>
              <p className="text-[13px] text-[color:var(--text-muted)]">
                아래에서 학생을 검색해 명단에 담으세요. 담긴 학생들이 이 그룹의
                고정 발송 대상입니다. 빼고 싶은 학생은 칩의 X 로 제거할 수 있어요.
              </p>
            </div>

            <Field label="학생 검색" hint="이름 또는 연락처로 찾아 담기">
              <StudentSearchAdder
                branch={branch}
                canRevealPhone={canRevealPhone}
                alreadyAddedIds={includeStudents.map((s) => s.id)}
                onAdd={(hit) =>
                  setIncludeStudents((prev) =>
                    prev.some((x) => x.id === hit.id)
                      ? prev
                      : [
                          ...prev,
                          {
                            id: hit.id,
                            name: hit.name,
                            parent_phone: hit.parent_phone,
                            school: hit.school,
                            grade: hit.grade,
                          },
                        ],
                  )
                }
              />
            </Field>

            <Field
              label="담긴 학생"
              hint={
                includeStudents.length > 0
                  ? `${includeStudents.length}명 담김`
                  : "담긴 학생이 없습니다"
              }
            >
              <IncludeStudentReview
                students={includeStudents}
                canRevealPhone={canRevealPhone}
                onRemove={(id) =>
                  setIncludeStudents((prev) => prev.filter((x) => x.id !== id))
                }
              />
            </Field>

            {customEmpty && (
              <p
                role="status"
                className="text-[13px] text-[color:var(--danger)]"
              >
                발송할 학생이 1명 이상 있어야 저장할 수 있습니다. 모두 제거되었다면
                이전 화면에서 다시 학생을 골라 담아 주세요.
              </p>
            )}
          </section>
          )}

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
              disabled={isPending || customEmpty}
              title={
                customEmpty
                  ? "발송할 학생이 1명 이상 있어야 저장할 수 있습니다"
                  : undefined
              }
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

        {/* 우측: 프리뷰 + 선택 요약 */}
        <aside className="lg:sticky lg:top-6 h-fit space-y-4">
          <div
            className={`
              relative rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-4
              transition-colors
              ${previewLoading ? "border-[color:var(--border-strong)]" : ""}
            `}
          >
            {/* 로딩 중일 때 카드 우상단에 항상 보이는 스피너.
                좌측 칩 클릭 직후 즉시 켜져 "눌렸다" 신호를 준다. */}
            {previewLoading && (
              <span
                className="absolute top-4 right-4 inline-flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]"
                aria-live="polite"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                계산 중...
              </span>
            )}

            <h2 className="text-[13px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
              수신자 미리보기
            </h2>

            <div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`
                    text-[36px] font-semibold tabular-nums leading-none
                    transition-opacity
                    ${
                      previewLoading
                        ? "text-[color:var(--text-muted)] opacity-60"
                        : "text-[color:var(--text)]"
                    }
                  `}
                  aria-live="polite"
                  aria-busy={previewLoading}
                >
                  {preview.total.toLocaleString()}
                </span>
                <span className="text-[15px] text-[color:var(--text-muted)]">
                  명
                </span>
              </div>
              {previewError && (
                <p className="mt-2 text-[13px] text-[color:var(--danger)]">
                  {previewError}
                </p>
              )}

              {/* edit 모드 전용 — 변경 차이 칩 (added / removed). */}
              {mode === "edit" && diff && (diff.added > 0 || diff.removed > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                  {diff.added > 0 && (
                    <span className="font-medium text-red-600">
                      +{diff.added.toLocaleString()}명 추가
                    </span>
                  )}
                  {diff.removed > 0 && (
                    <span className="text-[color:var(--text-muted)]">
                      −{diff.removed.toLocaleString()}명 제외
                    </span>
                  )}
                </div>
              )}

              {/* edit 모드 — 사용자가 폼을 바꿨고 아직 재계산 전이면 안내+버튼 */}
              {mode === "edit" && oldFilters && (
                <div className="mt-3">
                  {dirty && !diff && (
                    <button
                      type="button"
                      onClick={recomputeDiff}
                      disabled={diffLoading || !branch}
                      className="
                        inline-flex items-center h-8 px-3 rounded-md
                        border border-[color:var(--border)] bg-bg-card
                        text-[12px] font-medium text-[color:var(--text)]
                        hover:bg-[color:var(--bg-hover)]
                        disabled:opacity-50 disabled:cursor-not-allowed
                        transition-colors
                      "
                    >
                      {diffLoading ? "계산 중..." : "변경 확인"}
                    </button>
                  )}
                  {diffError && (
                    <p className="mt-2 text-[12px] text-[color:var(--danger)]">
                      {diffError}
                    </p>
                  )}
                  {diff && dirty && (diff.added === 0 && diff.removed === 0) && (
                    <p className="text-[12px] text-[color:var(--text-muted)]">
                      수신자 변동 없음
                    </p>
                  )}
                </div>
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
                      <BranchBadge branch={s.branch} />
                      <span className="text-[color:var(--text-muted)]">
                        {s.school ?? "-"}
                      </span>
                      <span className="text-[color:var(--text-muted)]">
                        {s.grade ?? ""}
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

          {/* 선택 요약 — 어떤 조건이 들어갔고 무엇이 빠지는지 한눈에.
              custom(고정 명단)은 조건이 없으므로 명단 수만 간단히 표기. */}
          <SelectionSummary
            isCustom={isCustom}
            customCount={includeStudents.length}
            grades={grades}
            schools={schools}
            unmappedSchool={unmappedSchool}
            mappedSchool={mappedSchool}
            statuses={statuses}
            regions={regions}
            subjects={subjects}
            excludeSchools={excludeSchools}
            excludeClasses={excludeClasses}
          />
        </aside>
      </div>

      {confirmingSave && (
        <ConfirmDialog
          title="그룹 변경사항을 저장할까요?"
          description={
            <div className="space-y-2">
              <p>
                <strong className="text-[color:var(--text)]">
                  &lsquo;{name.trim()}&rsquo;
                </strong>{" "}
                그룹의 수신자 조건이 즉시 갱신됩니다.
              </p>
              <p>
                현재 조건의 수신자는{" "}
                <strong className="text-[color:var(--text)] tabular-nums">
                  {preview.total.toLocaleString()}명
                </strong>
                입니다.
              </p>
              {diff && (diff.added > 0 || diff.removed > 0) && (
                <p className="tabular-nums">
                  변동: {diff.added > 0 && (
                    <span className="text-red-600 font-medium">
                      +{diff.added.toLocaleString()}명 추가
                    </span>
                  )}
                  {diff.added > 0 && diff.removed > 0 && (
                    <span className="mx-1 text-[color:var(--text-dim)]">·</span>
                  )}
                  {diff.removed > 0 && (
                    <span>−{diff.removed.toLocaleString()}명 제외</span>
                  )}
                </p>
              )}
            </div>
          }
          confirmLabel="저장"
          busy={isPending}
          onCancel={() => setConfirmingSave(false)}
          onConfirm={doSave}
        />
      )}
    </form>
  );
}

// ─── 내부 소 컴포넌트 ───────────────────────────────────────
// 필터 칩(Chip)·필드 래퍼(Field)·학교/제외 패널은 공용 FilterChipPanel 로
// 이동했다. 여기서는 그 둘을 import 해 기본정보·custom 명단 섹션에서 재사용한다.

/**
 * 담긴 학생 명단 검토 컴포넌트 (read-only review).
 *
 * 사용자 결정(2026-05): 빌더에서 free-form 학생 검색·추가 UI 는 제거한다.
 * prefill(강좌별 발송 #5 / 종강 미등록 추적 #6 / 학생 직접 진입)로 이미 담긴
 * 명단을 칩으로 보여주고, X 로 개별 제거만 가능하다. 추가 입력은 없음.
 */
/**
 * 만들기 방식 세그먼티드 토글 버튼.
 * active = 검정 채움(흰 글씨), inactive = 흰 배경 muted 글씨. 흰/검 미니멀.
 */
function ModeToggleButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`
        inline-flex items-center justify-center h-10 px-4 rounded-md
        text-[14px] font-medium transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--action)] focus-visible:ring-offset-1
        ${
          active
            ? "bg-[color:var(--action)] text-[color:var(--action-text)]"
            : "bg-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
        }
      `}
    >
      {label}
    </button>
  );
}

/**
 * custom(고정 명단) 그룹용 학생 검색·추가 콤보박스.
 *
 * - 이름 또는 학부모 연락처로 검색(>=2자). 250ms 디바운스 후 searchStudentsAction
 *   호출(현재 branch 로 제한). useTransition 으로 로딩 표시.
 * - 결과 드롭다운: 이름 · 분원 배지 · 학교/학년 · 전화(canRevealPhone 따라 마스킹).
 *   클릭/Enter 로 명단에 담는다(id dedupe — 부모가 처리). 이미 담긴 학생은 "담김".
 * - 키보드: ↑/↓ 이동, Enter 추가, Esc 닫기. listbox/option role.
 * - branch 변경 시 입력·결과 초기화(타 분원 잔여 결과 방지).
 */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN = 2;

function StudentSearchAdder({
  branch,
  canRevealPhone,
  alreadyAddedIds,
  onAdd,
}: {
  branch: string;
  canRevealPhone: boolean;
  alreadyAddedIds: string[];
  onAdd: (hit: StudentSearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPending, startSearch] = useTransition();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const addedSet = useMemo(
    () => new Set(alreadyAddedIds),
    [alreadyAddedIds],
  );

  // branch 가 바뀌면 잔여 검색 상태 초기화 (타 분원 결과 노출 방지).
  useEffect(() => {
    setQuery("");
    setResults([]);
    setOpen(false);
    setError(null);
    setSearched(false);
    setActiveIndex(-1);
  }, [branch]);

  // 디바운스 검색.
  useEffect(() => {
    const trimmed = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < SEARCH_MIN) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const myReq = ++reqIdRef.current;
      startSearch(async () => {
        const result = await searchStudentsAction(trimmed, branch);
        if (myReq !== reqIdRef.current) return;
        if (result.status === "success") {
          setResults(result.data);
          setError(null);
        } else {
          setResults([]);
          setError(result.reason);
        }
        setSearched(true);
        setActiveIndex(-1);
        setOpen(true);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, branch]);

  // 바깥 클릭 시 드롭다운 닫기.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleAdd = (hit: StudentSearchHit) => {
    if (addedSet.has(hit.id)) return;
    onAdd(hit);
    // 연속 추가 편의 — 입력은 비우고 드롭다운은 닫는다.
    setQuery("");
    setResults([]);
    setOpen(false);
    setSearched(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = activeIndex >= 0 ? activeIndex : 0;
      const hit = results[idx];
      if (hit) handleAdd(hit);
    }
  };

  const showDropdown =
    open && query.trim().length >= SEARCH_MIN && searched;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-muted)]"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="student-search-listbox"
          aria-autocomplete="list"
          aria-label="이름 또는 연락처로 학생 검색"
          placeholder="이름 또는 연락처로 검색"
          className="
            w-full h-10 rounded-lg pl-9 pr-9
            bg-bg-card border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors
          "
        />
        {isPending && (
          <Loader2
            className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-[color:var(--text-muted)]"
            aria-hidden
          />
        )}
      </div>

      {showDropdown && (
        <ul
          id="student-search-listbox"
          role="listbox"
          aria-label="학생 검색 결과"
          className="
            absolute z-20 mt-1 w-full max-h-72 overflow-auto
            rounded-lg border border-[color:var(--border)] bg-bg-card
            shadow-lg py-1
          "
        >
          {error ? (
            <li className="px-3 py-2.5 text-[13px] text-[color:var(--danger)]">
              {error}
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2.5 text-[13px] text-[color:var(--text-muted)]">
              검색 결과가 없습니다. 다른 이름이나 번호로 찾아보세요.
            </li>
          ) : (
            results.map((hit, i) => {
              const added = addedSet.has(hit.id);
              const phone = hit.parent_phone
                ? canRevealPhone
                  ? formatPhone(hit.parent_phone) || hit.parent_phone
                  : maskPhone(hit.parent_phone)
                : "—";
              return (
                <li key={hit.id} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    disabled={added}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => handleAdd(hit)}
                    className={`
                      flex w-full items-center gap-2 px-3 py-2 text-left
                      transition-colors
                      ${
                        added
                          ? "cursor-not-allowed opacity-60"
                          : i === activeIndex
                            ? "bg-[color:var(--bg-hover)]"
                            : "hover:bg-[color:var(--bg-hover)]"
                      }
                    `}
                  >
                    <span className="text-[14px] font-medium text-[color:var(--text)]">
                      {hit.name}
                    </span>
                    <BranchBadge branch={hit.branch} />
                    <span className="text-[12px] text-[color:var(--text-muted)]">
                      {hit.school ?? "-"}
                    </span>
                    <span className="text-[12px] text-[color:var(--text-muted)]">
                      {hit.grade ?? ""}
                    </span>
                    <span className="text-[12px] text-[color:var(--text-muted)]">
                      {phone}
                    </span>
                    {added && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--text-muted)]">
                        <Check className="size-3.5" strokeWidth={2} aria-hidden />
                        담김
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

function IncludeStudentReview({
  students,
  onRemove,
  canRevealPhone,
}: {
  students: DirectStudent[];
  onRemove: (id: string) => void;
  canRevealPhone: boolean;
}) {
  if (students.length === 0) {
    return (
      <p className="text-[13px] text-[color:var(--text-muted)]">
        담긴 학생이 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {students.map((s) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full bg-[color:var(--bg-muted)] text-[13px] text-[color:var(--text)] border border-[color:var(--border)]"
        >
          <span className="font-medium">{s.name}</span>
          <span className="text-[11px] text-[color:var(--text-muted)]">
            (
            {s.parent_phone
              ? canRevealPhone
                ? formatPhone(s.parent_phone) || s.parent_phone
                : maskPhone(s.parent_phone)
              : "—"}
            )
          </span>
          <button
            type="button"
            onClick={() => onRemove(s.id)}
            aria-label={`${s.name} 제거`}
            className="ml-1 size-5 inline-flex items-center justify-center rounded-full hover:bg-[color:var(--bg-hover)] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
          >
            <X className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}


/**
 * 선택 요약 패널 (우측 컬럼, 수신자 미리보기 카드 아래).
 *
 * 현재 빌더의 필터 state 를 그대로 읽어 "무엇이 들어갔고(포함) 무엇이 빠지는지
 * (제외)" 를 한 카드에 정리한다. 40~60대 사용자가 발송 전에 조건을 눈으로 확인하는
 * 용도 — 포함은 기본 톤, 제외는 --danger 톤으로 시각 구분한다.
 *
 * 표시 규칙:
 *  - 설정 안 한 조건은 "전체"/"없음" 으로 명시 (빈칸으로 두지 않음).
 *  - 학교가 많으면(임계값 초과) 앞 몇 개 + "외 N개" 로 줄여 칩-wall 방지.
 *  - custom(고정 명단)은 조건이 없으므로 담긴 명단 수만 간단히 보여준다.
 */
function SelectionSummary({
  isCustom,
  customCount,
  grades,
  schools,
  unmappedSchool,
  mappedSchool,
  statuses,
  regions,
  subjects,
  excludeSchools,
  excludeClasses,
}: {
  isCustom: boolean;
  customCount: number;
  grades: Grade[];
  schools: string[];
  unmappedSchool: boolean;
  mappedSchool: boolean;
  statuses: StudentStatus[];
  regions: string[];
  subjects: string[];
  excludeSchools: string[];
  excludeClasses: ClassOption[];
}) {
  if (isCustom) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-2">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
          선택 요약
        </h2>
        <p className="text-[14px] text-[color:var(--text)]">
          직접 담은 명단{" "}
          <strong className="tabular-nums">
            {customCount.toLocaleString()}명
          </strong>
        </p>
        <p className="text-[12px] text-[color:var(--text-dim)] leading-relaxed">
          고정 명단 그룹이라 조건 필터는 적용되지 않습니다.
        </p>
      </div>
    );
  }

  // 학교 요약 — 등록/미등록 토글이 켜져 있으면 그쪽 시맨틱을 우선 표기.
  const schoolNote = mappedSchool
    ? "학교 등록 학생만"
    : unmappedSchool
      ? "학교 미등록 학생만"
      : null;

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-4">
      <h2 className="text-[13px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
        선택 요약
      </h2>

      {/* 포함 조건 */}
      <dl className="space-y-3">
        <SummaryRow label="학년">
          {grades.length === 0 ? (
            <SummaryMuted>전 학년</SummaryMuted>
          ) : (
            <SummaryChips items={grades} />
          )}
        </SummaryRow>

        <SummaryRow label="학교">
          {schools.length === 0 ? (
            <SummaryMuted>{schoolNote ?? "전 학교"}</SummaryMuted>
          ) : (
            <span className="text-[13px] text-[color:var(--text)]">
              {summarizeList(schools)}
            </span>
          )}
          {schoolNote && schools.length > 0 && (
            <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">
              {schoolNote}
            </p>
          )}
        </SummaryRow>

        <SummaryRow label="재원 상태">
          {statuses.length === 0 ? (
            <SummaryMuted>재원생 (기본)</SummaryMuted>
          ) : (
            <SummaryChips items={statuses} />
          )}
        </SummaryRow>

        <SummaryRow label="지역">
          {regions.length === 0 ? (
            <SummaryMuted>전 지역</SummaryMuted>
          ) : (
            <SummaryChips items={regions} />
          )}
        </SummaryRow>

        <SummaryRow label="과목">
          {subjects.length === 0 ? (
            <SummaryMuted>전 과목</SummaryMuted>
          ) : (
            <SummaryChips items={subjects} />
          )}
        </SummaryRow>
      </dl>

      {/* 제외 조건 — --danger 톤으로 포함과 시각 구분 */}
      <div className="pt-3 border-t border-[color:var(--border)]">
        <p className="flex items-center gap-1 text-[12px] font-medium uppercase tracking-wide text-[color:var(--danger)]">
          <MinusCircle className="size-3.5" strokeWidth={2} aria-hidden />
          제외
        </p>
        <dl className="mt-3 space-y-3">
          <SummaryRow label="제외 학교" danger>
            {excludeSchools.length === 0 ? (
              <SummaryMuted>없음</SummaryMuted>
            ) : (
              <span className="text-[13px] text-[color:var(--danger)]">
                {summarizeList(excludeSchools)}
              </span>
            )}
          </SummaryRow>

          <SummaryRow label="제외 강좌" danger>
            {excludeClasses.length === 0 ? (
              <SummaryMuted>없음</SummaryMuted>
            ) : (
              <span className="text-[13px] text-[color:var(--danger)]">
                {summarizeList(excludeClasses.map((c) => c.name))}
              </span>
            )}
          </SummaryRow>
        </dl>
      </div>
    </div>
  );
}

/** 요약 한 줄 (라벨 + 값). danger 면 라벨도 빨강 톤. */
function SummaryRow({
  label,
  danger,
  children,
}: {
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <dt
        className={`text-[12px] font-medium ${
          danger
            ? "text-[color:var(--danger)]"
            : "text-[color:var(--text-muted)]"
        }`}
      >
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** "설정 안 함" 값을 위한 회색 텍스트. */
function SummaryMuted({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[13px] text-[color:var(--text-dim)]">{children}</span>
  );
}

/** 소수 항목을 작은 칩으로 나열 (학년·상태·지역·과목용). */
function SummaryChips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => (
        <span
          key={it}
          className="inline-flex items-center h-6 px-2 rounded-full bg-[color:var(--bg-muted)] text-[12px] font-medium text-[color:var(--text)] border border-[color:var(--border)]"
        >
          {it}
        </span>
      ))}
    </div>
  );
}

/**
 * 학교/강좌처럼 수가 많을 수 있는 목록을 "휘문고, 단대부고 외 M개" 로 축약.
 * 임계값(4개) 이하면 전부 나열, 초과면 앞 2개 + "외 N개".
 */
function summarizeList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length <= 4) return items.join(", ");
  const head = items.slice(0, 2).join(", ");
  return `${head} 외 ${items.length - 2}개`;
}
