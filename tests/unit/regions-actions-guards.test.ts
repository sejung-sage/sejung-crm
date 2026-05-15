import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertSchoolRegionAction,
  deleteSchoolRegionAction,
  listSchoolRegionsAction,
  listMissingSchoolRegionsAction,
} from "@/app/(features)/regions/actions";

/**
 * F-Region · Server Action dev-seed 가드 테스트.
 *
 * 쓰기 액션(upsert/delete) 은 dev-seed 모드에서 권한 검사·DB 접근 전에
 * 즉시 `{ status: 'dev_seed_mode' }` 로 반환되어야 한다.
 * 읽기 액션(list/missing) 은 dev-seed 에서도 시드 기반으로 정상 응답.
 *
 * 실 권한 분기(master/admin/manager/viewer) 는 Supabase auth + users_profile
 * 조회가 필요해 단위 테스트에서 검증하기 어려우므로 RLS + 통합 테스트(E2E)
 * 에서 커버. 본 파일은 dev-seed 가드만 회귀 방어.
 */

describe("regions Server Actions · dev-seed 조기 반환", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("upsertSchoolRegionAction", () => {
    it("정상 입력이어도 dev-seed 이면 DB 접근 전 dev_seed_mode 반환", async () => {
      const r = await upsertSchoolRegionAction({
        school: "신생고",
        region: "분당구",
      });
      expect(r.status).toBe("dev_seed_mode");
    });

    it("기존 학교 갱신 시도도 dev_seed_mode 반환", async () => {
      const r = await upsertSchoolRegionAction({
        school: "휘문고",
        region: "송파구",
      });
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("deleteSchoolRegionAction", () => {
    it("정상 학교명도 dev_seed_mode 반환", async () => {
      const r = await deleteSchoolRegionAction("휘문고");
      expect(r.status).toBe("dev_seed_mode");
    });

    it("빈 학교명이어도 dev-seed 가드가 먼저 → dev_seed_mode (failed 아님)", async () => {
      // dev-seed 가드가 입력 검증보다 먼저 호출되므로, 빈 학교명이라도
      // dev_seed_mode 가 반환됨. 운영 모드에선 'failed' + 한글 메시지.
      const r = await deleteSchoolRegionAction("");
      expect(r.status).toBe("dev_seed_mode");
    });
  });

  describe("listSchoolRegionsAction · 읽기 전용 액션", () => {
    it("dev-seed 에서도 시드 26건을 success 로 반환", async () => {
      const r = await listSchoolRegionsAction();
      expect(r.status).toBe("success");
      if (r.status === "success") {
        expect(r.data.length).toBe(26);
      }
    });

    it("쿼리 적용도 success (region='강남구' → 12건)", async () => {
      const r = await listSchoolRegionsAction({ region: "강남구" });
      expect(r.status).toBe("success");
      if (r.status === "success") {
        expect(r.data.length).toBe(12);
        expect(r.data.every((row) => row.region === "강남구")).toBe(true);
      }
    });
  });

  describe("listMissingSchoolRegionsAction · 읽기 전용 액션", () => {
    it("dev-seed 에서도 매핑 누락 재원생 학교를 success 로 반환", async () => {
      const r = await listMissingSchoolRegionsAction();
      expect(r.status).toBe("success");
      if (r.status === "success") {
        // 0037 이후 재원생만 카운트 — 인천포스코고/대왕중 (각 1명).
        // 송도국제고는 비재원생이라 제외.
        expect(r.data.items.length).toBe(2);
        expect(r.data.total).toBe(2);
        const schools = r.data.items.map((row) => row.school).sort();
        expect(schools).toEqual(["대왕중", "인천포스코고"]);
      }
    });
  });
});
