import { describe, it, expect, beforeEach } from "vitest";
import { listSeminars } from "@/lib/seminars/list-seminars";
import { getSeminar } from "@/lib/seminars/get-seminar";
import { listSignups } from "@/lib/seminars/list-signups";
// lookupSeminarByToken (0080 폼 모델) 은 0082 invitation 모델로 폐기됨.
// 새 lookupInvitationByToken 단위 테스트는 seminars-invitation-loaders.test.ts 참고.

/**
 * F5 · 설명회 데이터 로더 4종 · dev-seed 폴백 단위 테스트.
 *
 * `isDevSeedMode()` 가 true 일 때 각 로더는 mock 데이터를 DB 컬럼명(0080) 으로
 * 어댑팅해 반환해야 한다 — 폼/리스트가 정식 필드명을 가정하므로 어댑터가 깨지면
 * Phase 1 운영 시연 전체가 무너진다.
 *
 * mock seminar id 는 `dev-seed.ts` 의 SEMINARS 상수와 동기화:
 *   sem_001 (대치 · open · 토큰 tok_whimun_g1_2026)
 *   sem_002 (반포 · open · 토큰 tok_banpo_predaeip_2026)
 *   sem_003 (송도 · closed)
 *   sem_004 (방배 · ended)
 *   sem_005 (대치 · cancelled · 신청자 0)
 */

const SEMINAR_STATUSES = new Set(["open", "closed", "ended", "cancelled"]);
// 0082 invitation_items.status enum (pending / signed / cancelled). listSignups 는
// signed 만 반환하므로 테스트도 signed 검증으로 좁힌다.
const INVITATION_ITEM_STATUSES = new Set(["pending", "signed", "cancelled"]);

describe("seminar 데이터 로더 · dev-seed 폴백", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  // ─── listSeminars ────────────────────────────────────────
  describe("listSeminars", () => {
    it("필터 전체 비움이면 5건 모두 반환 (전체 분원)", async () => {
      const r = await listSeminars({ branch: "", status: "", q: "" });
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.total).toBe(r.items.length);
    });

    it("branch='대치' 면 대치 분원만 (sem_001 + sem_005)", async () => {
      const r = await listSeminars({ branch: "대치", status: "", q: "" });
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items.every((s) => s.branch === "대치")).toBe(true);
    });

    it("각 row 가 정식 컬럼명을 가진다 (held_at / signup_closes_at / signup_count) — 0082 에서 link_token 폐기", async () => {
      const r = await listSeminars({ branch: "대치", status: "", q: "" });
      expect(r.items.length).toBeGreaterThan(0);
      for (const row of r.items) {
        // 정식 컬럼명 존재 확인.
        expect(row).toHaveProperty("held_at");
        expect(row).toHaveProperty("signup_opens_at");
        expect(row).toHaveProperty("signup_closes_at");
        expect(row).toHaveProperty("signup_count");
        // 0082: crm_seminars.link_token 컬럼 DROP — 어댑터에서도 노출 안 한다.
        expect(
          (row as unknown as Record<string, unknown>).link_token,
        ).toBeUndefined();
        // mock 의 옛 필드명은 새지 않아야 한다.
        expect((row as unknown as Record<string, unknown>).token).toBeUndefined();
        expect((row as unknown as Record<string, unknown>).starts_at).toBeUndefined();
        expect(
          (row as unknown as Record<string, unknown>).application_deadline,
        ).toBeUndefined();
      }
    });

    it("각 row 의 status 가 정식 SeminarStatus enum 중 하나", async () => {
      const r = await listSeminars({ branch: "", status: "", q: "" });
      for (const row of r.items) {
        expect(SEMINAR_STATUSES.has(row.status)).toBe(true);
      }
    });

    it("status='open' 필터 시 모든 row 의 status='open'", async () => {
      const r = await listSeminars({ branch: "", status: "open", q: "" });
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items.every((row) => row.status === "open")).toBe(true);
    });

    it("q='휘문' 부분일치 검색이 동작 (sem_001 만)", async () => {
      const r = await listSeminars({ branch: "", status: "", q: "휘문" });
      expect(r.items.length).toBe(1);
      expect(r.items[0].name).toContain("휘문");
    });

    it("q 가 어떤 row 와도 매칭 안 되면 items=[]/total=0", async () => {
      const r = await listSeminars({
        branch: "",
        status: "",
        q: "이런이름은없다xyz",
      });
      expect(r.items).toEqual([]);
      expect(r.total).toBe(0);
    });
  });

  // ─── getSeminar ──────────────────────────────────────────
  describe("getSeminar", () => {
    it("실재 mock id (sem_001) 면 정식 SeminarListItem 반환 (0082: link_token 컬럼 폐기)", async () => {
      const row = await getSeminar("sem_001");
      expect(row).not.toBeNull();
      if (!row) return;
      expect(row.id).toBe("sem_001");
      expect(row).toHaveProperty("held_at");
      expect(row).toHaveProperty("signup_closes_at");
      // 0082: link_token 컬럼 DROP — 어댑터에서도 노출 안 한다.
      expect(
        (row as unknown as Record<string, unknown>).link_token,
      ).toBeUndefined();
      expect(SEMINAR_STATUSES.has(row.status)).toBe(true);
      // signup_count 는 number 타입.
      expect(typeof row.signup_count).toBe("number");
      expect(row.signup_count).toBeGreaterThanOrEqual(0);
    });

    it("존재하지 않는 id 면 null", async () => {
      const row = await getSeminar("sem_does_not_exist");
      expect(row).toBeNull();
    });

    it("sem_001 의 signup_count 는 active(=signed) 신청자만 카운트 (취소 1건 제외)", async () => {
      const row = await getSeminar("sem_001");
      expect(row).not.toBeNull();
      if (!row) return;
      // mock SIGNUPS: sem_001 = active 6 + cancelled 1 = 활성 6.
      expect(row.signup_count).toBe(6);
    });
  });

  // lookupSeminarByToken describe 블록은 폐기 — 새 lookupInvitationByToken
  // 단위 테스트는 seminars-invitation-loaders.test.ts 에서 다룸.

  // ─── listSignups (0082 invitation 모델) ──────────────────
  // 0080 폼 모델(SeminarSignupRow) → 0082 invitation_items.status='signed'
  // 명단(InvitationSignupRow) 으로 재작성. dev-seed 어댑터는 active mock 만
  // signed 로 매핑(취소 mock 은 명단에서 제외).
  describe("listSignups", () => {
    it("실재 mock seminar id 면 InvitationSignupRow[] 반환 (status='signed' 만)", async () => {
      const rows = await listSignups("sem_001");
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        // invitation 모델 status enum.
        expect(INVITATION_ITEM_STATUSES.has(r.status)).toBe(true);
        // 명단은 signed 만.
        expect(r.status).toBe("signed");
        // 새 필수 컬럼.
        expect(typeof r.item_id).toBe("string");
        expect(typeof r.invitation_id).toBe("string");
        expect(typeof r.student_id).toBe("string");
        expect(typeof r.student_name).toBe("string");
        expect(typeof r.parent_phone).toBe("string");
        // signed 이므로 signed_at NOT NULL.
        expect(r.signed_at).not.toBeNull();
        // 옛 필드명은 새지 않아야 한다.
        expect(
          (r as unknown as Record<string, unknown>).id,
        ).toBeUndefined();
        expect(
          (r as unknown as Record<string, unknown>).seminar_id,
        ).toBeUndefined();
        expect(
          (r as unknown as Record<string, unknown>).created_at,
        ).toBeUndefined();
        expect(
          (r as unknown as Record<string, unknown>).cancelled_at,
        ).toBeUndefined();
        expect(
          (r as unknown as Record<string, unknown>).signed_up_at,
        ).toBeUndefined();
      }
    });

    it("취소된 mock 신청은 명단에서 제외 (sem_001 active 6 + cancelled 1 → 6건)", async () => {
      const rows = await listSignups("sem_001");
      // mock SIGNUPS: sem_001 active=6, cancelled=1. signed 만 노출.
      expect(rows.length).toBe(6);
      expect(rows.every((r) => r.status === "signed")).toBe(true);
    });

    it("미존재 seminar id 면 빈 배열", async () => {
      const rows = await listSignups("sem_does_not_exist");
      expect(rows).toEqual([]);
    });

    it("빈 문자열 seminar id 면 즉시 빈 배열 (DB 도달 전 차단)", async () => {
      const rows = await listSignups("");
      expect(rows).toEqual([]);
    });
  });
});
