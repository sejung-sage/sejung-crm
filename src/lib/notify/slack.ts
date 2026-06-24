/**
 * Slack Incoming Webhook 알림 클라이언트.
 *
 * 설정: env `SLACK_WEBHOOK_URL` (Slack 앱 → Incoming Webhooks 에서 발급).
 *   - 미설정이면 전체 no-op → 기능을 끄는 스위치 역할(설정 전까지 안전).
 *
 * 정책:
 *   - 절대 throw 하지 않는다. 알림 실패가 본 작업(발송/cron)을 막으면 안 됨.
 *   - 타임아웃으로 무한 대기 방지.
 *   - 메시지에 학부모 연락처 등 개인정보를 직접 싣지 않는다(요약만). CLAUDE.md #9.
 */

const SLACK_TIMEOUT_MS = 8_000;

export interface SlackPostResult {
  ok: boolean;
  /** ok=false 일 때 사유. "disabled" 면 webhook 미설정(정상 no-op). */
  reason?: string;
}

/** Slack webhook 이 설정돼 있는지(기능 활성 여부). */
export function isSlackEnabled(): boolean {
  return !!process.env.SLACK_WEBHOOK_URL;
}

/**
 * Slack 으로 텍스트 메시지 1건 전송. webhook 미설정이면 no-op.
 * mrkdwn 문법(`*굵게*`, `<url|라벨>`)을 그대로 쓸 수 있다.
 */
export async function postSlackMessage(text: string): Promise<SlackPostResult> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, reason: "disabled" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: `Slack 응답 ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Slack 전송 실패",
    };
  } finally {
    clearTimeout(timer);
  }
}
