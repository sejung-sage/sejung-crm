/**
 * 솔라피 live 모드 1건 sanity 발송 스크립트.
 *
 * 용도: Supabase 미연결(dev-seed) 상태에서도 어댑터 + 가드만 직접 호출해
 *       본인 번호로 SMS 1건이 실제로 도착하는지 검증.
 *
 * 호출 경로: env 검증 → 안전 가드 적용 → solapi adapter.send() 1회.
 *           DB 기록 없음. 캠페인/메시지 row 안 만듦.
 *
 * 실행:
 *   npx tsx scripts/sanity-live-send.ts
 *
 * 사전 조건 (.env.local):
 *   SMS_ADAPTER_MODE=live
 *   SOLAPI_API_KEY=NCS...
 *   SOLAPI_API_SECRET=...
 *   SOLAPI_FROM_NUMBER=01012345678   (사전 등록·승인 완료된 번호)
 *   TEST_RECIPIENT_PHONE=01098765432 (본인 번호. 발신번호와 다른 번호 권장)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── .env.local 수동 로드 (dotenv 의존성 회피) ────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const text = readFileSync(envPath, "utf-8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (process.env[key]) continue; // 이미 set 된 값 우선
    process.env[key] = val.trim().replace(/^["']|["']$/g, "");
  }
} catch (err) {
  console.error("❌ .env.local 을 읽을 수 없습니다:", envPath);
  process.exit(1);
}

// ─── 안전 가드 (실 발송 직전 차단) ──────────────────────────
const required = {
  SMS_ADAPTER_MODE: process.env.SMS_ADAPTER_MODE,
  SMS_PROVIDER: process.env.SMS_PROVIDER ?? "solapi",
  SOLAPI_API_KEY: process.env.SOLAPI_API_KEY,
  SOLAPI_API_SECRET: process.env.SOLAPI_API_SECRET,
  SOLAPI_FROM_NUMBER: process.env.SOLAPI_FROM_NUMBER,
  TEST_RECIPIENT_PHONE: process.env.TEST_RECIPIENT_PHONE,
};

const missing = Object.entries(required)
  .filter(([, v]) => !v || v.trim() === "")
  .map(([k]) => k);

if (missing.length > 0) {
  console.error("❌ 필수 env 누락:", missing.join(", "));
  process.exit(1);
}

if (required.SMS_ADAPTER_MODE !== "live") {
  console.error(
    `❌ SMS_ADAPTER_MODE 가 'live' 가 아닙니다 (현재: ${required.SMS_ADAPTER_MODE}). 안전상 중단.`,
  );
  process.exit(1);
}

if (required.SMS_PROVIDER !== "solapi") {
  console.error(
    `❌ SMS_PROVIDER 가 'solapi' 가 아닙니다 (현재: ${required.SMS_PROVIDER}). 이 스크립트는 솔라피 전용.`,
  );
  process.exit(1);
}

// 본인 번호 정규화 + 검증
const recipient = required.TEST_RECIPIENT_PHONE!.replace(/\D/g, "");
if (!/^01[016789][0-9]{7,8}$/.test(recipient)) {
  console.error(
    "❌ TEST_RECIPIENT_PHONE 형식 오류. 010XXXXXXXX 형식이어야 합니다.",
  );
  process.exit(1);
}

const fromNumber = required.SOLAPI_FROM_NUMBER!.replace(/\D/g, "");
if (recipient === fromNumber) {
  console.error(
    "⚠️  발신번호와 수신번호가 동일합니다. 일부 통신사가 차단할 수 있어요. 다른 번호 권장.",
  );
}

// ─── 본문 + 가드 적용 + 발송 ───────────────────────────────
import { applyAllGuards } from "../src/lib/messaging/guards";
import { createSmsAdapter } from "../src/lib/messaging/adapters";

async function main(): Promise<void> {
  const body = "[세정학원] CRM 발송 시스템 연동 테스트입니다. (개발용)";
  const isAd = false;
  const scheduledAt = new Date();

  const guarded = applyAllGuards({
    body,
    isAd,
    scheduledAt,
    recipients: [
      { studentId: null, phone: recipient, name: "테스트수신자", status: "재원생" },
    ],
    unsubscribedPhones: [],
  });

  if (!guarded.allowedToSend) {
    console.error("❌ 가드 차단:", guarded.blockReason);
    process.exit(1);
  }

  if (guarded.eligible.length === 0) {
    console.error("❌ 가드 후 수신자 0명 (수신거부 또는 비활성)");
    process.exit(1);
  }

  const mask = (p: string) =>
    p.length === 11
      ? `${p.slice(0, 3)}-****-${p.slice(7)}`
      : `${p.slice(0, 3)}-***-${p.slice(p.length - 4)}`;

  console.log("─── 솔라피 sanity 발송 ────────────────────────────");
  console.log(`  공급자       : ${required.SMS_PROVIDER}`);
  console.log(`  모드         : ${required.SMS_ADAPTER_MODE}`);
  console.log(`  발신번호     : ${mask(fromNumber)}`);
  console.log(`  수신번호     : ${mask(recipient)}`);
  console.log(`  본문         : ${guarded.finalBody}`);
  console.log(`  바이트       : ${Buffer.byteLength(guarded.finalBody, "utf-8")} (UTF-8)`);
  console.log(`  광고성       : ${isAd}`);
  console.log(`  예약 시각    : ${scheduledAt.toISOString()}`);
  console.log("");
  console.log("3초 후 발송합니다. 중단하려면 Ctrl+C…");
  console.log("");

  await new Promise((r) => setTimeout(r, 3000));

  const adapter = createSmsAdapter();
  console.log(`▶ adapter.send 호출 (provider=${adapter.name})...`);

  try {
    const result = await adapter.send({
      to: recipient,
      body: guarded.finalBody,
      subject: null,
      type: "SMS",
      fromNumber,
    });

    console.log("");
    console.log("─── 응답 ──────────────────────────────────────────");
    console.log(JSON.stringify(result, null, 2));
    console.log("");

    if (result.status === "queued") {
      console.log("✅ 솔라피 큐 적재 성공.");
      console.log(`   vendorMessageId: ${result.vendorMessageId}`);
      console.log(`   cost: ${result.cost}원`);
      console.log("   휴대폰 도착 확인 후 솔라피 콘솔 → 발송내역에서도 확인 가능.");
    } else {
      console.error("❌ 발송 실패:", result.reason);
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ adapter.send 예외:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ 스크립트 실행 실패:", err instanceof Error ? err.message : err);
  process.exit(1);
});
