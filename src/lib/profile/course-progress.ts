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

/**
 * 설명회 강좌 판정.
 *
 * 설명회는 수업이 아니라 일회성 행사라 "진행 중"으로 보면 안 된다(운영 정책).
 * 그런데 설명회 강좌는 (종) prefix 가 없고 end_date 가 sentinel('2050-01-01')
 * 인 경우가 많아 prefix·날짜 어느 로직으로도 "진행 중"으로 잡힌다 →
 * 별도 판정해서 진행 중에서 제외한다.
 *
 * crm_classes.subject 가 '설명회'면 신뢰(운영 raw 100% 일치). enrollments.subject
 * 는 항상 NULL 이라 강좌명에 '설명회' 포함도 보조 신호로 함께 본다.
 */
export function isSeminarCourse(
  subject: string | null | undefined,
  courseName?: string | null | undefined,
): boolean {
  if (subject === "설명회") return true;
  if (courseName && courseName.includes("설명회")) return true;
  return false;
}

/**
 * 강좌(수강 행/출석 그룹)의 "진행 중" 여부 — 단일 정의(교집합):
 *   설명회 아님  AND  종강·폐강 접두 아님  AND  (end_date 없음 OR end_date >= 오늘).
 *
 * DB 의 `public.crm_class_is_ongoing(name, subject)` + end_date 조건과 동일 규칙.
 * 접두만 보면 운영자가 종강 표시를 깜빡한 과거 강좌가 진행 중으로 남고(2026-06-30
 * 신동아 [1-기말] 케이스), 날짜만 보면 sentinel('2050-01-01') 강좌가 영원히 진행
 * 중으로 잡힌다 → 둘을 모두 만족해야 진행 중. sentinel 은 미래라 날짜 조건 통과.
 *
 * 날짜 비교는 뷰의 CURRENT_DATE(UTC) 와 맞추려 ISO(UTC) 'YYYY-MM-DD' 문자열 비교.
 */
export function isCourseOngoing(args: {
  courseName: string | null | undefined;
  subject: string | null | undefined;
  endDate: string | null | undefined;
}): boolean {
  if (isSeminarCourse(args.subject, args.courseName)) return false;
  if (parseCourseProgress(args.courseName) !== "ongoing") return false;
  if (args.endDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (args.endDate.slice(0, 10) < today) return false;
  }
  return true;
}
