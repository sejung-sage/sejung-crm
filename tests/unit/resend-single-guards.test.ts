import { describe, it, expect, beforeEach } from "vitest";
import { resendSingleMessage } from "@/lib/messaging/resend-single";
import { resendSingleMessageAction } from "@/app/(features)/campaigns/actions";

/**
 * F3 Part B · 개별 학생 1명 재발송 — 상태 가드 / 차단 규칙.
 *
 * `resendSingleMessage` 는 일괄 재발송(`resendFailedMessages`)을 1건으로 좁힌
 * 단건 경로다. dev-seed 모드에서는 DB 접근/벤더 호출 없이 즉시 `dev_seed_mode`
 * 를 반환해야 한다(CLAUDE.md 마지막 줄: 개발 환경에서 실 SMS 차단).
 *
 * 작성 방침(qa 규약):
 *   - 실제 발송/네트워크 금지. 기존 send-campaign-guards / *-actions-guards
 *     테스트와 동일하게 dev-seed env(SEJUNG_DEV_SEED=1)로 짧은 차단 경로만 검증.
 *   - Supabase 단건 조회 이후의 상태 가드(대기/도달/is_test 등)는 실제 DB row 가
 *     필요해 단위로 못 덮는다 → E2E(send-flow / 캠페인 상세 재발송) 영역. 하단
 *     "검증 못 한 계약" 주석 참조.
 *   - 결과는 SendCampaignResult discriminated union. 메시지는 한국어.
 *
 * dev-seed 차단이 messageId 검증보다 먼저 일어난다(코드 순서: isDevSeedMode 첫 줄).
 * 따라서 빈 messageId 의 "failed" 는 dev-seed 가 꺼진 환경에서만 관찰 가능하다.
 */

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("resendSingleMessage · dev-seed 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("UUID 형식 messageId 도 dev-seed 면 dev_seed_mode 즉시 반환", async () => {
    const r = await resendSingleMessage(VALID_UUID);
    expect(r.status).toBe("dev_seed_mode");
    if (r.status === "dev_seed_mode") {
      expect(r.reason).toMatch(/시드|dev|차단/i);
    }
  });

  it("아무 문자열 messageId 도 dev_seed_mode (DB 조회 전 차단)", async () => {
    const r = await resendSingleMessage("msg-abc-123");
    expect(r.status).toBe("dev_seed_mode");
  });

  it("빈 문자열 messageId 도 dev_seed_mode (시드 차단이 ID 검증보다 먼저)", async () => {
    // resend-single.ts: isDevSeedMode() 가 messageId 검증보다 위에 있다.
    const r = await resendSingleMessage("");
    expect(r.status).toBe("dev_seed_mode");
  });
});

describe("resendSingleMessage · messageId 입력 검증 (시드 OFF 경로)", () => {
  beforeEach(() => {
    // dev-seed 를 끄고, 실 Supabase URL 도 없는 상태를 피하기 위해 더미 URL 지정.
    // 이렇게 해야 isDevSeedMode() 가 false 가 되어 messageId 가드 분기에 도달한다.
    delete process.env.SEJUNG_DEV_SEED;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
  });

  it("빈 문자열 messageId → failed + '메시지 ID 가 유효하지 않습니다' (DB 조회 전)", async () => {
    // messageId 가드는 createSupabaseServerClient 호출 이전에 반환하므로
    // DB 커넥션 없이 순수하게 검증 가능하다.
    const r = await resendSingleMessage("");
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toBe("메시지 ID 가 유효하지 않습니다");
    }
  });
});

describe("resendSingleMessageAction · 입력 가드 (Server Action 래퍼)", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("UUID messageId → dev_seed_mode (lib 함수로 위임)", async () => {
    const r = await resendSingleMessageAction(VALID_UUID);
    expect(r.status).toBe("dev_seed_mode");
  });

  it("빈 ID → failed + 한글 메시지 (래퍼 입력 가드가 dev-seed 보다 먼저)", async () => {
    // actions.ts: messageId.length === 0 검사가 resendSingleMessage 호출 이전.
    const r = await resendSingleMessageAction("");
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toMatch(/메시지 ID|유효/);
    }
  });
});

/**
 * ── 단위로 못 덮는 계약 (E2E / 통합 영역) ───────────────────────────────
 *
 * 아래는 실제 crm_messages row + 캠페인 + 권한 컨텍스트가 있어야 검증되며,
 * dev-seed 차단이 그 전에 일어나 단위 테스트로는 도달 불가하다. Supabase
 * 로컬 인스턴스를 띄우는 E2E(send-flow / 캠페인 상세 재발송 시나리오)에서 검증한다.
 *
 *   - is_test=true            → failed("테스트 메시지는 재발송할 수 없습니다")
 *   - status '대기'            → failed("발송 중인 메시지는 재발송할 수 없습니다")
 *   - status '도달'            → failed("이미 도달한 메시지는 재발송할 수 없습니다")
 *   - status '실패'/'발송됨'   → 가드 통과 시 재발송 허용
 *   - campaign_id null         → failed("캠페인 정보가 없어 재발송할 수 없습니다")
 *   - body/type NULL 옛 캠페인 → failed("본문 정보가 없는 옛 캠페인은 ...")
 *     (template 기반·직접 작성 본문 모두 재발송 허용 — 캠페인 스냅샷 body 재사용,
 *      {이름}/{날짜} 는 applyNameToken/applyDateToken 으로 단건 치환)
 *   - 권한 없음                → failed("본 분원 캠페인 발송 권한이 없습니다")
 *   - 야간 광고 차단           → blocked
 *   - 수신거부 번호            → failed("재발송 가능한 수신자가 없습니다(수신거부)")
 *   - 성공 시 캠페인 status 미변경 + total_cost 만 누적
 */
