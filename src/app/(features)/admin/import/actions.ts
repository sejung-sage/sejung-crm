"use server";

/**
 * F1-03 · Aca2000 CSV/XLSX Import Server Actions
 *
 * 두 단계로 분리:
 *   1) `dryRunImportAction`  — 파싱 + 행 검증 + 교차 검증 → 보고서 반환
 *   2) `commitImportAction`  — dry-run 결과를 DB 에 적용
 *
 * 권한:
 *   master / admin 역할만 실행 가능. dev-seed 모드에선 권한 체크 스킵
 *   (로컬 개발 편의).
 */
import { parseFile } from "@/lib/import/parse-file";
import {
  crossValidate,
  validateAttendances,
  validateEnrollments,
  validateStudents,
} from "@/lib/import/validate";
import { applyImport } from "@/lib/import/apply";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ImportApplyResult,
  ImportCombinedReport,
  ImportValidationReport,
} from "@/types/import";

const ALLOWED_ROLES = new Set(["master", "admin"]);

/**
 * 역할 기반 권한 확인.
 * dev-seed 모드에서는 스킵하여 로컬 개발 편의 보장.
 */
async function assertAdminRole(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (isDevSeedMode()) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, reason: "로그인 후 이용 가능합니다" };
  }

  const { data, error } = await supabase
    .from("users_profile")
    .select("role, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: "권한 정보 조회에 실패했습니다" };
  }
  // Supabase `Database` 타입 미세 이슈로 `data` 가 `never` 로 추론되는 경우 방어.
  const profile = data as { role?: string; active?: boolean };
  if (!profile.active) {
    return { ok: false, reason: "비활성 계정은 사용할 수 없습니다" };
  }
  if (!profile.role || !ALLOWED_ROLES.has(profile.role)) {
    return { ok: false, reason: "권한이 없습니다 (master / admin 만 가능)" };
  }
  return { ok: true };
}

function failedReport(reason: string): ImportCombinedReport {
  return {
    students: null,
    enrollments: null,
    attendances: null,
    crossErrors: [{ row: 0, message: reason }],
    summary: {
      totalStudents: 0,
      totalEnrollments: 0,
      totalAttendances: 0,
      totalErrors: 1,
      canCommit: false,
    },
  };
}

// ============================================================
// dryRunImportAction
// ============================================================

export async function dryRunImportAction(
  formData: FormData,
): Promise<ImportCombinedReport> {
  const auth = await assertAdminRole();
  if (!auth.ok) return failedReport(auth.reason);

  const studentsFile = formData.get("students");
  const enrollmentsFile = formData.get("enrollments");
  const attendancesFile = formData.get("attendances");

  let studentsReport: ImportValidationReport | null = null;
  let enrollmentsReport: ImportValidationReport | null = null;
  let attendancesReport: ImportValidationReport | null = null;

  try {
    if (studentsFile instanceof File && studentsFile.size > 0) {
      const { rows } = await parseFile(studentsFile);
      studentsReport = validateStudents(rows);
    }
    if (enrollmentsFile instanceof File && enrollmentsFile.size > 0) {
      const { rows } = await parseFile(enrollmentsFile);
      enrollmentsReport = validateEnrollments(rows);
    }
    if (attendancesFile instanceof File && attendancesFile.size > 0) {
      const { rows } = await parseFile(attendancesFile);
      attendancesReport = validateAttendances(rows);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "파일 파싱 중 오류";
    return failedReport(`파일 파싱 실패: ${msg}`);
  }

  // 셋 다 없으면 의미 없는 호출
  if (!studentsReport && !enrollmentsReport && !attendancesReport) {
    return failedReport("업로드된 파일이 없습니다");
  }

  const { combined } = crossValidate(
    studentsReport,
    enrollmentsReport,
    attendancesReport,
  );
  return combined;
}

// ============================================================
// commitImportAction
// ============================================================

export async function commitImportAction(
  combined: ImportCombinedReport,
  options: { upsertMode: "upsert" | "insert_only" },
): Promise<ImportApplyResult> {
  const auth = await assertAdminRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }
  return applyImport(combined, options);
}
