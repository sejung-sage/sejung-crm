/**
 * 강좌 1개의 회차(수업일) 목록 + 회차별 인원수.
 *
 * "강좌 클릭 → 회차 클릭" 드롭다운을 채우기 위한 경량 조회. 0118 의
 * crm_class_session_dates RPC 를 호출한다.
 *
 * getClassSessions(get-class-sessions.ts) 와의 차이:
 *   저쪽은 회차 격자(학생 이름·연락처·학교까지)를 그리는 무거운 로더로,
 *   티켓 전량 + crm_students batch 조회를 한다. 드롭다운엔 날짜와 인원수만
 *   필요하므로 SQL 에서 GROUP BY 로 끝내고 행 몇 개만 받는다.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export interface ClassSessionDate {
  /** 수업일 ISO 'YYYY-MM-DD'. includeClassDates 에 저장되는 값. */
  date: string;
  /** 1-based 회차 번호 (날짜 오름차순). */
  sessionNo: number;
  /** 그날 수강권이 있는 학생 수. */
  studentCount: number;
}

export interface ClassSessionDatesResult {
  sessions: ClassSessionDate[];
  /**
   * 이 강좌의 등록(crm_enrollments) 학생 수.
   *
   * **회차가 0개일 때만 채운다** (그 외엔 0). 설명회·독학관처럼 수강권 티켓을
   * 발급하지 않는 강좌가 운영 데이터의 4~16% 있는데, 티켓 기준 필터로는 0명이
   * 잡힌다. 운영자에게 "왜 0명인지" 를 알려주기 위한 값이라 회차가 있을 땐
   * 불필요한 count 쿼리를 돌리지 않는다.
   */
  enrolledCount: number;
}

interface SessionRow {
  class_date: string;
  student_count: number;
}

const EMPTY: ClassSessionDatesResult = { sessions: [], enrolledCount: 0 };

/**
 * @param classId crm_classes.id. aca_class_id 가 NULL 인 자체 등록 강좌는 빈 결과.
 */
export async function listClassSessionDates(
  classId: string,
): Promise<ClassSessionDatesResult> {
  if (isDevSeedMode()) return EMPTY;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: "crm_class_session_dates",
      p: { p_class_id: string },
    ) => Promise<{
      data: SessionRow[] | null;
      error: { message: string } | null;
    }>
  )("crm_class_session_dates", { p_class_id: classId });

  if (error) {
    throw new Error(`강좌 회차 조회에 실패했습니다: ${error.message}`);
  }

  // RPC 가 class_date 오름차순으로 반환 — 그 순서가 곧 회차 번호.
  const sessions: ClassSessionDate[] = (data ?? []).map((r, idx) => ({
    date: r.class_date,
    sessionNo: idx + 1,
    studentCount: Number(r.student_count),
  }));

  if (sessions.length > 0) {
    return { sessions, enrolledCount: 0 };
  }

  // 회차 0개 — 수강권 미발급 강좌인지, 그냥 빈 반인지 구분해 주기 위해 등록 수를 센다.
  return { sessions, enrolledCount: await countEnrolled(supabase, classId) };
}

/** 강좌의 등록 학생 수. aca_class_id 가 없으면(자체 등록 강좌) 0. */
async function countEnrolled(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  classId: string,
): Promise<number> {
  const { data: cls } = await supabase
    .from("crm_classes")
    .select("aca_class_id")
    .eq("id", classId)
    .maybeSingle();
  const acaClassId = (cls as { aca_class_id: string | null } | null)
    ?.aca_class_id;
  if (!acaClassId) return 0;

  const { count } = await supabase
    .from("crm_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("aca_class_id", acaClassId);
  return count ?? 0;
}
