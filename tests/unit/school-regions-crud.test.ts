import { describe, it, expect, beforeEach } from "vitest";
import { listSchoolRegions } from "@/lib/regions/list-school-regions";
import { listMissingSchoolRegions } from "@/lib/regions/list-missing-regions";
import {
  upsertSchoolRegion,
  DevSeedReadOnlyError,
} from "@/lib/regions/upsert-school-region";
import { deleteSchoolRegion } from "@/lib/regions/delete-school-region";

/**
 * F-Region · 학교 → 지역 매핑 CRUD 단위 테스트 (dev-seed 경로).
 *
 * dev-seed 시드 (DEV_SCHOOL_REGIONS, students-dev-seed.ts):
 *   강남구 12 / 서초구 9 / 송파구 1 / 인천 송도 4 = 26 행
 *   (포스코고/송도고/해송고/신송고 — 단, 인천포스코고 는 매핑 없음).
 *
 * dev-seed 학생 시드와의 매핑 누락 학교:
 *   - 인천포스코고 (SD0002, 재원생) · 1명
 *   - 송도국제고 (SD0004, 탈퇴) · 1명
 *   - 대왕중 (DC0006, 재원생) · 1명
 *   * dev-seed collectFromDevSeed 는 status 분기가 없어 SD0004 도 카운트.
 *     실DB 분기는 .neq('status', '탈퇴') 가 있어 송도국제고는 0 으로 떨어짐.
 *     이 미세 차이는 backend-dev 보고에 명시됨.
 */
describe("listSchoolRegions · dev-seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("정상 입력 · 필터 미적용", () => {
    it("쿼리 없으면 전체 26건 (region asc, school asc)", async () => {
      const r = await listSchoolRegions();
      expect(r.length).toBe(26);
      // region 오름차순 — 첫 행은 사전순 가장 앞 region.
      // 한글 정렬은 강(ㄱ)·서(ㅅ)·송(ㅅ)·인(ㅇ) 순 → 첫 region='강남구'.
      expect(r[0].region).toBe("강남구");
      // 마지막 행은 인천 송도.
      expect(r[r.length - 1].region).toBe("인천 송도");
    });

    it("region asc, school asc 안정 정렬", async () => {
      const r = await listSchoolRegions();
      for (let i = 1; i < r.length; i++) {
        const prev = r[i - 1];
        const cur = r[i];
        const cmpRegion = prev.region.localeCompare(cur.region, "ko");
        // 1차 키(region) 가 같으면 2차 키(school) 가 오름차순이어야 함.
        if (cmpRegion === 0) {
          expect(prev.school.localeCompare(cur.school, "ko")).toBeLessThanOrEqual(0);
        } else {
          expect(cmpRegion).toBeLessThan(0);
        }
      }
    });
  });

  describe("region 정확 일치 필터", () => {
    it("region='강남구' → 12건 (시드의 강남구 학교 수)", async () => {
      const r = await listSchoolRegions({ region: "강남구" });
      expect(r.length).toBe(12);
      expect(r.every((row) => row.region === "강남구")).toBe(true);
    });

    it("region='인천 송도' → 4건 (포스코고/송도고/해송고/신송고)", async () => {
      const r = await listSchoolRegions({ region: "인천 송도" });
      expect(r.length).toBe(4);
      const schools = r.map((row) => row.school).sort();
      expect(schools).toEqual(["송도고", "신송고", "포스코고", "해송고"]);
    });

    it("region='없는지역' → 빈 배열", async () => {
      const r = await listSchoolRegions({ region: "없는지역" });
      expect(r).toEqual([]);
    });

    it("region 빈 문자열 / 공백만 → 무시 (전체 반환)", async () => {
      const r1 = await listSchoolRegions({ region: "" });
      const r2 = await listSchoolRegions({ region: "   " });
      expect(r1.length).toBe(26);
      expect(r2.length).toBe(26);
    });
  });

  describe("search · 학교명 부분 일치(대소문자 무시)", () => {
    it("search='휘문' → 휘문고 1건", async () => {
      const r = await listSchoolRegions({ search: "휘문" });
      expect(r.length).toBe(1);
      expect(r[0].school).toBe("휘문고");
      expect(r[0].region).toBe("강남구");
    });

    it("search='고' → '고' 가 들어간 학교명 다수", async () => {
      const r = await listSchoolRegions({ search: "고" });
      // 시드 26 행 모두 고등학교('~고')이라 26건 그대로.
      expect(r.length).toBe(26);
    });

    it("search 양옆 trim", async () => {
      const r = await listSchoolRegions({ search: "  휘문  " });
      expect(r.length).toBe(1);
      expect(r[0].school).toBe("휘문고");
    });

    it("search + region 복합 (region='강남구' & search='휘문')", async () => {
      const r = await listSchoolRegions({ region: "강남구", search: "휘문" });
      expect(r.length).toBe(1);
      expect(r[0].school).toBe("휘문고");
    });

    it("매칭 없는 search → 빈 배열", async () => {
      const r = await listSchoolRegions({ search: "절대없는학교명XYZ" });
      expect(r).toEqual([]);
    });
  });
});

describe("listMissingSchoolRegions · dev-seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("매핑 없는 재원생 학교만 반환", async () => {
    const r = await listMissingSchoolRegions();
    // 0037 이후 status='재원생' 만 카운트. 시드 중 인천포스코고/대왕중 재원생만
    // 결과에 포함 (송도국제고 학생은 비재원생 상태로 시드되어 있어 제외).
    expect(r.items.length).toBe(2);
    expect(r.total).toBe(2);
    const map = new Map(r.items.map((row) => [row.school, row.student_count]));
    expect(map.get("인천포스코고")).toBe(1);
    expect(map.get("대왕중")).toBe(1);
    expect(map.get("송도국제고")).toBeUndefined();
  });

  it("동률(1명씩) 시 학교명 한글 가나다 정렬", async () => {
    const r = await listMissingSchoolRegions();
    // 동률 student_count=1 → 한글 정렬. 송도국제고는 비재원생이라 제외.
    const names = r.items.map((row) => row.school);
    expect(names).toEqual(["대왕중", "인천포스코고"]);
  });

  it("school=null 학생(DC0008)은 결과에서 제외", async () => {
    const r = await listMissingSchoolRegions();
    // DC0008 은 school=null 이라 매핑 키 자체가 없음 → 결과 미포함.
    expect(r.items.find((row) => row.school === null)).toBeUndefined();
    // 또한 빈 학교명도 없음.
    expect(r.items.every((row) => row.school.length > 0)).toBe(true);
  });
});

describe("upsertSchoolRegion · dev-seed 모드 쓰기 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("스키마 통과한 입력이라도 DevSeedReadOnlyError 로 throw", async () => {
    await expect(
      upsertSchoolRegion({ school: "신생고", region: "분당구" }),
    ).rejects.toBeInstanceOf(DevSeedReadOnlyError);
  });

  it("기존 학교 갱신 시도도 차단", async () => {
    await expect(
      upsertSchoolRegion({ school: "휘문고", region: "송파구" }),
    ).rejects.toBeInstanceOf(DevSeedReadOnlyError);
  });

  it("스키마 검증은 dev-seed 가드보다 먼저 — 빈 입력은 ZodError", async () => {
    // upsertSchoolRegion 내부에서 SchoolRegionUpsertSchema.parse 가 먼저 호출.
    // 빈 학교명은 Zod 가 막아 DevSeedReadOnlyError 까지 도달하지 않음.
    await expect(
      upsertSchoolRegion({ school: "", region: "강남구" }),
    ).rejects.not.toBeInstanceOf(DevSeedReadOnlyError);
  });
});

describe("deleteSchoolRegion · dev-seed 모드 쓰기 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("DevSeedReadOnlyError 로 throw", async () => {
    await expect(deleteSchoolRegion("휘문고")).rejects.toBeInstanceOf(
      DevSeedReadOnlyError,
    );
  });

  it("빈 학교명은 Error('학교명이 비어있습니다') · dev-seed 가드 도달 전에 거부", async () => {
    // 빈/공백 학교명은 dev-seed 분기로 가기 전에 즉시 거부.
    await expect(deleteSchoolRegion("")).rejects.toThrow("학교명이 비어있습니다");
    await expect(deleteSchoolRegion("   ")).rejects.toThrow("학교명이 비어있습니다");
  });
});
