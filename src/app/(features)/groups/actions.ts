"use server";

/**
 * 발송 그룹 관련 잔여 Server Actions.
 *
 * 발송 그룹 UI(목록/생성/수정/상세)는 제거되고 진입점이 /compose(인라인 필터)로
 * 통합됐다(2026-06). 그룹 CRUD 액션도 함께 제거됐으나, 공용 필터 칩 패널
 * (`FilterChipPanel`)이 사용하는 조회 전용 액션 두 개만 여기 남는다.
 * /compose · /seminars/compose 의 필터 칩이 분원/상태 변경에 맞춰 옵션을 좁히는 데 쓴다.
 *
 *   - groupBuilderFilterOptionsAction : 학교/학년/지역 칩 옵션을 statuses·분원에 맞춰 좁힘
 *   - listClassOptionsAction          : "강좌별 제외" 드롭다운 옵션을 분원 변경 시 재페치
 *
 * 둘 다 조회 전용 — 쓰기 권한 가드 없음.
 */

import {
  listStudentFilterOptions,
  type StudentFilterOptions,
} from "@/lib/profile/list-filter-options";
import {
  listClassOptions,
  type ClassOption,
} from "@/lib/classes/list-class-options";
import type { StudentStatus } from "@/types/database";

// ─── groupBuilderFilterOptionsAction ──────────────────────
// 필터 칩의 학교/학년/지역 옵션을 statuses 등 다른 칩 토글에 맞춰 좁힘.
// listStudentFilterOptions 의 client 노출 래퍼 — RLS 통과 위해 server.

export type GroupBuilderFilterOptionsResult =
  | { status: "success"; data: StudentFilterOptions }
  | { status: "failed"; reason: string };

export async function groupBuilderFilterOptionsAction(
  branch: unknown,
  statuses: unknown,
): Promise<GroupBuilderFilterOptionsResult> {
  if (typeof branch !== "string") {
    return { status: "failed", reason: "분원 값이 올바르지 않습니다" };
  }
  const allowedStatuses: StudentStatus[] = ["재원생", "수강이력자", "수강 x"];
  const cleanStatuses = Array.isArray(statuses)
    ? statuses.filter((s): s is StudentStatus =>
        typeof s === "string" &&
        (allowedStatuses as ReadonlyArray<string>).includes(s),
      )
    : [];

  try {
    const data = await listStudentFilterOptions({
      branch: branch || undefined,
      statuses: cleanStatuses,
      // 졸업·미정 학생도 발송 대상 가능.
      includeHidden: true,
    });
    return { status: "success", data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "필터 옵션 조회 실패";
    return { status: "failed", reason: msg };
  }
}

// ─── listClassOptionsAction ───────────────────────────────
// 필터 칩의 "강좌별 제외" 드롭다운 옵션을 분원 변경 시 재페치.
// 초기값은 페이지가 prop 으로 내려주고, master 가 분원 칩을 바꾸면 이 액션으로
// 새 분원의 강좌 목록을 다시 가져온다. 조회 전용 — 권한 가드 없음.

export type ListClassOptionsResult =
  | { status: "success"; data: ClassOption[] }
  | { status: "failed"; reason: string };

export async function listClassOptionsAction(
  branch: unknown,
): Promise<ListClassOptionsResult> {
  if (typeof branch !== "string" || branch.trim().length === 0) {
    return { status: "failed", reason: "분원은 필수입니다" };
  }
  try {
    const data = await listClassOptions(branch.trim());
    return { status: "success", data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "강좌 목록 조회 실패";
    return { status: "failed", reason: msg };
  }
}
