/**
 * 강좌 회차(날짜)별 수강 명단 data loader.
 *
 * 배경: Aca2000 처럼 "특정 회차(날짜)에 수업 듣는 학생만" 보여주려면 학생마다
 * 듣는 날짜 집합을 알아야 한다. `aca_tickets`(수강권)는 **"학생 × 수업일(class_date)"
 * 단위로 1행씩** 들어있어, `(aca_class_id, class_date)` 로 그 날 티켓 있는 학생만
 * 정확히 뽑을 수 있다. 8회 중 7회만 듣는 학생은 안 듣는 날짜에 행이 없어 그 회차
 * 명단에서 자동 제외된다. (crm_enrollments 는 강좌 전체 등록이라 회차 구분 불가 →
 * 회차별은 aca_tickets 기준.)
 *
 * 흐름:
 *   1) aca_tickets 를 aca_class_id 로 페이지네이션 수집 (class_date NOT NULL).
 *      RLS(can_read_branch) 가 분원 격리, aca_class_id 는 분원 고유라 추가 필터 불필요.
 *   2) class_date 로 group → 회차 목록(오름차순, 1-based sessionNo).
 *   3) distinct aca_student_id → crm_students(aca2000_id) batch 조회로 메타·연락처 매핑.
 *      매핑 실패 학생은 티켓 denorm(이름/학교/학년)으로 표시(연락처는 없음 → 발송 제외).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import type { Grade, StudentStatus } from "@/types/database";

/** 회차 명단 한 사람. */
export interface SessionStudent {
  /** crm_students.id (매핑 실패 시 null — 발송 대상에서 제외). */
  id: string | null;
  /** 아카 학생 키 (중복 제거·디버그용). */
  aca_student_id: string;
  name: string;
  school: string | null;
  grade: Grade | string | null;
  /** 학부모 연락처 (crm_students). 회차별 발송 대상. */
  parent_phone: string | null;
  status: StudentStatus | null;
}

/** 한 회차(수업일). */
export interface ClassSession {
  /** 수업일 ISO 'YYYY-MM-DD'. */
  date: string;
  /** 1-based 회차 번호 (날짜 오름차순). */
  sessionNo: number;
  students: SessionStudent[];
}

export interface ClassSessionsResult {
  sessions: ClassSession[];
  /** 강좌 총 회차 수(class_total_sessions). 표시용. 없으면 회차 개수로 fallback. */
  totalSessions: number;
}

/** PostgREST 기본 max_rows cap — 페이지 크기. */
const PAGE = 1000;
/** crm_students IN(...) 청크 — URL 한도 방어. */
const STUDENT_LOOKUP_CHUNK = 200;

const EMPTY: ClassSessionsResult = { sessions: [], totalSessions: 0 };

interface TicketRow {
  aca_student_id: string | null;
  class_date: string | null;
  class_total_sessions: number | null;
  student_name: string | null;
  student_school: string | null;
  student_grade: string | null;
}

/**
 * 강좌의 회차별 수강 명단.
 * @param acaClassId crm_classes.aca_class_id ("{branch}-{반고유코드}"). NULL 강좌는 빈 결과.
 */
export async function getClassSessions(
  acaClassId: string | null,
): Promise<ClassSessionsResult> {
  if (isDevSeedMode()) return EMPTY;
  if (!acaClassId) return EMPTY;

  const supabase = await createSupabaseServerClient();

  // 1) aca_tickets 수집 (페이지네이션). class_date 오름차순.
  const tickets: TicketRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("aca_tickets")
      .select(
        "aca_student_id, class_date, class_total_sessions, student_name, student_school, student_grade",
      )
      .eq("aca_class_id", acaClassId)
      .not("class_date", "is", null)
      .order("class_date", { ascending: true })
      .order("aca_student_id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      throw new Error(`강좌 회차 조회에 실패했습니다: ${error.message}`);
    }
    const rows = (data ?? []) as TicketRow[];
    tickets.push(...rows);
    if (rows.length < PAGE) break;
  }

  if (tickets.length === 0) return EMPTY;

  // 2) distinct aca_student_id → crm_students 메타 매핑.
  const acaStudentIds = Array.from(
    new Set(
      tickets
        .map((t) => t.aca_student_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const metaByAca = await loadStudentMeta(supabase, acaStudentIds);

  // 3) class_date 로 group. 같은 (날짜, 학생) 중복은 1회만.
  const byDate = new Map<string, Map<string, SessionStudent>>();
  let totalSessions = 0;
  for (const t of tickets) {
    if (!t.class_date || !t.aca_student_id) continue;
    if (t.class_total_sessions && t.class_total_sessions > totalSessions) {
      totalSessions = Math.round(t.class_total_sessions);
    }
    let group = byDate.get(t.class_date);
    if (!group) {
      group = new Map<string, SessionStudent>();
      byDate.set(t.class_date, group);
    }
    if (group.has(t.aca_student_id)) continue;
    const meta = metaByAca.get(t.aca_student_id);
    group.set(t.aca_student_id, {
      id: meta?.id ?? null,
      aca_student_id: t.aca_student_id,
      // 메타 매핑 성공 시 crm_students 우선, 실패 시 티켓 denorm.
      name: meta?.name ?? t.student_name ?? "",
      school: meta?.school ?? t.student_school ?? null,
      grade: meta?.grade ?? t.student_grade ?? null,
      parent_phone: meta?.parent_phone ?? null,
      status: meta?.status ?? null,
    });
  }

  // 4) 날짜 오름차순 → 회차 번호 부여, 학생 이름 정렬.
  const sessions: ClassSession[] = Array.from(byDate.keys())
    .sort()
    .map((date, idx) => {
      const students = Array.from(byDate.get(date)!.values()).sort((a, b) =>
        a.name.localeCompare(b.name, "ko"),
      );
      return { date, sessionNo: idx + 1, students };
    });

  return {
    sessions,
    totalSessions: totalSessions || sessions.length,
  };
}

interface StudentMeta {
  id: string;
  name: string;
  school: string | null;
  grade: Grade | null;
  parent_phone: string | null;
  status: StudentStatus;
}

/** aca2000_id → crm_students 메타 맵 (청크 IN 조회). */
async function loadStudentMeta(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  acaStudentIds: string[],
): Promise<Map<string, StudentMeta>> {
  const out = new Map<string, StudentMeta>();
  if (acaStudentIds.length === 0) return out;

  type Row = {
    id: string;
    aca2000_id: string;
    name: string;
    school: string | null;
    grade: Grade | null;
    parent_phone: string | null;
    status: StudentStatus;
  };

  for (let i = 0; i < acaStudentIds.length; i += STUDENT_LOOKUP_CHUNK) {
    const chunk = acaStudentIds.slice(i, i + STUDENT_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from("crm_students")
      .select("id, aca2000_id, name, school, grade, parent_phone, status")
      .in("aca2000_id", chunk);

    if (error) {
      throw new Error(`회차 명단 학생 조회에 실패했습니다: ${error.message}`);
    }
    for (const r of (data ?? []) as Row[]) {
      out.set(r.aca2000_id, {
        id: r.id,
        name: r.name,
        school: r.school,
        grade: r.grade,
        parent_phone: r.parent_phone,
        status: r.status,
      });
    }
  }
  return out;
}
