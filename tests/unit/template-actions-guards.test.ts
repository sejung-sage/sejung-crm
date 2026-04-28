import { describe, it, expect, beforeEach } from "vitest";
import {
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
} from "@/app/(features)/templates/actions";

/**
 * F3-A · 템플릿 Server Action dev-seed 가드.
 *
 * 모든 쓰기 액션은 dev-seed 모드에서 DB 접근 없이 즉시
 * `{ status: 'dev_seed_mode' }` 로 반환되어야 한다.
 *
 * NOTE: "use server" 파일은 vitest 노드 환경에서도 일반 모듈로 import 가능.
 * (group-actions-guards.test.ts 가 동일 패턴으로 이미 통과 중.)
 */

const validUuid = "11111111-1111-4111-8111-111111111111";

describe("Template Server Actions · dev-seed 조기 반환", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("createTemplateAction", () => {
    it("정상 입력이어도 dev-seed 이면 DB 접근 전에 dev_seed_mode 반환", async () => {
      const r = await createTemplateAction({
        name: "테스트 템플릿",
        type: "SMS",
        subject: null,
        body: "안녕하세요",
        teacher_name: null,
        is_ad: false,
      });
      expect(r.status).toBe("dev_seed_mode");
    });

    it("LMS + subject 있음도 dev_seed_mode", async () => {
      const r = await createTemplateAction({
        name: "LMS 테스트",
        type: "LMS",
        subject: "제목",
        body: "본문",
        teacher_name: "김선생T",
        is_ad: false,
      });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("updateTemplateAction", () => {
    it("id + 유효 payload 도 dev_seed_mode", async () => {
      const r = await updateTemplateAction({
        id: validUuid,
        name: "수정",
        type: "SMS",
        subject: null,
        body: "수정된 본문",
        teacher_name: null,
        is_ad: false,
      });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("deleteTemplateAction", () => {
    it("단건 삭제도 dev_seed_mode", async () => {
      const r = await deleteTemplateAction(validUuid);
      expect(r.status).toBe("dev_seed_mode");
    });

    it("빈 id 전달이어도 dev_seed 가 우선 · dev_seed_mode 반환", async () => {
      const r = await deleteTemplateAction("");
      expect(r.status).toBe("dev_seed_mode");
    });
  });
});
