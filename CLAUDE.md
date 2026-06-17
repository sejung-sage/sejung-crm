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
5. **디자인은 흰색+검정 미니멀**. 보라색·강한 색상 금지. 디자인 토큰은 PRD 섹션 2.2 또는 `src/app/globals.css`의 CSS 변수 준수.
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
| UI 셸 | `src/components/shell/` | frontend-dev |
| 기능 페이지 | `src/app/(features)/` | frontend-dev |
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

**OUT (Phase 1+)**: 비용 대시보드, 자동 트리거, A/B 테스트, STT, AI 추천, 설명회·털기 모듈

스코프 밖 기능은 사용자가 명시적으로 요청하지 않는 한 구현하지 않는다.

## SMS 벤더 상태

- **sendon** · 단일 운영 벤더. 공식 SDK `@alipeople/sendon-sdk-typescript` 사용
- live 모드: SMS / LMS 실 발송 구현 완료. 알림톡(ALIMTALK) 은 별도 sendon.kakao API
  + 사전 등록 템플릿 ID 가 필요해 Phase 1 으로 미룸
- 인증: `id` (콘솔 로그인 ID) + `apikey` 이중. env 는 `SENDON_USER_ID` / `SENDON_API_KEY` /
  `SENDON_FROM_NUMBER` 3종 모두 필수
- **분원별 발신번호** (2026-06-17): 분원마다 sendon 등록 번호가 달라 분원 기준으로
  발신번호를 해석한다. 단일 소스 `src/config/sender-numbers.ts` 의 `sendonFromNumber(branch)`.
  env(값은 하이픈 없는 숫자): `SENDON_FROM_NUMBER_DAECHI`(대치) / `_SONGDO`(송도) /
  `_BANPO`(반포) / `_BANGBAE`(방배). 분원 키 미설정 시 `SENDON_FROM_NUMBER` 폴백.
  발송 경로(drain/test/resend/excel/seminar)는 모두 캠페인·발송 분원을 넘겨 이 함수로 해석.
  ⚠️ sendon 검수 '정상' 번호만 실제 발송됨 — '검수 대기중' 번호는 발송 실패.
- 세정학원 전용 단가 (부가세 별도, 소수 포함):
  - SMS 7.4원 / LMS 24원 / 알림톡 6.4원 / MMS 59.2원 (MMS 는 컬럼 정의만)
- 단가는 `src/lib/messaging/cost-rates.ts` 의 `SENDON_UNIT_COST` 단일 소스
- 미사용으로 일괄 제거(2026-05-08): 솔라피(SOLAPI) / 문자나라 / SK C&C to-go / Sendwise

주의: 발송 테스트는 본인 번호 1건 또는 테스트 모드로만. 실수로 대량 발송 금지.

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
