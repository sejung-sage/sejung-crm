import { describe, it, expect } from "vitest";
import { resolveSenderDivision } from "@/lib/messaging/resolve-sender-division";
import type { CurrentUser } from "@/types/database";

/**
 * 발송 안전 가드 · 계정별 발신 명의(sender_division) 서버 잠금.
 *
 * resolveSenderDivision 은 발송 순간에 유효 발신 division 을 최종 결정하는 순수
 * 함수다. 폼·쿼리로 넘어온 requested 는 마스터에게만 의미가 있고, 비마스터는
 * 클라이언트 입력을 무시하고 계정 고정 명의로 강제된다(폼 우회·조작 방어).
 *
 * 규칙("A 잠금, 마스터만 예외"):
 *  - 마스터: requested 가 branchDivisions(sendBranch) 에 있으면 requested, 아니면 본원.
 *  - 비마스터: requested 무시. sender_division 이 발송 분원에서 유효하면 그 값, 아니면 본원.
 *  - branchDivisions: 대치=[본원,수학관], 그 외/미지정=[본원].
 *
 * 반환은 항상 Division(널 없음).
 */

type SenderUser = Pick<CurrentUser, "role" | "sender_division">;

const mathAccount: SenderUser = { role: "manager", sender_division: "수학관" };
const mainAccount: SenderUser = { role: "manager", sender_division: "본원" };
const legacyAccount: SenderUser = { role: "manager", sender_division: null };
const master: SenderUser = { role: "master", sender_division: null };

describe("resolveSenderDivision · 계정 발신 명의 서버 잠금", () => {
  describe("비마스터 잠금(핵심 안전선)", () => {
    it("수학관 계정이 requested='본원'(조작 시도)로 발송해도 요청을 무시하고 '수학관'을 강제한다", () => {
      // 대치 분원 → [본원, 수학관] 둘 다 유효하지만 계정 명의가 이긴다.
      expect(resolveSenderDivision(mathAccount, "대치", "본원")).toBe("수학관");
    });

    it("본원 계정이 requested='수학관'으로 승격 시도해도 '본원'으로 고정한다", () => {
      expect(resolveSenderDivision(mainAccount, "대치", "수학관")).toBe("본원");
    });

    it("sender_division=null(기존 계정)은 대치에서도 기본 '본원'으로 귀결한다", () => {
      expect(resolveSenderDivision(legacyAccount, "대치", "수학관")).toBe("본원");
      expect(resolveSenderDivision(legacyAccount, "대치", null)).toBe("본원");
    });

    it("admin·viewer 등 비마스터 role 전부 동일하게 계정 명의로 잠긴다", () => {
      expect(
        resolveSenderDivision(
          { role: "admin", sender_division: "수학관" },
          "대치",
          "본원",
        ),
      ).toBe("수학관");
      expect(
        resolveSenderDivision(
          { role: "viewer", sender_division: "수학관" },
          "대치",
          "본원",
        ),
      ).toBe("수학관");
    });
  });

  describe("비마스터 · 비대치 분원 폴백", () => {
    it("수학관 계정이 어쩌다 송도로 발송하면 송도엔 수학관이 없어 '본원'으로 폴백한다", () => {
      expect(resolveSenderDivision(mathAccount, "송도", "수학관")).toBe("본원");
    });

    it("수학관 계정이 미등록 분원으로 발송해도 '본원'으로 폴백한다", () => {
      expect(resolveSenderDivision(mathAccount, "반포", "수학관")).toBe("본원");
    });
  });

  describe("마스터 예외(클라이언트 입력 신뢰, 단 분원 유효성 검증)", () => {
    it("대치 + requested='수학관' → '수학관'", () => {
      expect(resolveSenderDivision(master, "대치", "수학관")).toBe("수학관");
    });

    it("대치 + requested='본원'/undefined → '본원'", () => {
      expect(resolveSenderDivision(master, "대치", "본원")).toBe("본원");
      expect(resolveSenderDivision(master, "대치", undefined)).toBe("본원");
    });

    it("대치 + 유효하지 않은 requested → '본원'으로 폴백한다", () => {
      // @ts-expect-error 런타임 방어 검증: 타입 밖 값이 들어와도 isDivision 이 막는다.
      expect(resolveSenderDivision(master, "대치", "존재하지않음")).toBe("본원");
      expect(resolveSenderDivision(master, "대치", null)).toBe("본원");
    });

    it("송도 + requested='수학관'(송도엔 수학관 없음) → '본원'으로 폴백한다", () => {
      expect(resolveSenderDivision(master, "송도", "수학관")).toBe("본원");
    });
  });

  describe("경계값 · sendBranch/requested 방어", () => {
    it("sendBranch=null/undefined 는 [본원]뿐이라 마스터·비마스터 모두 '본원'", () => {
      expect(resolveSenderDivision(master, null, "수학관")).toBe("본원");
      expect(resolveSenderDivision(master, undefined, "수학관")).toBe("본원");
      expect(resolveSenderDivision(mathAccount, null, "수학관")).toBe("본원");
      expect(resolveSenderDivision(mathAccount, undefined, null)).toBe("본원");
    });

    it("requested 생략(인자 미전달)도 안전하게 처리한다", () => {
      expect(resolveSenderDivision(master, "대치")).toBe("본원");
      expect(resolveSenderDivision(mathAccount, "대치")).toBe("수학관");
    });

    it("반환은 항상 Division(널 아님) — 모든 폴백이 '본원'으로 수렴한다", () => {
      const result = resolveSenderDivision(legacyAccount, null, undefined);
      expect(result).not.toBeNull();
      expect(result).toBe("본원");
    });
  });
});
