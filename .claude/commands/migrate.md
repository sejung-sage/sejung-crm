---
description: 새 Supabase 마이그레이션 생성 (한글 COMMENT 필수 템플릿)
argument-hint: <migration-name>
---

# 새 마이그레이션 생성

architect 에이전트를 호출하여 `supabase/migrations/` 하위에 새 마이그레이션 파일을 만든다.

**입력 인자**: `$ARGUMENTS` (예: `add_groups_table`)

## 체크 항목 (architect가 반드시 준수)

1. 기존 마이그레이션 번호 확인 후 다음 번호로 네이밍 (`0003_add_groups_table.sql` 식)
2. 모든 신규 컬럼에 `COMMENT ON COLUMN ... IS '...'` 한글 주석
3. enum은 `CHECK` 제약으로 표현
4. RLS 필요 테이블은 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + 정책 작성
5. 외래키 `ON DELETE` 정책 명시 (CASCADE/SET NULL/RESTRICT)
6. 인덱스 필요 여부 판단 (자주 조회되는 컬럼)

## 완료 후

- `supabase gen types typescript --local > src/types/database.ts` 실행 제안
- 변경된 테이블을 사용하는 Zod 스키마(`src/lib/schemas/`) 업데이트 대상도 함께 보고
