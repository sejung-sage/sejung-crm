import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyImport } from "@/lib/import/apply";
import type { ImportCombinedReport } from "@/types/import";

/**
 * F1-03 · applyImport 의 방어(가드) 로직 테스트.
 *
 * 실제 Supabase 호출 전 단계에서 분기가 되는지만 확인.
 * DB 쓰기 단계는 통합 테스트 범위.
 *
 * 순서:
 *   1) isDevSeedMode()          → status: 'dev_seed_mode'
 *   2) canCommit === false       → status: 'failed'
 *   3) revalidate() 실패 (클라이언트 조작 방어) → status: 'failed'
 *   4) students.length === 0     → status: 'failed'
 */

function buildReport(overrides: {
  students?: ImportCombinedReport["students"];
  enrollments?: ImportCombinedReport["enrollments"];
  attendances?: ImportCombinedReport["attendances"];
  canCommit?: boolean;
  totalStudents?: number;
  totalErrors?: number;
}): ImportCombinedReport {
  const totalStudents =
    overrides.totalStudents ?? overrides.students?.totalRows ?? 0;
  return {
    students: overrides.students ?? null,
    enrollments: overrides.enrollments ?? null,
    attendances: overrides.attendances ?? null,
    crossErrors: [],
    summary: {
      totalStudents,
      totalEnrollments: overrides.enrollments?.totalRows ?? 0,
      totalAttendances: overrides.attendances?.totalRows ?? 0,
      totalErrors: overrides.totalErrors ?? 0,
      canCommit: overrides.canCommit ?? true,
    },
  };
}

// 유효한 학생 prepared 행 (ImportStudentRow shape).
const VALID_STUDENT = {
  parent_phone: "01012345678",
  name: "김민준",
  phone: null,
  school: null,
  grade: null,
  track: null,
  status: "재원생" as const,
  branch: "대치",
  registered_at: null,
  aca2000_id: null,
};

describe("applyImport · dev-seed 모드", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("NEXT_PUBLIC_SUPABASE_URL 미설정 → dev_seed_mode 반환", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SEJUNG_DEV_SEED", "");

    const report = buildReport({
      students: {
        kind: "students",
        totalRows: 1,
        validRows: 1,
        errors: [],
        prepared: [VALID_STUDENT],
      },
    });

    const r = await applyImport(report);
    expect(r.status).toBe("dev_seed_mode");
  });

  it("placeholder URL (your-project) → dev_seed_mode", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://your-project.supabase.co",
    );
    vi.stubEnv("SEJUNG_DEV_SEED", "");

    const report = buildReport({
      students: {
        kind: "students",
        totalRows: 1,
        validRows: 1,
        errors: [],
        prepared: [VALID_STUDENT],
      },
    });

    const r = await applyImport(report);
    expect(r.status).toBe("dev_seed_mode");
  });

  it("SEJUNG_DEV_SEED=1 강제 시 실제 URL 있어도 dev_seed_mode", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://real.supabase.co",
    );
    vi.stubEnv("SEJUNG_DEV_SEED", "1");

    const report = buildReport({
      students: {
        kind: "students",
        totalRows: 1,
        validRows: 1,
        errors: [],
        prepared: [VALID_STUDENT],
      },
    });

    const r = await applyImport(report);
    expect(r.status).toBe("dev_seed_mode");
  });
});

describe("applyImport · canCommit 가드", () => {
  beforeEach(() => {
    // dev-seed 분기를 벗어나기 위해 실제 URL 처럼 stub
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://real.supabase.co");
    vi.stubEnv("SEJUNG_DEV_SEED", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("canCommit === false → failed + 검증 실패 메시지", async () => {
    const report = buildReport({
      students: {
        kind: "students",
        totalRows: 1,
        validRows: 0,
        errors: [
          {
            row: 1,
            field: "parent_phone",
            message: "학부모 연락처 형식이 올바르지 않습니다",
          },
        ],
        prepared: [],
      },
      canCommit: false,
      totalErrors: 1,
    });

    const r = await applyImport(report);
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("검증");
    }
  });
});

describe("applyImport · 재검증 가드 (클라이언트 조작 방어)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://real.supabase.co");
    vi.stubEnv("SEJUNG_DEV_SEED", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prepared 에 스키마 위반 (parent_phone 형식 오류) 섞여 있으면 failed", async () => {
    // 학부모 연락처 02X 접두사는 preprocess(normalizeKoreanPhone) 에서 null 로 변환 →
    // PhoneSchema 에서 거부되어 재검증 실패.
    // canCommit=true 를 강제로 설정해도 revalidate 에서 막혀야 함.
    const report = buildReport({
      students: {
        kind: "students",
        totalRows: 1,
        validRows: 1,
        errors: [],
        prepared: [
          {
            ...VALID_STUDENT,
            parent_phone: "021234567",
          },
        ],
      },
      canCommit: true,
    });

    const r = await applyImport(report);
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("재검증");
    }
  });

  it("prepared 에 필수 필드 누락 (name 빈값) → failed", async () => {
    const report = buildReport({
      students: {
        kind: "students",
        totalRows: 1,
        validRows: 1,
        errors: [],
        prepared: [
          {
            ...VALID_STUDENT,
            name: "",
          },
        ],
      },
      canCommit: true,
    });

    const r = await applyImport(report);
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("재검증");
    }
  });

  it("prepared 가 빈 배열 · canCommit=true 여도 failed (학생 비어있음)", async () => {
    const report = buildReport({
      students: {
        kind: "students",
        totalRows: 0,
        validRows: 0,
        errors: [],
        prepared: [],
      },
      canCommit: true,
    });

    const r = await applyImport(report);
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("학생");
    }
  });

  it("enrollments prepared 에 스키마 위반 → failed", async () => {
    const report = buildReport({
      students: {
        kind: "students",
        totalRows: 1,
        validRows: 1,
        errors: [],
        prepared: [VALID_STUDENT],
      },
      enrollments: {
        kind: "enrollments",
        totalRows: 1,
        validRows: 1,
        errors: [],
        prepared: [
          {
            parent_phone: "01012345678",
            student_name: "김민준",
            // course_name 누락 → 재검증 실패
            amount: 100000,
          },
        ],
      },
      canCommit: true,
    });

    const r = await applyImport(report);
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("재검증");
    }
  });
});
