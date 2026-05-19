import { describe, it, expect, beforeEach } from "vitest";
import { listStudents } from "@/lib/profile/list-students";
import {
  ListStudentsInputSchema,
  parseStudentsSearchParams,
} from "@/lib/schemas/student";

/**
 * F1 · 학생 region 필터 단위 테스트 (dev-seed 경로).
 *
 * 0026 마이그레이션으로 student_profiles 뷰에 region 컬럼이 추가되며
 * dev-seed 시드도 동일하게 region 을 채워두었다. 본 테스트는 listStudents
 * 의 region 분기가 OR 매칭으로 동작하고 default(재원생) status 와 어떻게
 * 함께 작동하는지 검증한다.
 *
 * dev-seed 의 학생별 region 매핑(students-dev-seed.ts):
 *   DC0001 휘문고 / 재원생  → 강남구
 *   DC0002 단대부고 / 재원생 → 강남구
 *   DC0003 휘문고 / 재원생  → 강남구
 *   DC0004 중동고 / 수강 x → 강남구
 *   DC0005 단대부고 / 수강이력자 → 강남구
 *   SD0001 송도고 / 재원생   → 인천 송도
 *   SD0002 인천포스코고 / 재원생 → 기타
 *   SD0003 송도고 / 재원생   → 인천 송도
 *   SD0004 송도국제고 / 탈퇴 → 기타
 *   SD0005 송도고 / 수강 x → 인천 송도
 *   DC0006 대왕중 / 재원생   → 기타
 *   DC0007 휘문고 / 졸업     → 강남구
 *   DC0008 school=null / 미정 → 기타
 *
 * 주의: ListStudentsInputSchema 의 statuses default 는 빈 배열이지만,
 * URL 첫 진입 시 parseStudentsSearchParams 가 ['재원생'] 으로 채운다.
 * 이 파일은 ListStudentsInputSchema.parse({}) 를 base 로 하므로
 * statuses 는 빈 배열이고 → 모든 status 통과 (졸업/미정만 자동 숨김).
 */
describe("listStudents · region 필터 (dev-seed)", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  // statuses=[] (전체 status), includeHidden=false (졸업·미정 자동 숨김)
  const baseInput = ListStudentsInputSchema.parse({});

  describe("정상 케이스 · 단일/복수 region 매칭", () => {
    it("regions=['강남구'] → 강남구 학생만 통과 (DC0001~DC0005, DC0007 자동 숨김)", async () => {
      const r = await listStudents({ ...baseInput, regions: ["강남구"] });
      expect(r.source).toBe("dev-seed");
      // 강남구 학생: DC0001/02/03/04/05/07. DC0007 은 grade='졸업' 으로 자동
      // 숨김 → 5명만 노출.
      expect(r.total).toBe(5);
      expect(r.rows.every((s) => s.region === "강남구")).toBe(true);
      const ids = r.rows.map((s) => s.id).sort();
      expect(ids).toEqual([
        "dev-DC0001",
        "dev-DC0002",
        "dev-DC0003",
        "dev-DC0004",
        "dev-DC0005",
      ]);
    });

    it("regions=['강남구','인천 송도'] OR 매칭 → 강남구 + 송도 학생", async () => {
      const r = await listStudents({
        ...baseInput,
        regions: ["강남구", "인천 송도"],
      });
      // 강남구 5명(자동 숨김 후) + 인천 송도 SD0001·SD0003·SD0005 3명 = 8명.
      // SD0002(기타)·DC0006(기타)·DC0008(기타) 은 제외.
      expect(r.total).toBe(8);
      expect(
        r.rows.every((s) => ["강남구", "인천 송도"].includes(s.region)),
      ).toBe(true);
      // 강도윤(SD0001)·임하윤(SD0003)·조서윤(SD0005) 모두 포함되는지 확인.
      const names = r.rows.map((s) => s.name);
      expect(names).toContain("강도윤");
      expect(names).toContain("임하윤");
      expect(names).toContain("조서윤");
    });

    it("regions=['기타'] → '기타' 분류 학생만 (SD0002·SD0004·DC0006, DC0008 자동 숨김)", async () => {
      const r = await listStudents({ ...baseInput, regions: ["기타"] });
      // SD0002(인천포스코고·재원생)·SD0004(송도국제고·탈퇴)·DC0006(대왕중·재원생).
      // DC0008 은 grade='미정' 으로 자동 숨김 → 3명.
      expect(r.total).toBe(3);
      expect(r.rows.every((s) => s.region === "기타")).toBe(true);
      const ids = r.rows.map((s) => s.id).sort();
      expect(ids).toEqual(["dev-DC0006", "dev-SD0002", "dev-SD0004"]);
    });

    it("regions=[] → region 필터 미적용 (자동 숨김 외 전체 11명)", async () => {
      const r = await listStudents({ ...baseInput, regions: [] });
      // baseInput.statuses=[] 이므로 status 필터는 미적용.
      // includeHidden=false 자동 숨김(졸업·미정) 만 적용 → 13 - 2 = 11.
      expect(r.total).toBe(11);
    });
  });

  describe("default status='재원생' 와의 상호작용", () => {
    it("default 재원생 + regions=['강남구'] → 재원생인 강남구만 (DC0001~DC0003)", async () => {
      // parseStudentsSearchParams 가 첫 진입에 채워주는 default status='재원생'.
      const input = parseStudentsSearchParams({ region: "강남구" });
      const r = await listStudents(input);
      expect(r.total).toBe(3);
      const ids = r.rows.map((s) => s.id).sort();
      expect(ids).toEqual(["dev-DC0001", "dev-DC0002", "dev-DC0003"]);
      expect(r.rows.every((s) => s.status === "재원생")).toBe(true);
    });

    it("default 재원생 + regions=['기타'] → 재원생인 '기타' 학생 (SD0002·DC0006)", async () => {
      const input = parseStudentsSearchParams({ region: "기타" });
      const r = await listStudents(input);
      // SD0004 는 status='탈퇴' 로 default 재원생 필터에 의해 제외.
      // DC0008 은 status='수강 x' 라 default 재원생 필터에 의해 제외.
      expect(r.total).toBe(2);
      const ids = r.rows.map((s) => s.id).sort();
      expect(ids).toEqual(["dev-DC0006", "dev-SD0002"]);
    });
  });

  describe("경계값", () => {
    it("매칭 없는 region → 빈 결과", async () => {
      const r = await listStudents({
        ...baseInput,
        regions: ["존재하지않는지역"],
      });
      expect(r.total).toBe(0);
      expect(r.rows).toEqual([]);
    });

    it("region + branch + grade 복합 필터 (강남구 × 대치 × 고2)", async () => {
      const r = await listStudents({
        ...baseInput,
        regions: ["강남구"],
        branch: "대치",
        grades: ["고2"],
      });
      // 강남구 × 대치 × 고2: DC0001·DC0002 (재원생 둘).
      expect(r.total).toBe(2);
      expect(
        r.rows.every(
          (s) =>
            s.region === "강남구" && s.branch === "대치" && s.grade === "고2",
        ),
      ).toBe(true);
    });

    it("URL 의 빈 문자열·공백 region 은 cleanFreeText 에서 제거됨", () => {
      const input = parseStudentsSearchParams({
        region: ["", "  ", "강남구"],
      });
      // cleanFreeText 가 빈 문자열/공백을 걸러 '강남구' 만 남김.
      expect(input.regions).toEqual(["강남구"]);
    });

    it("URL 에 region 미지정 → regions=[]", () => {
      const input = parseStudentsSearchParams({});
      expect(input.regions).toEqual([]);
    });
  });
});
