import { describe, it, expect } from "vitest";
import { applyGroupFiltersDev } from "@/lib/groups/apply-filters";
import { DEV_STUDENT_PROFILES } from "@/lib/profile/students-dev-seed";
import type { GroupFilters } from "@/lib/schemas/group";

/**
 * F2 · applyGroupFiltersDev - 공통 dev 필터 로직 단위 테스트.
 *
 * 시드 기준(0012 정규화 모델 검증용 시드 추가됨):
 *   - 대치 DC0001~DC0008 (8명) · 송도 SD0001~SD0005 (5명) · 합계 13명
 *   - 탈퇴: SD0004 (한예린)
 *   - 고2 재원 대치: DC0001(휘문고·수학)·DC0002(단대부고·국어)
 *   - 수학 수강: DC0001·DC0003(대치) · SD0001·SD0002(송도)
 *   - 신규 추가:
 *       DC0006 한지민 (대치·중2·재원생·대왕중)
 *       DC0007 송재호 (대치·졸업·수강이력자·휘문고)
 *       DC0008 임가람 (대치·미정·수강 x·school NULL)
 *
 * 규칙: branch + status≠탈퇴 + unsub + filters(grades/schools/subjects).
 * (default-hide 졸업·미정 은 list-students 계층에서 처리. 그룹 발송에선 적용 안 됨.)
 */

// emptyFilters 의 의도는 "조건 없음 → 모든 status (탈퇴 제외) 통과". statuses default 가
// 빈 배열 → ['재원생'] 1종으로 좁혀지므로, 옛 시맨틱을 보존하려면 3종 풀로 명시.
const emptyFilters: GroupFilters = { grades: [], schools: [], subjects: [], regions: [], statuses: ["재원생", "수강이력자", "수강 x"], includeStudentIds: [], excludeStudentIds: [], excludeSchools: [], excludeClassIds: [], unmappedSchool: false, mappedSchool: false };

describe("applyGroupFiltersDev · 분원·자동제외", () => {
  it("branch='대치' 이면 송도 학생 제외", () => {
    const r = applyGroupFiltersDev(DEV_STUDENT_PROFILES, emptyFilters, "대치");
    expect(r.every((p) => p.branch === "대치")).toBe(true);
    // 대치 8명 중 탈퇴 0 → 8명 (default-hide 는 그룹 발송에 미적용)
    expect(r.length).toBe(8);
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
    expect(r.length).toBe(7); // 대치 8명 - 수신거부 1명
  });

  it("빈 branch 이면 분원 필터 미적용(탈퇴·수신거부만 제외)", () => {
    const r = applyGroupFiltersDev(DEV_STUDENT_PROFILES, emptyFilters, "");
    // 13명 - 탈퇴 1명(SD0004) = 12명
    expect(r.length).toBe(12);
  });
});

describe("applyGroupFiltersDev · grades 필터", () => {
  it("grades=[2] · 대치 고2만 · DC0001·DC0002 두 명", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, grades: ["고2"] },
      "대치",
    );
    expect(r.length).toBe(2);
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0002"]);
  });

  it("grades=[1,3] · 대치 고1+고3만", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, grades: ["고1", "고3"] },
      "대치",
    );
    expect(r.every((p) => p.grade === "고1" || p.grade === "고3")).toBe(true);
    // DC0003(고3)·DC0004(고1)·DC0005(고3) = 3명
    expect(r.length).toBe(3);
  });
});

describe("applyGroupFiltersDev · schools 필터", () => {
  it("schools=['휘문고'] · 대치에서 휘문고만(DC0001·DC0003·DC0007)", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, schools: ["휘문고"] },
      "대치",
    );
    // DC0001(고2), DC0003(고3), DC0007(졸업, 수강이력자) 모두 휘문고.
    expect(r.length).toBe(3);
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

  it("subjects=['과탐'] · 강도윤(SD0001)만 해당", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, subjects: ["과탐"] },
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
      { grades: ["고2"], schools: ["휘문고"], subjects: ["수학"], regions: [], statuses: [], includeStudentIds: [], excludeStudentIds: [], excludeSchools: [], excludeClassIds: [], unmappedSchool: false, mappedSchool: false },
      "대치",
    );
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("dev-DC0001");
  });

  it("grades=[2] + schools=['중동고'] · 대치 중동고 고2 없음 → 0명", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { grades: ["고2"], schools: ["중동고"], subjects: [], regions: [], statuses: [], includeStudentIds: [], excludeStudentIds: [], excludeSchools: [], excludeClassIds: [], unmappedSchool: false, mappedSchool: false },
      "대치",
    );
    expect(r.length).toBe(0);
  });

  it("빈 statuses 는 default '탈퇴 빼고 전체' (3종) → 대치 8명", () => {
    // 옛 그룹 JSONB 호환을 위해 빈 statuses 의 시맨틱을 "조건 없음 = 전체" 로 복원.
    // 재원생/수강이력자/수강 x 모두 매칭. 탈퇴는 안전 정책상 항상 차단.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { grades: [], schools: [], subjects: [], regions: [], statuses: [], includeStudentIds: [], excludeStudentIds: [], excludeSchools: [], excludeClassIds: [], unmappedSchool: false, mappedSchool: false },
      "대치",
    );
    expect(r.length).toBe(8);
    expect(r.every((p) => p.status !== "탈퇴")).toBe(true);
  });

  it("statuses 풀 명시(3종) → 옛 빈필터 시맨틱과 동일하게 대치 8명", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        grades: [],
        schools: [],
        subjects: [],
        regions: [],
        statuses: ["재원생", "수강이력자", "수강 x"],
        includeStudentIds: [],
        excludeStudentIds: [], excludeSchools: [], excludeClassIds: [], unmappedSchool: false, mappedSchool: false,
      },
      "대치",
    );
    expect(r.length).toBe(8);
  });
});

/**
 * F2 · 학교별 제외(excludeSchools) (박은주 부원장 요청 2026-05-27).
 *
 * 계약:
 *   - student.school IN (excludeSchools) 면 최종 수신자에서 제외.
 *   - school IS NULL 은 차감 대상 아님(매칭되지 않음).
 *   - 빈 배열이면 제외 미적용(전체 보존).
 *   - include(조건/includeStudentIds) 와 겹치면 exclude 가 승리.
 *
 * 시드 기준(대치 8명):
 *   휘문고: DC0001(고2)·DC0003(고3)·DC0007(졸업)
 *   단대부고: DC0002(고2)·DC0005(고3)
 *   중동고: DC0004(고1) / 대왕중: DC0006(중2) / school NULL: DC0008(미정)
 */
describe("applyGroupFiltersDev · excludeSchools (학교별 제외)", () => {
  describe("기본 동작", () => {
    it("excludeSchools=['휘문고'] · 휘문고 3명(DC0001·DC0003·DC0007) 빠지고 5명 남음", () => {
      const r = applyGroupFiltersDev(
        DEV_STUDENT_PROFILES,
        { ...emptyFilters, excludeSchools: ["휘문고"] },
        "대치",
      );
      // 대치 8명 - 휘문고 3명 = 5명
      expect(r.length).toBe(5);
      expect(r.every((p) => p.school !== "휘문고")).toBe(true);
      // 다른 학교는 보존
      expect(r.find((p) => p.id === "dev-DC0002")).toBeDefined(); // 단대부고
      expect(r.find((p) => p.id === "dev-DC0004")).toBeDefined(); // 중동고
    });

    it("excludeSchools=['휘문고','단대부고'] · 두 학교(5명) 모두 차감", () => {
      const r = applyGroupFiltersDev(
        DEV_STUDENT_PROFILES,
        { ...emptyFilters, excludeSchools: ["휘문고", "단대부고"] },
        "대치",
      );
      // 대치 8명 - 휘문고 3 - 단대부고 2 = 3명 (DC0004 중동고·DC0006 대왕중·DC0008 NULL)
      expect(r.length).toBe(3);
      expect(r.map((p) => p.id).sort()).toEqual([
        "dev-DC0004",
        "dev-DC0006",
        "dev-DC0008",
      ]);
    });
  });

  describe("school NULL 경계", () => {
    it("school NULL 학생(DC0008)은 어떤 excludeSchools 로도 차감되지 않는다", () => {
      // 빈 학교명 매칭이 NULL 을 잡지 않음을 보장 — NOT IN 시맨틱과 동일.
      const r = applyGroupFiltersDev(
        DEV_STUDENT_PROFILES,
        { ...emptyFilters, excludeSchools: ["휘문고", "단대부고", "중동고", "대왕중"] },
        "대치",
      );
      // 대치에서 학교 등록된 7명 전부 제외 → school NULL 인 DC0008 만 남음
      expect(r.length).toBe(1);
      expect(r[0].id).toBe("dev-DC0008");
      expect(r[0].school).toBeNull();
    });
  });

  describe("경계값", () => {
    it("excludeSchools=[] 빈 배열이면 제외 미적용(대치 8명 보존)", () => {
      const r = applyGroupFiltersDev(
        DEV_STUDENT_PROFILES,
        { ...emptyFilters, excludeSchools: [] },
        "대치",
      );
      expect(r.length).toBe(8);
    });

    it("존재하지 않는 학교를 excludeSchools 에 줘도 아무도 빠지지 않는다", () => {
      const r = applyGroupFiltersDev(
        DEV_STUDENT_PROFILES,
        { ...emptyFilters, excludeSchools: ["없는학교"] },
        "대치",
      );
      expect(r.length).toBe(8);
    });
  });
});

/**
 * F2 · exclude 승리 (include 와 겹칠 때 차감 우선).
 *
 * 계약: ① include 산정(조건 ∪ includeStudentIds) → ② exclude 차감.
 *       include 와 exclude 가 겹치면 exclude 가 이긴다.
 */
describe("applyGroupFiltersDev · exclude 승리(차감 우선)", () => {
  it("schools 로 포함된 학생이 excludeSchools 와 겹치면 최종 제외", () => {
    // 같은 학교를 schools(포함) + excludeSchools(제외) 동시 지정 → exclude 승리로 0명.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, schools: ["휘문고"], excludeSchools: ["휘문고"] },
      "대치",
    );
    expect(r.length).toBe(0);
  });

  it("custom 그룹: includeStudentIds 로 콕 찍은 학생도 excludeStudentIds 와 겹치면 제외", () => {
    // 그룹 종류 분리(2026-05-27): includeStudentIds 는 custom 그룹에서만 모집단이 된다.
    // DC0001 을 직접 포함했지만 동시에 명시 제외 → exclude 승리(custom 도 개별 제거 유지).
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        statuses: [],
        includeStudentIds: ["dev-DC0001", "dev-DC0002"],
        excludeStudentIds: ["dev-DC0001"],
      },
      "대치",
    );
    expect(r.map((p) => p.id)).toEqual(["dev-DC0002"]);
  });

  it("custom 그룹: includeStudentIds 콕 찍은 학생은 excludeSchools 를 무시한다", () => {
    // 그룹 종류 분리(2026-05-27): custom 그룹은 excludeSchools 를 무시한다(고정 명단).
    // DC0001(휘문고)·DC0002(단대부고) 직접 포함 + 휘문고 학교 제외 → 둘 다 남음.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        statuses: [],
        includeStudentIds: ["dev-DC0001", "dev-DC0002"],
        excludeSchools: ["휘문고"],
      },
      "대치",
    );
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0002"]);
  });
});

/**
 * F2 · 명시 제외 + 학교 제외 합집합.
 *
 * excludeStudentIds 와 excludeSchools 는 독립적으로 적용되어 합집합으로 차감된다.
 */
describe("applyGroupFiltersDev · excludeStudentIds + excludeSchools 합집합", () => {
  it("명시 제외(DC0002) + 학교 제외(휘문고 3명) = 4명 차감 → 대치 4명 남음", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        excludeStudentIds: ["dev-DC0002"],
        excludeSchools: ["휘문고"],
      },
      "대치",
    );
    // 대치 8명 - (휘문고 3 ∪ DC0002 1) = 4명 (DC0004·DC0005·DC0006·DC0008)
    expect(r.length).toBe(4);
    expect(r.map((p) => p.id).sort()).toEqual([
      "dev-DC0004",
      "dev-DC0005",
      "dev-DC0006",
      "dev-DC0008",
    ]);
  });

  it("명시 제외 학생이 학교 제외에도 걸리면 한 번만 차감(중복 무해)", () => {
    // DC0001 은 휘문고이자 명시 제외 대상 — 두 경로 모두 잡아도 결과는 동일.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        excludeStudentIds: ["dev-DC0001"],
        excludeSchools: ["휘문고"],
      },
      "대치",
    );
    // 휘문고 3명(DC0001 포함) 차감 → 5명. DC0001 명시 제외는 이미 휘문고 차감과 겹침.
    expect(r.length).toBe(5);
    expect(r.find((p) => p.id === "dev-DC0001")).toBeUndefined();
  });
});

/**
 * F2 · 강좌별 제외(excludeClassIds) (박은주 부원장 요청 2026-05-27).
 *
 * dev-seed 계약 확인:
 *   - DEV_ENROLLMENTS 의 aca_class_id 는 11건 전부 NULL(자체 등록 강좌).
 *   - 따라서 어떤 excludeClassIds 를 줘도 매칭 0명 — "aca_class_id NULL 은 매칭 0명"
 *     계약과 정확히 일치. (Supabase 경로는 crm_classes→aca_class_id→enrollment 매핑)
 *   - 빈 배열이면 제외 미적용.
 */
describe("applyGroupFiltersDev · excludeClassIds (강좌별 제외)", () => {
  describe("dev 시드 aca_class_id 전부 NULL → 매칭 0명 계약", () => {
    it("임의 강좌 id 를 excludeClassIds 에 줘도 아무도 차감되지 않는다", () => {
      // 시드 enrollment 의 aca_class_id 가 전부 NULL 이라 매칭 0명.
      const r = applyGroupFiltersDev(
        DEV_STUDENT_PROFILES,
        {
          ...emptyFilters,
          excludeClassIds: ["44444444-4444-4444-8444-444444444444"],
        },
        "대치",
      );
      expect(r.length).toBe(8);
    });

    it("복수 강좌 id 를 줘도 NULL 매칭이라 전체 보존", () => {
      const r = applyGroupFiltersDev(
        DEV_STUDENT_PROFILES,
        {
          ...emptyFilters,
          excludeClassIds: [
            "44444444-4444-4444-8444-444444444444",
            "55555555-5555-4555-8555-555555555555",
          ],
        },
        "송도",
      );
      // 송도 5명 - 탈퇴 1 = 4명. 강좌 제외는 0명 매칭.
      expect(r.length).toBe(4);
    });
  });

  describe("경계값", () => {
    it("excludeClassIds=[] 빈 배열이면 제외 미적용(대치 8명 보존)", () => {
      const r = applyGroupFiltersDev(
        DEV_STUDENT_PROFILES,
        { ...emptyFilters, excludeClassIds: [] },
        "대치",
      );
      expect(r.length).toBe(8);
    });
  });
});

/**
 * F2 · 그룹 종류(kind) 별 해석 분리 (사용자 확정 2026-05-27).
 *
 * 핵심 회귀 방어 — 두 불변식이 어긋나면 오발송/누락이 발생:
 *   ① filter 그룹: 조건만으로 모집단 산정. includeStudentIds 는 **완전히 무시**
 *      (동기화 보장). excludeStudentIds/excludeSchools/excludeClassIds 차감은 유지.
 *   ② custom 그룹: includeStudentIds 명단만 모집단. 필터 조건(grades 등)/
 *      excludeSchools/excludeClassIds 는 **무시**. excludeStudentIds 차감만 유지.
 *
 * 시드 기준(대치 8명): DC0001(휘문고·고2·재원·수학)·DC0002(단대부고·고2·재원·국어)·
 *   DC0003(휘문고·고3·재원·수학)·DC0004(중동고·고1·수강이력자)·DC0005(단대부고·고3·
 *   수강이력자)·DC0006(대왕중·중2·재원)·DC0007(휘문고·졸업·수강이력자)·
 *   DC0008(school NULL·미정·수강이력자).
 */
describe("applyGroupFiltersDev · kind='filter' (조건 동기화)", () => {
  it("includeStudentIds 를 채워도 무시 — include 한 학생이 조건 밖이면 결과에 없음", () => {
    // 회귀 핵심: filter 그룹은 동기화 보장을 위해 includeStudentIds 를 절대 보지 않는다.
    // 조건 grades=['고2'] → DC0001·DC0002 만 매칭. DC0004(고1)·DC0006(중2)·DC0007(졸업)
    // 을 includeStudentIds 로 박아도 조건 밖이라 결과에 들어오면 안 된다.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "filter",
        grades: ["고2"],
        includeStudentIds: ["dev-DC0004", "dev-DC0006", "dev-DC0007"],
      },
      "대치",
    );
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0002"]);
    // include 로 박은 조건 밖 학생들은 한 명도 없음.
    expect(r.find((p) => p.id === "dev-DC0004")).toBeUndefined();
    expect(r.find((p) => p.id === "dev-DC0006")).toBeUndefined();
    expect(r.find((p) => p.id === "dev-DC0007")).toBeUndefined();
  });

  it("includeStudentIds 만 채우고 조건은 비워도 → 전체(탈퇴 제외) 동기화 (include 무시)", () => {
    // filter + 조건 없음 + includeStudentIds 1명 → include 무시하므로 결과는
    // 조건 없는 filter 그룹 = 대치 8명 전부 (include 가 모집단을 좁히지 않음).
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "filter",
        includeStudentIds: ["dev-DC0001"],
      },
      "대치",
    );
    expect(r.length).toBe(8);
  });

  it("동기화 성격 — 조건 매칭 학생 전부 포함 (휘문고 3명 모두)", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, kind: "filter", schools: ["휘문고"] },
      "대치",
    );
    // DC0001·DC0003·DC0007 모두 휘문고 → 조건 매칭 전원 포함.
    expect(r.map((p) => p.id).sort()).toEqual([
      "dev-DC0001",
      "dev-DC0003",
      "dev-DC0007",
    ]);
  });

  it("kind 미지정(옛 그룹) 은 filter 로 동작 — includeStudentIds 무시 회귀", () => {
    // 옛 그룹 JSONB: kind 키 없음. resolveGroupKind → 'filter'.
    // includeStudentIds 가 보존돼 있어도 filter 해석에서 무시되어야 한다.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        grades: ["고2"],
        includeStudentIds: ["dev-DC0004"], // 조건 밖(고1)
      },
      "대치",
    );
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0002"]);
  });
});

describe("applyGroupFiltersDev · kind='custom' (고정 명단)", () => {
  it("includeStudentIds 명단만 — 조건(grades) 채워도 무시", () => {
    // custom: 조건 grades=['고3'] 을 줘도 무시. includeStudentIds 명단이 진실.
    // DC0001(고2)·DC0006(중2) 은 grades=['고3'] 조건 밖이지만 include 라 포함.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        grades: ["고3"],
        includeStudentIds: ["dev-DC0001", "dev-DC0006"],
      },
      "대치",
    );
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0006"]);
  });

  it("조건에 맞아도 include 아니면 제외 — 명단이 유일한 진실", () => {
    // grades=['고2'] 조건엔 DC0001·DC0002 가 맞지만, include 는 DC0001 뿐.
    // custom 은 조건 무시 + include 만 → DC0002 는 조건 매칭이어도 빠진다.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        grades: ["고2"],
        includeStudentIds: ["dev-DC0001"],
      },
      "대치",
    );
    expect(r.map((p) => p.id)).toEqual(["dev-DC0001"]);
  });

  it("빈 includeStudentIds 면 모집단 0명 → 빈 결과 (안전)", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      { ...emptyFilters, kind: "custom", includeStudentIds: [] },
      "대치",
    );
    expect(r.length).toBe(0);
  });

  it("custom + excludeStudentIds — 명단에서 개별 제거", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        includeStudentIds: ["dev-DC0001", "dev-DC0002", "dev-DC0003"],
        excludeStudentIds: ["dev-DC0002"],
      },
      "대치",
    );
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0003"]);
  });

  it("custom + excludeSchools 무시 — 학교 제외 줘도 명단 안 줄어듦", () => {
    // custom 은 excludeSchools 를 무시한다(고정 명단). DC0001·DC0003 둘 다 휘문고지만
    // excludeSchools=['휘문고'] 가 custom 에선 적용되지 않아 둘 다 남는다.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        includeStudentIds: ["dev-DC0001", "dev-DC0003"],
        excludeSchools: ["휘문고"],
      },
      "대치",
    );
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0003"]);
  });

  it("custom + excludeClassIds 무시 — 강좌 제외 줘도 명단 보존", () => {
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        includeStudentIds: ["dev-DC0001", "dev-DC0002"],
        excludeClassIds: ["44444444-4444-4444-8444-444444444444"],
      },
      "대치",
    );
    expect(r.map((p) => p.id).sort()).toEqual(["dev-DC0001", "dev-DC0002"]);
  });

  it("custom 도 안전 가드는 유지 — 탈퇴 학생은 include 해도 제외", () => {
    // SD0004(탈퇴) 를 명단에 콕 박아도 status='탈퇴' 안전 가드가 차단.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        includeStudentIds: ["dev-SD0003", "dev-SD0004"],
      },
      "송도",
    );
    expect(r.map((p) => p.id)).toEqual(["dev-SD0003"]);
    expect(r.find((p) => p.status === "탈퇴")).toBeUndefined();
  });

  it("custom 도 안전 가드는 유지 — 수신거부 학부모는 include 해도 제외", () => {
    // DC0001 학부모 번호 수신거부 → 명단에 있어도 강제 제외.
    const unsub = new Set<string>(["01090010001"]);
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        includeStudentIds: ["dev-DC0001", "dev-DC0002"],
      },
      "대치",
      { unsubscribedPhones: unsub },
    );
    expect(r.map((p) => p.id)).toEqual(["dev-DC0002"]);
  });

  it("custom 도 분원 불일치 학생은 include 해도 제외", () => {
    // branch='대치' 인데 송도 학생(SD0001) 을 명단에 넣으면 분원 가드가 차단.
    const r = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      {
        ...emptyFilters,
        kind: "custom",
        includeStudentIds: ["dev-DC0001", "dev-SD0001"],
      },
      "대치",
    );
    expect(r.map((p) => p.id)).toEqual(["dev-DC0001"]);
  });
});
