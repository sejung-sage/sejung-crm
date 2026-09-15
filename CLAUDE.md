# 세정학원 CRM MVP

세정학원의 학생 목록 필터링 + 문자 발송 CRM. Aca2000 대비 편의성 개선, 원장 1인 의존 탈피, 문자비 20~30% 절감이 목표.

상세 요구사항은 `docs/sejung-crm-mvp-prd.md` 참조. 이 문서는 그 요약 + 에이전트 작업 규약.

## 스택 요약

- Next.js 15 (App Router) · TypeScript strict
- Tailwind + shadcn/ui · Pretendard + Serif(로고)
- Supabase (PostgreSQL 15) · RLS · pg_cron · Edge Functions
- TanStack Query + Zustand
- SMS: sendon 단일 벤더 (어댑터 패턴 유지)
- Vitest + Playwright

## 절대 규약

1. **DB 컬럼은 영어 snake_case, UI는 한글**. 예: `parent_phone` 컬럼은 UI에서 "학부모 연락처"로 노출.
2. **모든 DB 컬럼에 한글 COMMENT 필수**. 마이그레이션 파일에서 `COMMENT ON COLUMN ...` 빠뜨리지 말 것.
3. **TypeScript strict · `any` 금지**. 외부 입력은 Zod로 런타임 검증.
4. **Server Component 우선**. 클라이언트 컴포넌트는 상호작용 필요한 경우에만.
5. **디자인은 미니멀**: 메인 콘텐츠는 흰색 배경, 사이드바는 브랜드 딥 네이비(`.app-sidebar-navy` 스코프). 보라색·과한 색상 금지. 디자인 토큰은 `src/app/globals.css`의 CSS 변수 준수(2026-07-08 네이비 사이드바 도입, 이전 "흰색+검정" 규약 갱신).
6. **40~60대 사용자 배려**: 기본 폰트 15px, 버튼·입력창 최소 높이 40px, WCAG AA 대비.
7. **SMS 어댑터 패턴 유지**: 환경변수로 벤더 전환 가능한 구조 유지. 현재는 `sendon` 단일 운영.
8. **발송 안전 가드는 서버에서 최종 검증**: [광고] 자동 삽입, 080 수신거부 삽입, 21시~08시 광고 차단, 수신거부 DB 제외, 비활성 학생 제외.
9. **학부모 연락처는 로그에서 마스킹** (`010-****-1234`). API 키는 Supabase Vault.
10. **커밋 메시지는 Conventional Commits**.

## 모듈 경계

| 모듈 | 디렉토리 | 담당 에이전트 |
|---|---|---|
| 데이터 레이어 | `supabase/migrations/` | architect |
| 공통 타입·토큰 | `src/config/`, `src/types/` | architect |
| 학생 프로필 엔진 | `src/lib/profile/` | backend-dev |
| 문자 발송 | `src/lib/messaging/` | backend-dev |
| 강좌·회차 | `src/lib/classes/`, `src/app/(features)/classes/` | backend-dev, frontend-dev |
| UI 셸 | `src/components/shell/` | frontend-dev |
| 기능 페이지 | `src/app/(features)/` | frontend-dev |
| 내부 도구 (master 전용) | `src/lib/explorer/`, `src/lib/dashboard/` | backend-dev |
| 테스트 | `tests/`, `e2e/` | qa-engineer |

## 에이전트 실행 흐름

기능 하나를 개발할 때 기본 패턴:

```
architect → [backend-dev, frontend-dev (병렬)] → qa-engineer
```

- **architect**가 먼저 스키마·타입·디자인 토큰 확정
- 그 다음 **backend-dev**와 **frontend-dev**를 병렬로 돌려 로직·UI 동시 구현
- 마지막에 **qa-engineer**가 단위·E2E·안전성 테스트 작성

구체 지시는 `.claude/agents/*.md`와 `.claude/commands/feature.md` 참조.

## MVP 범위

**IN (Phase 0)**: F1 학생 명단 · F2 발송 그룹 · F3 문자 발송 · F4 계정 권한

**Phase 0 이후 추가된 것** (원래 OUT 이었으나 운영 요청으로 구현됨):
- 발송 대시보드 `/dashboard` (master 전용, 2026-07)
- 데이터 탐색기 `/explorer` (master 전용, 읽기전용)
- 강좌·회차 관리 `/classes` — 설명회는 2026-06-02 에 강좌로 통합됨 (`crm_seminars*` 전부 DROP)
- 아카2000 원본 적재 `aca_*` raw 계층 + 발송 분석 `send_analysis_all`

**여전히 OUT (Phase 1+)**: 자동 트리거, A/B 테스트, STT, AI 추천, 털기 모듈,
알림톡(ALIMTALK) 실발송, RCS

스코프 밖 기능은 사용자가 명시적으로 요청하지 않는 한 구현하지 않는다.

## SMS 벤더 상태

- **sendon** · 단일 운영 벤더. 공식 SDK `@alipeople/sendon-sdk-typescript` 사용
- live 모드: SMS / LMS 실 발송 구현 완료. 알림톡(ALIMTALK) 은 별도 sendon.kakao API
  + 사전 등록 템플릿 ID 가 필요해 Phase 1 으로 미룸
- 인증: `id` (콘솔 로그인 ID) + `apikey` 이중. 기본/폴백 env 는 `SENDON_USER_ID` /
  `SENDON_API_KEY` / `SENDON_FROM_NUMBER` 3종. 분원 전용 키가 없으면 여기로 폴백한다.
- **분원별 계정·발신번호** (2026-06-17): 분원마다 sendon 계정·충전·등록번호가 달라
  분원 기준으로 계정과 발신번호를 해석한다.
  계정 env: `SENDON_USER_ID_DAECHI` / `_BANPO` / `_SONGDO` / `_BANGBAE` (+ `SENDON_API_KEY_*` 동일 접미).
  ⚠️ **방배 계정 키는 넣지 않는다** — 반포와 같은 사업자 계정이라
  `sender-numbers.ts` 의 `ACCOUNT_SHARE` 가 방배→반포로 폴백한다(발신번호는 방배 전용).
  ⚠️ **송도는 sendon 전용 계정(`songdosejung`)이 있으나 env 에 미등록** — 그래서 지금
  송도로 보내면 기본 폴백 계정(`SENDON_USER_ID`)으로 나간다. 송도 번호가 그 계정에
  등록돼 있지 않으면 발송 실패하고, 통과하더라도 요금이 폴백 계정에서 차감돼 분원 정산이
  어긋난다. 송도 발송 시작 전 `SENDON_USER_ID_SONGDO`(=`songdosejung`) /
  `SENDON_API_KEY_SONGDO` 등록 필요.
- **발신 division 축** (2026-07-15): 같은 분원 내에서 발신번호·표시 브랜드명을 나눈다
  (대치 본원 vs 대치 수학관). `branch` 는 sendon **계정**을, `division` 은 **발신번호와
  브랜드명**을 결정하는 2축 모델. division 정의는 `src/config/divisions.ts` (`본원` / `수학관`).
  단일 소스는 `src/config/sender-numbers.ts` 의 **`sendonFromNumber(branch, division)`** — 인자 2개.
  발신번호 env(값은 하이픈 없는 숫자): `SENDON_FROM_NUMBER_DAECHI`(대치 본원) /
  `_DAECHI_MATH`(대치 수학관) / `_BANPO` / `_BANGBAE` / `_SONGDO`.
  발송 경로(drain/test/resend/excel/seminar)는 모두 캠페인의 분원·division 을 넘겨 이 함수로 해석.
  비마스터 계정은 `crm_users_profile.sender_division` 으로 명의가 서버에서 강제 고정된다
  (`resolveSenderDivision`). 마스터만 발송 시 선택 가능.
- **발신번호 검수 상태**: sendon 검수 '정상' 번호만 실제 발송됨 — '검수 대기중' 번호는 발송 실패.

  | 분원 | 번호 | 상태 | 확인 |
  |---|---|---|---|
  | 대치 | — | 정상 | 2026-06-17 · 발송 실적으로 확인 |
  | 송도 | `032-858-0005` | 정상 (2026-07-06 등록) | 2026-09-14 · 콘솔 |
  | 반포 | — | 검수 대기중 | 2026-06-17 (미재확인) |
  | 방배 | — | 검수 대기중 | 2026-06-17 (미재확인) |

  ⚠️ 송도 계정(`songdosejung`)의 **기본 발신번호가 `010-9515-6540`(검수 대기중)로 잡혀 있다**.
  발신번호를 명시하지 않는 경로는 이 번호로 나가 실패한다. 우리 코드는 항상
  `sendonFromNumber()` 로 명시하지만, 콘솔 직접 발송 등에서 걸릴 수 있음.
  ⚠️ 반포·방배는 2026-06-17 이후 재확인하지 않았다. 송도처럼 그 사이 통과했을 수 있으니
  발송 전 콘솔에서 직접 확인할 것.
  실제 발송 실적은 여전히 대치에만 있다(2026-09-14).
- 세정학원 전용 단가 (부가세 별도, 소수 포함):
  - SMS 7.4원 / LMS 24원 / 알림톡 6.4원 / MMS 59.2원 (MMS 는 컬럼 정의만)
- 단가는 `src/lib/messaging/cost-rates.ts` 의 `SENDON_UNIT_COST` 단일 소스
- 미사용으로 일괄 제거(2026-05-08): 솔라피(SOLAPI) / 문자나라 / SK C&C to-go / Sendwise

주의: 발송 테스트는 본인 번호 1건 또는 테스트 모드로만. 실수로 대량 발송 금지.

## 환경변수 · 배포

**값의 단일 소스는 Vercel 환경변수**다. 로컬 `.env.local` 은 뒤처져 있을 수 있으니
운영 값을 확인·인수인계할 때는 Vercel 을 본다 (`vercel env ls production`).

발송 파이프라인 인증·알림 (위 sendon 키 외 필수):

| env | 용도 | 미설정 시 |
|---|---|---|
| `CRON_SECRET` | Vercel cron 이 `Authorization: Bearer` 로 자동 전달 | cron 라우트 401 |
| `DRAIN_SECRET` | 드레인 엔드포인트 `x-drain-secret` 검증 | 드레인 라우트 500 |
| `SLACK_BOT_TOKEN` | 발송 실패 알림 Bot 토큰 (`xoxb-...`) | 알림 skip (발송은 정상) |
| `SLACK_CHANNEL_ID` | 알림 채널 ID (`C...`) | 알림 skip (발송은 정상) |
| `SMS_PROVIDER` | 벤더 선택 | `sendon` 폴백 |
| `SMS_ADAPTER_MODE` | `mock` / `live` | `mock` (실발송 안 함) |
| `SMS_OPT_OUT_NUMBER` | 080 수신거부 번호 | 기본값 `080-123-4567` |

로컬·ETL 전용(Vercel 미등록): `DATABASE_OWNER_URL`, `SHARED_POOLLER`,
`ACA_MSSQL_PASSWORD`, `TEST_RECIPIENT_PHONE`.

cron (`vercel.json`):

| 경로 | 주기 | 역할 |
|---|---|---|
| `/api/cron/dispatch-scheduled-campaigns` | 매 1분 | 예약 발송 시각 도래분 처리 |
| `/api/cron/reconcile-sendon-failures` | 매 5분 | sendon 비동기 실패 대조 |

⚠️ `vercel.json` 의 `regions: ["icn1"]`(서울) 은 바꾸지 말 것. sendon 발송 화이트리스트가
서울 고정 IP(`52.79.40.50` / `13.209.45.47`) 로 등록돼 있어 리전 변경 시 발송이 전부 실패한다.

마이그레이션 적용은 `./scripts/db-push.sh`.

## 개발 원칙 (Karpathy Guidelines)

LLM 코딩 흔한 실수를 막는 행동 지침. 트리비얼한 작업엔 판단껏. 사소하지 않은 작업일수록 속도보다 신중함 우선.
출처: https://github.com/multica-ai/andrej-karpathy-skills (MIT)

### 1. 생각 먼저 (Think Before Coding)
**가정하지 말 것. 헷갈림을 숨기지 말 것. 트레이드오프를 드러낼 것.**
- 가정은 명시적으로 진술. 불확실하면 질문한다.
- 해석이 여러 갈래면 말없이 하나 고르지 말고 제시한다.
- 더 단순한 방법이 있으면 말한다. 필요하면 반대 의견도 낸다.
- 불명확하면 멈춘다. 뭐가 헷갈리는지 짚고 질문한다.

### 2. 단순함 우선 (Simplicity First)
**문제를 푸는 최소 코드. 투기적 코드 금지.**
- 요청 범위를 벗어난 기능 추가 금지.
- 일회성 코드에 추상화 금지. 요청 안 한 "유연성·설정 가능성" 금지.
- 일어날 수 없는 시나리오의 예외처리 금지.
- 200줄을 50줄로 줄일 수 있으면 다시 쓴다. "시니어가 보면 과하다고 할까?" → 예면 단순화.

### 3. 수술적 변경 (Surgical Changes)
**건드려야 할 것만 건드린다. 내가 만든 쓰레기만 치운다.**
- 인접 코드·주석·포매팅을 "개선"하지 않는다. 안 망가진 걸 리팩터링하지 않는다.
- 내 방식과 달라도 기존 스타일에 맞춘다.
- 무관한 죽은 코드를 발견하면 언급만 하고 지우지 않는다 (요청 없이 삭제 금지).
- 내 변경이 만든 미사용 import·변수·함수만 제거한다.
- 테스트: 바뀐 모든 줄이 사용자의 요청으로 직접 추적돼야 한다.

### 4. 목표 기반 실행 (Goal-Driven Execution)
**성공 기준을 정의하고 검증될 때까지 반복한다.**
- "검증 추가" → "잘못된 입력 테스트를 짜고 통과시킨다"
- "버그 수정" → "버그를 재현하는 테스트를 짜고 통과시킨다"
- "X 리팩터링" → "전후로 테스트가 통과하는지 보장한다"
- 멀티스텝 작업은 단계와 검증 체크포인트를 담은 짧은 계획을 먼저 진술한다.
