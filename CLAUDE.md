# 세정학원 CRM MVP

세정학원의 학생 목록 필터링 + 문자 발송 CRM. Aca2000 대비 편의성 개선, 원장 1인 의존 탈피, 문자비 20~30% 절감이 목표.

상세 요구사항은 `docs/sejung-crm-mvp-prd.md` 참조. 이 문서는 그 요약 + 에이전트 작업 규약.

## 스택 요약

- Next.js 15 (App Router) · TypeScript strict
- Tailwind + shadcn/ui · Pretendard + Serif(로고)
- Supabase (PostgreSQL 15) · RLS · pg_cron · Edge Functions
- TanStack Query + Zustand
- SMS: 솔라피(SOLAPI) 1순위 (어댑터 패턴)
- Vitest + Playwright

## 절대 규약

1. **DB 컬럼은 영어 snake_case, UI는 한글**. 예: `parent_phone` 컬럼은 UI에서 "학부모 연락처"로 노출.
2. **모든 DB 컬럼에 한글 COMMENT 필수**. 마이그레이션 파일에서 `COMMENT ON COLUMN ...` 빠뜨리지 말 것.
3. **TypeScript strict · `any` 금지**. 외부 입력은 Zod로 런타임 검증.
4. **Server Component 우선**. 클라이언트 컴포넌트는 상호작용 필요한 경우에만.
5. **디자인은 흰색+검정 미니멀**. 보라색·강한 색상 금지. 디자인 토큰은 PRD 섹션 2.2 또는 `src/app/globals.css`의 CSS 변수 준수.
6. **40~60대 사용자 배려**: 기본 폰트 15px, 버튼·입력창 최소 높이 40px, WCAG AA 대비.
7. **SMS 어댑터 패턴 유지**: 환경변수 `SMS_PROVIDER`로 벤더 전환 가능해야 함. MVP는 `solapi`만 실구현.
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

- **솔라피(SOLAPI)** · 1순위 · 실구현 대상 (SMS 8원/LMS 14원/MMS 22원/알림톡 13원)
- **문자나라** · Phase 1+ · 어댑터 스텁만 유지 (가격 경쟁력 부족)
- **SK C&C to-go**, **Sendwise** · Phase 1 · 어댑터 스텁만

주의: 발송 테스트는 본인 번호 1건 또는 테스트 모드로만. 실수로 대량 발송 금지.
