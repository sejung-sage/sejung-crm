/**
 * 지역 옵션 SSOT (Single Source of Truth).
 *
 * UI 의 지역 칩·드롭다운·학교 그룹 등 "고정 옵션" 이 필요한 곳의 단일 출처.
 * 학생 명단(/students), 발송 그룹 빌더(/groups/new, /groups/[id]/edit), 학교 ↔ 지역
 * admin(/regions), 학생 학교 필터의 5분류 그룹 등이 모두 여기서 import 한다.
 *
 * 정책:
 *   - 운영자는 /regions admin 페이지에서 student_profiles.region 으로 어떤
 *     텍스트든 자유 입력 가능 (예: "분당구"). DB·zod 검증은 자유 텍스트.
 *     단 UI 칩에 노출되는 것은 본 배열에 정의된 옵션뿐 — 빠르게 토글하려는
 *     자주 쓰는 지역만 칩으로 노출하는 정책.
 *   - 추가 지역(예: "분당구") 이 매핑되어 있어도 학생 필터/그룹 빌더 칩에는
 *     노출되지 않지만, 매핑 자체는 정상 작동 (URL 직접 ?region=분당구 OK).
 *   - 순서: 강남 3구(강남·서초·송파) → 서울 추가 구(용산·동작) → 인천 송도 →
 *     fallback '기타'.
 *
 * 추가/제거 시 영향 받는 위치:
 *   - src/lib/profile/list-filter-options.ts (학생 학교 5분류 그룹의 bucket)
 *   - src/components/students/students-filters.tsx (학생 명단 지역 칩)
 *   - src/components/groups/group-builder.tsx (그룹 빌더 지역 칩)
 *   - src/app/(features)/regions/page.tsx (매핑 admin 드롭다운 기본 옵션)
 * 위 4곳 모두 본 상수를 import 하므로 본 파일만 수정하면 전체 반영.
 */

/** UI 칩에 노출되는 지역 옵션 (fixed list). */
export const REGION_OPTIONS = [
  "강남구",
  "서초구",
  "송파구",
  "용산구",
  "동작구",
  "인천 송도",
  "기타",
] as const;

/** REGION_OPTIONS 의 유니온 타입. */
export type RegionOption = (typeof REGION_OPTIONS)[number];

/**
 * 매핑되지 않은 학교/NULL 학교의 자동 fallback 지역.
 * student_profiles 뷰의 LEFT JOIN COALESCE 결과와 동일.
 */
export const FALLBACK_REGION: RegionOption = "기타";

/**
 * 주어진 문자열이 UI 칩 옵션에 포함되는지 확인.
 * (자유 입력 지역과 fixed 옵션을 구분할 때 사용.)
 */
export function isKnownRegion(v: string): v is RegionOption {
  return (REGION_OPTIONS as readonly string[]).includes(v);
}
