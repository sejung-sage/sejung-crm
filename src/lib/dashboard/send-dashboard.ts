/**
 * 발송 대시보드 · 서버 데이터 레이어 (마스터 전용)
 *
 * architect 가 작성한 집계 RPC `crm_send_dashboard`(0102) 를 래핑한다.
 * - RPC 내부에 is_master() 가드가 있어 SECURITY DEFINER 로도 마스터만 집계 가능.
 *   데이터 레이어에서도 viewer.role 로 1차 방어(비마스터면 빈 배열).
 * - 세션 기반 supabase 클라이언트로 호출해야 RLS·is_master() 컨텍스트가 유지된다.
 *   service-role 로 우회하지 않는다(마스터 가드가 세션 역할에 의존).
 *
 * from/to 는 'YYYY-MM-DD'(KST) 로 받아 list-campaigns 와 동일하게
 * `T00:00:00+09:00` / `T23:59:59+09:00` 경계 timestamptz 로 변환해 전달한다.
 */

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/types/database";

// ─── 필터 스키마 ────────────────────────────────────────────────

/**
 * 'YYYY-MM-DD' 형식 + 실제 존재하는 날짜만 통과. 아니면 undefined 로 떨궈 필터 미적용.
 * (형식만 보면 '2026-13-99' 같은 값이 그대로 RPC 로 흘러가므로 달력 유효성까지 검증.)
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  })
  .optional()
  .catch(undefined);

/**
 * URL searchParams(문자열) 로부터 견고하게 파싱한다.
 * enum(seminar/groupBy) 은 잘못된 값이면 `.catch()` 로 기본값으로 복구,
 * 나머지는 optional. from/to 는 'YYYY-MM-DD' 형식 검증(불통과 → undefined).
 */
export const SendDashboardFilterSchema = z.object({
  from: isoDate,
  to: isoDate,
  branch: z.string().min(1).optional().catch(undefined),
  sender: z.string().min(1).optional().catch(undefined),
  seminar: z.enum(["all", "with", "without"]).catch("all").default("all"),
  groupBy: z.enum(["month", "branch", "sender"]).catch("month").default("month"),
});

export type SendDashboardFilters = z.infer<typeof SendDashboardFilterSchema>;

// ─── 행 타입 ────────────────────────────────────────────────────

export type SendDashboardRow = {
  groupKey: string;
  groupLabel: string;
  msgCount: number;
  totalCost: number;
  smsCount: number;
  lmsCount: number;
  alimtalkCount: number;
};

/**
 * RPC 원시 행 스키마. bigint 컬럼은 supabase-js 가 number 또는 string 으로
 * 줄 수 있으므로 둘 다 받아 Number(...) 로 정규화한다.
 */
const bigintish = z.union([z.number(), z.string()]);

const rpcRowSchema = z.object({
  group_key: z.string(),
  group_label: z.string(),
  msg_count: bigintish,
  total_cost: bigintish,
  sms_count: bigintish,
  lms_count: bigintish,
  alimtalk_count: bigintish,
});

const rpcRowsSchema = z.array(rpcRowSchema);

/**
 * RPC 좁힌 인터페이스 — `crm_send_dashboard` 가 아직 generated Database 타입에
 * 없어 캐스팅. 마이그(0102) 적용 후 `supabase gen types` 재실행 시 제거 가능.
 */
interface RpcCaller {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

// ─── 조회 함수 ──────────────────────────────────────────────────

export async function getSendDashboard(
  filters: SendDashboardFilters,
  viewer: Pick<CurrentUser, "role"> | null,
): Promise<SendDashboardRow[]> {
  // 데이터 레이어 1차 가드: 비마스터면 즉시 빈 배열. (RPC 내부 is_master() 가 2차)
  if (!viewer || viewer.role !== "master") {
    return [];
  }

  const supabase = await createSupabaseServerClient();
  const rpc = supabase as unknown as RpcCaller;

  // KST 경계로 변환 — list-campaigns 의 sent_at 범위 필터와 동일한 방식.
  const pFrom = filters.from ? `${filters.from}T00:00:00+09:00` : null;
  const pTo = filters.to ? `${filters.to}T23:59:59+09:00` : null;

  const { data, error } = await rpc.rpc("crm_send_dashboard", {
    p_from: pFrom,
    p_to: pTo,
    p_branch: filters.branch ?? null,
    p_sender: filters.sender ?? null,
    p_seminar: filters.seminar,
    p_group_by: filters.groupBy,
  });

  if (error) {
    throw new Error(`발송 대시보드 조회에 실패했습니다: ${error.message}`);
  }

  const rows = rpcRowsSchema.parse(data ?? []);

  return rows.map((r) => ({
    groupKey: r.group_key,
    groupLabel: r.group_label,
    msgCount: Number(r.msg_count),
    totalCost: Number(r.total_cost),
    smsCount: Number(r.sms_count),
    lmsCount: Number(r.lms_count),
    alimtalkCount: Number(r.alimtalk_count),
  }));
}
