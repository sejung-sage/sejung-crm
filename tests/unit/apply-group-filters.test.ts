import { describe, it, expect } from "vitest";
import { applyGroupFiltersDev } from "@/lib/groups/apply-filters";
import { DEV_STUDENT_PROFILES } from "@/lib/profile/students-dev-seed";
import type { GroupFilters } from "@/lib/schemas/group";

/**
 * F2 · applyGroupFiltersDev - 공통 dev 필터 로직 단위 테스트.
 *
 * 시드 기준(중요):
 *   - 대치 DC0001~DC0005 · 송도 SD0001~SD0005
 *   - 탈퇴: SD0004 (한예린)
 *   - 고2 재원 대치: DC0001(휘문고·수학)·DC0002(단대부고·국어)
 *   - 수학 수강: DC0001·DC0003(대치) · SD0001·SD0002(송도)
 *
 * 규칙: branch + status≠탈퇴 + unsub + filters(grades/schools/subjects).
 */

const emptyFilters: GroupFilters = { grades: [], schools: [], subjects: [] };

describe("applyGroupFiltersDev · 분원·자동제외", () => {
  it("branch='대치' 이면 송도 학생 제외", () => {
    const r = applyGroupFiltersDev(DEV_STUDENT_PROFILES, emptyFilters, "대치");
    expect(r.every((p) => p.branch === "대치")).toBe(true);
    // 대치 5명 중 탈퇴 0 → 5명
    expect(r.length).toBe(5);
  });

  it("branch='송도' 이면 대치 학생 제외 + 탈퇴(SD0004) 자동 제외", () => {
    const r = applyGroupFiltersDev(DEV_STUDENT_PROFILES, emptyFilters, "송도");
    expect(r.every((p) => p.branch === "송도")).toBe(true);
    // 송도 5명 중 탈퇴 1(SD0004) → 4명
    expect(r.length).toBe(4);
    expect(r.find((p) => p.id === "dev-SD0004")).toBeUndefined();
  });

  it("status='탈퇴' 학생(SD0004)은 어떤 조건에서도 포함되지 않는다", () => {
    const withTrack = { ...emptyFilters };
    const r = applyGroupFiltersDev(DEV_STUDENT_PROFILES, withTrack, "송도");
    expect(r.find((p) => p.status === "탈퇴")).toBeUndefined();
  });

  it("수신거부 phone Set 에 포함된 학부모는 강제 제외", () => {
    // DC0001(김민준)의 학부모 번호를 수신거부 처리
    const unsub = new Set<string>(["01090010001"]);
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      emptyFilters,
      "대치",
      { unsubscribedPhones: unsub },
    );
    expect(r.find((p) => p.id === "dev-DC0001")).toBeUndefined();
    expect(r.length).toBe(4); // 대치 5명 - 수신거부 1명
  });

  it("빈 branch 이면 분원 필터 미적용(탈퇴·수신거부만 제외)", () => {
    const r = applyGroupFiltersDev(DEV_STUDENT_PROFILES, emptyFilters, "");
    // 10명 - 탈퇴 1명 = 9명
    expect(r.length).toBe(9);
  });
});

describe("applyGroupFiltersDev · grades 필터", () => {
  it("grades=[2] · 대치 고2만 · DC0001·DC0002 두 명", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, grades: [2] },
      "대치",
    );
    expect(r.length).toBe(2);
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0002"]);
  });

  it("grades=[1,3] · 대치 고1+고3만", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, grades: [1, 3] },
      "대치",
    );
    expect(r.every((p) => p.grade === 1 || p.grade === 3)).toBe(true);
    // DC0003(고3)·DC0004(고1)·DC0005(고3) = 3명
    expect(r.length).toBe(3);
  });
});

describe("applyGroupFiltersDev · schools 필터", () => {
  it("schools=['휘문고'] · 대치에서 휘문고만(DC0001·DC0003)", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, schools: ["휘문고"] },
      "대치",
    );
    expect(r.length).toBe(2);
    expect(r.every((p) => p.school === "휘문고")).toBe(true);
  });

  it("존재하지 않는 학교 → 빈 결과", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, schools: ["없는학교"] },
      "대치",
    );
    expect(r.length).toBe(0);
  });
});

describe("applyGroupFiltersDev · subjects 필터(DEV_ENROLLMENTS 기반)", () => {
  it("subjects=['수학'] · 수강 중인 학생만 포함", () => {
    // 전체 분원에서 수학 수강: DC0001, DC0003(대치), SD0001, SD0002(송도)
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, subjects: ["수학"] },
      "",
    );
    const ids = r.map((p) => p.id).sort();
    expect(ids).toContain("dev-DC0001");
    expect(ids).toContain("dev-DC0003");
    expect(ids).toContain("dev-SD0001");
    expect(ids).toContain("dev-SD0002");
    // 수학 안 듣는 학생은 제외
    expect(ids).not.toContain("dev-DC0002"); // 국어만
    expect(ids).not.toContain("dev-DC0004"); // 수강 없음
  });

  it("subjects=['국어'] · 대치 분원에서 국어 수강자만", () => {
    // DC0002(국어). DC0005 는 수강이력자 이나 과거 국어 수강 등록 있음.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, subjects: ["국어"] },
      "대치",
    );
    const ids = r.map((p) => p.id).sort();
    expect(ids).toContain("dev-DC0002");
    expect(ids).toContain("dev-DC0005");
    expect(ids).not.toContain("dev-DC0001"); // 수학만
  });

  it("subjects=['탐구'] · 강도윤(SD0001)만 해당", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, subjects: ["탐구"] },
      "",
    );
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("dev-SD0001");
  });
});

describe("applyGroupFiltersDev · 복합 필터", () => {
  it("grades=[2] + schools=['휘문고'] + subjects=['수학'] · DC0001 1명만", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { grades: [2], schools: ["휘문고"], subjects: ["수학"] },
      "대치",
    );
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("dev-DC0001");
  });

  it("grades=[2] + schools=['중동고'] · 대치 중동고 고2 없음 → 0명", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { grades: [2], schools: ["중동고"], subjects: [] },
      "대치",
    );
    expect(r.length).toBe(0);
  });

  it("빈 필터(모두 빈 배열)는 분원·탈퇴·수신거부만 적용 → 대치 5명", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { grades: [], schools: [], subjects: [] },
      "대치",
    );
    expect(r.length).toBe(5);
  });
});
