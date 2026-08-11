# Vercel + Supabase → GCP 풀 이전 계획

> 작성 2026-06-17. 결정 전제: **ERP와 단일 GCP Postgres를 직접 공유**, **한 번에 풀 이전**.
> 이 문서는 실제 레포 감사 수치에 기반한 실행 계획이다. "결정 필요" 표시는 아직
> 확정 안 된 기술 선택지 — 진행하며 정한다.

## 0. 현재 결합도 (감사 결과 2026-06-17)






| 영역 | 현황 | 이주 난이도 |
|---|---|---|
| 호스팅 | Vercel(region `icn1`), Next.js 16, npm | 낮음 |
| 백그라운드 발송 | `@vercel/functions` `waitUntil` ×5 (drain/send/resume/reschedule/seminar) | 중 (구조 변경) |
| 예약 발송 | Vercel Cron `*/5` → `/api/cron/dispatch-scheduled-campaigns` | 낮음 |
| 함수 타임아웃 | `maxDuration=300` (drain, cron) | 낮음 |
| 발신 고정 IP | `icn1` 고정 IP(52.79.40.50 / 13.209.45.47) → **sendon 발송 화이트리스트** | **중·필수** |
| 데이터 계층 | supabase-js `.from()` **240곳 / 56파일** + `.rpc()` 5곳 | **높음 (핵심)** |
| 인증 | Supabase Auth(`signInWithPassword`/`getUser`) → `crm_users_profile` | 높음 |
| 권한 | 앱 레이어 `can()`/`assert*` **+** RLS 정책 13개 마이그(`auth.uid()` 의존) | 높음 (보안) |
| 스케줄 작업(DB) | pg_cron 2개(stalled sweep, dispatch) | 중 |
| 시크릿 | Supabase Vault(drain_secret) + Vercel env | 낮음 |
| Storage / Edge Functions / Realtime | **미사용** | 없음 |
| ETL | Windows 노트북 Python: Aca2000(MSSQL) → Supabase 매시간 | 중 (재연결) |

**핵심 통찰:** Vercel 탈출은 얕고, **진짜 작업은 "Supabase 플랫폼 떠나기"**(데이터 240곳 + 인증 + RLS).

## 1. 목표 아키텍처 (GCP)

| 구성요소 | 현재 | GCP 목표 | 비고 |
|---|---|---|---|
| 앱 호스팅 | Vercel | **Cloud Run** (Next.js `output:'standalone'` + Dockerfile) | 0→N 오토스케일 |
| DB | Supabase Postgres 15 | **AlloyDB for PostgreSQL** (ERP 공유) · *결정 필요: Cloud SQL 대안(단순/저비용)* | 스케일·ERP공유 → AlloyDB 권장 |
| 데이터 접근 | supabase-js (PostgREST) | **Drizzle ORM** + `pg`/AlloyDB 커넥터 · *결정 필요: Prisma 대안* | strict TS·기존 SQL스러운 쿼리 → Drizzle 권장 |
| 인증 | Supabase Auth(GoTrue) | *결정 필요:* GCP **Identity Platform**(관리형) vs **자체 세션**(Auth.js Credentials/Lucia) | 내부 직원용 고정 사용자 → 자체 세션도 충분 |
| 권한/RLS | RLS 13 + 앱 `can()` | *결정 필요:* 세션 GUC(`SET LOCAL`)로 RLS 유지 vs 앱레이어 일원화(+보안리뷰) | ERP 공유 DB라 RLS 의미 재정의 필요 |
| 백그라운드 발송 | `waitUntil` | **Cloud Tasks**(푸시 큐) → Cloud Run 청크 처리 → 재적재 | 기존 청크 드레인과 1:1 |
| 예약/스윕 cron | Vercel Cron + pg_cron | **Cloud Scheduler** → Cloud Run 엔드포인트 (pg_cron은 AlloyDB 지원 시 유지) | |
| 고정 egress IP | Vercel region | **Serverless VPC 커넥터 + Cloud NAT + 예약 static IP** → sendon 재등록 | **컷오버 선결** |
| 시크릿 | Vault + env | **Secret Manager** + Cloud Run env | |
| ETL 대상 | Supabase | AlloyDB(Cloud SQL Auth Proxy/private IP). 소스 MSSQL은 온프렘 유지 | |

## 2. 가장 어려운 3가지 (여기서 성패 갈림)

1. **데이터 계층 재작성 (240 `.from()` + 5 `.rpc()`).**
   - 대부분 `src/lib/*` 로더/액션에 모여 있음 → **함수 시그니처는 그대로 두고 내부만 Drizzle로 교체**하면 UI·서버액션은 거의 안 건드림. 이게 리스크 축소의 핵심.
   - `drizzle-kit introspect`로 현 스키마를 그대로 가져와 시작.
2. **인증 교체.** Supabase Auth 제거 → 선택한 provider로 로그인/세션 재구현. `crm_users_profile`은 유지(프로필·역할 소스). 미들웨어/`current-user.ts`가 교체 지점.
3. **RLS/권한.** 앱이 이미 `can()`/`assertSendPermission`로 1차 방어 중. RLS는 2차 방어망(`auth.uid()` 의존). ERP가 같은 DB를 공유하면 RLS 주체가 모호해짐 → **보안 리뷰 후** (a) 세션 GUC로 RLS 보존 또는 (b) 앱레이어 일원화 결정. 데이터 노출 위험이라 신중.

## 3. 실행 단계 (풀 컷오버, 내부는 안전하게 스테이징)

- **P0 · 기반:** GCP 프로젝트, VPC, Cloud NAT + 예약 static IP, Serverless VPC 커넥터, AlloyDB 인스턴스, Secret Manager. *(sendon에 새 IP 등록은 P7에서, 검증 후)*
- **P1 · 데이터 계층:** Drizzle 도입 → 현 스키마 introspect → 로더/액션 240곳 내부를 점진 교체(시그니처 고정). `.rpc()` 5개는 SQL 함수 그대로 두고 호출부만 교체. **테스트로 회귀 방지**(기존 Vitest 905개 + 추가).
- **P2 · 인증:** provider 교체, 세션/미들웨어 재구현, `crm_users_profile` 연결.
- **P3 · 권한/RLS:** 보안 리뷰 → RLS 전략 확정·적용.
- **P4 · 백그라운드/cron:** `waitUntil`·`@vercel/functions` 제거 → Cloud Tasks; Vercel Cron + pg_cron → Cloud Scheduler. `maxDuration` → Cloud Run 타임아웃.
- **P5 · 컨테이너화:** Next standalone Dockerfile → Cloud Run 배포(스테이징).
- **P6 · 데이터 이전:** Supabase `pg_dump` → AlloyDB 복원(스키마+데이터). ETL 노트북 → AlloyDB 재연결.
- **P7 · 발송 경로 검증:** 고정 IP → **sendon 화이트리스트 재등록**. 스테이징에서 테스트 발송 1건으로 IP·발신번호(분원별) 확인.
- **P8 · 컷오버:** DNS 전환, 모니터링, Vercel/Supabase 디커미션.

## 4. 리스크 / 게이트

- ⚠️ **sendon IP 화이트리스트** — 새 egress IP 미등록 시 **발송 전부 실패**. P7 게이트.
- ⚠️ **RLS 제거 시 데이터 노출** — 앱레이어 authz 빈틈 없는지 보안 리뷰 필수.
- ⚠️ **`waitUntil` 의미** — Cloud Run은 응답 후 인스턴스 종료 가능. Cloud Tasks로 견고화(또는 CPU always-on).
- ⚠️ **데이터 계층 240곳** — 최대 공수. 로더 시그니처 고정 + 테스트로 통제.
- ⚠️ **ERP 공유 DB** — 스키마 소유권·마이그레이션 조율·서비스계정 접근(RLS 우회) 정책 합의 필요.
- 분원별 발신번호(`SENDON_FROM_NUMBER_*`)·고정IP 화이트리스트는 [project_branch_sender_numbers], [project_static_ip_sendon_whitelist] 참조.

## 5. 다음 액션 (결정 필요)

1. **DB:** AlloyDB vs Cloud SQL?
2. **ORM:** Drizzle vs Prisma?
3. **인증:** Identity Platform(관리형) vs 자체 세션?
4. **RLS:** 세션 GUC로 보존 vs 앱레이어 일원화?

→ 위 4개만 정하면 P0(기반)부터 바로 착수 가능.
