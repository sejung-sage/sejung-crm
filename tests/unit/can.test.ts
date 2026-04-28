import { describe, it, expect } from "vitest";
import { can, type Resource, type Action } from "@/lib/auth/can";
import type { CurrentUser } from "@/types/database";

/**
 * F4 · 권한 매트릭스 회귀 테스트.
 *
 * 정책 (src/lib/auth/can.ts):
 *   master  : 전 분원 · 모든 리소스 · 모든 액션
 *   admin   : 본인 분원 한정 모든 리소스 모든 액션 (account 포함)
 *   manager : 본인 분원 한정 student/group/template read + campaign read|send.
 *             write/delete/account/import 모두 불가.
 *   viewer  : 본인 분원 한정 student/group/template/campaign read.
 *             그 외 모두 불가.
 *
 * branch 인자가 undefined 면 admin/manager/viewer 도 통과(분원 무관 호출).
 * branch 가 제공되면 본인 분원과 정확히 일치해야 통과.
 */

const ALL_RESOURCES: Resource[] = [
  "student",
  "group",
  "template",
  "campaign",
  "account",
  "import",
];
const ALL_ACTIONS: Action[] = ["read", "write", "delete", "send"];

function makeUser(partial: Partial<CurrentUser>): CurrentUser {
  return {
    user_id: "u-1",
    email: "u@example.com",
    name: "테스트",
    role: "viewer",
    branch: "대치",
    active: true,
    must_change_password: false,
    ...partial,
  };
}

describe("can() · null / 비활성 사용자", () => {
  it("null 사용자 → 모든 (resource, action) 조합에서 false", () => {
    for (const r of ALL_RESOURCES) {
      for (const a of ALL_ACTIONS) {
        expect(can(null, a, r)).toBe(false);
        expect(can(null, a, r, "대치")).toBe(false);
      }
    }
  });

  it("active=false 사용자 → 모든 조합에서 false (master 라도)", () => {
    const inactiveMaster = makeUser({ role: "master", active: false });
    for (const r of ALL_RESOURCES) {
      for (const a of ALL_ACTIONS) {
        expect(can(inactiveMaster, a, r)).toBe(false);
        expect(can(inactiveMaster, a, r, "대치")).toBe(false);
      }
    }
  });
});

describe("can() · master", () => {
  const master = makeUser({ role: "master", branch: "대치" });

  it("모든 리소스 × 모든 액션 → true", () => {
    for (const r of ALL_RESOURCES) {
      for (const a of ALL_ACTIONS) {
        expect(can(master, a, r)).toBe(true);
      }
    }
  });

  it("branch 인자 무시: 다른 분원이어도 true", () => {
    expect(can(master, "write", "account", "송도")).toBe(true);
    expect(can(master, "delete", "student", "분당")).toBe(true);
    expect(can(master, "send", "campaign", "어디든")).toBe(true);
  });
});

describe("can() · admin (대치)", () => {
  const admin = makeUser({ role: "admin", branch: "대치" });

  it("본인 분원 모든 리소스 모든 액션 → true", () => {
    for (const r of ALL_RESOURCES) {
      for (const a of ALL_ACTIONS) {
        expect(can(admin, a, r, "대치")).toBe(true);
      }
    }
  });

  it("다른 분원(송도) 인자 시 false", () => {
    for (const r of ALL_RESOURCES) {
      for (const a of ALL_ACTIONS) {
        expect(can(admin, a, r, "송도")).toBe(false);
      }
    }
  });

  it("branch 인자 미제공 시 → 분원 검사 생략(통과)", () => {
    // 구현 정책: branch === undefined → 본인 분원 검사 스킵
    expect(can(admin, "write", "account")).toBe(true);
    expect(can(admin, "send", "campaign")).toBe(true);
  });
});

describe("can() · manager (대치)", () => {
  const manager = makeUser({ role: "manager", branch: "대치" });

  it("student/group/template read → true (본인 분원)", () => {
    expect(can(manager, "read", "student", "대치")).toBe(true);
    expect(can(manager, "read", "group", "대치")).toBe(true);
    expect(can(manager, "read", "template", "대치")).toBe(true);
  });

  it("campaign read → true, send → true (본인 분원)", () => {
    expect(can(manager, "read", "campaign", "대치")).toBe(true);
    expect(can(manager, "send", "campaign", "대치")).toBe(true);
  });

  it("write/delete → false (모든 리소스)", () => {
    for (const r of ALL_RESOURCES) {
      expect(can(manager, "write", r, "대치")).toBe(false);
      expect(can(manager, "delete", r, "대치")).toBe(false);
    }
  });

  it("account / import → 모든 액션 false", () => {
    for (const a of ALL_ACTIONS) {
      expect(can(manager, a, "account", "대치")).toBe(false);
      expect(can(manager, a, "import", "대치")).toBe(false);
    }
  });

  it("다른 분원(송도) 호출 → 모두 false", () => {
    expect(can(manager, "read", "student", "송도")).toBe(false);
    expect(can(manager, "send", "campaign", "송도")).toBe(false);
  });
});

describe("can() · viewer (대치)", () => {
  const viewer = makeUser({ role: "viewer", branch: "대치" });

  it("student/group/template/campaign read → true (본인 분원)", () => {
    expect(can(viewer, "read", "student", "대치")).toBe(true);
    expect(can(viewer, "read", "group", "대치")).toBe(true);
    expect(can(viewer, "read", "template", "대치")).toBe(true);
    expect(can(viewer, "read", "campaign", "대치")).toBe(true);
  });

  it("write / delete / send 모두 false", () => {
    for (const r of ALL_RESOURCES) {
      expect(can(viewer, "write", r, "대치")).toBe(false);
      expect(can(viewer, "delete", r, "대치")).toBe(false);
      expect(can(viewer, "send", r, "대치")).toBe(false);
    }
  });

  it("account / import → 모든 액션 false", () => {
    for (const a of ALL_ACTIONS) {
      expect(can(viewer, a, "account", "대치")).toBe(false);
      expect(can(viewer, a, "import", "대치")).toBe(false);
    }
  });

  it("다른 분원 read → false", () => {
    expect(can(viewer, "read", "student", "송도")).toBe(false);
  });
});
