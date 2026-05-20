-- ============================================================
-- 0068_search_recipients_by_subjects_rpc.sql
-- 과목(subjects) 필터 전용 RPC — student id list URL 폭주 회피.
-- ------------------------------------------------------------
-- 배경:
--   ETL 정책상 crm_enrollments.subject 는 NULL. 실제 과목은 crm_classes.subject.
--   기존 코드는 classes.subject IN → aca_class_id 페치 → enrollments JOIN →
--   distinct student_id 페치 후 crm_students.in("id", studentIds) 매칭.
--   국어처럼 수강생 많은 과목은 studentIds 가 수천 단위라 PostgREST URL
--   한계(~8KB) 초과 → "수신자 카운트 조회에 실패".
--
-- 해결:
--   SECURITY INVOKER RPC 가 SQL 단에서 classes JOIN enrollments JOIN students
--   한 번에 처리. window count + LIMIT/OFFSET 으로 count + sample 동시 반환.
--   PostgREST URL 짧음 — region 칩 7종, status 4종, schools 100여 개 정도.
--
-- 호출부 (count-recipients):
--   filters.subjects.length > 0 일 때 본 RPC 호출. 결과의 첫 row total_count 가
--   count. rows 자체가 sample (LIMIT 5 행).
-- ============================================================

BEGIN;

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
  p_limit int DEFAULT 5
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
BEGIN
  -- statuses default = "탈퇴 빼고 전체" (옛 그룹 JSONB 호환).
  v_wanted_statuses := COALESCE(
    NULLIF(p_statuses, ARRAY[]::text[]),
    ARRAY['재원생', '수강이력자', '수강 x']
  );

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
  폭주 회피. count + sample 동시 반환 (window count). 0068.';

COMMIT;
