import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { CreateBroadcastInput } from "@/lib/schemas/seminar";

/**
 * F5 · 설명회 발송 · `{이름}` 본문 변수 잔존 가드 회귀 테스트.
 *
 * 배경(버그):
 *   createSeminarBroadcastAction 은 본문의 `{초대링크}`(INVITE_TOKEN)를 sendon
 *   치환 슬롯 `#{이름}`(SENDON_INVITE_PLACEHOLDER)으로 변환한다. 과거 구현은 변환
 *   *후* finalBody 기준으로 `finalBody.includes("{이름}")` 잔존 검사를 했는데,
 *   `"#{이름}"` 문자열은 `"{이름}"` 을 부분 문자열로 포함하므로 항상 true 가 되어
 *   운영자가 `{이름}` 을 쓰지 않아도 무조건 "설명회 발송에서는 {이름} 변수를
 *   사용할 수 없습니다" 로 차단됐다.
 *
 *   수정: 검사를 치환 *전* 원문(`trimmed = parsed.body.trim()`) 기준으로 옮기고,
 *   `{초대링크}` → `#{이름}` 치환보다 앞에서 수행한다.
 *
 * 이 파일의 목적:
 *   actions.ts 의 `{이름}` 가드(라인 ~528) 까지 실제로 도달하려면 dev-seed OFF +
 *   인증/권한/강좌/그룹/수신자 로딩/디스패치까지 모두 통과해야 한다. seminars-
 *   broadcast-guards.test.ts 는 dev-seed 조기 반환 또는 Zod 실패 단계에서 끝나
 *   이 가드를 건드리지 못하므로, 여기서 의존성을 모킹해 가드 도달 경로를 만든다.
 *
 *   ⚠️ 모킹이 파일 전역에 적용되므로(`vi.mock` 호이스팅) dev-seed/Zod 단계만
 *      검증하는 기존 파일과 분리해 독립 파일로 둔다.
 */

const validUuid = "11111111-1111-4111-8111-111111111111";
const validUuid2 = "22222222-2222-4222-8222-222222222222";

// ─── 의존성 모킹 ────────────────────────────────────────────
//
// 가드 도달 전후로 호출되는 lib 함수들을 전부 행복 경로(happy path)로 고정한다.
// 본문 가공·검증 로직만 실제 actions.ts 코드가 돌게 두고, DB/인증/sendon 은 가짜.

// dev-seed 는 항상 OFF (조기 반환 회피).
vi.mock("@/lib/profile/students-dev-seed", () => ({
  isDevSeedMode: () => false,
}));

// 인증: 항상 master 통과 (권한·분원 격리 무관).
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: validUuid,
    email: "master@sejung.test",
    name: "원장",
    role: "master" as const,
    branch: "대치",
    active: true,
    must_change_password: false,
  })),
}));

// 그룹 조회: 분원 일치하는 그룹 1개 반환 (getGroup 직접 호출 가드용).
vi.mock("@/lib/groups/get-group", () => ({
  getGroup: vi.fn(async (id: string) => ({
    id,
    name: "테스트 그룹",
    branch: "대치",
    filters: {},
    recipient_count: 1,
    last_sent_at: null,
    last_message_preview: null,
    created_by: null,
    created_at: "2026-06-02T00:00:00Z",
    updated_at: "2026-06-02T00:00:00Z",
    creator_name: null,
  })),
}));

// 그룹 펼침: 학부모 번호가 있는 학생 1명.
vi.mock("@/lib/groups/load-all-group-recipients", () => ({
  loadAllGroupRecipients: vi.fn(async () => [
    {
      id: "student-1",
      name: "김민준",
      parent_phone: "01090010001",
      phone: "01011110001",
      status: "재원생",
    },
  ]),
}));

// 수신거부 번호 없음.
vi.mock("@/lib/messaging/unsubscribed-phones", () => ({
  getUnsubscribedPhones: vi.fn(async () => [] as string[]),
}));

// sendon 디스패치: 항상 1건 성공 (실 발송 X).
vi.mock("@/lib/seminars/dispatch-broadcast", () => ({
  dispatchBroadcast: vi.fn(async () => ({
    sent: 1,
    failed: 0,
    totalCost: 7,
    failedReason: null,
  })),
}));

// Supabase 서버 클라이언트: 강좌 검증·페이지 find-or-create·campaign/invitation/
// items INSERT 체인을 모두 가짜로 충족. actions.ts 가 사용하는 메서드 체인:
//   .from(t).select(c).in(col, vals)                  → 강좌·페이지 조회
//   .from(t).insert(rows).select(c)                   → 페이지 생성
//   .from(t).insert(row).select(c).single()           → campaign/invitation 생성
//   .from(t).insert(rows)                             → items 생성
//   .from(t).update(v).eq(col, val)                   → 캠페인 상태 갱신
vi.mock("@/lib/supabase/server", () => {
  return {
    createSupabaseServerClient: vi.fn(async () => makeFakeSupabase()),
  };
});

// next/cache revalidatePath 는 테스트 환경에서 no-op.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * actions.ts 가 호출하는 PostgREST 체인을 흉내내는 최소 가짜 클라이언트.
 * 테이블 이름으로 분기해 각 단계가 기대하는 형태의 응답을 돌려준다.
 */
function makeFakeSupabase() {
  return {
    from(table: string) {
      return {
        // SELECT 경로: .select(cols)
        select(_cols: string) {
          return {
            // 강좌/페이지 조회: .in(col, vals)
            in(_col: string, vals: string[]) {
              if (table === "crm_classes") {
                return Promise.resolve({
                  data: vals.map((id) => ({
                    id,
                    branch: "대치",
                    subject: "설명회",
                    active: true,
                  })),
                  error: null,
                });
              }
              if (table === "crm_class_signup_pages") {
                // 기존 페이지 1:1 존재 (find-or-create 의 find 분기).
                return Promise.resolve({
                  data: vals.map((cid) => ({
                    id: `page-${cid}`,
                    class_id: cid,
                  })),
                  error: null,
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
        // INSERT 경로: .insert(rowOrRows)
        insert(rows: unknown) {
          // items INSERT 는 .insert(rows) 가 곧 Promise (체인 없음).
          const itemsPromise = Promise.resolve({ error: null });
          // 단건 INSERT (campaign/invitation): .insert(row).select(c).single()
          // 다건 INSERT (페이지): .insert(rows).select(c)
          const chain = {
            select(_cols: string) {
              return {
                single() {
                  // campaign / invitation 둘 다 { id } 한 행만 필요.
                  return Promise.resolve({
                    data: { id: `${table}-row-1` },
                    error: null,
                  });
                },
                then(
                  resolve: (v: {
                    data: Array<{ id: string; class_id: string }> | null;
                    error: null;
                  }) => void,
                ) {
                  // 다건 INSERT(.select 후 await): 생성된 페이지 행 반환.
                  const arr = Array.isArray(rows) ? rows : [rows];
                  resolve({
                    data: arr.map((r, i) => {
                      const rec = r as { class_id?: string };
                      return {
                        id: `created-page-${i}`,
                        class_id: rec.class_id ?? `class-${i}`,
                      };
                    }),
                    error: null,
                  });
                },
              };
            },
            // items INSERT: await .insert(rows) 직접.
            then(resolve: (v: { error: null }) => void) {
              itemsPromise.then(resolve);
            },
          };
          return chain;
        },
        // UPDATE 경로: .update(v).eq(col, val)
        update(_v: Record<string, unknown>) {
          return {
            eq(_col: string, _val: string) {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// 동적 import — vi.mock 호이스팅 이후 actions.ts 가 모킹된 의존성을 받도록.
async function loadAction() {
  const mod = await import("@/app/(features)/seminars/actions");
  return mod.createSeminarBroadcastAction;
}

const base: CreateBroadcastInput = {
  class_ids: [validUuid],
  group_id: validUuid2,
  body: "[설명회 안내]",
  subject: null,
  type: "SMS",
  branch: "대치",
  is_ad: false,
  allow_multiple: true, // 중복 신청 허용 (0087) — 기본 true(현행)
};

describe("createSeminarBroadcastAction · {이름} 본문 변수 잔존 가드", () => {
  beforeEach(() => {
    delete process.env.SEJUNG_DEV_SEED;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub-not-real.invalid";
    process.env.SENDON_FROM_NUMBER = "0212345678";
    process.env.APP_BASE_URL = "https://crm.sejung.test";
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SENDON_FROM_NUMBER;
    delete process.env.APP_BASE_URL;
  });

  describe("정상 케이스 (가드에 걸리지 않아야 함)", () => {
    it("(회귀 핵심) 본문에 {초대링크}만 있고 {이름}이 없으면 → {이름} 가드에서 차단되지 않는다", async () => {
      const createSeminarBroadcastAction = await loadAction();
      const r = await createSeminarBroadcastAction({
        ...base,
        body: "[설명회 안내] 아래 링크로 신청하세요: {초대링크}",
      });

      // 버그 재발 시: status='blocked' + reason 에 {이름} 메시지 → 반드시 실패.
      if (r.status === "blocked") {
        expect(r.reason).not.toContain("{이름}");
      }
      // 가드를 통과하면 모킹된 happy path 로 success 까지 도달.
      expect(r.status).toBe("success");
    });

    it("{초대링크}가 아예 없는 본문도 #{이름}이 자동 부착되지만 {이름} 가드에 걸리지 않는다", async () => {
      const createSeminarBroadcastAction = await loadAction();
      const r = await createSeminarBroadcastAction({
        ...base,
        body: "[설명회 안내] 자세한 내용은 문의 주세요",
      });

      if (r.status === "blocked") {
        expect(r.reason).not.toContain("{이름}");
      }
      expect(r.status).toBe("success");
    });

    it("본문에 {초대링크} 여러 개여도 {이름} 가드에 걸리지 않는다", async () => {
      const createSeminarBroadcastAction = await loadAction();
      const r = await createSeminarBroadcastAction({
        ...base,
        // LMS 로 두어 다중 URL 합성이 바이트 한도에 걸리지 않게 한다.
        // (핵심은 {이름} 가드 미차단 — 바이트 한도는 별개 가드.)
        type: "LMS",
        subject: "설명회 안내",
        body: "신청1: {초대링크} / 신청2: {초대링크}",
      });

      // {이름} 가드는 {초대링크} 개수와 무관하게 걸리지 않아야 한다.
      if (r.status === "blocked") {
        expect(r.reason).not.toContain("{이름}");
      }
      expect(r.status).toBe("success");
    });
  });

  describe("차단 케이스 (운영자가 직접 {이름}을 넣음)", () => {
    it("본문에 운영자가 {이름}을 직접 넣으면 → blocked + '{이름} 변수를 사용할 수 없습니다'", async () => {
      const createSeminarBroadcastAction = await loadAction();
      const r = await createSeminarBroadcastAction({
        ...base,
        body: "{이름} 학부모님 안녕하세요, 신청: {초대링크}",
      });

      expect(r.status).toBe("blocked");
      if (r.status === "blocked") {
        expect(r.reason).toContain("{이름} 변수를 사용할 수 없습니다");
      }
    });

    it("{초대링크} 없이 {이름}만 있어도 차단된다", async () => {
      const createSeminarBroadcastAction = await loadAction();
      const r = await createSeminarBroadcastAction({
        ...base,
        body: "{이름} 학부모님께 안내드립니다",
      });

      expect(r.status).toBe("blocked");
      if (r.status === "blocked") {
        expect(r.reason).toContain("{이름}");
      }
    });
  });
});
