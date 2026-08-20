"use server";

/**
 * 수신거부 관리 페이지 Server Actions.
 *
 * 조회는 RLS(읽기 전체)에 위임 — 권한 가드는 페이지(server component)가
 * master/admin 으로 막는다. 등록/해제는 students/actions 의 기존 액션 재사용:
 *   - addUnsubscribeAction: 로그인 필요 (게이팅은 UI 책임)
 *   - removeUnsubscribeAction: master 전용 (서버에서 역할 재확인)
 *
 * 페이지가 한 곳에서 import 하도록 두 액션을 편의 재노출.
 */

import {
  listUnsubscribes,
  type UnsubscribeRow,
} from "@/lib/messaging/list-unsubscribes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import {
  groupPhoneMatches,
  type PhoneMatchRow,
} from "@/lib/students/group-phone-matches";

/**
 * 수신거부 목록 조회. search 가 문자열 아니면 "" 로 정규화.
 * 실패 시 failed 로 감싸 UI 가 빈 표 fallback 을 결정.
 *
 * ⚠️ "use server" 파일은 async 함수만 export 가능 — 타입 export·재노출 금지.
 *    반환 타입은 인라인, 등록/해제(addUnsubscribeAction/removeUnsubscribeAction)는
 *    호출부가 @/app/(features)/students/actions 에서 직접 import 한다(단일 소스).
 */
export async function listUnsubscribesAction(
  search: unknown,
): Promise<
  | { status: "success"; data: UnsubscribeRow[] }
  | { status: "failed"; reason: string }
> {
  const term = typeof search === "string" ? search : "";
  try {
    const data = await listUnsubscribes(term);
    return { status: "success", data };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "수신거부 목록 조회 실패";
    return { status: "failed", reason };
  }
}

/** 번호 조회 최소 자릿수. addUnsubscribeAction 의 등록 기준과 동일. */
const LOOKUP_MIN_DIGITS = 9;

/**
 * 번호로 학생을 찾아 되비춘다 — 수신거부 등록 전 "누구인지" 확인용.
 *
 * 왜 필요한가(운영 요청 2026-08-20):
 *   "학부모 수신 차단 요청이 오면 누군지도 모르고 그냥 차단하고 있다."
 *   등록은 되돌릴 수 있지만(master 한정 해제), 잘못 차단하면 그 학부모에게
 *   개강·공지 문자가 통째로 안 나가므로 등록 전에 확인 수단이 필요하다.
 *
 * 매칭:
 *   학부모 번호(parent_phone) 와 학생 본인 번호(phone) 를 모두 본다 —
 *   차단 요청이 학생 번호로 오는 경우도 있다. 어느 쪽으로 걸렸는지 함께 돌려준다.
 *   형제자매가 같은 학부모 번호를 쓰면 여러 명이 나온다(전부 반환).
 *
 * 권한:
 *   사용자 세션 클라이언트 → crm_students 의 RLS 가 적용된다. 즉 비-master 는
 *   본인 분원 학생만 보인다. 수신거부 자체는 분원 공통이라 타 분원 학생은
 *   "못 찾음" 으로 뜨는데, 그건 지금과 같은 상태이므로 등록을 막지는 않는다.
 */
export async function lookupStudentsByPhoneAction(input: unknown): Promise<
  | {
      status: "success";
      students: Array<{
        id: string;
        name: string | null;
        school: string | null;
        grade: string | null;
        /** 이 학생이 등록된 분원들. 한 사람이 여러 분원에 따로 등록돼 있을 수 있다. */
        branches: string[];
        status: string | null;
        matchedAs: "학부모" | "학생";
      }>;
    }
  | { status: "skipped" }
  | { status: "failed"; reason: string }
> {
  const raw =
    typeof input === "string"
      ? input
      : typeof input === "object" && input !== null && "phone" in input
        ? String((input as { phone: unknown }).phone ?? "")
        : "";
  const digits = raw.replace(/\D/g, "");
  // 자릿수가 모자라면 조회하지 않는다 — 타이핑 중 전체 스캔을 유발하지 않기 위함.
  if (digits.length < LOOKUP_MIN_DIGITS) return { status: "skipped" };

  if (isDevSeedMode()) return { status: "success", students: [] };

  const user = await getCurrentUser();
  if (!user) return { status: "failed", reason: "로그인 후 이용 가능합니다" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_students")
    .select("id, name, school, grade, branch, status, parent_phone, phone")
    .or(`parent_phone.eq.${digits},phone.eq.${digits}`)
    .limit(20);

  if (error) {
    return { status: "failed", reason: `학생 조회에 실패했습니다: ${error.message}` };
  }

  const rows = (data ?? []) as PhoneMatchRow[];

  // 한 사람이 여러 행으로 잡히는 것을 이름 기준으로 접는다(분원별 중복 등록).
  // 병합 규칙과 근거는 groupPhoneMatches 참조.
  return { status: "success", students: groupPhoneMatches(rows, digits) };
}
