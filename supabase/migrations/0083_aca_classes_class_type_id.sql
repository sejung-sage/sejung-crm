-- 0083_aca_classes_class_type_id.sql
-- aca_classes / crm_classes 에 aca_class_type_id (V_class_list.반형태_코드) 컬럼 추가
-- + aca_class_accounts 를 브릿지로 즉시 backfill
-- + 반형태가 '설명회/간담회' 카테고리인 강좌의 subject='설명회' 백필.
--
-- 배경 (2026-06-02 진단):
--   - 0058 마이그(subject enum 에 '설명회' 추가) 가 강좌명 substring 매칭만 사용.
--   - 대치 분원의 "2026 ... 콘서트" 6건은 강좌명에 '설명회'/'간담회' 가 없지만
--     Aca 행정팀이 반형태_코드 = 78031-130 (반형태1='설 명', 반형태2='회', 공백 분리됨)
--     로 분류해 두었음. 현재 시스템은 subject=NULL 로 떨어뜨려, 그 강좌만 듣는
--     학생이 있다면 재원생으로 오분류될 수 있음 (0058 정책 반대 효과).
--
-- 단계:
--   1) aca_classes·crm_classes 에 aca_class_type_id TEXT 컬럼 추가 + 인덱스.
--      (한글 COMMENT 필수 — CLAUDE.md 규약 2.)
--   2) aca_class_accounts (aca_class_id ↔ aca_class_type_id 동시 보유) 를 브릿지로
--      backfill. ETL(migrate_classes.py) 가 V_class_list.반형태_코드 를 가져오지
--      않아 직접 채울 수 없기 때문. 다음 PR 의 ETL 보강 후에는 그쪽에서 직접 채움.
--   3) 반형태 카테고리가 '설명회/간담회' 인 강좌의 subject='설명회' UPDATE.
--      대치의 공백 분리 케이스('설 명' + '회') 처리를 위해 concat 후 공백 제거.
--   4) (수동) SELECT apply_aca_to_crm(); 실행 — 새로 잡힌 설명회 강좌만 듣는
--      학생들의 status 재계산 (0058 와 동일 효과).
--
-- 롤백 노트 (수동):
--   ALTER TABLE public.aca_classes DROP COLUMN IF EXISTS aca_class_type_id;
--   ALTER TABLE public.crm_classes DROP COLUMN IF EXISTS aca_class_type_id;
--   (subject 백필 분은 수동 검토 후 NULL 복원 필요 — 강좌명 매칭으로 잡힌 분과
--    구분이 안 되므로 식별자 보존이 필요하면 별도 audit 테이블 권장.)

BEGIN;

SET LOCAL statement_timeout = '10min';

-- ── 1) aca_classes 컬럼 추가 ────────────────────────────────
ALTER TABLE public.aca_classes
  ADD COLUMN IF NOT EXISTS aca_class_type_id TEXT;

COMMENT ON COLUMN public.aca_classes.aca_class_type_id IS
  '아카 반형태 키 ("{학원_코드}-{반형태_코드}" 포맷). V_class_list.반형태_코드 → aca_class_types.aca_class_type_id 와 join 용. 0083 추가 — ETL migrate_classes.py 보강 후 다음 sync 부터 직접 채움.';

CREATE INDEX IF NOT EXISTS idx_aca_classes_aca_class_type_id
  ON public.aca_classes (aca_class_type_id);

-- ── 2) crm_classes 컬럼 추가 (curated 미러) ──────────────────
ALTER TABLE public.crm_classes
  ADD COLUMN IF NOT EXISTS aca_class_type_id TEXT;

COMMENT ON COLUMN public.crm_classes.aca_class_type_id IS
  '아카 반형태 키 — aca_classes 와 동일 의미. apply_aca_to_crm() 가 raw 에서 그대로 미러링.';

CREATE INDEX IF NOT EXISTS idx_crm_classes_aca_class_type_id
  ON public.crm_classes (aca_class_type_id);

-- ── 3) aca_class_accounts 브릿지로 backfill ─────────────────
-- 한 강좌가 수업일별로 여러 회계행을 가지므로 DISTINCT 로 1:1 매핑 확보.
UPDATE public.aca_classes c
SET aca_class_type_id = sub.aca_class_type_id
FROM (
  SELECT DISTINCT aca_class_id, aca_class_type_id
  FROM public.aca_class_accounts
  WHERE aca_class_id IS NOT NULL
    AND aca_class_type_id IS NOT NULL
) sub
WHERE c.aca_class_id = sub.aca_class_id
  AND c.aca_class_type_id IS NULL;  -- idempotent (재실행 안전)

UPDATE public.crm_classes c
SET aca_class_type_id = sub.aca_class_type_id
FROM (
  SELECT DISTINCT aca_class_id, aca_class_type_id
  FROM public.aca_class_accounts
  WHERE aca_class_id IS NOT NULL
    AND aca_class_type_id IS NOT NULL
) sub
WHERE c.aca_class_id = sub.aca_class_id
  AND c.aca_class_type_id IS NULL;

-- ── 4) 반형태 매칭으로 잡히는 설명회 강좌의 subject='설명회' backfill ──
-- 대치 분원의 '설 명' + '회' 공백 분리 케이스를 위해 concat 후 공백 제거 매칭.
-- 강좌명 매칭으로 이미 '설명회' 인 행은 IS DISTINCT FROM 가드로 안 건드림.
UPDATE public.aca_classes
SET subject = '설명회'
WHERE subject IS DISTINCT FROM '설명회'
  AND aca_class_type_id IS NOT NULL
  AND aca_class_type_id IN (
    SELECT aca_class_type_id
    FROM public.aca_class_types
    WHERE replace(
            COALESCE(type1, '') || COALESCE(type2, '') || COALESCE(type3, ''),
            ' ', ''
          ) ILIKE '%설명회%'
       OR replace(
            COALESCE(type1, '') || COALESCE(type2, '') || COALESCE(type3, ''),
            ' ', ''
          ) ILIKE '%간담회%'
  );

UPDATE public.crm_classes
SET subject = '설명회'
WHERE subject IS DISTINCT FROM '설명회'
  AND aca_class_type_id IS NOT NULL
  AND aca_class_type_id IN (
    SELECT aca_class_type_id
    FROM public.aca_class_types
    WHERE replace(
            COALESCE(type1, '') || COALESCE(type2, '') || COALESCE(type3, ''),
            ' ', ''
          ) ILIKE '%설명회%'
       OR replace(
            COALESCE(type1, '') || COALESCE(type2, '') || COALESCE(type3, ''),
            ' ', ''
          ) ILIKE '%간담회%'
  );

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- 적용 후 (수동 실행 필요):
--   SELECT * FROM public.apply_aca_to_crm();
--
-- apply_aca_to_crm() 가 active_set 재계산 시 subject='설명회' 강좌를 제외하므로
-- 새로 '설명회' 로 잡힌 강좌만 듣던 학생들의 status 가 자동으로:
--   - 다른 정규 수강 이력 있음 → '수강이력자'
--   - 설명회만 있음            → '수강 x'
-- 로 재분류된다. 0058 마이그와 동일 효과.
--
-- 검증 쿼리:
--   -- 새로 잡힌 설명회 강좌 (대치 콘서트 6건 예상)
--   SELECT branch, name, subject_raw FROM crm_classes
--   WHERE subject = '설명회' AND aca_class_type_id IS NOT NULL
--   ORDER BY branch, name;
-- ════════════════════════════════════════════════════════════════
