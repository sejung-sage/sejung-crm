"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import type { GroupFilters } from "@/lib/schemas/group";
import type { Grade, StudentStatus, Subject } from "@/types/database";
import type {
  CountRecipientsResult,
  DiffRecipientsResult,
} from "@/lib/groups/count-recipients";
import {
  countRecipientsAction,
  createGroupAction,
  diffRecipientsAction,
  groupBuilderFilterOptionsAction,
  searchStudentsAction,
  updateGroupAction,
} from "@/app/(features)/groups/actions";
import { BRANCHES } from "@/config/branches";
import { REGION_OPTIONS } from "@/config/regions";
import { formatPhone, maskPhone } from "@/lib/phone";
import { BranchBadge } from "@/components/students/branch-badge";
import { useToast } from "@/components/ui/toast";

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

/**
 * 0012 정규화 enum 9종에 맞춘 학년 옵션.
 * - 1차 옵션: 학교급 토글(중/고/전체) + 빈도 높은 9종 중 7종.
 * - 졸업·미정은 expand 영역(체크박스)으로 분리. 대량 발송에서 운영 의도가
 *   강한 만큼 노출을 한 단계 숨겨 오·발송을 줄임.
 */
const GRADE_OPTIONS_HIGH: Grade[] = ["고1", "고2", "고3", "재수"];
const GRADE_OPTIONS_MID: Grade[] = ["중1", "중2", "중3"];
const GRADE_OPTIONS_ELEM: Grade[] = ["초등"];
const GRADE_OPTIONS_HIDDEN: Grade[] = ["졸업", "미정"];
// 학년 칩 — 항상 모든 학교급(초+중+고) 노출. 학교급 세그먼트는 시각 분류 보조용.
const GRADE_OPTIONS_ALL: Grade[] = [
  ...GRADE_OPTIONS_ELEM,
  ...GRADE_OPTIONS_MID,
  ...GRADE_OPTIONS_HIGH,
];
const SUBJECT_OPTIONS: Subject[] = [
  "국어",
  "영어",
  "수학",
  "과탐",
  "사탐",
  "컨설팅",
  "기타",
];

/**
 * 발송 그룹의 재원 상태 옵션 (다중 선택).
 * 학생 명단의 4종 토글과 달리 빈 배열 = default '재원생' 시맨틱 — 수신자
 * 산정 단(count-recipients · apply-filters)에서 빈 배열을 ['재원생']로 대체.
 * 탈퇴는 안전 정책상 어떤 경우에도 자동 제외 → 옵션에서 노출하지 않는다.
 */
const STATUS_OPTIONS: StudentStatus[] = ["재원생", "수강이력자", "수강 x"];

// 지역 칩 옵션은 SSOT(src/config/regions.ts) 의 REGION_OPTIONS 사용 —
// 학생 명단·그룹 빌더·매핑 admin 모두 동일 출처.
const LEVEL_SEGMENTS: ReadonlyArray<{
  value: "전체" | "초" | "중" | "고";
  label: string;
}> = [
  { value: "전체", label: "전체" },
  { value: "고", label: "고등" },
  { value: "중", label: "중등" },
  { value: "초", label: "초등" },
];
const DEBOUNCE_MS = 300;

/**
 * 학교명에서 학교급(고/중/초) 추론.
 *  - 끝 "고" 또는 "여고" / "고등학교" → 고
 *  - 끝 "중" 또는 "여중" → 중
 *  - 끝 "초" 또는 "초등" 포함 → 초
 *  - 그 외 → 기타
 */
function inferSchoolLevel(school: string): "고" | "중" | "초" | "기타" {
  const s = school.trim();
  if (s.endsWith("고") || s.endsWith("여고") || s.includes("고등학교")) return "고";
  if (s.endsWith("초") || s.includes("초등")) return "초";
  if (s.endsWith("중") || s.endsWith("여중")) return "중";
  return "기타";
}

/**
 * 학년 선택값에서 허용 학교급 set 추론.
 *  - 학년 미선택 → null (필터 없음, 모든 학교 노출)
 *  - 고1/고2/고3/재수/졸업/미정 포함 → "고"
 *  - 중1/중2/중3 포함 → "중"
 *  - 초등 포함 → "초"
 *  - 기타 학교급은 항상 함께 노출 (level 추론 실패한 안전망)
 */
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
  // level 추론 실패한 학교는 안전상 항상 포함.
  levels.add("기타");
  return Array.from(levels);
}

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
  const [subjects, setSubjects] = useState<string[]>(initial.filters.subjects);
  // regions 는 5종 고정 칩 — 자유 입력 X. 옛 그룹 데이터엔 필드가 없을 수 있어 ?? [] 가드.
  const [regions, setRegions] = useState<string[]>(
    initial.filters.regions ?? [],
  );
  const [includeStudents, setIncludeStudents] = useState<DirectStudent[]>(
    initial.filters.includeStudents ?? [],
  );
  // 재원 상태 — 다중 선택. 빈 배열 = default 재원생 만 (수신자 산정 단에서 처리).
  // 옛 그룹 JSONB 에 statuses 키 없으면 빈 배열 → 기존 동작 보존.
  const [statuses, setStatuses] = useState<StudentStatus[]>(
    initial.filters.statuses ?? [],
  );
  // 학교 검색어 — 학생 명단 SchoolSearchPanel 과 동일한 패턴.
  // schoolOptions 가 수천개 단위라 더보기/접기 대신 검색+스크롤로 전환.
  const [schoolQuery, setSchoolQuery] = useState("");

  // '졸업·미정' 학년 영역 expand. 초기값은 현재 선택된 grades 에 포함되면 펼침.
  const [showHiddenGrades, setShowHiddenGrades] = useState<boolean>(() =>
    initial.filters.grades.some((g) => GRADE_OPTIONS_HIDDEN.includes(g)),
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

  // 디바운스·요청 취소
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number>(0);

  // 학교/학년/지역 옵션 — branch 와 statuses 에 매칭되는 학생을 가진 것만.
  // 초기값은 prop. branch/statuses 변경 시 server action 으로 재페치 → 좁힘.
  const [dynamicSchoolOptions, setDynamicSchoolOptions] =
    useState<string[]>(schoolOptions);
  // 학교를 지역 그룹으로 묶은 결과. region 칩 토글 시 client 단 좁힘에 사용.
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

  // 선택된 region 으로 좁힌 학교 옵션. region 미선택 시 dynamicSchoolOptions 전체.
  // server 라운드트립 없이 즉시 반영 — schoolGroups 매핑이 이미 client 에 있음.
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

  // 실제 서버로 보낼 filters.
  // excludeStudentIds 는 그룹 상세 화면의 "개별 학생 제거" 액션이 관리 →
  // 빌더 폼에서는 직접 편집 안 함. 수정 모드에선 초기값에 들어있는 제외
  // 목록을 그대로 유지해 저장 시 손실되지 않게 한다.
  const initialExcludeIds = initial.filters.excludeStudentIds ?? [];
  const filters: GroupFilters = useMemo(
    () => ({
      grades,
      schools,
      subjects: subjects.filter((s): s is Subject =>
        SUBJECT_OPTIONS.includes(s as Subject),
      ),
      regions,
      statuses,
      includeStudentIds: includeStudents.map((s) => s.id),
      excludeStudentIds: initialExcludeIds,
    }),
    [grades, schools, subjects, regions, statuses, includeStudents, initialExcludeIds],
  );

  // branch / statuses 변경 시 학교·학년·지역 옵션 재페치 (디바운스).
  // 옵션 좁힘: 그 분원에서 그 status 학생이 다니는 학교/학년/지역만 노출.
  // 다른 필터(grades/schools/regions) 는 자기 자신 좁힘 방지로 미적용.
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
        } else {
          setSubmitError(result.reason);
          showToast("error", `그룹 수정 실패: ${result.reason}`);
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
          학년·학교·지역·과목 조건으로 수신자를 지정합니다. 수신거부·탈퇴 학생은 자동 제외됩니다.
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
                        setBranch(b);
                      }}
                    />
                  );
                })}
              </div>
            </Field>
          </section>

          {/* 필터 */}
          <section className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-5">
            <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
              수신자 조건
            </h2>

            <Field
              label="학년"
              hint={grades.length === 0 ? "선택 안 함 = 전 학년" : undefined}
            >
              <div className="space-y-2.5">
                {/* 학년 칩 — 분원 매칭 학생 있는 학년만 (availableGrades) ∩ 7종.
                    현재 선택된 grade 는 매칭 없어도 유지 (해제 가능). */}
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
                      onClick={() =>
                        toggleFromList(grades, g, (next) => setGrades(next))
                      }
                    />
                  ))}
                </div>

                {/* 졸업·미정 expand — dynamicGrades 에 졸업/미정 있을 때만 노출 */}
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
                              toggleFromList(grades, g, (next) =>
                                setGrades(next),
                              )
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
              <GroupSchoolSearchPanel
                schoolOptions={visibleSchoolOptions}
                selected={schools}
                grades={grades}
                query={schoolQuery}
                onQueryChange={setSchoolQuery}
                onToggle={(s) =>
                  toggleFromList(schools, s, (next) => setSchools(next))
                }
              />
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
                    onClick={() =>
                      toggleFromList(statuses, s, (next) => setStatuses(next))
                    }
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
                    onClick={() =>
                      toggleFromList(regions, r, (next) => setRegions(next))
                    }
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
                    onClick={() =>
                      toggleFromList(subjects, s, (next) =>
                        setSubjects(next),
                      )
                    }
                  />
                ))}
              </div>
            </Field>

            <Field
              label="학생 직접 선택"
              hint={
                includeStudents.length > 0
                  ? "선택된 학생만 수신자가 됩니다 (위 조건 무시)"
                  : "이름·학부모번호로 검색해 학생을 콕 찍어 추가할 수 있습니다"
              }
            >
              <DirectStudentPicker
                branch={branch}
                selected={includeStudents}
                canRevealPhone={canRevealPhone}
                onAdd={(s) =>
                  setIncludeStudents((prev) =>
                    prev.find((x) => x.id === s.id) ? prev : [...prev, s],
                  )
                }
                onRemove={(id) =>
                  setIncludeStudents((prev) => prev.filter((x) => x.id !== id))
                }
              />
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
          <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-4">
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
            : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
        }
      `}
    >
      {label}
    </button>
  );
}

/**
 * 발송 그룹 학교 검색·선택 패널.
 *
 * 학생 명단의 SchoolSearchPanel 과 유사하지만 그룹 빌더는 schoolOptions
 * 를 단일 string[] 로 받기 때문에 (지역 그룹 정보 없음) 평면 리스트로 렌더.
 *
 * 검색어 부분일치 + 스크롤 컨테이너 + 선택된 학교 카운트.
 * 선택된 학교가 schoolOptions 에 없어도 항상 보이도록 머지 후 렌더.
 */
function GroupSchoolSearchPanel({
  schoolOptions,
  selected,
  grades,
  query,
  onQueryChange,
  onToggle,
}: {
  schoolOptions: string[];
  selected: string[];
  grades: Grade[];
  query: string;
  onQueryChange: (q: string) => void;
  onToggle: (s: string) => void;
}) {
  const normalized = query.trim().toLowerCase();
  // 선택된 학교는 옵션에 없어도 칩으로 보여줘야 함 — 머지.
  const merged = (() => {
    const set = new Set(schoolOptions);
    for (const s of selected) set.add(s);
    return Array.from(set);
  })();
  // 학년 선택에 맞춰 학교 후보 좁히기 — 고/중/초 학교명 끝글자로 추론.
  // 선택된 학교는 학년과 무관히 항상 노출 (탈선 방지).
  const allowedLevels = gradesToSchoolLevels(grades);
  const levelFiltered =
    allowedLevels === null
      ? merged
      : merged.filter(
          (s) =>
            selected.includes(s) ||
            allowedLevels.includes(inferSchoolLevel(s)),
        );
  const filtered =
    normalized.length === 0
      ? levelFiltered
      : levelFiltered.filter((s) => s.toLowerCase().includes(normalized));

  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">학교 검색</span>
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="학교명 검색 (예: 휘문, 단대부)"
          className="
            w-full h-10 rounded-lg pl-9 pr-9
            bg-bg-card border border-[color:var(--border)]
            text-[14px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
          "
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="검색어 지우기"
            className="
              absolute right-2 top-1/2 -translate-y-1/2
              inline-flex items-center justify-center size-6 rounded-md
              text-[color:var(--text-muted)] hover:text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
            "
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </label>

      <p className="text-[12px] text-[color:var(--text-muted)]">
        {normalized.length > 0
          ? `검색 결과 ${filtered.length.toLocaleString()}개`
          : `총 ${merged.length.toLocaleString()}개 학교`}
        {selected.length > 0 && (
          <>
            <span className="mx-1.5 text-[color:var(--text-dim)]">·</span>
            <span>선택 {selected.length}개</span>
          </>
        )}
      </p>

      <div className="max-h-[360px] overflow-y-auto pr-1 rounded-lg bg-[color:var(--bg-muted)] p-3">
        {filtered.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-muted)] py-2 text-center">
            {normalized.length > 0
              ? `"${query.trim()}" 와(과) 일치하는 학교가 없습니다.`
              : "표시할 학교가 없습니다."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {filtered.map((s) => (
              <Chip
                key={s}
                label={s}
                active={selected.includes(s)}
                onClick={() => onToggle(s)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 학생 직접 선택 컴포넌트.
 * 검색어 (>=2자) → searchStudentsAction → 결과 리스트.
 * 선택된 학생은 칩으로 표시, X 버튼으로 제거.
 */
function DirectStudentPicker({
  branch,
  selected,
  onAdd,
  onRemove,
  canRevealPhone,
}: {
  branch: string;
  selected: DirectStudent[];
  onAdd: (s: DirectStudent) => void;
  onRemove: (id: string) => void;
  canRevealPhone: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DirectStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!branch || query.trim().length < 2) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const myReq = ++reqIdRef.current;
    debRef.current = setTimeout(async () => {
      const r = await searchStudentsAction(query, branch);
      if (myReq !== reqIdRef.current) return;
      if (r.status === "success") {
        setHits(
          r.data.map((d) => ({
            id: d.id,
            name: d.name,
            parent_phone: d.parent_phone,
            school: d.school,
            grade: d.grade,
          })),
        );
      } else {
        setError(r.reason);
        setHits([]);
      }
      setLoading(false);
    }, 250);
    return () => {
      if (debRef.current) clearTimeout(debRef.current);
    };
  }, [query, branch]);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          branch
            ? "이름 또는 학부모 연락처 일부 (2자 이상)"
            : "분원을 먼저 선택해주세요"
        }
        disabled={!branch}
        className="block w-full min-h-[40px] rounded-md border border-[color:var(--border)] bg-bg-card px-3 text-[14px] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-[color:var(--action)] disabled:bg-[color:var(--bg-muted)]"
      />

      {error && (
        <div className="text-[12px] text-[color:var(--danger)]" role="alert">
          {error}
        </div>
      )}

      {query.trim().length >= 2 && (
        <div className="rounded-md border border-[color:var(--border)] bg-bg-card max-h-60 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
              검색 중...
            </div>
          )}
          {!loading && hits.length === 0 && !error && (
            <div className="px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
              일치하는 학생이 없습니다
            </div>
          )}
          {!loading &&
            hits.map((h) => {
              const already = selectedIds.has(h.id);
              return (
                <button
                  type="button"
                  key={h.id}
                  disabled={already}
                  onClick={() => {
                    onAdd(h);
                    setQuery("");
                    setHits([]);
                  }}
                  className="block w-full text-left px-3 py-2 text-[14px] hover:bg-[color:var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[color:var(--text)]">
                      {h.name}
                    </span>
                    <span className="text-[12px] text-[color:var(--text-muted)]">
                      {h.school ?? "—"} · {h.grade ?? "—"} ·{" "}
                      {h.parent_phone
                        ? canRevealPhone
                          ? formatPhone(h.parent_phone) || h.parent_phone
                          : maskPhone(h.parent_phone)
                        : "연락처 없음"}
                    </span>
                    {already && (
                      <span className="ml-auto text-[12px] text-[color:var(--text-muted)]">
                        이미 추가됨
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selected.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full bg-[color:var(--bg-muted)] text-[13px] text-[color:var(--text)] border border-[color:var(--border)]"
            >
              {s.name}
              <span className="text-[11px] text-[color:var(--text-muted)]">
                ({s.parent_phone
                  ? canRevealPhone
                    ? formatPhone(s.parent_phone) || s.parent_phone
                    : maskPhone(s.parent_phone)
                  : "—"})
              </span>
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                aria-label={`${s.name} 제거`}
                className="ml-1 size-5 inline-flex items-center justify-center rounded-full hover:bg-[color:var(--bg-hover)] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
