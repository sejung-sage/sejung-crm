import { describe, it, expect } from "vitest";
import {
  InvitationItemStatusSchema,
  ClaimInvitationStatusSchema,
  CreateBroadcastInputSchema,
  ClaimInvitationItemInputSchema,
} from "@/lib/schemas/seminar";

/**
 * 설명회 invitation 모델 (0082) · Zod 스키마 단위 테스트.
 *
 * 다루는 범위:
 *  - DB CHECK enum (invitation_items.status)
 *  - claim_invitation_item RPC 반환 status enum
 *  - Server Action 입력: 일괄 발송 / 카드 신청 클릭
 *
 * 0080 폼 모델 스키마는 deprecated — 별도 파일 seminar-schemas.test.ts 가 커버.
 */

describe("InvitationItemStatusSchema", () => {
  it("pending / signed / cancelled 3종만 허용 (DB CHECK 와 1:1)", () => {
    expect(InvitationItemStatusSchema.parse("pending")).toBe("pending");
    expect(InvitationItemStatusSchema.parse("signed")).toBe("signed");
    expect(InvitationItemStatusSchema.parse("cancelled")).toBe("cancelled");
    expect(() => InvitationItemStatusSchema.parse("waiting")).toThrow();
    expect(() => InvitationItemStatusSchema.parse("")).toThrow();
  });
});

describe("ClaimInvitationStatusSchema", () => {
  it("claim_invitation_item RPC 반환 7종 enum 모두 허용", () => {
    for (const s of [
      "signed",
      "already_signed",
      "closed",
      "ended",
      "cancelled",
      "invalid",
      "out_of_window",
    ]) {
      expect(ClaimInvitationStatusSchema.parse(s)).toBe(s);
    }
    // 0080 폼 모델 'duplicate' 는 invitation 모델 enum 에 없다 (already_signed 로 대체).
    expect(() => ClaimInvitationStatusSchema.parse("duplicate")).toThrow();
  });
});

describe("CreateBroadcastInputSchema", () => {
  const validBase = {
    seminar_ids: ["a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"],
    group_id: "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    body: "[설명회 안내] 1차",
    subject: null,
    type: "SMS" as const,
    branch: "대치",
  };

  it("정상 입력 통과", () => {
    const r = CreateBroadcastInputSchema.parse(validBase);
    expect(r.type).toBe("SMS");
    expect(r.subject).toBeNull();
    expect(r.seminar_ids).toHaveLength(1);
    expect(typeof r.group_id).toBe("string");
  });

  it("seminar_ids 가 빈 배열이면 거부", () => {
    expect(() =>
      CreateBroadcastInputSchema.parse({ ...validBase, seminar_ids: [] }),
    ).toThrow();
  });

  it("group_id 가 잘못된 UUID 이면 거부", () => {
    expect(() =>
      CreateBroadcastInputSchema.parse({ ...validBase, group_id: "not-uuid" }),
    ).toThrow();
  });

  it("seminar_ids 안 UUID 가 아니면 거부", () => {
    expect(() =>
      CreateBroadcastInputSchema.parse({
        ...validBase,
        seminar_ids: ["not-a-uuid"],
      }),
    ).toThrow();
  });

  it("body 공백만이면 거부", () => {
    expect(() =>
      CreateBroadcastInputSchema.parse({ ...validBase, body: "   " }),
    ).toThrow();
  });

  it("LMS 인데 subject 가 null 이면 거부 (제목 필수)", () => {
    expect(() =>
      CreateBroadcastInputSchema.parse({
        ...validBase,
        type: "LMS",
        subject: null,
      }),
    ).toThrow();
    expect(() =>
      CreateBroadcastInputSchema.parse({
        ...validBase,
        type: "LMS",
        subject: "",
      }),
    ).toThrow();
  });

  it("LMS + subject 제공 시 통과", () => {
    const r = CreateBroadcastInputSchema.parse({
      ...validBase,
      type: "LMS",
      subject: "설명회 안내",
    });
    expect(r.type).toBe("LMS");
    expect(r.subject).toBe("설명회 안내");
  });

  it("branch 누락(빈 문자열) 거부", () => {
    expect(() =>
      CreateBroadcastInputSchema.parse({ ...validBase, branch: "" }),
    ).toThrow();
  });

  it("type 이 ALIMTALK/MMS 면 거부 (SMS/LMS 만)", () => {
    expect(() =>
      CreateBroadcastInputSchema.parse({
        ...validBase,
        type: "ALIMTALK" as unknown as "SMS",
      }),
    ).toThrow();
  });
});

describe("ClaimInvitationItemInputSchema", () => {
  it("token + seminar_id(uuid) 정상", () => {
    const r = ClaimInvitationItemInputSchema.parse({
      token: "abc123def456",
      seminar_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    });
    expect(r.token).toBe("abc123def456");
    expect(r.seminar_id).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
  });

  it("token 빈 문자열 거부 (유효하지 않은 링크)", () => {
    expect(() =>
      ClaimInvitationItemInputSchema.parse({
        token: "",
        seminar_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      }),
    ).toThrow();
    expect(() =>
      ClaimInvitationItemInputSchema.parse({
        token: "   ",
        seminar_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      }),
    ).toThrow();
  });

  it("seminar_id 가 UUID 가 아니면 거부", () => {
    expect(() =>
      ClaimInvitationItemInputSchema.parse({
        token: "abc123def456",
        seminar_id: "not-a-uuid",
      }),
    ).toThrow();
  });
});
