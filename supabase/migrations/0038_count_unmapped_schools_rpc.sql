-- 0038_count_unmapped_schools_rpc.sql
-- 미매핑 학교 '전체 개수' 집계 RPC.
--
-- 배경 (2026-05-15):
--   미매핑 패널이 list_unmapped_school_counts(p_limit=50) 결과만 표시 → 항상
--   "50건" 으로 보임. 사용자가 매핑을 추가해도 51번째 학교가 50번째로 올라와
--   카운트가 줄지 않는 것처럼 느낌.
--
-- 변경:
--   리스트와 별개로 미매핑 학교 '전체 distinct 개수' 를 반환하는 함수 추가.
--   UI 는 두 RPC 를 병렬 호출 — 패널 헤더에는 total, 본문에는 list 50건 표시.
--
-- 정의:
--   list 함수와 동일한 기준(status='재원생', school IS NOT NULL, sr.school IS NULL)
--   으로 학교 distinct 개수만 반환. 가벼움.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.count_unmapped_schools();

BEGIN;

CREATE OR REPLACE FUNCTION public.count_unmapped_schools()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT s.school)::bigint
  FROM public.students s
  LEFT JOIN public.school_regions sr ON sr.school = s.school
  WHERE s.school IS NOT NULL
    AND s.status = '재원생'
    AND sr.school IS NULL;
$$;

COMMENT ON FUNCTION public.count_unmapped_schools() IS
  '미매핑 학교 전체 distinct 개수 (재원생 기준, school_regions entry 없는 학교). list_unmapped_school_counts 와 짝 — 패널 헤더용.';

GRANT EXECUTE ON FUNCTION public.count_unmapped_schools() TO authenticated, anon;

COMMIT;
