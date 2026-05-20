-- ============================================================
-- 0059_templates_cleanup.sql
-- crm_templates : ALIMTALK enum 제거 + teacher_name 컬럼 DROP
-- ------------------------------------------------------------
-- 배경 (운영팀 피드백 2026-05-19 · #10):
--   1) 알림톡(ALIMTALK) 은 사전 등록 템플릿 기반 + 광고 차단 채널이라
--      세정학원 CRM 의 광고/안내 발송 흐름과 맞지 않는다. Phase 1 으로
--      유보된 sendon.kakao API 도입 전까지 UI/DB 양쪽에서 제거.
--   2) 강사명(teacher_name) 필드 자체 삭제 요청 — 운영팀이 강사 분류를
--      쓰지 않는다. /templates 의 강사 필터 컬럼도 같이 사라진다.
--
-- 데이터 처리 순서 (CHECK 제약 위반 회피 + 무손실 우선):
--   1) type='ALIMTALK' 인 기존 row 가 있으면 type='LMS' 로 변환.
--      - 이유: 알림톡 본문은 보통 1000자 이내이지만 LMS 한도(2000B) 안에
--        충분히 들어간다. SMS(90B) 로 strip 하면 본문 손실 위험.
--      - body 는 그대로 유지. is_ad 도 유지.
--   2) 기존 CHECK (type IN ('SMS','LMS','ALIMTALK')) 제약 DROP.
--   3) 새 CHECK (type IN ('SMS','LMS')) 추가.
--   4) idx_templates_teacher 인덱스 DROP → teacher_name 컬럼 DROP.
--
-- 후속 영향 (이 마이그 밖에서 처리):
--   - src/types/database.ts TemplateType 에서 'ALIMTALK' 제거.
--   - src/lib/schemas/{template,common,compose}.ts ALIMTALK 분기 정리.
--   - 컴포넌트(/templates · /compose) 의 ALIMTALK 옵션·라벨 제거.
--   - calculate-cost / cost-rates / sendon adapter 의 ALIMTALK 분기 제거.
--   - list-templates.ts 의 teacher_name 필터 제거.
--   - crm_campaigns.type CHECK 도 ALIMTALK 포함 (0027). 이번 회차에서는
--     건드리지 않음 — 이미 발송된 과거 캠페인 데이터 보존 우선.
--     Phase 1 진입 시 일괄 정리.
--
-- 롤백:
--   ALTER TABLE public.crm_templates
--     ADD COLUMN teacher_name TEXT;
--   COMMENT ON COLUMN public.crm_templates.teacher_name IS '강사명 (강사별 분류용)';
--   CREATE INDEX idx_templates_teacher ON public.crm_templates (teacher_name);
--   ALTER TABLE public.crm_templates DROP CONSTRAINT crm_templates_type_check;
--   ALTER TABLE public.crm_templates ADD CONSTRAINT crm_templates_type_check
--     CHECK (type IN ('SMS','LMS','ALIMTALK'));
--   (ALIMTALK 행 복구는 별도 작업 — type='LMS' 로 변환된 row 식별 불가)
-- ============================================================

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) ALIMTALK row 를 LMS 로 변환 ───────────────────────────
UPDATE public.crm_templates
   SET type = 'LMS'
 WHERE type = 'ALIMTALK';

-- ── 2) CHECK 제약 교체 ──────────────────────────────────────
-- 제약명은 PostgreSQL 자동 명명 규칙(테이블명_컬럼명_check). 0001/0013 양쪽 모두
-- 익명 CHECK 로 추가됐고 0049 RENAME 으로 'templates_type_check' 그대로 따라옴.
-- 분기 처리 — pg_constraint 에서 자동 명을 조회해 DROP.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = 'public.crm_templates'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%type%ALIMTALK%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.crm_templates DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.crm_templates
  ADD CONSTRAINT crm_templates_type_check
  CHECK (type IN ('SMS', 'LMS'));

COMMENT ON COLUMN public.crm_templates.type IS
  '유형 (SMS:단문 90b / LMS:장문 2000b). 0059 에서 ALIMTALK 제거 — 광고 발송 채널 부적합.';

-- ── 3) teacher_name 인덱스 + 컬럼 DROP ──────────────────────
DROP INDEX IF EXISTS public.idx_templates_teacher;

ALTER TABLE public.crm_templates
  DROP COLUMN IF EXISTS teacher_name;

COMMIT;
