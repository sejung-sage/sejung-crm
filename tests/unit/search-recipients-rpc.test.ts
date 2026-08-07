import { describe, it, expect } from "vitest";
import { buildSearchRecipientsParams } from "@/lib/groups/search-recipients-rpc";
import { GroupFiltersSchema } from "@/lib/schemas/group";

/**
 * search_recipients RPC(0093) 파라미터 빌더.
 *
 * 핵심 회귀 보호: 학생 ID·제외 목록이 GET URL 이 아니라 "파라미터(요청 본문)" 로
 * 실려야 414 가 안 난다. + filter/custom 모드 시맨틱 보존.
 */

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

function filter(overrides: Record<string, unknown> = {}) {
  return GroupFiltersSchema.parse({ kind: "filter", ...overrides });
}

describe("buildSearchRecipientsParams · filter 모드", () => {
  it("빈 필터 → 분원만 적용, 나머지 배열은 null", () => {
    const p = buildSearchRecipientsParams(filter(), "반포", true, false);
    expect(p.p_branch).toBe("반포");
    expect(p.p_grades).toBeNull();
    expect(p.p_schools).toBeNull();
    expect(p.p_regions).toBeNull();
    expect(p.p_subjects).toBeNull();
    expect(p.p_statuses).toBeNull();
    expect(p.p_include_ids).toBeNull();
    expect(p.p_exclude_ids).toBeNull();
    expect(p.p_exclude_schools).toBeNull();
    expect(p.p_exclude_class_ids).toBeNull();
    expect(p.p_mapped_school).toBe(false);
    expect(p.p_unmapped_school).toBe(false);
    expect(p.p_require_parent_phone).toBe(true);
  });

  it("excludeStudentIds(체크 해제) → p_exclude_ids 로 전달 (URL 미직렬화)", () => {
    const ids = [UUID_A, UUID_B];
    const p = buildSearchRecipientsParams(
      filter({ excludeStudentIds: ids }),
      "대치",
      true,
      false,
    );
    expect(p.p_exclude_ids).toEqual(ids);
  });

  it("subjects 7종 전체 = 조건 없음 → null", () => {
    const p = buildSearchRecipientsParams(
      filter({
        subjects: ["국어", "영어", "수학", "과탐", "사탐", "컨설팅", "기타"],
      }),
      "대치",
      false,
      false,
    );
    expect(p.p_subjects).toBeNull();
  });

  it("subjects 일부 → 그대로 전달", () => {
    const p = buildSearchRecipientsParams(
      filter({ subjects: ["수학"] }),
      "대치",
      false,
      false,
    );
    expect(p.p_subjects).toEqual(["수학"]);
  });

  it("학교 등록만/미등록만 토글 전달", () => {
    expect(
      buildSearchRecipientsParams(
        filter({ mappedSchool: true }),
        "대치",
        false,
        false,
      ).p_mapped_school,
    ).toBe(true);
    expect(
      buildSearchRecipientsParams(
        filter({ unmappedSchool: true }),
        "대치",
        false,
        false,
      ).p_unmapped_school,
    ).toBe(true);
  });

  it("require_parent_phone 플래그 반영", () => {
    expect(
      buildSearchRecipientsParams(filter(), "대치", false, false)
        .p_require_parent_phone,
    ).toBe(false);
  });

  it("exclude_unsubscribed 플래그 반영 (리스트업 true / 발송 로더 false)", () => {
    expect(
      buildSearchRecipientsParams(filter(), "대치", true, true)
        .p_exclude_unsubscribed,
    ).toBe(true);
    expect(
      buildSearchRecipientsParams(filter(), "대치", false, false)
        .p_exclude_unsubscribed,
    ).toBe(false);
  });
});

describe("buildSearchRecipientsParams · custom 모드", () => {
  it("include 모집단 + 조건/학교제외/강좌제외 무시, exclude 차감만 유지", () => {
    const p = buildSearchRecipientsParams(
      GroupFiltersSchema.parse({
        kind: "custom",
        includeStudentIds: [UUID_A, UUID_B],
        excludeStudentIds: [UUID_C],
        grades: ["고2"],
        schools: ["세정고"],
        subjects: ["수학"],
        regions: ["강남구"],
        excludeSchools: ["세정고"],
        excludeClassIds: [UUID_A],
        mappedSchool: true,
      }),
      "대치",
      false,
      false,
    );
    expect(p.p_include_ids).toEqual([UUID_A, UUID_B]);
    expect(p.p_exclude_ids).toEqual([UUID_C]);
    // custom 은 조건 무시.
    expect(p.p_grades).toBeNull();
    expect(p.p_schools).toBeNull();
    expect(p.p_subjects).toBeNull();
    expect(p.p_regions).toBeNull();
    expect(p.p_exclude_schools).toBeNull();
    expect(p.p_exclude_class_ids).toBeNull();
    expect(p.p_mapped_school).toBe(false);
    expect(p.p_unmapped_school).toBe(false);
  });
});

// ─── 강좌 + 회차 포함 필터 (0118) ──────────────────────────

describe("buildSearchRecipientsParams · 강좌/회차 포함 (0118)", () => {
  it("강좌 미선택 → 강좌·회차 모두 null (조건 미적용)", () => {
    const p = buildSearchRecipientsParams(filter(), "반포", true, false);
    expect(p.p_include_class_ids).toBeNull();
    expect(p.p_include_class_dates).toBeNull();
  });

  it("강좌만 선택 → 강좌는 전달, 회차는 null (= 전 회차)", () => {
    const p = buildSearchRecipientsParams(
      filter({ includeClassIds: [UUID_A] }),
      "반포",
      true,
      false,
    );
    expect(p.p_include_class_ids).toEqual([UUID_A]);
    expect(p.p_include_class_dates).toBeNull();
  });

  it("강좌 + 회차 선택 → 둘 다 전달", () => {
    const p = buildSearchRecipientsParams(
      filter({
        includeClassIds: [UUID_A],
        includeClassDates: ["2026-08-12"],
      }),
      "반포",
      true,
      false,
    );
    expect(p.p_include_class_ids).toEqual([UUID_A]);
    expect(p.p_include_class_dates).toEqual(["2026-08-12"]);
  });

  it("강좌 없이 회차만 있으면 회차는 무시 (날짜 단독은 의미 없음)", () => {
    const p = buildSearchRecipientsParams(
      filter({ includeClassDates: ["2026-08-12"] }),
      "반포",
      true,
      false,
    );
    expect(p.p_include_class_ids).toBeNull();
    expect(p.p_include_class_dates).toBeNull();
  });

  it("custom(고정 명단) 모드에서는 강좌·회차를 무시", () => {
    const p = buildSearchRecipientsParams(
      GroupFiltersSchema.parse({
        kind: "custom",
        includeStudentIds: [UUID_C],
        includeClassIds: [UUID_A],
        includeClassDates: ["2026-08-12"],
      }),
      "반포",
      true,
      false,
    );
    expect(p.p_include_class_ids).toBeNull();
    expect(p.p_include_class_dates).toBeNull();
    expect(p.p_include_ids).toEqual([UUID_C]);
  });
});
