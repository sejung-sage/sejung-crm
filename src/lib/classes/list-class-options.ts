/**
 * 발송 그룹 빌더의 "강좌별 제외" 드롭다운용 강좌 옵션 prefetch.
 *
 * 분원의 강좌를 `{ id, name, teacher_name, subject }` 형태로 단순 나열한다.
 * 그룹 빌더는 이 목록에서 강좌를 다중 선택해 `excludeClassIds`(crm_classes.id)
 * 로 저장하고, 발송 시점에 그 강좌 현재 수강생을 동적으로 차감한다
 * (제외 동적 결정 근거는 GroupFiltersSchema.excludeClassIds 주석 참조).
 *
 * 정책:
 *  - 진행 중 강좌만 노출. 종강·폐강 prefix(4종) 로 시작하는 강좌와 미래 강좌
 *    필터 없이, end_date 가 NULL 이거나 오늘(KST) 이후인 강좌 + prefix 미해당.
 *    제외 후보로 "이미 끝난 강좌"를 노출하면 발송 의도와 무관해 혼란만 준다.
 *  - 설명회(subject='설명회') 도 노출 — 설명회 수강생을 제외 대상으로 삼는
 *    케이스가 있을 수 있어 진행 중 강좌와 함께 둔다.
 *  - aca_class_id 가 NULL 인 자체 등록 강좌도 목록엔 노출하되, 수신자 해석 시
 *    enrollment 매칭이 불가해 제외 대상 0명이 되는 건 backend 가 처리.
 *
 * dev-seed 모드: 강좌 시드가 없어 빈 배열 반환.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import type { Subject } from "@/types/database";

export interface ClassOption {
  /** crm_classes.id (UUID). excludeClassIds 에 저장되는 값. */
  id: string;
  /** 반명. */
  name: string;
  /** 강사명 (없으면 null). 드롭다운 보조 라벨. */
  teacher_name: string | null;
  /** 정규화 과목 (없으면 null). */
  subject: Subject | null;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // 안전상한 — 1만 강좌. 분원 1개 규모엔 충분.

/**
 * 종강·폐강 prefix 4종 — list-classes.ts 와 동일.
 * 진행 중 강좌만 제외 후보로 노출하기 위한 가드.
 */
const GRADUATED_NAME_PREFIXES = ["(종)", "종)", "(폐)", "폐)"] as const;

function todayKstDateString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

interface OptionRow {
  id: string;
  name: string;
  teacher_name: string | null;
  subject: Subject | null;
}

/**
 * 주어진 crm_classes.id 목록의 강좌 메타(id+name+teacher+subject)를 조회.
 *
 * 용도: 그룹 수정 모드에서 이미 저장된 excludeClassIds 의 칩 라벨을 그리기 위함.
 * 진행 중 옵션(listClassOptions)에서 빠진 종강 강좌라도 칩으로 보여줘 해제할 수
 * 있게 하기 위해 별도 lookup. 빈 입력이면 빈 배열 즉시 반환.
 */
export async function getClassOptionsByIds(
  ids: readonly string[],
): Promise<ClassOption[]> {
  if (isDevSeedMode() || ids.length === 0) {
    return [];
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_classes")
    .select("id, name, teacher_name, subject")
    .in("id", ids as string[]);
  if (error) {
    return [];
  }
  const rows = (data ?? []) as unknown as OptionRow[];
  return rows
    .filter(
      (row): row is OptionRow =>
        typeof row.id === "string" && typeof row.name === "string",
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      teacher_name: row.teacher_name,
      subject: row.subject,
    }));
}

export async function listClassOptions(branch: string): Promise<ClassOption[]> {
  if (isDevSeedMode()) {
    return [];
  }
  const supabase = await createSupabaseServerClient();
  const today = todayKstDateString();
  const out: ClassOption[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("crm_classes")
      .select("id, name, teacher_name, subject")
      // 진행 중: 종강일 미정(NULL) 또는 오늘 이후. prefix 가드는 아래 .not 으로.
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("name", { ascending: true })
      .range(from, to);

    if (branch && branch !== "" && branch !== "전체") {
      query = query.eq("branch", branch);
    }

    // 종강·폐강 prefix 4종 가드 — end_date 백필 누락 행이 새는 걸 막음.
    for (const prefix of GRADUATED_NAME_PREFIXES) {
      query = query.not("name", "ilike", `${prefix}%`);
    }

    const { data, error } = await query;
    if (error) {
      // 옵션 prefetch 실패는 페이지를 깨지 않는다 — 지금까지 모은 것만 반환.
      break;
    }

    const rows = (data ?? []) as unknown as OptionRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (typeof row.id === "string" && typeof row.name === "string") {
        out.push({
          id: row.id,
          name: row.name,
          teacher_name: row.teacher_name,
          subject: row.subject,
        });
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return out;
}
