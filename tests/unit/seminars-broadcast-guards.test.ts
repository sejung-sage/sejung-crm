import { describe, it, expect, beforeEach } from "vitest";
import {
  createSeminarBroadcastAction,
  claimInvitationItemAction,
  cancelSignupAction,
} from "@/app/(features)/seminars/actions";
import type {
  CreateBroadcastInput,
  ClaimInvitationItemInput,
} from "@/lib/schemas/seminar";

/**
 * F5 · 설명회 invitation 모델 (0084/0085) · Server Action 가드 단위 테스트.
 *
 * 다루는 액션:
 *   - createSeminarBroadcastAction (강좌 기반 발송 + invitation 카드 생성)
 *   - claimInvitationItemAction    (학부모 카드별 [신청하기])
 *   - cancelSignupAction           (운영자 invitation_items 단건 cancel)
 *
 * 폐기된 submitSignupAction 은 Phase 2-B-3 (2026-06-02) 에서 제거됨.
 *
 * 정책:
 *   - dev-seed 모드: 모든 쓰기 액션은 DB 도달 전에 dev_seed_mode 조기 반환.
 *   - dev-seed OFF + Zod 실패: failed (한글 reason 노출).
 *   - 발송 가드는 dispatch 이전 단계만 검증 (DB·sendon 호출 없음).
 */

const validUuid = "11111111-1111-4111-8111-111111111111";
const validUuid2 = "22222222-2222-4222-8222-222222222222";

const validBroadcast: CreateBroadcastInput = {
  class_ids: [validUuid],
  group_id: validUuid2, // 그룹 id (414 회피 predicate)
  body: "[설명회 안내] 1차",
  subject: null,
  type: "SMS",
  branch: "대치",
  is_ad: false, // 광고 토글 추가 — 기본 정보성 발송
  allow_multiple: true, // 중복 신청 허용 (0087) — 기본 true(현행)
};

const validClaim: ClaimInvitationItemInput = {
  token: "abcdef123456",
  signup_page_id: validUuid,
};

// ─── dev-seed ON ────────────────────────────────────────────

describe("seminar invitation Server Actions · dev-seed 조기 반환", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("createSeminarBroadcastAction", () => {
    it("정상 입력이어도 dev-seed 이면 dev_seed_mode placeholder 카운트", async () => {
      const r = await createSeminarBroadcastAction(validBroadcast);
      expect(r.status).toBe("dev_seed_mode");
      if (r.status === "dev_seed_mode") {
        // group 만 받는 모델 → dev-seed 에선 실제 학생 수 모름 (placeholder 1)
        expect(r.sent).toBe(1);
        expect(r.invitation_count).toBe(1);
      }
    });
  });

  describe("claimInvitationItemAction", () => {
    it("정상 token+seminar_id 도 dev-seed 면 dev_seed_mode 즉시 반환", async () => {
      const r = await claimInvitationItemAction(validClaim);
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("cancelSignupAction (0082 invitation_items.id 기준)", () => {
    it("정상 item id(uuid) 도 dev_seed_mode", async () => {
      const r = await cancelSignupAction({ signup_id: validUuid });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

});

// ─── dev-seed OFF · Zod / 입력 가드 ─────────────────────────

describe("seminar invitation Server Actions · Zod 검증 (dev-seed OFF)", () => {
  beforeEach(() => {
    delete process.env.SEJUNG_DEV_SEED;
    // Supabase URL stub — Zod 단계까지만 도달하면 충분 (이후 인증/DB 호출은 failed 떨어짐).
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub-not-real.invalid";
  });

  describe("createSeminarBroadcastAction", () => {
    it("seminar_ids 빈 배열 → failed (Zod) — '1개 이상 선택'", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        class_ids: [],
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toMatch(/설명회|1개 이상/);
      }
    });

    it("group_id 가 잘못된 uuid → failed (Zod)", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        group_id: "not-a-uuid",
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toMatch(/그룹|유효하지/);
      }
    });

    it("body 공백만이면 → failed (Zod)", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        body: "   ",
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("본문");
      }
    });

    it("type='LMS' + subject=null → failed (Zod, 제목 필수)", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        type: "LMS",
        subject: null,
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        // refine 메시지 (LMS 제목 필요) 또는 path:'subject' 관련.
        expect(r.reason).toMatch(/LMS|제목/);
      }
    });

    it("branch 빈 문자열 → failed (Zod)", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        branch: "",
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("분원");
      }
    });

    it("빈 객체 입력 → failed (Zod, 첫 위반 메시지)", async () => {
      const r = await createSeminarBroadcastAction(
        {} as unknown as CreateBroadcastInput,
      );
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        // 여러 필드 실패 중 첫 메시지가 한글이라는 것만 보장.
        expect(typeof r.reason).toBe("string");
        expect(r.reason.length).toBeGreaterThan(0);
      }
    });

    it("class_ids 내 UUID 형식 위반 → failed", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        class_ids: ["not-a-uuid"],
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        // 0084 새 모델: "강좌 ID 가 유효하지 않습니다" 메시지.
        expect(r.reason).toContain("강좌");
      }
    });
  });

  describe("claimInvitationItemAction", () => {
    it("token 빈 문자열 → failed('유효하지 않은 링크입니다')", async () => {
      const r = await claimInvitationItemAction({
        token: "",
        signup_page_id: validUuid,
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("링크");
      }
    });

    it("token 공백만 → failed (trim 후 빈문자열 차단)", async () => {
      const r = await claimInvitationItemAction({
        token: "   ",
        signup_page_id: validUuid,
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("링크");
      }
    });

    it("signup_page_id 가 UUID 아님 → failed (Zod)", async () => {
      const r = await claimInvitationItemAction({
        token: "abcdef123456",
        signup_page_id: "not-a-uuid",
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        // 0085 새 RPC 기준 메시지: "신청 페이지 ID 가 유효하지 않습니다"
        expect(r.reason).toContain("신청 페이지");
      }
    });
  });

  describe("cancelSignupAction (0082)", () => {
    it("signup_id 가 UUID 아님 → failed", async () => {
      const r = await cancelSignupAction({ signup_id: "not-a-uuid" });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("ID");
      }
    });

    it("signup_id 빈 문자열 → failed (Zod)", async () => {
      const r = await cancelSignupAction({ signup_id: "" });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        // 빈 문자열도 UUID 검증 실패로 잡힌다.
        expect(r.reason).toContain("ID");
      }
    });
  });

});
