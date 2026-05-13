/**
 * 0031_pg_cron_sweep_stalled_campaigns.sql 정적 검증.
 *
 * 마이그 SQL 자체를 실행하려면 supabase 로컬 인스턴스가 필요해 본 단계에서는 제외.
 * 대신 핵심 키워드 누락 회귀(예: pg_cron 스케줄 표현식 변경, vault secret 이름 오기)를
 * 정규식으로 가볍게 잡는다.
 *
 * 회귀 보호 항목:
 *   - 한국어 enum 값 ('발송중', '대기')
 *   - 익스텐션 (pg_cron, pg_net)
 *   - vault secret 조회 (vault.decrypted_secrets)
 *   - cron.schedule 호출과 '*\/3 * * * *' 표현식
 *   - COMMENT (운영자 안내) 누락 방지
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/0031_pg_cron_sweep_stalled_campaigns.sql",
);

describe("0031_pg_cron_sweep_stalled_campaigns.sql · 정적 키워드 회귀", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const lower = sql.toLowerCase();

  it("한국어 enum 값 '발송중' 포함", () => {
    expect(sql).toContain("'발송중'");
  });

  it("한국어 enum 값 '대기' 포함", () => {
    expect(sql).toContain("'대기'");
  });

  it("pg_cron 익스텐션 활성화 구문 포함", () => {
    expect(lower).toMatch(/create\s+extension\s+if\s+not\s+exists\s+pg_cron/);
  });

  it("pg_net 익스텐션 활성화 구문 포함", () => {
    expect(lower).toMatch(/create\s+extension\s+if\s+not\s+exists\s+pg_net/);
  });

  it("vault.decrypted_secrets 조회 포함", () => {
    expect(lower).toContain("vault.decrypted_secrets");
  });

  it("cron.schedule 호출 포함", () => {
    expect(lower).toContain("cron.schedule");
  });

  it("매 3분 cron 표현식 '*/3 * * * *' 포함", () => {
    expect(sql).toContain("*/3 * * * *");
  });

  it("주석/COMMENT 가 최소 1개 이상 포함", () => {
    expect(lower).toMatch(/comment\s+on\s+function/);
  });

  it("find_stalled_campaigns 함수 정의 포함", () => {
    expect(lower).toContain("function public.find_stalled_campaigns");
  });

  it("sweep_stalled_campaigns 함수 정의 포함", () => {
    expect(lower).toContain("function public.sweep_stalled_campaigns");
  });

  it("net.http_post 호출 포함 (드레인 재킥)", () => {
    expect(lower).toContain("net.http_post");
  });

  it("'/api/messaging/drain' 경로 포함", () => {
    expect(sql).toContain("/api/messaging/drain");
  });

  it("'x-drain-secret' 헤더 명시", () => {
    expect(lower).toContain("x-drain-secret");
  });
});
