/**
 * 강좌 상세 data loader (/classes/[id]).
 *
 * 학생 상세 패턴 (`@/lib/profile/get-student-detail`) 을 미러링.
 * - 강좌 메타 + 수강생 명단 + 출결 매트릭스 원본을 한 번에 묶어 반환.
 * - 강좌 미존재 시 `null`. 쿼리 에러는 throw (Next.js error boundary 로).
 * - 출결 격자 UI 는 반환된 attendances 를 student_id × attended_at 로 group 하여 빌드.
 *
 * 쿼리 흐름 (Supabase 모드):
 *   1) classes by id — maybeSingle. 미존재 → null.
 *   2) enrollments by aca_class_id → student_id 모음 (JS 단 distinct).
 *      class.aca_class_id 가 NULL 이면 자체 등록 강좌이므로 enrollments 매칭 불가
 *      → 학생 0명, attendances 도 0. 강좌 메타는 그대로 반환.
 *   3) student_profiles 에서 in(studentIds) 로 학생 메타 batch 조회.
 *   4) attendances by aca_class_id (attended_at ASC).
 *   5) JS 단 group → 학생별 5종 카운트 머지.
 *
 * dev seed 모드:
 *   - dev seed 에는 강좌 시드가 없어 의미 있는 출력을 만들 수 없다.
 *   - 학생 상세 loader 는 학생 시드가 있어 시드에서 조립하지만,
 *     강좌 상세는 시드 부재라 의도적으로 `null` 반환.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import type {
  AttendanceRow,
  AttendanceStatus,
  ClassDetail,
  ClassRow,
  ClassStudentRow,
  StudentProfileRow,
} from "@/types/database";

/** PostgREST 기본 max_rows cap. attendances 가 정확히 이 수면 cap 의심 경고. */
const POSTGREST_MAX_ROWS_CAP = 1000;

export async function getClassDetail(
  classId: string,
): Promise<ClassDetail | null> {
  // dev seed 에는 강좌 시드가 없어 의미 있는 출력 불가 → null.
  // (학생 상세 loader 와 다른 정책 — 학생 시드는 존재하지만 강좌 시드는 부재)
  if (isDevSeedMode()) {
    return null;
  }
  return getFromSupabase(classId);
}

async function getFromSupabase(
  classId: string,
): Promise<ClassDetail | null> {
  const supabase = await createSupabaseServerClient();

  // 1) 강좌 메타 조회. 없으면 null.
  const classRes = await supabase
    .from("classes")
    .select("*")
    .eq("id", classId)
    .maybeSingle();

  if (classRes.error) {
    throw new Error(
      `강좌 정보 조회에 실패했습니다: ${classRes.error.message}`,
    );
  }
  if (!classRes.data) return null;

  const classRow = classRes.data as ClassRow;

  // aca_class_id 가 NULL 이면 자체 등록 강좌 → enrollments/attendances 매칭 불가능.
  // 강좌 메타만 반환하고 학생·출결은 빈 배열.
  if (!classRow.aca_class_id) {
    return {
      class: classRow,
      students: [],
      attendances: [],
    };
  }

  const acaClassId = classRow.aca_class_id;

  // 2) 수강생 student_id 목록. JS 단 distinct.
  const enrollmentsRes = await supabase
    .from("enrollments")
    .select("student_id")
    .eq("aca_class_id", acaClassId);

  if (enrollmentsRes.error) {
    throw new Error(
      `강좌 수강생 ID 조회에 실패했습니다: ${enrollmentsRes.error.message}`,
    );
  }

  const studentIds = Array.from(
    new Set(
      ((enrollmentsRes.data ?? []) as Array<{ student_id: string }>).map(
        (r) => r.student_id,
      ),
    ),
  );

  // 3) 학생 메타 (student_profiles 뷰) — studentIds 가 0 개면 query skip.
  // 4) 출결 데이터 (attendances) — 병렬 실행 가능.
  const [profilesRes, attendancesRes] = await Promise.all([
    studentIds.length > 0
      ? supabase
          .from("student_profiles")
          .select("id, name, school, grade, parent_phone")
          .in("id", studentIds)
      : Promise.resolve({
          data: [] as Array<
            Pick<
              StudentProfileRow,
              "id" | "name" | "school" | "grade" | "parent_phone"
            >
          >,
          error: null,
        }),
    supabase
      .from("attendances")
      .select("id, student_id, attended_at, status, aca_class_id")
      .eq("aca_class_id", acaClassId)
      .order("attended_at", { ascending: true }),
  ]);

  if (profilesRes.error) {
    throw new Error(
      `강좌 수강생 메타 조회에 실패했습니다: ${profilesRes.error.message}`,
    );
  }
  if (attendancesRes.error) {
    throw new Error(
      `강좌 출결 조회에 실패했습니다: ${attendancesRes.error.message}`,
    );
  }

  type AttendanceMatrixRow = Pick<
    AttendanceRow,
    "id" | "student_id" | "attended_at" | "status" | "aca_class_id"
  >;

  const attendances = (attendancesRes.data ?? []) as AttendanceMatrixRow[];

  // PostgREST max_rows cap 의심 경고. 정확히 1000 건이면 잘렸을 가능성.
  // 한 강좌의 출결은 보통 학생 수 × 회차 (≤ 100 × 30 = 3000) 라 cap 가능성 있음.
  // 다만 실데이터일 수도 있어 throw 하지 않고 warn.
  if (attendances.length === POSTGREST_MAX_ROWS_CAP) {
    console.warn(
      `[getClassDetail] attendances 가 ${POSTGREST_MAX_ROWS_CAP} 건으로 정확히 일치합니다. ` +
        `PostgREST max_rows cap 으로 잘렸을 수 있습니다 (classId=${classId}, aca_class_id=${acaClassId}).`,
    );
  }

  // 5) 학생별 5종 카운트 집계 (JS 단).
  const countsByStudent = aggregateAttendanceCounts(attendances);

  type StudentMetaRow = Pick<
    StudentProfileRow,
    "id" | "name" | "school" | "grade" | "parent_phone"
  >;
  const profiles = (profilesRes.data ?? []) as StudentMetaRow[];

  // 학생 메타 + 카운트 머지. 카운트 0 인 학생도 명단에는 포함 (등록은 했지만 미수업).
  const students: ClassStudentRow[] = profiles.map((p) => {
    const counts = countsByStudent.get(p.id);
    return {
      id: p.id,
      name: p.name,
      school: p.school,
      grade: p.grade,
      parent_phone: p.parent_phone,
      attended_count: counts?.attended_count ?? 0,
      absent_count: counts?.absent_count ?? 0,
      late_count: counts?.late_count ?? 0,
      early_leave_count: counts?.early_leave_count ?? 0,
      makeup_count: counts?.makeup_count ?? 0,
      total_count: counts?.total_count ?? 0,
    };
  });

  // 한글 이름 정렬.
  students.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return {
    class: classRow,
    students,
    attendances,
  };
}

// ─── 내부 유틸 ───────────────────────────────────────────────

interface AttendanceCounts {
  attended_count: number;
  absent_count: number;
  late_count: number;
  early_leave_count: number;
  makeup_count: number;
  total_count: number;
}

/**
 * attendances 를 student_id 별로 group 하여 5종 상태 카운트로 집계.
 * total_count 는 5종 합 (= attendances 행 수 by student).
 */
function aggregateAttendanceCounts(
  rows: ReadonlyArray<{ student_id: string; status: AttendanceStatus }>,
): Map<string, AttendanceCounts> {
  const map = new Map<string, AttendanceCounts>();
  for (const row of rows) {
    let counts = map.get(row.student_id);
    if (!counts) {
      counts = {
        attended_count: 0,
        absent_count: 0,
        late_count: 0,
        early_leave_count: 0,
        makeup_count: 0,
        total_count: 0,
      };
      map.set(row.student_id, counts);
    }
    switch (row.status) {
      case "출석":
        counts.attended_count += 1;
        break;
      case "결석":
        counts.absent_count += 1;
        break;
      case "지각":
        counts.late_count += 1;
        break;
      case "조퇴":
        counts.early_leave_count += 1;
        break;
      case "보강":
        counts.makeup_count += 1;
        break;
    }
    counts.total_count += 1;
  }
  return map;
}
