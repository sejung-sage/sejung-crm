import { describe, it, expect, beforeEach } from "vitest";
import {
  createSeminarAction,
  updateSeminarAction,
  changeSeminarStatusAction,
  cancelSignupAction,
  submitSignupAction,
  exportSignupsAction,
} from "@/app/(features)/seminars/actions";
import { SEMINAR_LINK_TOKEN_LENGTH } from "@/lib/seminars/generate-link-token";
import type {
  CreateSeminarInput,
  SubmitSignupInput,
} from "@/lib/schemas/seminar";

/**
 * F5 · 설명회 Server Action 6종 · dev-seed 조기 반환 + Zod 검증.
 *
 * 정책:
 *  - 모든 쓰기 액션은 dev-seed 모드에서 DB 접근 전에 `{ status: 'dev_seed_mode', ... }`
 *    반환. createSeminarAction 만 `{ id, link_token }` 가짜를 함께 동봉(폼 라우팅 일관성).
 *  - submitSignupAction 도 dev-seed 에서 `{ status: 'dev_seed_mode' }` — parent-signup-flow
 *    의 switch 가 이를 view='done' 으로 매핑해 학부모 UI 가 정상 흐름처럼 보인다.
 *  - Zod 검증 실패는 dev-seed 가드가 먼저 발동하므로 dev-seed OFF 일 때만 도달 가능.
 *
 * 다른 dev-seed 가드 테스트(group/template/account)와 동일 패턴.
 */

const validUuid = "11111111-1111-4111-8111-111111111111";

const validCreateInput: CreateSeminarInput = {
  name: "테스트 설명회",
  branch: "대치",
  description: null,
  held_at: null,
  venue: null,
  capacity: null,
  signup_opens_at: null,
  signup_closes_at: null,
};

const validSignupInput: SubmitSignupInput & { token: string } = {
  token: "tok_whimun_g1_2026",
  student_name: "홍길동",
  parent_phone: "01012345678",
  consent: true,
};

describe("seminar Server Actions · dev-seed 조기 반환", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("createSeminarAction", () => {
    it("정상 입력이어도 dev-seed 이면 dev_seed_mode + 가짜 id/link_token 반환", async () => {
      const r = await createSeminarAction(validCreateInput);
      expect(r.status).toBe("dev_seed_mode");
      if (r.status === "dev_seed_mode") {
        expect(typeof r.id).toBe("string");
        expect(r.id.length).toBeGreaterThan(0);
        // 가짜 토큰도 정책 길이를 따른다.
        expect(r.link_token).toHaveLength(SEMINAR_LINK_TOKEN_LENGTH);
        expect(r.link_token).toMatch(/^[A-Za-z0-9_-]{12}$/);
      }
    });
  });

  describe("updateSeminarAction", () => {
    it("정상 id+name 부분 수정이어도 dev_seed_mode", async () => {
      const r = await updateSeminarAction({
        id: validUuid,
        name: "수정된 이름",
      });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("changeSeminarStatusAction", () => {
    it("status='closed' 전이도 dev_seed_mode", async () => {
      const r = await changeSeminarStatusAction({
        seminar_id: validUuid,
        status: "closed",
      });
      expect(r.status).toBe("dev_seed_mode");
    });

    it("status='cancelled' 전이도 dev_seed_mode", async () => {
      const r = await changeSeminarStatusAction({
        seminar_id: validUuid,
        status: "cancelled",
      });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("cancelSignupAction", () => {
    it("정상 signup_id 도 dev_seed_mode", async () => {
      const r = await cancelSignupAction({ signup_id: validUuid });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("submitSignupAction", () => {
    it("dev-seed 에서도 dev_seed_mode 반환 — UI 는 parent-signup-flow 가 done 으로 매핑", async () => {
      // 학부모 anon 신청도 dev-seed 에서는 즉시 dev_seed_mode 반환.
      // parent-signup-flow.tsx 의 switch 가 dev_seed_mode → view='done' 로 변환.
      const r = await submitSignupAction(validSignupInput);
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("exportSignupsAction", () => {
    it("정상 seminarId 라도 dev_seed_mode (xlsx 생성 안 함)", async () => {
      const r = await exportSignupsAction("sem_001");
      expect(r.status).toBe("dev_seed_mode");
    });
  });
});

describe("seminar Server Actions · Zod 검증 (dev-seed 우선이라 일부만 도달)", () => {
  describe("dev-seed OFF · Zod 실패 경로", () => {
    beforeEach(() => {
      // dev-seed 끄고 Zod 만 검증. Supabase URL 도 가짜로 두면 인증 단계까지 못 가고
      // failed 가 떨어진다 — 우리가 잡고 싶은 건 Zod 메시지뿐.
      delete process.env.SEJUNG_DEV_SEED;
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub-not-real.invalid";
    });

    describe("createSeminarAction", () => {
      it("이름 누락 → failed (Zod) — '설명회 제목은 필수입니다'", async () => {
        const r = await createSeminarAction({
          name: "",
          branch: "대치",
          description: null,
          held_at: null,
          venue: null,
          capacity: null,
          signup_opens_at: null,
          signup_closes_at: null,
        });
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          expect(r.reason).toContain("제목");
        }
      });

      it("분원 누락 → failed (Zod) — '분원은 필수입니다'", async () => {
        const r = await createSeminarAction({
          name: "이름 있음",
          branch: "",
          description: null,
          held_at: null,
          venue: null,
          capacity: null,
          signup_opens_at: null,
          signup_closes_at: null,
        });
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          expect(r.reason).toContain("분원");
        }
      });
    });

    describe("submitSignupAction", () => {
      it("token 빈 문자열 → failed('유효하지 않은 링크입니다')", async () => {
        const r = await submitSignupAction({
          token: "",
          student_name: "홍길동",
          parent_phone: "01012345678",
          consent: true,
        });
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          expect(r.reason).toContain("링크");
        }
      });

      it("consent=false → failed (개인정보 동의 메시지)", async () => {
        const r = await submitSignupAction({
          token: "tok_test",
          student_name: "홍길동",
          parent_phone: "01012345678",
          // SubmitSignupInputSchema 는 literal(true) — 런타임 거부.
          consent: false as unknown as true,
        });
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          expect(r.reason).toContain("동의");
        }
      });

      it("parent_phone 길이 부족(02-1234 → 5자리) → failed", async () => {
        const r = await submitSignupAction({
          token: "tok_test",
          student_name: "홍길동",
          parent_phone: "02-1234",
          consent: true,
        });
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          // "너무 짧습니다" 메시지.
          expect(r.reason).toMatch(/연락처|짧/);
        }
      });

      it("student_name 빈 문자열 → failed", async () => {
        const r = await submitSignupAction({
          token: "tok_test",
          student_name: "   ",
          parent_phone: "01012345678",
          consent: true,
        });
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          expect(r.reason).toContain("이름");
        }
      });
    });

    describe("changeSeminarStatusAction", () => {
      it("seminar_id 가 UUID 아님 → failed", async () => {
        const r = await changeSeminarStatusAction({
          seminar_id: "not-a-uuid",
          status: "closed",
        });
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          expect(r.reason).toContain("ID");
        }
      });
    });

    describe("cancelSignupAction", () => {
      it("signup_id 가 UUID 아님 → failed", async () => {
        const r = await cancelSignupAction({ signup_id: "not-a-uuid" });
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          expect(r.reason).toContain("ID");
        }
      });
    });

    describe("exportSignupsAction", () => {
      it("seminarId 빈 문자열 → failed", async () => {
        const r = await exportSignupsAction("");
        expect(r.status).toBe("failed");
        if (r.status === "failed") {
          expect(r.reason).toContain("설명회 ID");
        }
      });
    });
  });
});
