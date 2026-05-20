/**
 * 강좌 진행 상태 enum — 강좌명 prefix 파싱.
 *
 * Aca2000 의 운영자가 강좌 상태를 강좌명 prefix 로 표시한다:
 *   "(종)" / "종)"  → 종강 (closed)
 *   "(폐)" / "폐)"  → 폐강 (closed — 표시는 동일)
 *   "(현)" / "현)"  → 진행 중 (ongoing)
 *   prefix 없음     → 진행 중 default (ongoing)
 *
 * 날짜(end_date) 기반 판정은 sentinel '2050-01-01' 같은 placeholder 때문에
 * 종강 강좌도 진행 중으로 잡히는 회귀가 있어 폐기 — enum 단일 정책.
 *
 * 단일 출처: 학생 상세의 수강 이력 패널 · 출석 탭 accordion 모두 본 함수 사용.
 */

export type CourseProgressState = "ongoing" | "closed";

const CLOSED_PREFIXES: ReadonlyArray<string> = [
  "(종)",
  "종)",
  "(폐)",
  "폐)",
];

export function parseCourseProgress(
  courseName: string | null | undefined,
): CourseProgressState {
  if (!courseName) return "ongoing";
  const trimmed = courseName.trim();
  for (const p of CLOSED_PREFIXES) {
    if (trimmed.startsWith(p)) return "closed";
  }
  return "ongoing";
}
