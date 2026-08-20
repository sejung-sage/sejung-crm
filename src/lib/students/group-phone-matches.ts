/**
 * 번호로 찾은 학생 행들을 "사람" 단위로 접는 순수 함수.
 *
 * 왜 접어야 하나 (프로덕션 실측 2026-08-20):
 *   한 사람이 분원마다 따로 등록돼 각기 다른 aca2000_id 를 갖는 경우가 흔하다.
 *   예: 학부모 번호 하나에 "이지우/세화여고/고2" 가 반포·방배·대치 3행으로 존재.
 *   접지 않으면 수신거부 등록 화면이 "이 번호의 학생 5명" 이라고 띄워
 *   운영자가 화면을 못 믿게 된다(실제로는 형제 2명).
 *
 * 접는 기준: **이름**.
 *   번호 하나로 이미 좁힌 결과라 같은 이름은 같은 사람으로 봐도 안전하다
 *   (형제는 이름이 다르고, 같은 이름의 쌍둥이는 무시 가능).
 *
 * 병합 규칙:
 *   - branch: 전부 모은다(등장 순서 유지). 한 사람이 여러 분원에 있을 수 있다.
 *   - school: 미기입 placeholder('고'·'중학교' 등)나 NULL 은 정보량 0 으로 보고,
 *     더 구체적인 값이 나오면 승격한다.
 *   - grade: NULL/'미정' 이면 구체적인 값으로 승격한다.
 *   - status/matchedAs: 첫 행의 값을 유지한다(대표값).
 */

import { UNMAPPED_SCHOOL_PATTERNS } from "@/lib/schemas/common";

/** 접기 전 원본 행 — crm_students 에서 읽은 그대로. */
export interface PhoneMatchRow {
  id: string;
  name: string | null;
  school: string | null;
  grade: string | null;
  branch: string | null;
  status: string | null;
  parent_phone: string | null;
  phone: string | null;
}

/** 접은 결과 한 사람. */
export interface PhoneMatchStudent {
  id: string;
  name: string | null;
  school: string | null;
  grade: string | null;
  /** 이 학생이 등록된 분원들. 여러 분원에 따로 등록돼 있을 수 있다. */
  branches: string[];
  status: string | null;
  /** 이 번호가 학부모 번호로 걸렸는지, 학생 본인 번호로 걸렸는지. */
  matchedAs: "학부모" | "학생";
}

/** 미기입 placeholder('고'·'중학교' 등)면 정보량 0 으로 취급. */
function isPlaceholderSchool(v: string | null): boolean {
  if (v == null) return true;
  const t = v.trim();
  return t === "" || UNMAPPED_SCHOOL_PATTERNS.includes(t);
}

/**
 * @param rows  crm_students 조회 결과
 * @param digits 조회에 쓴 숫자만 남긴 번호 (학부모/학생 매칭 판정에 사용)
 */
export function groupPhoneMatches(
  rows: PhoneMatchRow[],
  digits: string,
): PhoneMatchStudent[] {
  const byName = new Map<string, PhoneMatchStudent>();

  for (const r of rows) {
    const key = r.name ?? r.id;
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, {
        id: r.id,
        name: r.name,
        school: r.school,
        grade: r.grade,
        branches: r.branch ? [r.branch] : [],
        status: r.status,
        matchedAs: r.parent_phone === digits ? "학부모" : "학생",
      });
      continue;
    }

    if (r.branch && !existing.branches.includes(r.branch)) {
      existing.branches.push(r.branch);
    }
    if (isPlaceholderSchool(existing.school) && !isPlaceholderSchool(r.school)) {
      existing.school = r.school;
    }
    if (
      (existing.grade == null || existing.grade === "미정") &&
      r.grade != null &&
      r.grade !== "미정"
    ) {
      existing.grade = r.grade;
    }
  }

  return [...byName.values()];
}
