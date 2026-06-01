import { describe, it, expect, beforeEach } from "vitest";
import { lookupInvitationByToken } from "@/lib/seminars/lookup-invitation-by-token";
import {
  getInvitationCounts,
  listInvitations,
} from "@/lib/seminars/list-invitations";
import { listSignups } from "@/lib/seminars/list-signups";

/**
 * F5 · 설명회 invitation 모델 (0082) · 데이터 로더 dev-seed 폴백.
 *
 * 로더 인벤토리:
 *   - lookupInvitationByToken(token) — 학부모 `/s/<token>` SSR. 학생 메타 + items[].
 *   - getInvitationCounts(seminarId) — 운영 페이지 신청률 카드. total/signed/pending/cancelled.
 *   - listInvitations(seminarId)     — 운영 페이지 발송 명단 (status 전체).
 *   - listSignups(seminarId)         — invitation_items 중 status='signed' 명단 only.
 *
 * dev-seed 어댑팅 회귀 방어 — 옛 폼 필드(`id` / `student_phone` / `signed_up_at`)가
 * 새 row shape 로 새지 않는지 검증 (frontend 가 새 컬럼명으로 갈아탔으므로).
 */

const INVITATION_ITEM_STATUSES = new Set(["pending", "signed", "cancelled"]);

describe("seminar invitation 데이터 로더 · dev-seed 폴백", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  // ─── lookupInvitationByToken ─────────────────────────────
  describe("lookupInvitationByToken", () => {
    it("빈 token → null (DB 도달 전 차단)", async () => {
      expect(await lookupInvitationByToken("")).toBeNull();
      expect(await lookupInvitationByToken("   ")).toBeNull();
    });

    it("정상 token (mock 토큰) → 학생 메타 + items[≥1]", async () => {
      const r = await lookupInvitationByToken("tok_whimun_g1_2026");
      expect(r).not.toBeNull();
      if (!r) return;
      // 학생 메타.
      expect(typeof r.invitation_id).toBe("string");
      expect(r.invitation_id.length).toBeGreaterThan(0);
      expect(typeof r.student_id).toBe("string");
      expect(typeof r.student_name).toBe("string");
      expect(r.student_name.length).toBeGreaterThan(0);
      expect(typeof r.parent_phone).toBe("string");
      // branch 도 노출됨 (학생 페이지 footer 등 활용 가능).
      expect(typeof r.branch).toBe("string");
      // items.
      expect(Array.isArray(r.items)).toBe(true);
      expect(r.items.length).toBeGreaterThan(0);
    });

    it("미존재 토큰이어도 mock 어댑터가 active 상위 3건을 카드로 합성 (시연 UX)", async () => {
      const r = await lookupInvitationByToken("does-not-exist-anywhere");
      // dev-seed 는 미매칭 토큰이면 open+closed 상위 3건으로 합성 — null 아님.
      expect(r).not.toBeNull();
      if (!r) return;
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items.length).toBeLessThanOrEqual(3);
    });

    it("items 각 항목의 shape — item_id / seminar_id / name / held_at / status / signed_at", async () => {
      const r = await lookupInvitationByToken("tok_whimun_g1_2026");
      expect(r).not.toBeNull();
      if (!r) return;
      for (const item of r.items) {
        expect(typeof item.item_id).toBe("string");
        expect(item.item_id.length).toBeGreaterThan(0);
        expect(typeof item.seminar_id).toBe("string");
        expect(typeof item.name).toBe("string");
        expect(item.name.length).toBeGreaterThan(0);
        // held_at 은 null 가능 (mock 은 starts_at 매핑).
        expect(
          item.held_at === null || typeof item.held_at === "string",
        ).toBe(true);
        // status enum.
        expect(INVITATION_ITEM_STATUSES.has(item.status)).toBe(true);
        // signed 이면 signed_at NOT NULL.
        if (item.status === "signed") {
          expect(item.signed_at).not.toBeNull();
        }
      }
    });

    it("dev-seed 합성 시 첫 카드는 status='signed' — 멱등 (already_signed) 경로 시연용", async () => {
      const r = await lookupInvitationByToken("tok_whimun_g1_2026");
      expect(r).not.toBeNull();
      if (!r) return;
      // mock 어댑터는 idx=0 에 signed 1개 박는다.
      const signed = r.items.find((i) => i.status === "signed");
      expect(signed).toBeDefined();
    });
  });

  // ─── listSignups (0082 invitation_items shape) ─────────────
  describe("listSignups · invitation_items row shape", () => {
    it("실재 mock seminar id (sem_001) → status='signed' 만 invitation_items shape 로 반환", async () => {
      const rows = await listSignups("sem_001");
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        // 새 필수 컬럼 (invitation 모델).
        expect(typeof r.item_id).toBe("string");
        expect(typeof r.invitation_id).toBe("string");
        expect(typeof r.student_id).toBe("string");
        expect(typeof r.student_name).toBe("string");
        expect(typeof r.parent_phone).toBe("string");
        expect(r.status).toBe("signed");
        // signed → signed_at NOT NULL.
        expect(r.signed_at).not.toBeNull();
      }
    });

    it("옛 폼 모델 필드명(id / student_phone / signed_up_at / cancelled_at) 은 노출되지 않는다 (전환 회귀 방어)", async () => {
      const rows = await listSignups("sem_001");
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const asAny = r as unknown as Record<string, unknown>;
        // 옛 SeminarSignupRow 의 PK 명.
        expect(asAny.id).toBeUndefined();
        // 0080 폼은 학부모 번호를 student_phone 으로 호명한 적도 있음 — invitation 모델은 parent_phone.
        expect(asAny.student_phone).toBeUndefined();
        // signed_up_at (옛) vs signed_at (새).
        expect(asAny.signed_up_at).toBeUndefined();
        // 단건 명단에는 cancelled_at 도 노출되지 않는다.
        expect(asAny.cancelled_at).toBeUndefined();
        // seminar_id 도 row 에 박지 않는다 (호출 인자로 이미 알고 있음).
        expect(asAny.seminar_id).toBeUndefined();
      }
    });

    it("미존재 seminar id → 빈 배열", async () => {
      expect(await listSignups("sem_does_not_exist")).toEqual([]);
    });

    it("빈 seminar id → 빈 배열 (DB 도달 전 차단)", async () => {
      expect(await listSignups("")).toEqual([]);
    });
  });

  // ─── listInvitations (보낸 명단 전체) ─────────────────────
  describe("listInvitations · invitation 카드 명단", () => {
    it("정상 seminar id → SeminarInvitationRowItem[] (status 전체)", async () => {
      const rows = await listInvitations("sem_001");
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(typeof r.item_id).toBe("string");
        expect(typeof r.invitation_id).toBe("string");
        expect(typeof r.student_id).toBe("string");
        expect(typeof r.student_name).toBe("string");
        expect(typeof r.parent_phone).toBe("string");
        expect(INVITATION_ITEM_STATUSES.has(r.status)).toBe(true);
        // invited_at(=invitation.created_at) NOT NULL.
        expect(typeof r.invited_at).toBe("string");
        expect(r.invited_at.length).toBeGreaterThan(0);
      }
    });

    it("미존재 seminar id → 빈 배열", async () => {
      expect(await listInvitations("sem_does_not_exist")).toEqual([]);
    });

    it("빈 seminar id → 빈 배열 (DB 도달 전 차단)", async () => {
      expect(await listInvitations("")).toEqual([]);
    });
  });

  // ─── getInvitationCounts ──────────────────────────────────
  describe("getInvitationCounts · 신청률 카드 카운트", () => {
    it("정상 seminar id → { total, signed, pending, cancelled } 4종 number", async () => {
      const c = await getInvitationCounts("sem_001");
      expect(typeof c.total).toBe("number");
      expect(typeof c.signed).toBe("number");
      expect(typeof c.pending).toBe("number");
      expect(typeof c.cancelled).toBe("number");
      // 불변식: 각 카운트는 0 이상.
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.signed).toBeGreaterThanOrEqual(0);
      expect(c.pending).toBeGreaterThanOrEqual(0);
      expect(c.cancelled).toBeGreaterThanOrEqual(0);
      // 불변식: signed + pending + cancelled ≤ total (dev-seed 가상 모수 패턴).
      expect(c.signed + c.pending + c.cancelled).toBeLessThanOrEqual(c.total);
    });

    it("sem_001 mock 기준 signed=6, cancelled=1, total≥7 (active=6 + cancelled=1 + pending)", async () => {
      // mock SIGNUPS: sem_001 active 6 + cancelled 1.
      // dev-seed 어댑터는 totalSent = max(7, 6*2=12) = 12.
      const c = await getInvitationCounts("sem_001");
      expect(c.signed).toBe(6);
      expect(c.cancelled).toBe(1);
      expect(c.total).toBeGreaterThanOrEqual(7);
    });

    it("빈 seminar id → 모든 카운트 0", async () => {
      const c = await getInvitationCounts("");
      expect(c).toEqual({ total: 0, signed: 0, pending: 0, cancelled: 0 });
    });

    it("미존재 seminar id (sem_005·신청자 0) → signed=0, cancelled=0", async () => {
      const c = await getInvitationCounts("sem_005");
      expect(c.signed).toBe(0);
      expect(c.cancelled).toBe(0);
    });
  });
});
