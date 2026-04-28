import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AttendanceRow,
  EnrollmentRow,
  StudentDetail,
  StudentMessageRow,
  StudentProfileRow,
} from "@/types/database";
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

  const enrollments = [...findDevEnrollmentsByStudentId(studentId)].sort(
    compareEnrollmentsDesc,
  );
  const attendances = [...findDevAttendancesByStudentId(studentId)].sort(
    compareAttendancesDesc,
  );
  const messages = [...findDevMessagesByStudentId(studentId)].sort(
    compareMessagesDesc,
  );

  return { profile, enrollments, attendances, messages };
}

async function getFromSupabase(
  studentId: string,
): Promise<StudentDetail | null> {
  const supabase = await createSupabaseServerClient();

  const [profileRes, enrollmentsRes, attendancesRes, messagesRes] =
    await Promise.all([
      supabase
        .from("student_profiles")
        .select("*")
        .eq("id", studentId)
        .maybeSingle(),
      supabase
        .from("enrollments")
        .select("*")
        .eq("student_id", studentId)
        .order("paid_at", { ascending: false, nullsFirst: false })
        .order("start_date", { ascending: false }),
      supabase
        .from("attendances")
        .select("*")
        .eq("student_id", studentId)
        .order("attended_at", { ascending: false }),
      supabase
        .from("messages")
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
  const enrollments = (enrollmentsRes.data ?? []) as EnrollmentRow[];
  const attendances = (attendancesRes.data ?? []) as AttendanceRow[];
  const messages = mapMessageRows(messagesRes.data ?? []);

  return { profile, enrollments, attendances, messages };
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
