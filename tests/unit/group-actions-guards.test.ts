import { describe, it, expect, beforeEach } from "vitest";
import {
  createGroupAction,
  updateGroupAction,
  deleteGroupAction,
  deleteGroupsAction,
  countRecipientsAction,
} from "@/app/(features)/groups/actions";

/**
 * F2 · Server Action dev-seed 가드 테스트.
 *
 * 모든 쓰기 액션은 dev-seed 모드에서 DB 접근 없이 즉시
 * `{ status: 'dev_seed_mode' }` 로 반환되어야 한다.
 * (배포 전 UI 가 비활성 안내를 띄우는 기반)
 *
 * countRecipientsAction 은 조회 전용이므로 dev-seed 에서도 정상 동작.
 */

const validUuid = "11111111-1111-4111-8111-111111111111";

describe("Server Actions · dev-seed 조기 반환", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("createGroupAction", () => {
    it("정상 입력이어도 dev-seed 이면 DB 접근 전에 dev_seed_mode 반환", async () => {
      const r = await createGroupAction({
        name: "테스트 그룹",
        branch: "대치",
        filters: { grades: ["고2"], schools: [], subjects: [] },
      });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("updateGroupAction", () => {
    it("id + name 부분 수정이어도 dev_seed_mode 반환", async () => {
      const r = await updateGroupAction({
        id: validUuid,
        name: "수정",
      });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("deleteGroupAction", () => {
    it("단건 삭제도 dev_seed_mode 반환", async () => {
      const r = await deleteGroupAction(validUuid);
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("deleteGroupsAction", () => {
    it("다건 삭제도 dev_seed_mode 반환", async () => {
      const r = await deleteGroupsAction([validUuid, validUuid]);
      expect(r.status).toBe("dev_seed_mode");
    });

    it("빈 id 배열이어도 dev_seed 우선 · dev_seed_mode 반환", async () => {
      const r = await deleteGroupsAction([]);
      // dev-seed 가드가 먼저 반환하므로 유효성 실패가 아니라 dev_seed_mode.
      expect(r.status).toBe("dev_seed_mode");
    });
  });
});

describe("countRecipientsAction · dev-seed 에서도 정상 동작", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("정상 필터·분원 → success + data.total/sample 반환", async () => {
    const r = await countRecipientsAction(
      { grades: ["고2"], schools: [], subjects: [] },
      "대치",
    );
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.data.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(r.data.sample)).toBe(true);
    }
  });

  it("branch 가 빈 문자열이면 failed('분원은 필수')", async () => {
    const r = await countRecipientsAction(
      { grades: [], schools: [], subjects: [] },
      "",
    );
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("분원");
    }
  });

  it("filters 가 잘못된 값이면 failed(한글 메시지)", async () => {
    // 일부러 잘못된 값을 넣어 Zod 가드 검증.
    const r = await countRecipientsAction(
      { grades: ["대학생"] } as unknown as Parameters<
        typeof countRecipientsAction
      >[0],
      "대치",
    );
    expect(r.status).toBe("failed");
  });
});
