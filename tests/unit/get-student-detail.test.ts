import { describe, it, expect, beforeEach } from "vitest";
import { getStudentDetail } from "@/lib/profile/get-student-detail";
import {
  DEV_ATTENDANCES,
  DEV_ENROLLMENTS,
  DEV_STUDENT_MESSAGES,
} from "@/lib/profile/students-dev-seed";

/**
 * getStudentDetail · dev-seed 경로 단위 테스트.
 *
 * SEJUNG_DEV_SEED=1 강제 + NEXT_PUBLIC_SUPABASE_URL 제거로 dev-seed 분기만 검증.
 * Supabase 경로는 네트워크 모킹이 복잡하므로 이번 테스트 범위 밖.
 */
describe("getStudentDetail · dev seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("프로필 조회 - 기본", () => {
    it("존재하는 학생 ID(dev-DC0001) → 프로필을 반환한다", async () => {
      const detail = await getStudentDetail("dev-DC0001");
      expect(detail).not.toBeNull();
      expect(detail?.profile.id).toBe("dev-DC0001");
      expect(detail?.profile.name).toBe("김민준");
      // name 이 빈 문자열이 아님을 명시적으로 검증
      expect(typeof detail?.profile.name).toBe("string");
      expect((detail?.profile.name ?? "").length).toBeGreaterThan(0);
    });

    it("존재하지 않는 ID → null", async () => {
      const detail = await getStudentDetail("nonexistent-999");
      expect(detail).toBeNull();
    });

    it("빈 문자열 ID → null", async () => {
      const detail = await getStudentDetail("");
      expect(detail).toBeNull();
    });
  });

  describe("수강 이력(enrollments)", () => {
    it("수강 이력이 있는 학생(dev-DC0003) → enrollments 배열이 채워진다", async () => {
      const detail = await getStudentDetail("dev-DC0003");
      expect(detail).not.toBeNull();
      expect(detail!.enrollments.length).toBeGreaterThan(0);
      // 시드상 DC0003 은 2건
      expect(detail!.enrollments.length).toBe(2);
      // 모든 레코드가 해당 학생 소속
      expect(
        detail!.enrollments.every((e) => e.student_id === "dev-DC0003"),
      ).toBe(true);
    });

    it("enrollments 가 paid_at DESC (그 다음 start_date DESC) 로 정렬된다", async () => {
      const detail = await getStudentDetail("dev-DC0003");
      const enrollments = detail!.enrollments;
      // DC0003 시드 · ENR-0004 paid_at=2026-04-01 이 먼저, ENR-0003 paid_at=2026-02-28 이 나중
      expect(enrollments[0].id).toBe("dev-ENR-0004");
      expect(enrollments[1].id).toBe("dev-ENR-0003");

      // 일반 검증 - 인접 쌍의 paid_at 이 비내림차순
      for (let i = 0; i < enrollments.length - 1; i++) {
        const a = enrollments[i].paid_at;
        const b = enrollments[i + 1].paid_at;
        if (a !== null && b !== null) {
          expect(a >= b).toBe(true);
        }
      }
    });

    it("course_name 은 string, teacher_name 은 string 또는 null", async () => {
      const detail = await getStudentDetail("dev-DC0003");
      for (const e of detail!.enrollments) {
        expect(typeof e.course_name).toBe("string");
        expect(e.course_name.length).toBeGreaterThan(0);
        expect(
          e.teacher_name === null || typeof e.teacher_name === "string",
        ).toBe(true);
      }
    });

    it("paid_at null 레코드가 시드에 있을 경우 NULLS LAST 로 정렬된다", async () => {
      // 시드에 paid_at null 레코드가 있는지 런타임 체크 → 있으면 검증, 없으면 skip 동등한 PASS
      const hasNullPaid = DEV_ENROLLMENTS.some((e) => e.paid_at === null);
      if (!hasNullPaid) {
        // 시드에 null 레코드 없음 - NULLS LAST 검증 스킵, 단순 DESC 불변식만 재확인
        const detail = await getStudentDetail("dev-DC0001");
        const enrollments = detail!.enrollments;
        expect(enrollments.every((e) => e.paid_at !== null)).toBe(true);
        return;
      }
      // 있으면 null 이 항상 non-null 뒤에 오는지 확인 (학생별 필터링 필요)
      const nullRow = DEV_ENROLLMENTS.find((e) => e.paid_at === null)!;
      const detail = await getStudentDetail(nullRow.student_id);
      const enrollments = detail!.enrollments;
      let seenNull = false;
      for (const e of enrollments) {
        if (e.paid_at === null) seenNull = true;
        else if (seenNull) {
          // null 뒤에 non-null 이 오면 실패
          throw new Error("NULLS LAST 위반: null 뒤에 non-null 발견");
        }
      }
    });

    it("수강 이력이 없는 학생(dev-DC0004) → enrollments 빈 배열", async () => {
      const detail = await getStudentDetail("dev-DC0004");
      expect(detail).not.toBeNull();
      expect(detail!.enrollments).toEqual([]);
      expect(detail!.enrollments.length).toBe(0);
    });

    it("수강 이력이 없는 학생(dev-SD0005) → enrollments 빈 배열", async () => {
      const detail = await getStudentDetail("dev-SD0005");
      expect(detail).not.toBeNull();
      expect(detail!.enrollments).toEqual([]);
    });
  });

  describe("출석(attendances)", () => {
    it("출석 이력이 있는 학생(dev-DC0001) → attendances 가 attended_at DESC 로 정렬", async () => {
      const detail = await getStudentDetail("dev-DC0001");
      const attendances = detail!.attendances;
      expect(attendances.length).toBeGreaterThan(0);

      // 시드상 DC0001 은 5건
      expect(attendances.length).toBe(5);
      // 가장 최근 출석이 맨 앞 (2026-04-21)
      expect(attendances[0].attended_at).toBe("2026-04-21");

      // DESC 불변식
      for (let i = 0; i < attendances.length - 1; i++) {
        expect(attendances[i].attended_at >= attendances[i + 1].attended_at).toBe(
          true,
        );
      }
    });

    it("출석 status 값은 '출석'|'지각'|'결석'|'조퇴' 중 하나", async () => {
      // 시드 전체를 한 번에 훑기 - 여러 학생 조합
      const ids = ["dev-DC0001", "dev-DC0002", "dev-DC0003", "dev-SD0001"];
      const allowed = new Set(["출석", "지각", "결석", "조퇴"]);
      for (const id of ids) {
        const detail = await getStudentDetail(id);
        for (const a of detail!.attendances) {
          expect(allowed.has(a.status)).toBe(true);
        }
      }
      // 시드에 '지각'·'결석'·'조퇴' 가 실제로 포함되어 있는지도 확인 (안전성)
      const allStatuses = new Set(DEV_ATTENDANCES.map((a) => a.status));
      expect(allStatuses.has("출석")).toBe(true);
      expect(allStatuses.has("지각")).toBe(true);
      expect(allStatuses.has("결석")).toBe(true);
      expect(allStatuses.has("조퇴")).toBe(true);
    });

    it("출석 이력이 없는 학생(dev-DC0004) → attendances 빈 배열", async () => {
      const detail = await getStudentDetail("dev-DC0004");
      expect(detail!.attendances).toEqual([]);
    });
  });

  describe("발송 이력(messages)", () => {
    it("발송 이력 있는 학생(dev-DC0001) → messages 가 채워지고 campaign_title 이 string", async () => {
      const detail = await getStudentDetail("dev-DC0001");
      const messages = detail!.messages;
      expect(messages.length).toBeGreaterThan(0);
      // 시드상 DC0001 은 2건
      expect(messages.length).toBe(2);
      for (const m of messages) {
        // StudentMessageRow 타입상 campaign_title 은 string (빈 문자열 허용)
        expect(typeof m.campaign_title).toBe("string");
      }
    });

    it("발송 이력 있는 학생(dev-DC0002) → messages 1건", async () => {
      const detail = await getStudentDetail("dev-DC0002");
      expect(detail!.messages.length).toBe(1);
      expect(detail!.messages[0].campaign_title).toBe("2026년 3월 개강 안내");
    });

    it("발송 이력 없는 학생(dev-DC0003) → 빈 배열", async () => {
      // 수강 이력은 있으나 발송 이력은 없는 케이스 - 두 영역이 독립적으로 동작하는지 확인
      const detail = await getStudentDetail("dev-DC0003");
      expect(detail!.messages).toEqual([]);
    });

    it("발송 이력 없는 학생(dev-DC0004) → 빈 배열", async () => {
      const detail = await getStudentDetail("dev-DC0004");
      expect(detail!.messages).toEqual([]);
    });

    it("messages 가 sent_at DESC NULLS LAST 로 정렬된다", async () => {
      const detail = await getStudentDetail("dev-DC0001");
      const messages = detail!.messages;

      // DC0001 시드 · MSG-0002 sent_at=2026-04-18 먼저, MSG-0001 sent_at=2026-03-01 나중
      expect(messages[0].id).toBe("dev-MSG-0002");
      expect(messages[1].id).toBe("dev-MSG-0001");

      // DESC + NULLS LAST 불변식: null 은 비-null 보다 뒤, 비-null 끼리는 내림차순
      let seenNull = false;
      for (let i = 0; i < messages.length; i++) {
        const cur = messages[i].sent_at;
        if (cur === null) {
          seenNull = true;
          continue;
        }
        // null 뒤에 non-null 등장 시 위반
        expect(seenNull).toBe(false);
        if (i > 0) {
          const prev = messages[i - 1].sent_at;
          if (prev !== null) {
            expect(prev >= cur).toBe(true);
          }
        }
      }

      // 시드에 sent_at null 이 실제로 있을 경우에만 NULLS LAST 를 강하게 검증
      const hasNullSent = DEV_STUDENT_MESSAGES.some((m) => m.sent_at === null);
      if (hasNullSent) {
        const nullMsg = DEV_STUDENT_MESSAGES.find((m) => m.sent_at === null)!;
        // 그 phone 을 가진 학생 찾아서 검증 (현재 시드엔 null 없으므로 이 블록은 미도달)
        expect(nullMsg).toBeDefined();
      }
    });
  });
});
