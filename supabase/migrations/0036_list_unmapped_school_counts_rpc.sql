-- 0036_list_unmapped_school_counts_rpc.sql
-- 미매핑 학교 + 학생 수 집계 RPC 함수.
--
-- 배경 (2026-05-15):
--   list-missing-regions.ts 가 students 6만 행을 PostgREST 1000행 페이지네이션
--   60번 round-trip 으로 가져오면서 /regions 페이지 로딩이 수십초 단위로 느려짐.
--   PG 단에서 한 번에 집계하면 인덱스 활용 + 결과 ≤ 50행이라 ms 단위.
--
-- 함수 정의:
--   p_limit 개의 (school, student_count) 를 student_count 내림차순으로 반환.
--   - school_regions 에 entry 가 없는 학교만 미매핑으로 간주 (region 값 무관).
--   - status='탈퇴' 학생 제외.
--   - school IS NULL 학생 제외 (매핑할 키 없음).
--
-- 호출:
--   supabase.rpc('list_unmapped_school_counts', { p_limit: 50 })
--
-- 보안:
--   STABLE · SECURITY INVOKER. RLS 가 students/school_regions 에 적용된 채로 실행.
--   /regions admin 페이지가 master/admin role 만 진입 가능하고, RLS 가 그 role 들
--   에 SELECT 권한을 부여하므로 정상 작동.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.list_unmapped_school_counts(int);

BEGIN;

CREATE OR REPLACE FUNCTION public.list_unmapped_school_counts(p_limit int DEFAULT 50)
RETURNS TABLE(school text, student_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.school::text AS school,
    COUNT(*)::bigint AS student_count
  FROM public.students s
  LEFT JOIN public.school_regions sr ON sr.school = s.school
  WHERE s.school IS NOT NULL
    AND s.status <> '탈퇴'
    AND sr.school IS NULL  -- school_regions 에 매핑 entry 없음
  GROUP BY s.school
  ORDER BY student_count DESC, s.school
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.list_unmapped_school_counts(int) IS
  '미매핑 학교 목록 — school_regions 에 entry 가 없는 학교를 학생 수 내림차순으로. /regions admin 미매핑 패널 전용. 탈퇴/학교 NULL 학생 제외.';

-- 안전: master/admin 만 호출 가능하도록 EXECUTE 권한도 좁힐 수 있으나,
-- /regions 페이지 자체가 role 가드를 두므로 anon/authenticated 에 EXECUTE 부여.
GRANT EXECUTE ON FUNCTION public.list_unmapped_school_counts(int) TO authenticated, anon;

COMMIT;
