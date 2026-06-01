import { describe, it, expect, beforeEach } from "vitest";
import { listSeminars } from "@/lib/seminars/list-seminars";
import { getSeminar } from "@/lib/seminars/get-seminar";
import { listSignups } from "@/lib/seminars/list-signups";
import { lookupSeminarByToken } from "@/lib/seminars/lookup-seminar-by-token";

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
const SIGNUP_STATUSES = new Set(["signed", "cancelled"]);

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

    it("각 row 가 0080 정식 컬럼명을 가진다 (link_token / held_at / signup_closes_at / signup_count)", async () => {
      const r = await listSeminars({ branch: "대치", status: "", q: "" });
      expect(r.items.length).toBeGreaterThan(0);
      for (const row of r.items) {
        // 정식 컬럼명 존재 확인.
        expect(row).toHaveProperty("link_token");
        expect(row).toHaveProperty("held_at");
        expect(row).toHaveProperty("signup_opens_at");
        expect(row).toHaveProperty("signup_closes_at");
        expect(row).toHaveProperty("signup_count");
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
    it("실재 mock id (sem_001) 면 정식 SeminarListItem 반환", async () => {
      const row = await getSeminar("sem_001");
      expect(row).not.toBeNull();
      if (!row) return;
      expect(row.id).toBe("sem_001");
      expect(row).toHaveProperty("link_token");
      expect(row).toHaveProperty("held_at");
      expect(row).toHaveProperty("signup_closes_at");
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

  // ─── lookupSeminarByToken ────────────────────────────────
  describe("lookupSeminarByToken", () => {
    it("실재 mock 토큰이면 공개 결과 반환 (capacity 는 노출 안 됨)", async () => {
      const row = await lookupSeminarByToken("tok_whimun_g1_2026");
      expect(row).not.toBeNull();
      if (!row) return;
      expect(row.id).toBe("sem_001");
      expect(row.name).toBe("2026 휘문 1학년 입시설명회");
      expect(row.branch).toBe("대치");
      expect(SEMINAR_STATUSES.has(row.status)).toBe(true);
      // capacity / link_token 은 학부모 공개 결과에 없어야 한다 (의도된 비공개).
      expect((row as unknown as Record<string, unknown>).capacity).toBeUndefined();
      expect(
        (row as unknown as Record<string, unknown>).link_token,
      ).toBeUndefined();
    });

    it("빈 토큰 → null (DB 도달 전 차단)", async () => {
      expect(await lookupSeminarByToken("")).toBeNull();
      expect(await lookupSeminarByToken("   ")).toBeNull();
    });

    it("미존재 토큰 → null", async () => {
      expect(await lookupSeminarByToken("tok_does_not_exist")).toBeNull();
    });
  });

  // ─── listSignups ─────────────────────────────────────────
  describe("listSignups", () => {
    it("실재 mock seminar id 면 SeminarSignupRow[] 반환", async () => {
      const rows = await listSignups("sem_001");
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        // 정식 DB enum 으로 매핑되어야 한다.
        expect(SIGNUP_STATUSES.has(r.status)).toBe(true);
        // 필수 컬럼.
        expect(typeof r.id).toBe("string");
        expect(r.seminar_id).toBe("sem_001");
        expect(typeof r.student_name).toBe("string");
        expect(typeof r.parent_phone).toBe("string");
        expect(typeof r.created_at).toBe("string");
        // 옛 필드명은 새지 않아야 한다.
        expect(
          (r as unknown as Record<string, unknown>).signed_up_at,
        ).toBeUndefined();
      }
    });

    it("cancelled 신청 row 는 cancelled_at NOT NULL, signed 는 NULL", async () => {
      const rows = await listSignups("sem_001");
      const cancelled = rows.filter((r) => r.status === "cancelled");
      const signed = rows.filter((r) => r.status === "signed");
      expect(cancelled.length).toBeGreaterThan(0);
      expect(signed.length).toBeGreaterThan(0);
      for (const r of cancelled) expect(r.cancelled_at).not.toBeNull();
      for (const r of signed) expect(r.cancelled_at).toBeNull();
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
