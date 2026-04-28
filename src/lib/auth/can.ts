/**
 * F4 · 권한 판별 헬퍼
 *
 * 리소스×액션×분원 매트릭스 기반.
 *
 * 정책 매트릭스 (PRD 섹션 "계정 권한 정책"):
 *   master  : 모든 리소스×모든 액션 허용. branch 인자 무시.
 *   admin   : 본인 분원 한정 모든 리소스×모든 액션. (branch 인자 == user.branch 일 때만 true)
 *   manager : 본인 분원 한정 read · send 만. write/delete/import/account 불가.
 *   viewer  : 본인 분원 한정 read 만. 그 외 전부 불가. account 불가.
 *   null / active=false → false (예외 없이 거부)
 *
 * 구현 방식:
 *   - 한눈에 보이는 롤별 테이블로 두 단계 검사: "허용 액션 집합" + "account 예외".
 *   - 벤더 어댑터처럼 외부로 나가는 물건이 아니라 내부 로직이므로
 *     switch 대신 표(plain object) 로 두어 확장·감사가 쉬움.
 *
 * 서버 측 권한 가드의 **1차** 레이어. DB RLS 가 2차로 최종 방어.
 * (UI 는 표시/숨김 용도로만 사용, 보안 신뢰 X)
 */

import type { CurrentUser, UserRole } from "@/types/database";

export type Resource =
  | "student"
  | "group"
  | "template"
  | "campaign"
  | "account"
  | "import";

export type Action = "read" | "write" | "delete" | "send";

// 역할별 허용 (리소스, 액션) 집합.
// "account" 는 account 허용 역할에 한해 별도 테이블에서 관리하지만,
// 아래 테이블이 이미 리소스 키를 포함하므로 account 를 여기에 담으면 충분.
type RoleMatrix = Record<UserRole, Partial<Record<Resource, Set<Action>>>>;

const ALL: Action[] = ["read", "write", "delete", "send"];
const READ_ONLY: Action[] = ["read"];

const MATRIX: RoleMatrix = {
  master: {
    student: new Set(ALL),
    group: new Set(ALL),
    template: new Set(ALL),
    campaign: new Set(ALL),
    account: new Set(ALL),
    import: new Set(ALL),
  },
  admin: {
    student: new Set(ALL),
    group: new Set(ALL),
    template: new Set(ALL),
    campaign: new Set(ALL),
    account: new Set(ALL),
    import: new Set(ALL),
  },
  manager: {
    student: new Set(READ_ONLY),
    group: new Set(READ_ONLY),
    template: new Set(READ_ONLY),
    // manager 는 발송 트리거(send) 만 추가 허용, write/delete 불가
    campaign: new Set<Action>(["read", "send"]),
    // account/import 는 정의하지 않음 → false
  },
  viewer: {
    student: new Set(READ_ONLY),
    group: new Set(READ_ONLY),
    template: new Set(READ_ONLY),
    campaign: new Set(READ_ONLY),
    // account/import 없음
  },
};

/**
 * 권한 판별.
 *
 * @param user 현재 사용자 (null 이면 항상 false)
 * @param action 수행하려는 액션
 * @param resource 대상 리소스
 * @param branch 대상 분원. admin/manager/viewer 에겐 본인 분원과 일치해야 한다.
 *               undefined 면 "분원 무관" 액션으로 간주(= 본인 분원 검사 생략).
 *               master 는 항상 branch 무시.
 */
export function can(
  user: CurrentUser | null,
  action: Action,
  resource: Resource,
  branch?: string,
): boolean {
  if (!user) return false;
  if (!user.active) return false;

  const allowed = MATRIX[user.role]?.[resource];
  if (!allowed || !allowed.has(action)) {
    return false;
  }

  // master 는 branch 제약 없음
  if (user.role === "master") {
    return true;
  }

  // branch 인자가 명시되었으면 본인 분원과 일치해야 함
  if (branch !== undefined && branch !== user.branch) {
    return false;
  }

  return true;
}

/**
 * 역할만으로 판단하는 보조 헬퍼.
 * 예: UI 에서 "이 역할은 계정 관리 가능?" 을 알고 싶을 때.
 * branch 교차 검사는 필요한 곳에서 별도로.
 */
export function roleAllows(
  role: UserRole | undefined,
  action: Action,
  resource: Resource,
): boolean {
  if (!role) return false;
  const allowed = MATRIX[role]?.[resource];
  return !!allowed && allowed.has(action);
}
