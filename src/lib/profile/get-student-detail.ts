import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AttendanceClassLookup,
  AttendanceRow,
  AttendanceWithClass,
  EnrollmentClassLookup,
  EnrollmentRow,
  EnrollmentWithClass,
  ExpectedSession,
  StudentDetail,
  StudentMessageRow,
  StudentProfileRow,
} from "@/types/database";
import { isStrictAttendanceBranch } from "./attendance-policy";
import {
  findDevAttendancesByStudentId,
  findDevEnrollmentsByStudentId,
  findDevMessagesByStudentId,
  findDevProfileById,
  isDevSeedMode,
} from "./students-dev-seed";

/**
 * 학생 상세 data loader (F1-02).
 *
 * 4개 영역(프로필·수강이력·출석·발송이력)을 하나로 묶어 반환.
 * - Supabase 연결 시 4개 쿼리를 병렬 실행
 * - dev-seed 모드에선 인메모리 시드에서 조합
 * - 프로필 미존재 시 `null`. 쿼리 에러는 throw (Next.js error boundary 로).
 * - 학부모/본인 번호 마스킹은 UI 레이어 책임. loader 는 원본 그대로.
 */
export async function getStudentDetail(
  studentId: string,
): Promise<StudentDetail | null> {
  if (isDevSeedMode()) {
    return getFromDevSeed(studentId);
  }
  return getFromSupabase(studentId);
}

async function getFromDevSeed(
  studentId: string,
): Promise<StudentDetail | null> {
  const profile = findDevProfileById(studentId);
  if (!profile) return null;

  const enrollments: EnrollmentWithClass[] = [
    ...findDevEnrollmentsByStudentId(studentId),
  ]
    .sort(compareEnrollmentsDesc)
    .map((e) => ({ ...e, class: null }));
  const attendances: AttendanceWithClass[] = [
    ...findDevAttendancesByStudentId(studentId),
  ]
    .sort(compareAttendancesDesc)
    .map((a) => ({ ...a, class: null }));
  const messages = [...findDevMessagesByStudentId(studentId)].sort(
    compareMessagesDesc,
  );

  // dev-seed 는 ticket 데이터를 시드하지 않으므로 expectedSessions 는 빈 배열.
  return { profile, enrollments, attendances, messages, expectedSessions: [] };
}

async function getFromSupabase(
  studentId: string,
): Promise<StudentDetail | null> {
  const supabase = await createSupabaseServerClient();

  const [
    profileRes,
    studentRes,
    enrollmentsRes,
    attendancesRes,
    messagesRes,
  ] = await Promise.all([
    supabase
      .from("student_profiles")
      .select("*")
      .eq("id", studentId)
      .maybeSingle(),
    // student_profiles view 는 aca2000_id 를 노출하지 않아 ticket join key 확보용으로
    // crm_students 를 별도 조회. 한 학생당 1행이라 비용은 미미.
    supabase
      .from("crm_students")
      .select("aca2000_id")
      .eq("id", studentId)
      .maybeSingle(),
    supabase
      .from("crm_enrollments")
      .select("*")
      .eq("student_id", studentId)
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("start_date", { ascending: false }),
    supabase
      .from("crm_attendances")
      .select("*")
      .eq("student_id", studentId)
      .order("attended_at", { ascending: false }),
    supabase
      .from("crm_messages")
      .select(
        "id, phone, status, sent_at, campaign_id, campaigns:campaign_id(title)",
      )
      .eq("student_id", studentId)
      .order("sent_at", { ascending: false, nullsFirst: false }),
  ]);

  if (profileRes.error) {
    throw new Error(
      `학생 프로필 조회에 실패했습니다: ${profileRes.error.message}`,
    );
  }
  if (!profileRes.data) return null;

  if (studentRes.error) {
    throw new Error(
      `학생 마스터 조회에 실패했습니다: ${studentRes.error.message}`,
    );
  }
  if (enrollmentsRes.error) {
    throw new Error(
      `수강 이력 조회에 실패했습니다: ${enrollmentsRes.error.message}`,
    );
  }
  if (attendancesRes.error) {
    throw new Error(
      `출석 이력 조회에 실패했습니다: ${attendancesRes.error.message}`,
    );
  }
  if (messagesRes.error) {
    throw new Error(
      `발송 이력 조회에 실패했습니다: ${messagesRes.error.message}`,
    );
  }

  const profile = profileRes.data as StudentProfileRow;
  const acaStudentId = (studentRes.data as { aca2000_id: string } | null)
    ?.aca2000_id ?? null;
  const enrollmentsRaw = (enrollmentsRes.data ?? []) as EnrollmentRow[];
  const attendancesRawDb = (attendancesRes.data ?? []) as AttendanceRow[];
  const messages = mapMessageRows(messagesRes.data ?? []);

  // 비-방배 분원(대치/반포/송도)은 source 의 V_Attend_List 에 결석만 기록되고
  // 실제 수업 출석은 aca_tickets.used_at(수강권 사용) 으로 표현된다.
  // 이 경우 ticket 의 used_at 을 가상 attendance row 로 변환해 합쳐줘야
  // student_profiles.attendance_rate (0057 마이그가 ticket 기반) 와
  // 학생 상세 출석 탭의 표시가 일관된다.
  //
  // 방배는 5종 status 가 완전히 기록되므로 ticket 데이터를 섞으면 카운트가
  // 이중 집계됨 — 그래서 분원 가드를 둔다.
  let attendancesRaw: AttendanceRow[] = attendancesRawDb;
  let expectedSessions: ExpectedSession[] = [];
  if (!isStrictAttendanceBranch(profile.branch) && acaStudentId) {
    // 결제완료 ticket 한 번에 조회 — used_at 사용분 (가상 attendance) 과
    // 전체 회차 (expectedSessions) 모두 같은 풀에서 파생.
    const ticketsRes = await supabase
      .from("aca_tickets")
      .select("id, aca_class_id, used_at, class_date, created_at, updated_at")
      .eq("aca_student_id", acaStudentId)
      .eq("payment_state", "결제완료");

    if (ticketsRes.error) {
      throw new Error(
        `수강권 출석 조회에 실패했습니다: ${ticketsRes.error.message}`,
      );
    }

    const ticketRows = (ticketsRes.data ?? []) as Array<{
      id: string;
      aca_class_id: string | null;
      used_at: string | null;
      class_date: string | null;
      created_at: string;
      updated_at: string;
    }>;

    // (1) 실제 사용된 ticket → 가상 attendance row.
    // 보강 며칠 차이 케이스에서 column 과 cell 이 어긋나지 않도록
    // attended_at = class_date (없으면 used_at) 로 통일.
    const usedTickets = ticketRows.filter(
      (t) => t.used_at !== null && t.used_at < "2050-01-01",
    );
    const ticketAsAttendance: AttendanceRow[] = usedTickets.map((t) => ({
      id: t.id,
      student_id: studentId,
      enrollment_id: null,
      // class_date 우선 (그 회차의 예정 수업일) — 컬럼 매칭용.
      // class_date 가 NULL 이면 fallback 으로 used_at 날짜 부분.
      attended_at: t.class_date ?? toDateOnly(t.used_at as string),
      status: "출석",
      aca_attendance_id: null,
      aca_class_id: t.aca_class_id,
      created_at: t.created_at,
    }));

    attendancesRaw = [...attendancesRawDb, ...ticketAsAttendance].sort(
      compareAttendancesDesc,
    );

    // (2) expectedSessions — 결제완료 ticket 의 class_date 전체.
    // 미사용 / 결제전 / 사용분 구분 없이 "결제된 모든 회차" 가 column 으로
    // 펼쳐져 진척도(예: 7회 중 1회 출석) 가 한눈에 보임.
    // aca_class_id 가 NULL 이거나 class_date 가 NULL 인 행은 매칭 불가라 제외.
    expectedSessions = ticketRows
      .filter(
        (t): t is typeof t & { aca_class_id: string; class_date: string } =>
          typeof t.aca_class_id === "string" &&
          t.aca_class_id.length > 0 &&
          typeof t.class_date === "string" &&
          t.class_date.length > 0,
      )
      .map((t) => ({
        aca_class_id: t.aca_class_id,
        class_date: toDateOnly(t.class_date),
      }));
  }

  // 강좌 마스터 lookup — aca_class_id 로 묶어 1쿼리, 그 다음 머지.
  // enrollments 와 attendances 는 같은 aca_class_id 풀을 공유하지만
  // select 컬럼/진화 방향이 달라 함수를 분리해 결합도를 낮췄다.
  const enrollments = await attachClassLookup(supabase, enrollmentsRaw);
  const attendances = await attachAttendanceClassLookup(
    supabase,
    attendancesRaw,
  );

  return { profile, enrollments, attendances, messages, expectedSessions };
}

/**
 * timestamptz 또는 ISO 문자열에서 'YYYY-MM-DD' 부분만 추출.
 * aca_tickets.used_at(timestamptz) 을 crm_attendances.attended_at(DATE) 형식에
 * 맞추는 데 사용. 입력이 이미 'YYYY-MM-DD' 면 그대로 반환.
 */
function toDateOnly(value: string): string {
  // 'YYYY-MM-DD...' 형태 — 앞 10자가 날짜.
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/**
 * enrollments 의 aca_class_id 들을 모아 classes 를 in 쿼리로 단일 lookup 후
 * 각 행에 class 필드로 머지한다. NULL 또는 미매칭 행은 class=null.
 */
async function attachClassLookup(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  enrollments: EnrollmentRow[],
): Promise<EnrollmentWithClass[]> {
  const ids = Array.from(
    new Set(
      enrollments
        .map((e) => e.aca_class_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );

  if (ids.length === 0) {
    return enrollments.map((e) => ({ ...e, class: null }));
  }

  const { data, error } = await supabase
    .from("crm_classes")
    .select("aca_class_id, total_sessions, amount_per_session, teacher_name, subject, subject_raw")
    .in("aca_class_id", ids);

  if (error) {
    throw new Error(`강좌 마스터 조회에 실패했습니다: ${error.message}`);
  }

  const lookup = new Map<string, EnrollmentClassLookup>();
  for (const row of (data ?? []) as Array<
    EnrollmentClassLookup & { aca_class_id: string }
  >) {
    lookup.set(row.aca_class_id, {
      total_sessions: row.total_sessions,
      amount_per_session: row.amount_per_session,
      teacher_name: row.teacher_name,
      subject: row.subject,
      subject_raw: row.subject_raw,
    });
  }

  return enrollments.map((e) => ({
    ...e,
    class: e.aca_class_id ? (lookup.get(e.aca_class_id) ?? null) : null,
  }));
}

/**
 * attendances 의 aca_class_id 들을 모아 classes 를 in 쿼리로 단일 lookup 후
 * 각 행에 class 필드로 머지한다. NULL/빈문자열/미매칭 행은 class=null.
 *
 * 학생 상세 "강좌 × 일자 격자" UI 의 group by 키 + 표시용 메타 (반명·교사·요일·시간) 제공.
 * enrollments 용 lookup 과는 select 컬럼이 다르므로 별도 함수로 유지.
 */
async function attachAttendanceClassLookup(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  attendances: AttendanceRow[],
): Promise<AttendanceWithClass[]> {
  const ids = Array.from(
    new Set(
      attendances
        .map((a) => a.aca_class_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );

  if (ids.length === 0) {
    return attendances.map((a) => ({ ...a, class: null }));
  }

  const { data, error } = await supabase
    .from("crm_classes")
    .select(
      "aca_class_id, name, teacher_name, subject, subject_raw, schedule_days, schedule_time, start_date, end_date",
    )
    .in("aca_class_id", ids);

  if (error) {
    throw new Error(
      `출석 격자용 강좌 마스터 조회에 실패했습니다: ${error.message}`,
    );
  }

  const lookup = new Map<string, AttendanceClassLookup>();
  for (const row of (data ?? []) as Array<
    AttendanceClassLookup & { aca_class_id: string }
  >) {
    lookup.set(row.aca_class_id, {
      name: row.name,
      teacher_name: row.teacher_name,
      subject: row.subject,
      subject_raw: row.subject_raw,
      schedule_days: row.schedule_days,
      schedule_time: row.schedule_time,
      start_date: row.start_date,
      end_date: row.end_date,
    });
  }

  return attendances.map((a) => ({
    ...a,
    class: a.aca_class_id ? (lookup.get(a.aca_class_id) ?? null) : null,
  }));
}

// ─── 내부 유틸 ───────────────────────────────────────────────

type RawMessageJoinRow = {
  id: string;
  phone: string;
  status: StudentMessageRow["status"];
  sent_at: string | null;
  campaign_id: string;
  // Supabase 조인은 관계 형태에 따라 객체 또는 배열로 반환될 수 있음
  campaigns: { title: string } | { title: string }[] | null;
};

function mapMessageRows(rows: unknown[]): StudentMessageRow[] {
  return rows.map((raw) => {
    const row = raw as RawMessageJoinRow;
    const campaignTitle = extractCampaignTitle(row.campaigns);
    return {
      id: row.id,
      phone: row.phone,
      status: row.status,
      sent_at: row.sent_at,
      campaign_id: row.campaign_id,
      campaign_title: campaignTitle,
    };
  });
}

function extractCampaignTitle(
  campaigns: RawMessageJoinRow["campaigns"],
): string {
  if (!campaigns) return "";
  if (Array.isArray(campaigns)) {
    return campaigns[0]?.title ?? "";
  }
  return campaigns.title ?? "";
}

function compareEnrollmentsDesc(a: EnrollmentRow, b: EnrollmentRow): number {
  // paid_at DESC NULLS LAST, 그 다음 start_date DESC
  const paid = compareNullableStringDesc(a.paid_at, b.paid_at);
  if (paid !== 0) return paid;
  return compareNullableStringDesc(a.start_date, b.start_date);
}

function compareAttendancesDesc(a: AttendanceRow, b: AttendanceRow): number {
  // attended_at 은 non-null 이지만 안전하게 비교
  if (a.attended_at === b.attended_at) return 0;
  return a.attended_at < b.attended_at ? 1 : -1;
}

function compareMessagesDesc(
  a: StudentMessageRow,
  b: StudentMessageRow,
): number {
  return compareNullableStringDesc(a.sent_at, b.sent_at);
}

/** 문자열 기반 DESC 정렬 (null 은 뒤로). */
function compareNullableStringDesc(
  a: string | null,
  b: string | null,
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b.localeCompare(a);
}
