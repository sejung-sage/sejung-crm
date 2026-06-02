import { describe, it, expect, beforeEach } from "vitest";
import {
  createSeminarBroadcastAction,
  claimInvitationItemAction,
  cancelSignupAction,
  submitSignupAction,
} from "@/app/(features)/seminars/actions";
import type {
  CreateBroadcastInput,
  ClaimInvitationItemInput,
  SubmitSignupInput,
} from "@/lib/schemas/seminar";

/**
 * F5 · 설명회 invitation 모델 (0082) · Server Action 가드 단위 테스트.
 *
 * 다루는 액션:
 *   - createSeminarBroadcastAction (신규 — 일괄 발송 + invitation 카드 생성)
 *   - claimInvitationItemAction    (신규 — 학부모 카드별 [신청하기])
 *   - cancelSignupAction           (갱신 — 0082 에선 invitation_items.id 를 받아 단건 cancel)
 *   - submitSignupAction           (폐기 — 실 모드에선 거절, dev-seed 호환 위해 mode 반환)
 *
 * 정책 (다른 actions-guards 미러):
 *   - dev-seed 모드: 모든 쓰기 액션은 DB 도달 전에 dev_seed_mode 조기 반환.
 *   - dev-seed OFF + Zod 실패: failed (한글 reason 노출).
 *   - 발송 가드는 dispatch 이전 단계만 검증 (DB·sendon 호출 없음).
 */

const validUuid = "11111111-1111-4111-8111-111111111111";
const validUuid2 = "22222222-2222-4222-8222-222222222222";

const validBroadcast: CreateBroadcastInput = {
  seminar_ids: [validUuid],
  student_ids: [validUuid2],
  body: "[설명회 안내] 1차",
  subject: null,
  type: "SMS",
  branch: "대치",
  is_ad: false, // 광고 토글 추가 — 기본 정보성 발송
};

const validClaim: ClaimInvitationItemInput = {
  token: "abcdef123456",
  seminar_id: validUuid,
};

const validSubmit: SubmitSignupInput & { token: string } = {
  token: "tok_legacy",
  student_name: "홍길동",
  parent_phone: "01012345678",
  consent: true,
};

// ─── dev-seed ON ────────────────────────────────────────────

describe("seminar invitation Server Actions · dev-seed 조기 반환", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("createSeminarBroadcastAction", () => {
    it("정상 입력이어도 dev-seed 이면 dev_seed_mode + 가짜 카운트 반환", async () => {
      const r = await createSeminarBroadcastAction(validBroadcast);
      expect(r.status).toBe("dev_seed_mode");
      if (r.status === "dev_seed_mode") {
        // student_ids.length 와 동일한 가짜 카운트.
        expect(r.sent).toBe(1);
        expect(r.invitation_count).toBe(1);
      }
    });

    it("student_ids 5건이면 dev-seed sent / invitation_count 도 5", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        student_ids: [
          validUuid2,
          "33333333-3333-4333-8333-333333333333",
          "44444444-4444-4444-8444-444444444444",
          "55555555-5555-4555-8555-555555555555",
          "66666666-6666-4666-8666-666666666666",
        ],
      });
      expect(r.status).toBe("dev_seed_mode");
      if (r.status === "dev_seed_mode") {
        expect(r.sent).toBe(5);
        expect(r.invitation_count).toBe(5);
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

  describe("submitSignupAction (DEPRECATED)", () => {
    it("dev-seed 에서는 호환을 위해 dev_seed_mode 반환 (parent-signup-flow done 매핑)", async () => {
      const r = await submitSignupAction(validSubmit);
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
        seminar_ids: [],
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toMatch(/설명회|1개 이상/);
      }
    });

    it("student_ids 빈 배열 → failed (Zod) — '1명 이상 선택'", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        student_ids: [],
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toMatch(/학생|1명 이상/);
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

    it("seminar_ids 내 UUID 형식 위반 → failed", async () => {
      const r = await createSeminarBroadcastAction({
        ...validBroadcast,
        seminar_ids: ["not-a-uuid"],
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("설명회");
      }
    });
  });

  describe("claimInvitationItemAction", () => {
    it("token 빈 문자열 → failed('유효하지 않은 링크입니다')", async () => {
      const r = await claimInvitationItemAction({
        token: "",
        seminar_id: validUuid,
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("링크");
      }
    });

    it("token 공백만 → failed (trim 후 빈문자열 차단)", async () => {
      const r = await claimInvitationItemAction({
        token: "   ",
        seminar_id: validUuid,
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("링크");
      }
    });

    it("seminar_id 가 UUID 아님 → failed (Zod)", async () => {
      const r = await claimInvitationItemAction({
        token: "abcdef123456",
        seminar_id: "not-a-uuid",
      });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("설명회 ID");
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

  describe("submitSignupAction (DEPRECATED · 실 모드)", () => {
    it("정상 입력이어도 실 모드는 '이 신청 방식은 더 이상...' 안내로 failed", async () => {
      const r = await submitSignupAction(validSubmit);
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("이 신청 방식은 더 이상");
        // 새 링크 안내 문구도 포함.
        expect(r.reason).toMatch(/새 링크|안내 문자/);
      }
    });

    it("token 빈 문자열은 Zod 이전 짧은-회로로 '유효하지 않은 링크' failed", async () => {
      const r = await submitSignupAction({ ...validSubmit, token: "" });
      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("링크");
      }
    });
  });
});
