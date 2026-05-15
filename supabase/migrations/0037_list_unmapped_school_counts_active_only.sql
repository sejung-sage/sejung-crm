-- 0037_list_unmapped_school_counts_active_only.sql
-- 미매핑 학교 학생수 집계의 status 기준 변경 — '재원생' 만 카운트.
--
-- 배경 (2026-05-15):
--   0036 의 함수는 status <> '탈퇴' (재원생/수강이력자/신규리드 모두 포함) 로
--   카운트했음. 그런데 학생 명단(/students) 의 기본 필터는 status = '재원생' 단일.
--   결과:
--     - 미매핑 패널: "한영외고 697명"
--     - 학생 명단 (학교=한영외고): "277명"
--   사용자가 두 화면을 비교하면 카운트 불일치로 혼란.
--
-- 변경:
--   status = '재원생' 만 카운트. 학생 명단 default 와 직관 일치.
--   매핑 우선순위 판단(재원생 수가 많은 학교부터) 에도 더 적합 — 수강이력자/리드는
--   매핑 정밀도 영향이 낮음.
--
-- 함수 정의 외엔 0036 과 동일 (CREATE OR REPLACE).
--
-- ROLLBACK: 이전 본문(status <> '탈퇴') 으로 CREATE OR REPLACE 복원.

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
    AND s.status = '재원생'  -- 학생 명단(/students) 기본 필터와 일치
    AND sr.school IS NULL
  GROUP BY s.school
  ORDER BY student_count DESC, s.school
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.list_unmapped_school_counts(int) IS
  '미매핑 학교 목록 — school_regions 에 entry 없는 학교를 재원생 수 내림차순으로. /regions 미매핑 패널 전용. status=재원생 만 카운트 (학생 명단 default 와 일치, 2026-05-15 0037).';

COMMIT;
