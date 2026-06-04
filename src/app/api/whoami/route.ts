/**
 * 임시 진단 엔드포인트 — Vercel 함수의 아웃바운드(egress) 공인 IP 확인용.
 *
 * 목적: sendon Whitelist IP 등록을 위해, 서울(icn1) 리전 함수가 실제로
 *       어떤 공인 IP 로 외부 호출을 나가는지 확인한다.
 *       Vercel Static IP 가 정상 적용됐다면 52.79.40.50 / 13.209.45.47 중 하나가 나와야 한다.
 *
 * ⚠️ 진단 완료 후 삭제할 것. (민감 정보 아님 — 자사 egress IP 만 노출)
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const probes = [
    "https://api.ipify.org?format=json",
    "https://ifconfig.me/all.json",
  ];

  const results: Record<string, unknown> = {};
  for (const url of probes) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      results[url] = await res.json();
    } catch (e) {
      results[url] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(
    { region: process.env.VERCEL_REGION ?? "unknown", probes: results },
    { headers: { "cache-control": "no-store" } },
  );
}
