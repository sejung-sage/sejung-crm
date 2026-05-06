/**
 * 학교 → 지역 매핑 Upsert.
 *
 * INSERT ... ON CONFLICT (school) DO UPDATE 패턴. 새 학교/기존 학교 모두 멱등.
 *
 * 정책:
 *  - 입력은 SchoolRegionUpsertSchema 로 재검증 (호출부가 이미 검증했더라도 중복 검증).
 *  - dev-seed 모드: 쓰기 차단 (DEV_SCHOOL_REGIONS 는 정적 시드).
 *  - 인증/권한은 호출부 (Server Action 레이어) 에서 선검증. 본 함수는 DB I/O 만 담당.
 */

import {
  SchoolRegionUpsertSchema,
  type SchoolRegionUpsert,
} from "@/lib/schemas/region";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SchoolRegionRow } from "@/types/database";

export class DevSeedReadOnlyError extends Error {
  constructor() {
    super("dev-seed 모드에서는 매핑을 수정할 수 없습니다");
    this.name = "DevSeedReadOnlyError";
  }
}

/**
 * 학교 → 지역 매핑 Upsert.
 *
 * @returns 생성/갱신된 행 (전체 컬럼 포함).
 * @throws Zod 검증 실패 시 ZodError; dev-seed 모드면 DevSeedReadOnlyError;
 *         RLS/네트워크 등 DB 에러는 메시지를 포함한 Error.
 */
export async function upsertSchoolRegion(
  input: SchoolRegionUpsert,
): Promise<SchoolRegionRow> {
  // 호출부가 검증했더라도 한 번 더. trim/길이 가드는 스키마 책임.
  const parsed = SchoolRegionUpsertSchema.parse(input);

  if (isDevSeedMode()) {
    throw new DevSeedReadOnlyError();
  }

  const supabase = await createSupabaseServerClient();

  // Supabase v2 Database 타입 추론 한계 (groups/actions.ts 와 동일 패턴) —
  // upsert + onConflict 의 좁은 타입을 명시적으로 캐스팅.
  const result = await (
    supabase.from("school_regions") as unknown as {
      upsert: (
        v: Pick<SchoolRegionRow, "school" | "region">,
        options: { onConflict: string },
      ) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: SchoolRegionRow | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .upsert(
      { school: parsed.school, region: parsed.region },
      { onConflict: "school" },
    )
    .select("school, region, created_at, updated_at")
    .single();

  if (result.error) {
    throw new Error(`지역 매핑 저장에 실패했습니다: ${result.error.message}`);
  }
  if (!result.data) {
    throw new Error("저장된 지역 매핑을 읽지 못했습니다");
  }

  return result.data;
}
