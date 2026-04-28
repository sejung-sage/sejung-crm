import { describe, it, expect, beforeEach } from "vitest";
import { listStudents } from "@/lib/profile/list-students";
import { ListStudentsInputSchema } from "@/lib/schemas/student";

/**
 * listStudents - 개발 시드 경로 단위 테스트.
 * SEJUNG_DEV_SEED=1 강제로 dev-seed 분기만 검증 (DB 없이 실행 가능).
 *
 * 0012 마이그레이션 정규화 모델 시드 구성:
 *   대치 8명: DC0001(고2), DC0002(고2), DC0003(고3), DC0004(고1),
 *            DC0005(고3), DC0006(중2), DC0007(졸업), DC0008(미정)
 *   송도 5명: SD0001~SD0005 (모두 고1/고2/고3)
 *   합계 13명. includeHidden=false 기본값에선 졸업·미정 2명 제외 → 11명.
 */
describe("listStudents · dev seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    // Supabase URL 이 있어도 강제로 dev seed 모드로 진입
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  const baseInput = ListStudentsInputSchema.parse({});

  it("필터 없으면 졸업·미정 자동 숨김으로 11명 (전체 13명 중)", async () => {
    const r = await listStudents(baseInput);
    expect(r.source).toBe("dev-seed");
    expect(r.total).toBe(11);
    expect(r.rows.length).toBe(11);
    // 자동 숨김 검증: 졸업·미정 이 한 명도 없어야 함.
    expect(r.rows.every((s) => s.grade !== "졸업" && s.grade !== "미정")).toBe(
      true,
    );
  });

  it("includeHidden=true 면 졸업·미정도 포함해 13명 전체", async () => {
    const r = await listStudents({ ...baseInput, includeHidden: true });
    expect(r.total).toBe(13);
    // 졸업·미정이 적어도 한 명씩 있어야 함.
    expect(r.rows.some((s) => s.grade === "졸업")).toBe(true);
    expect(r.rows.some((s) => s.grade === "미정")).toBe(true);
  });

  it("grades 에 '졸업' 명시 선택 시 자동 숨김 비활성화 (사용자 의도 존중)", async () => {
    const r = await listStudents({ ...baseInput, grades: ["졸업"] });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].grade).toBe("졸업");
  });

  it("grades 에 '미정' 명시 선택 시 미정 학생만 반환", async () => {
    const r = await listStudents({ ...baseInput, grades: ["미정"] });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].grade).toBe("미정");
  });

  it("schoolLevels='중' 필터 → 중학생만 (1명, 한지민 중2)", async () => {
    const r = await listStudents({ ...baseInput, schoolLevels: ["중"] });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].school_level).toBe("중");
    expect(r.rows[0].grade).toBe("중2");
  });

  it("schoolLevels='고' + 기본 숨김 → 고등부 재원/신규/수강이력 (10명)", async () => {
    const r = await listStudents({ ...baseInput, schoolLevels: ["고"] });
    // DC0007(졸업, school_level=고) 은 자동 숨김으로 제외.
    expect(r.rows.every((s) => s.school_level === "고")).toBe(true);
    expect(r.rows.every((s) => s.grade !== "졸업" && s.grade !== "미정")).toBe(
      true,
    );
    expect(r.total).toBe(10);
  });

  it("분원 필터 · 대치 (기본 숨김 ON) → 6명 (대치 8명 중 졸업·미정 2명 제외)", async () => {
    const r = await listStudents({ ...baseInput, branch: "대치" });
    expect(r.total).toBe(6);
    expect(r.rows.every((s) => s.branch === "대치")).toBe(true);
    expect(r.rows.every((s) => s.grade !== "졸업" && s.grade !== "미정")).toBe(
      true,
    );
  });

  it("학년 필터 · 고2만 선택 시 2학년만 반환", async () => {
    const r = await listStudents({
      ...baseInput,
      grades: ["고2"],
    });
    expect(r.rows.every((s) => s.grade === "고2")).toBe(true);
    expect(r.total).toBeGreaterThan(0);
  });

  it("학년 필터 · 중2 선택 시 중2 1명 반환", async () => {
    const r = await listStudents({ ...baseInput, grades: ["중2"] });
    expect(r.total).toBe(1);
    expect(r.rows[0].grade).toBe("중2");
  });

  it("재원 상태 복수 선택 · 재원생+신규리드", async () => {
    const r = await listStudents({
      ...baseInput,
      statuses: ["재원생", "신규리드"],
    });
    expect(r.rows.every((s) =>
      ["재원생", "신규리드"].includes(s.status),
    )).toBe(true);
  });

  it("검색 · 이름 부분 일치", async () => {
    const r = await listStudents({
      ...baseInput,
      search: "민준",
    });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].name).toBe("김민준");
  });

  it("검색 · 학교 부분 일치", async () => {
    const r = await listStudents({
      ...baseInput,
      search: "휘문",
    });
    expect(r.rows.length).toBeGreaterThan(0);
    // 휘문고 학생들 중 졸업(송재호)은 자동 숨김 → 박지후/김민준 만 나옴.
    expect(r.rows.every((s) => s.school?.includes("휘문"))).toBe(true);
  });

  it("검색 · 학부모 연락처 끝자리 일치", async () => {
    const r = await listStudents({
      ...baseInput,
      search: "0001",
    });
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("페이지네이션 · pageSize=3, page=2 동작 (total=11)", async () => {
    const r = await listStudents({
      ...baseInput,
      pageSize: 3,
      page: 2,
    });
    expect(r.rows.length).toBe(3);
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(3);
    expect(r.total).toBe(11);
  });

  it("조건에 안 맞으면 빈 배열", async () => {
    const r = await listStudents({
      ...baseInput,
      search: "존재하지않는이름XYZ",
    });
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("분원+학년+상태 복합 필터", async () => {
    const r = await listStudents({
      ...baseInput,
      branch: "대치",
      grades: ["고2"],
      statuses: ["재원생"],
    });
    expect(r.rows.every((s) =>
      s.branch === "대치" && s.grade === "고2" && s.status === "재원생",
    )).toBe(true);
  });
});
