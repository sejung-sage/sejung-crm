/**
 * Slack 알림 클라이언트 — Bot Token 방식(Web API chat.postMessage).
 *
 * 설정(둘 다 있어야 활성):
 *   - env `SLACK_BOT_TOKEN`  : Slack 앱의 Bot User OAuth Token (`xoxb-...`).
 *       필요 권한(scope): `chat:write`. 봇을 대상 채널에 초대해야 한다(/invite).
 *   - env `SLACK_CHANNEL_ID` : 보낼 채널 ID (`C...`). 채널 링크 끝의 ID.
 *   둘 중 하나라도 없으면 전체 no-op → 기능 off 스위치(설정 전까지 안전).
 *
 * 정책:
 *   - 절대 throw 하지 않는다. 알림 실패가 본 작업(발송/cron)을 막으면 안 됨.
 *   - 타임아웃으로 무한 대기 방지.
 *   - Slack Web API 는 논리 오류도 HTTP 200 + {ok:false} 로 주므로 body.ok 를 본다.
 *   - 메시지에 학부모 연락처 등 개인정보를 직접 싣지 않는다(요약만). CLAUDE.md #9.
 */

const SLACK_TIMEOUT_MS = 8_000;
const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export interface SlackPostResult {
  ok: boolean;
  /** ok=false 일 때 사유. "disabled" 면 미설정(정상 no-op). */
  reason?: string;
}

/** Slack 알림이 설정돼 있는지(기능 활성 여부). */
export function isSlackEnabled(): boolean {
  return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);
}

/**
 * Slack 으로 텍스트 메시지 1건 전송. 미설정이면 no-op.
 * mrkdwn 문법(`*굵게*`, `<url|라벨>`)을 그대로 쓸 수 있다.
 */
export async function postSlackMessage(text: string): Promise<SlackPostResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) return { ok: false, reason: "disabled" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
  try {
    const res = await fetch(SLACK_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: `Slack 응답 ${res.status}` };
    }
    // Web API 는 200 이어도 {ok:false, error} 일 수 있다.
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!body?.ok) {
      return { ok: false, reason: body?.error ?? "Slack ok=false" };
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
