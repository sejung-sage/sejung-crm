-- ============================================================
-- 0076_recipients_exclude_school_class.sql
-- 발송 그룹 "학교별 제외 + 강좌별 제외" (박은주 부원장 요청 2026-05-27).
-- ------------------------------------------------------------
-- 배경:
--   기존 그룹 제외는 개별 학생(excludeStudentIds) 단위만 가능했다.
--   부원장 요청으로 학교 단위(학교별 진도차로 일부 학교만 빼고 발송) + 강좌 단위
--   (교재 이미 받은 강좌 수강생 제외) 제외가 필요.
--
--   제외 의미는 filters JSONB 에 저장한다 (테이블 마이그 불필요):
--     - excludeSchools: text[]  (students.school 원값 정확 일치)
--     - excludeClassIds: uuid[] (crm_classes.id — 발송 시점 그 강좌 현재 수강생 동적 차감)
--
-- 본 마이그가 건드리는 것:
--   count-recipients 의 subjects 필터 경로가 위임하는
--   search_recipients_by_subjects RPC 에 제외 파라미터 2종을 추가한다.
--   (이 경로는 SQL 한 곳에서 매칭하므로 앱 후처리가 불가 → RPC 가 받아야 함.)
--
--   다른 수신자 해석 경로(load-all-group-recipients / preview-recipients /
--   count-recipients 의 비-subjects 분기)는 RPC 를 안 거치고 crm_students 를 직접
--   쿼리하므로 앱 레이어에서 NOT IN 후처리로 동일 제외를 적용한다 (backend 담당).
--   그래서 search_students_by_region RPC 는 변경 불필요(그룹 경로 미사용).
--
-- 매핑 경로 (강좌 제외):
--   crm_classes.id IN (p_exclude_class_ids) → crm_classes.aca_class_id 페치 →
--   crm_enrollments.aca_class_id 매칭 student_id 차집합.
--   aca_class_id NULL(자체 등록 강좌)은 enrollment 매칭 불가 → 제외 대상 0명.
--
-- 성능 (60K 규모):
--   제외는 NOT EXISTS / NOT IN 으로 표현. excludeClassIds 는 보통 1~수개라
--   crm_enrollments(aca_class_id) 인덱스로 작은 서브셋만 스캔. statement_timeout
--   안전권. p_exclude_schools 는 짧은 배열 ANY 비교.
--
-- 보안: 기존과 동일 SECURITY INVOKER (호출자 RLS 그대로).
--
-- 롤백:
--   본 함수는 CREATE OR REPLACE 로 시그니처가 확장된다. 되돌리려면 0068 본문을
--   다시 적용(아래 "-- ROLLBACK" 블록 참조)하면 0076 이전 시그니처로 복원된다.
--   단, 호출부(count-recipients.ts)가 새 파라미터를 보내므로 롤백 시 앱 코드도
--   함께 되돌려야 한다.
-- ============================================================

BEGIN;

-- 0068 의 10-인자 시그니처가 남아 있으면 신규 12-인자와 오버로드로 공존하여
-- (1) 아래 COMMENT ON FUNCTION(인자 미지정)이 모호해져 42725 로 실패하고
-- (2) 10-인자 호출이 양쪽 매칭되어 런타임 ambiguous 가 된다. 옛 시그니처를 먼저 제거.
DROP FUNCTION IF EXISTS public.search_recipients_by_subjects(
  text[], text, text[], text[], text[], text[], uuid[], text[], int, int
);

CREATE OR REPLACE FUNCTION public.search_recipients_by_subjects(
  p_subjects text[],
  p_branch text,
  p_grades text[] DEFAULT NULL,
  p_schools text[] DEFAULT NULL,
  p_regions text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_exclude_ids uuid[] DEFAULT NULL,
  p_unsub_phones text[] DEFAULT NULL,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 5,
  -- 0076 추가: 학교별 제외 / 강좌별 제외.
  p_exclude_schools text[] DEFAULT NULL,
  p_exclude_class_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  name text,
  school text,
  grade text,
  branch text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_wanted_statuses text[];
  v_exclude_aca_class_ids text[];
BEGIN
  -- statuses default = "탈퇴 빼고 전체" (옛 그룹 JSONB 호환).
  v_wanted_statuses := COALESCE(
    NULLIF(p_statuses, ARRAY[]::text[]),
    ARRAY['재원생', '수강이력자', '수강 x']
  );

  -- 강좌별 제외: crm_classes.id → aca_class_id 변환.
  -- aca_class_id NULL(자체 등록 강좌)은 enrollment 매칭 불가라 자연 탈락.
  IF p_exclude_class_ids IS NOT NULL
     AND array_length(p_exclude_class_ids, 1) > 0 THEN
    SELECT array_agg(c.aca_class_id)
      INTO v_exclude_aca_class_ids
      FROM public.crm_classes c
     WHERE c.id = ANY(p_exclude_class_ids)
       AND c.aca_class_id IS NOT NULL;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT DISTINCT s.id, s.name, s.school, s.grade::text AS grade,
           s.branch, s.registered_at, s.parent_phone
    FROM public.crm_students s
    JOIN public.crm_enrollments e ON e.student_id = s.id
    JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
    LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
    WHERE c.subject = ANY(p_subjects)
      AND s.status <> '탈퇴'
      AND s.status::text = ANY(v_wanted_statuses)
      AND (p_branch IS NULL OR p_branch = '' OR p_branch = '전체'
           OR s.branch = p_branch)
      AND (p_grades IS NULL OR array_length(p_grades, 1) IS NULL
           OR s.grade::text = ANY(p_grades))
      AND (p_schools IS NULL OR array_length(p_schools, 1) IS NULL
           OR s.school = ANY(p_schools))
      AND (p_regions IS NULL OR array_length(p_regions, 1) IS NULL
           OR COALESCE(sr.region, '기타') = ANY(p_regions))
      AND (p_exclude_ids IS NULL OR array_length(p_exclude_ids, 1) IS NULL
           OR NOT (s.id = ANY(p_exclude_ids)))
      AND (p_unsub_phones IS NULL OR array_length(p_unsub_phones, 1) IS NULL
           OR s.parent_phone IS NULL
           OR NOT (s.parent_phone = ANY(p_unsub_phones)))
      -- 0076: 학교별 제외 — students.school 이 제외 목록에 있으면 탈락.
      AND (p_exclude_schools IS NULL
           OR array_length(p_exclude_schools, 1) IS NULL
           OR s.school IS NULL
           OR NOT (s.school = ANY(p_exclude_schools)))
      -- 0076: 강좌별 제외 — 제외 강좌(들)에 enrollment 있는 학생이면 탈락.
      --   동적: 발송 시점 crm_enrollments 현재 상태를 그대로 반영.
      AND (v_exclude_aca_class_ids IS NULL
           OR array_length(v_exclude_aca_class_ids, 1) IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM public.crm_enrollments ex
              WHERE ex.student_id = s.id
                AND ex.aca_class_id = ANY(v_exclude_aca_class_ids)
           ))
  ),
  counted AS (
    SELECT m.*, COUNT(*) OVER () AS total_count
    FROM matched m
  )
  SELECT c.id, c.name, c.school, c.grade, c.branch, c.total_count
  FROM counted c
  ORDER BY c.registered_at DESC NULLS LAST
  OFFSET p_offset
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.search_recipients_by_subjects IS
  '과목 필터 전용 RPC — classes JOIN enrollments JOIN students. ETL 가
  enrollments.subject 를 NULL 로 적재하는 사정을 우회 + student id list URL
  폭주 회피. count + sample 동시 반환 (window count). 0076 에서 학교별 제외
  (p_exclude_schools) + 강좌별 제외(p_exclude_class_ids, crm_classes.id →
  aca_class_id 동적 차감) 파라미터 추가. 0068→0076.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동): 아래를 실행하면 0068 시그니처로 복원.
--   호출부 count-recipients.ts 의 p_exclude_schools/p_exclude_class_ids 전달도
--   함께 제거해야 한다.
-- ------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.search_recipients_by_subjects(
--   text[], text, text[], text[], text[], text[], uuid[], text[], int, int,
--   text[], uuid[]
-- );
-- (이후 0068_search_recipients_by_subjects_rpc.sql 본문 재실행)
-- COMMIT;
-- ============================================================
