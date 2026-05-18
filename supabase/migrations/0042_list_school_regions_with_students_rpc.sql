-- 0042_list_school_regions_with_students_rpc.sql
-- /regions 매핑 표 결과를 '학생 데이터에 실제로 학교가 있는 매핑'만으로 좁히는 RPC.
--
-- 배경 (2026-05-18):
--   0039 가 정식명("휘문고등학교")+줄임형("휘문고") 양쪽 모두 등록 → 매핑 표에
--   같은 학교가 두 번 표시. 학생 명단(/students) 의 학교 필터는 students.school
--   distinct 만 노출하므로 카운트 불일치:
--     /regions 강남구 105 vs /students 강남구 43
--
--   해결: 매핑 표도 학생 데이터에 EXISTS 인 학교만 표시. 학생 데이터에
--   "휘문고" 만 있으면 "휘문고등학교" 매핑은 (DB 엔 그대로 남아있지만)
--   화면에 숨김. 미래 학생이 정식명으로 들어오면 자동 노출.
--
-- 함수 정의:
--   - p_search: 학교명 부분 일치 (NULL = 전체)
--   - p_region: 지역명 정확 일치 (NULL = 전체)
--   - 정렬: region ASC, school ASC.
--   - WHERE EXISTS — students.school 과 정확 일치하는 학생이 한 명이라도 있는
--     매핑만. status 무관 (관리자 입장에선 탈퇴/리드도 동일 학교 인식).
--
-- 보안: SECURITY INVOKER. RLS 가 students/school_regions 에 적용된 채로 실행.
-- /regions 페이지가 master/admin role 만 진입 가능.
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.list_school_regions_with_students(text, text);

BEGIN;

CREATE OR REPLACE FUNCTION public.list_school_regions_with_students(
  p_search TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL
)
RETURNS TABLE(
  school     TEXT,
  region     TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    sr.school::TEXT,
    sr.region::TEXT,
    sr.created_at,
    sr.updated_at
  FROM public.school_regions sr
  WHERE EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.school = sr.school
  )
  AND (p_search IS NULL OR sr.school ILIKE '%' || p_search || '%')
  AND (p_region IS NULL OR sr.region = p_region)
  ORDER BY sr.region, sr.school;
$$;

COMMENT ON FUNCTION public.list_school_regions_with_students(TEXT, TEXT) IS
  '매핑 표용 — students 에 실제로 존재하는 학교의 매핑만 반환. 정식+줄임 중복 정리. /regions admin 학교 매핑 표가 학생 명단 학교 필터와 같은 학교 집합을 노출하도록 통일.';

GRANT EXECUTE ON FUNCTION public.list_school_regions_with_students(TEXT, TEXT)
  TO authenticated, anon;

COMMIT;
