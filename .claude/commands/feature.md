---
description: PRD의 F1~F4 기능 하나를 architect → [backend, frontend 병렬] → qa 흐름으로 구현
argument-hint: <feature-id> <한줄 요약>
---

# 기능 개발 워크플로우

PRD `docs/sejung-crm-mvp-prd.md` 섹션 5의 F1~F4 중 하나를 구현한다.

**입력 인자**: `$ARGUMENTS`

사용자가 `/feature F2-02 세그먼트 빌더 생성` 처럼 호출했다고 가정.

## 실행 순서

### 1. 사전 점검

- PRD 해당 섹션 읽어오기
- 이미 구현된 부분 확인 (`src/` 탐색)
- 필요한 새 테이블/타입/토큰 파악

### 2. Architect 단계 (단독)

architect 에이전트를 호출하여 스키마·타입·토큰부터 정리:

```
architect에게 위임: "<feature-id>에 필요한 DB 테이블·컬럼·타입·Zod 스키마 정리. PRD 섹션 4 참조. 한글 COMMENT 필수."
```

architect가 완료 보고 후, 새 타입·스키마 파일 위치를 메모.

### 3. 병렬 구현 단계

backend-dev와 frontend-dev를 **동시에** 호출 (한 메시지에 두 Agent 툴 호출):

- backend-dev: `src/lib/`와 Server Actions
- frontend-dev: `src/app/(features)/`와 `src/components/`

두 에이전트 모두 architect 산출물에 의존. 같은 파일을 동시에 건드리지 않도록 모듈 경계 명확히 프롬프트에 넣는다.

### 4. QA 단계

두 에이전트 완료 후 qa-engineer 호출:

```
qa-engineer에게 위임: "<feature-id> 단위·E2E 테스트 작성. 발송 기능이면 안전 가드 회귀 필수."
```

### 5. 마무리

- `pnpm typecheck && pnpm test` 실행
- 실패 시 해당 에이전트에게 수정 요청
- 사용자에게 최종 변경 요약 보고 (파일 목록 + 동작 요약)

## 주의

- **한 기능 = 한 PR**. 기능 간 스코프 오염 금지.
- MVP 범위 밖(Phase 1+) 기능은 건드리지 않는다.
- 발송 관련 기능은 qa-engineer 통과 없이 머지 금지.
