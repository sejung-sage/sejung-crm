import { describe, it, expect, beforeEach } from "vitest";
import { listStudents } from "@/lib/profile/list-students";
import { ListStudentsInputSchema } from "@/lib/schemas/student";

/**
 * listStudents - 개발 시드 경로 단위 테스트.
 * SEJUNG_DEV_SEED=1 강제로 dev-seed 분기만 검증 (DB 없이 실행 가능).
 */
describe("listStudents · dev seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    // Supabase URL 이 있어도 강제로 dev seed 모드로 진입
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  const baseInput = ListStudentsInputSchema.parse({});

  it("필터 없으면 시드 학생 전체(10명)를 반환한다", async () => {
    const r = await listStudents(baseInput);
    expect(r.source).toBe("dev-seed");
    expect(r.total).toBe(10);
    expect(r.rows.length).toBe(10);
  });

  it("분원 필터 · 대치 선택 시 대치 학생만 나온다", async () => {
    const r = await listStudents({
      ...baseInput,
      branch: "대치",
    });
    expect(r.total).toBe(5);
    expect(r.rows.every((s) => s.branch === "대치")).toBe(true);
  });

  it("학년 필터 · 고2만 선택 시 2학년만 반환", async () => {
    const r = await listStudents({
      ...baseInput,
      grades: [2],
    });
    expect(r.rows.every((s) => s.grade === 2)).toBe(true);
    expect(r.total).toBeGreaterThan(0);
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
    expect(r.rows.every((s) => s.school?.includes("휘문"))).toBe(true);
  });

  it("검색 · 학부모 연락처 끝자리 일치", async () => {
    const r = await listStudents({
      ...baseInput,
      search: "0001",
    });
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("페이지네이션 · pageSize=3, page=2 동작", async () => {
    const r = await listStudents({
      ...baseInput,
      pageSize: 3,
      page: 2,
    });
    expect(r.rows.length).toBe(3);
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(3);
    expect(r.total).toBe(10);
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
      grades: [2],
      statuses: ["재원생"],
    });
    expect(r.rows.every((s) =>
      s.branch === "대치" && s.grade === 2 && s.status === "재원생",
    )).toBe(true);
  });
});
