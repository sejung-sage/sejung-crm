/**
 * F1-03 · Import DB 적용
 *
 * ============================================================
 * 트랜잭션 제약 (중요)
 * ============================================================
 * Supabase JS 클라이언트는 REST 기반이라 여러 테이블을 단일 트랜잭션으로
 * 묶기 어렵다. PRD 섹션 5.3의 "전체 성공 or 롤백" 은 향후 PostgreSQL
 * 함수(RPC) 를 정의하고 거기서 `BEGIN/COMMIT` 을 감싸는 방식으로
 * 마이그레이션 예정. MVP 에선 아래 타협안을 적용한다:
 *
 *   1) students → enrollments → attendances 순차 insert/upsert.
 *   2) 앞 단계가 실패(HTTP 오류/제약 위반)하면 뒤 단계를 중단하고
 *      `{ status: 'failed' }` 반환.
 *   3) 이 타협의 의미: "students 만 일부 반영되고 enrollments 는
 *      반영되지 않은" 중간 상태가 발생할 수 있다. 재실행 시 students
 *      는 UPSERT 라 안전하지만 enrollments/attendances 는 append 라
 *      중복 이력이 생길 수 있다. 사용자 UI 에 재실행 시 주의 안내.
 *
 * 보안 방어:
 *   클라이언트가 조작한 combined.prepared 가 넘어올 수 있으므로,
 *   apply 진입 시 prepared 각 행을 Row Schema 로 **재검증** 한다.
 *   재검증 실패 시 즉시 failed 반환.
 * ============================================================
 */
import {
  ImportAttendanceRowSchema,
  ImportEnrollmentRowSchema,
  ImportStudentRowSchema,
  type ImportAttendanceRow,
  type ImportEnrollmentRow,
  type ImportStudentRow,
} from "@/lib/schemas/import";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  ImportApplyResult,
  ImportCombinedReport,
} from "@/types/import";

const CHUNK_SIZE = 500;

/**
 * 프로젝트 `Database` 타입은 `Relationships` 필드를 아직 포함하지 않아
 * @supabase/postgrest-js v2 의 GenericTable 제약을 완전히 만족하지 못한다.
 * 이 때문에 `insert/upsert` 호출 시 payload 타입이 `never` 로 추론되는
 * 현상이 있다. 본 파일은 Import 적용 전용 유틸이라 타입 안전성을 유지하는
 * 선에서 `any` 를 사용하지 않고, 전용 좁은 인터페이스로 wrapping 한다.
 * 향후 `npx supabase gen types` 도입 후 해당 cast 는 제거 예정.
 */
type WriteRow = Record<string, unknown>;
type WriteResponse = {
  data: WriteRow[] | null;
  error: { message: string } | null;
};
type WriteBuilder = {
  select: (cols: string) => Promise<WriteResponse>;
};
type TableWriter = {
  upsert: (
    values: WriteRow[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) => WriteBuilder;
  insert: (values: WriteRow[]) => WriteBuilder;
};
type TableReader = {
  select: (cols: string) => {
    in: (col: string, values: string[]) => Promise<WriteResponse>;
  };
};
type ImportSupabase = {
  from: (table: string) => TableWriter & TableReader;
};

type StudentUpsertPayload = {
  parent_phone: string;
  name: string;
  phone: string | null;
  school: string | null;
  grade: 1 | 2 | 3 | null;
  track: "문과" | "이과" | null;
  status: "재원생" | "수강이력자" | "신규리드" | "탈퇴";
  branch: string;
  registered_at: string | null;
  aca2000_id: string | null;
};

type EnrollmentInsertPayload = {
  student_id: string;
  course_name: string;
  teacher_name: string | null;
  subject: "수학" | "국어" | "영어" | "탐구" | null;
  amount: number;
  paid_at: string | null;
  start_date: string | null;
  end_date: string | null;
};

type AttendanceInsertPayload = {
  student_id: string;
  enrollment_id: string | null;
  attended_at: string;
  status: "출석" | "지각" | "결석" | "조퇴";
};

// ============================================================
// 유틸
// ============================================================

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function studentKey(parentPhone: string, name: string): string {
  return `${parentPhone}::${name}`;
}

/** Supabase 응답 row 에서 문자열 필드를 안전하게 추출. */
function str(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === "string" ? v : null;
}

/**
 * 클라이언트가 조작 가능한 combined 를 신뢰하지 않고, prepared 를
 * 다시 Row Schema 로 재파싱. 실패하면 null 반환.
 */
function revalidate(
  combined: ImportCombinedReport,
):
  | {
      students: ImportStudentRow[];
      enrollments: ImportEnrollmentRow[];
      attendances: ImportAttendanceRow[];
    }
  | { error: string } {
  const studentsRaw = combined.students?.prepared ?? [];
  const enrollmentsRaw = combined.enrollments?.prepared ?? [];
  const attendancesRaw = combined.attendances?.prepared ?? [];

  const students: ImportStudentRow[] = [];
  for (let i = 0; i < studentsRaw.length; i++) {
    const r = ImportStudentRowSchema.safeParse(studentsRaw[i]);
    if (!r.success) {
      return {
        error: `학생 ${i + 1}행 재검증 실패 (클라이언트 조작 의심): ${r.error.issues[0]?.message ?? "unknown"}`,
      };
    }
    students.push(r.data);
  }

  const enrollments: ImportEnrollmentRow[] = [];
  for (let i = 0; i < enrollmentsRaw.length; i++) {
    const r = ImportEnrollmentRowSchema.safeParse(enrollmentsRaw[i]);
    if (!r.success) {
      return {
        error: `수강 ${i + 1}행 재검증 실패 (클라이언트 조작 의심): ${r.error.issues[0]?.message ?? "unknown"}`,
      };
    }
    enrollments.push(r.data);
  }

  const attendances: ImportAttendanceRow[] = [];
  for (let i = 0; i < attendancesRaw.length; i++) {
    const r = ImportAttendanceRowSchema.safeParse(attendancesRaw[i]);
    if (!r.success) {
      return {
        error: `출석 ${i + 1}행 재검증 실패 (클라이언트 조작 의심): ${r.error.issues[0]?.message ?? "unknown"}`,
      };
    }
    attendances.push(r.data);
  }

  return { students, enrollments, attendances };
}

// ============================================================
// 메인 API
// ============================================================

export async function applyImport(
  combined: ImportCombinedReport,
  options: { upsertMode?: "upsert" | "insert_only" } = {},
): Promise<ImportApplyResult> {
  // 1) Dev-seed 모드에서는 실제 반영하지 않음
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "실제 Supabase 연결 시 실행 가능합니다",
    };
  }

  // 2) canCommit 가드
  if (!combined.summary.canCommit) {
    return {
      status: "failed",
      reason: "검증 실패 상태에서는 적용할 수 없습니다",
    };
  }

  // 3) 클라이언트 조작 방어 · 재검증
  const revalidated = revalidate(combined);
  if ("error" in revalidated) {
    return { status: "failed", reason: revalidated.error };
  }
  const { students, enrollments, attendances } = revalidated;

  if (students.length === 0) {
    return { status: "failed", reason: "학생 데이터가 비어 있습니다" };
  }

  const upsertMode = options.upsertMode ?? "upsert";
  // Supabase 제네릭 타입 제약 회피용 좁은 인터페이스 wrapping. 위 주석 참조.
  const supabase = createSupabaseServiceClient() as unknown as ImportSupabase;

  // ------------------------------------------------------------
  // STEP 1 · students upsert / insert
  // ------------------------------------------------------------
  const studentPayloads: StudentUpsertPayload[] = students.map((s) => ({
    parent_phone: s.parent_phone,
    name: s.name,
    phone: s.phone,
    school: s.school,
    grade: s.grade,
    track: s.track,
    status: s.status,
    branch: s.branch,
    registered_at: s.registered_at,
    aca2000_id: s.aca2000_id,
  }));

  // (parent_phone, name) → student id 매핑
  const idMap = new Map<string, string>();
  let studentsUpserted = 0;

  for (const batch of chunk(studentPayloads, CHUNK_SIZE)) {
    const writer = supabase.from("students");
    const builder =
      upsertMode === "upsert"
        ? writer.upsert(batch as unknown as WriteRow[], {
            onConflict: "parent_phone,name",
            ignoreDuplicates: false,
          })
        : writer.insert(batch as unknown as WriteRow[]);
    const { data, error } = await builder.select("id, parent_phone, name");
    if (error) {
      return {
        status: "failed",
        reason: `학생 저장 단계에서 ${batch.length}행 실패: ${error.message}`,
      };
    }
    for (const r of data ?? []) {
      const phone = str(r, "parent_phone");
      const nm = str(r, "name");
      const id = str(r, "id");
      if (phone && nm && id) {
        idMap.set(studentKey(phone, nm), id);
      }
    }
    studentsUpserted += data?.length ?? 0;
  }

  // upsert 응답에 일부 행이 빠질 수 있으므로(ignoreDuplicates=false 면 드묾),
  // 혹시 모를 누락을 채우기 위해 추가 조회 한 번 더 시도.
  const missingKeys = studentPayloads.filter(
    (s) => !idMap.has(studentKey(s.parent_phone, s.name)),
  );
  if (missingKeys.length > 0) {
    // 학부모 번호 목록으로 batch 조회 (이름은 후처리 필터)
    const phones = Array.from(
      new Set(missingKeys.map((s) => s.parent_phone)),
    );
    for (const phonesBatch of chunk(phones, CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from("students")
        .select("id, parent_phone, name")
        .in("parent_phone", phonesBatch);
      if (error) {
        return {
          status: "failed",
          reason: `학생 ID 조회 단계에서 실패: ${error.message}`,
        };
      }
      for (const r of data ?? []) {
        const phone = str(r, "parent_phone");
        const nm = str(r, "name");
        const id = str(r, "id");
        if (phone && nm && id) {
          idMap.set(studentKey(phone, nm), id);
        }
      }
    }
  }

  // ------------------------------------------------------------
  // STEP 2 · enrollments insert
  // ------------------------------------------------------------
  // course_name 으로 enrollment_id 를 추후 매칭하기 위해 임시 맵 유지:
  //   `${student_id}::${course_name}` → enrollment_id (최초 1건만)
  const enrollmentIdByCourse = new Map<string, string>();
  let enrollmentsInserted = 0;

  if (enrollments.length > 0) {
    const enrollmentPayloads: EnrollmentInsertPayload[] = [];
    const unmatched: number[] = [];

    enrollments.forEach((e, i) => {
      const sid = idMap.get(studentKey(e.parent_phone, e.student_name));
      if (!sid) {
        unmatched.push(i + 1);
        return;
      }
      enrollmentPayloads.push({
        student_id: sid,
        course_name: e.course_name,
        teacher_name: e.teacher_name,
        subject: e.subject,
        amount: e.amount,
        paid_at: e.paid_at,
        start_date: e.start_date,
        end_date: e.end_date,
      });
    });

    if (unmatched.length > 0) {
      return {
        status: "failed",
        reason: `수강 저장 단계에서 ${unmatched.length}행 학생 ID 매칭 실패 (행: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? " ..." : ""})`,
      };
    }

    for (const batch of chunk(enrollmentPayloads, CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from("enrollments")
        .insert(batch as unknown as WriteRow[])
        .select("id, student_id, course_name");
      if (error) {
        return {
          status: "failed",
          reason: `수강 저장 단계에서 ${batch.length}행 실패: ${error.message}`,
        };
      }
      for (const r of data ?? []) {
        const sid = str(r, "student_id");
        const course = str(r, "course_name");
        const id = str(r, "id");
        if (sid && course && id) {
          const key = `${sid}::${course}`;
          if (!enrollmentIdByCourse.has(key)) {
            enrollmentIdByCourse.set(key, id);
          }
        }
      }
      enrollmentsInserted += data?.length ?? 0;
    }
  }

  // ------------------------------------------------------------
  // STEP 3 · attendances insert
  // ------------------------------------------------------------
  let attendancesInserted = 0;

  if (attendances.length > 0) {
    const attendancePayloads: AttendanceInsertPayload[] = [];
    const unmatched: number[] = [];

    attendances.forEach((a, i) => {
      const sid = idMap.get(studentKey(a.parent_phone, a.student_name));
      if (!sid) {
        unmatched.push(i + 1);
        return;
      }

      let enrollmentId: string | null = null;
      if (a.enrollment_course_name) {
        enrollmentId =
          enrollmentIdByCourse.get(
            `${sid}::${a.enrollment_course_name}`,
          ) ?? null;
      }

      attendancePayloads.push({
        student_id: sid,
        enrollment_id: enrollmentId,
        attended_at: a.attended_at,
        status: a.status,
      });
    });

    if (unmatched.length > 0) {
      return {
        status: "failed",
        reason: `출석 저장 단계에서 ${unmatched.length}행 학생 ID 매칭 실패 (행: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? " ..." : ""})`,
      };
    }

    for (const batch of chunk(attendancePayloads, CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from("attendances")
        .insert(batch as unknown as WriteRow[])
        .select("id");
      if (error) {
        return {
          status: "failed",
          reason: `출석 저장 단계에서 ${batch.length}행 실패: ${error.message}`,
        };
      }
      attendancesInserted += data?.length ?? 0;
    }
  }

  return {
    status: "success",
    studentsUpserted,
    enrollmentsInserted,
    attendancesInserted,
  };
}
