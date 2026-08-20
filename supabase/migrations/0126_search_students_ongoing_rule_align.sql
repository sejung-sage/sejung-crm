-- ============================================================
-- 0126_search_students_ongoing_rule_align.sql
-- search_students_by_region 의 '진행 중' 판정을 crm_class_is_ongoing 으로 통일.
-- ------------------------------------------------------------
-- 배경 (2026-08-20 실측):
--   0101 이 crm_class_is_ongoing(name, subject) 를 '진행 중 강좌' 단일 정의로
--   세웠다 — end_date 조건은 호출부에서 AND 결합, 헬퍼는 "설명회 아님 AND
--   종강/폐강 접두((종)/종)/(폐)/폐)) 아님" 을 본다.
--   student_profiles 는 0101(active_enrollment_count)·0124(subjects/teachers)
--   에서 이 헬퍼를 쓰는데, 이 RPC 만 end_date 조건만 보고 있었다.
--
--   결과: 같은 질문에 두 화면이 다른 답을 냈다 (대치·재원생 기준)
--     국어  뷰 1,144명 / RPC 1,217명  (차 73)
--     영어  뷰   283명 / RPC   387명  (차 104)
--     수학  뷰   732명 / RPC   790명  (차 58)
--   차이나는 학생을 추적하니 **100% 종강/폐강 접두 강좌** 수강생이었다:
--     '종)26#SN 유대종T 고3 국어 [언매 연계 특강 4회] 금'   23명
--     '종)26#RN 이은직T 고2 국어 시즌3 [비문학 개념 + 문'    8명
--     '(종)(폐)26@RN 권미나T 고1 국어 (영동1) [1-기말'       3명
--
--   운영 피해: 과목 필터로 발송 대상을 잡으면 이미 종강한 강좌의 수강생이
--   섞여 나간다. 국어 개강 문자 기준 73명분의 오발송·문자비.
--
-- 변경:
--   crm_classes 를 조인하는 서브쿼리 3곳(과목 match_all / 과목 EXISTS /
--   강좌코드 mark·kind EXISTS)에 헬퍼 조건을 AND 로 추가한다. 그 외 로직·
--   시그니처·정렬은 라이브 정의 그대로다(pg_get_functiondef 덤프 기반).
--
--   강좌코드(mark/kind) 필터도 같은 이유로 함께 맞춘다 — 종강 강좌의 접두를
--   보고 대상에 넣던 동일 유형 버그.
--
-- 영향: 과목·강좌코드 필터의 대상 인원이 줄어든다(종강분 제외). 의도된 축소다.
--
-- ROLLBACK: 하단 블록 참조.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.search_students_by_region(p_regions text[] DEFAULT NULL::text[], p_branch text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_grades text[] DEFAULT NULL::text[], p_school_levels text[] DEFAULT NULL::text[], p_statuses text[] DEFAULT NULL::text[], p_schools text[] DEFAULT NULL::text[], p_include_hidden boolean DEFAULT false, p_sort text DEFAULT 'registered_desc'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50, p_subjects text[] DEFAULT NULL::text[], p_subjects_match_all boolean DEFAULT false, p_class_marks text[] DEFAULT NULL::text[], p_class_kinds text[] DEFAULT NULL::text[])
 RETURNS TABLE(id uuid, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_like text;
  v_digits text;  -- 전화번호 형태면 숫자만, 아니면 NULL
BEGIN
  -- 검색어는 ilike 패턴으로 변환.
  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_like := '%' || p_search || '%';
    -- 숫자·공백·하이픈·괄호·+ 외 문자가 없고 숫자가 있으면 전화번호 검색.
    IF p_search !~ '[^0-9[:space:]()+-]' THEN
      v_digits := regexp_replace(p_search, '\D', '', 'g');
      IF length(v_digits) = 0 THEN
        v_digits := NULL;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT s.id, s.registered_at, s.name
    FROM public.crm_students s
    LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
    WHERE s.status <> '탈퇴'
      -- region 필터 (있을 때만). 미매핑 학교는 '기타'.
      AND (p_regions IS NULL OR array_length(p_regions, 1) IS NULL
           OR COALESCE(sr.region, '기타') = ANY(p_regions))
      AND (p_branch IS NULL OR p_branch = '전체' OR s.branch = p_branch)
      AND (p_grades IS NULL OR array_length(p_grades, 1) IS NULL
           OR s.grade::text = ANY(p_grades))
      AND (p_school_levels IS NULL OR array_length(p_school_levels, 1) IS NULL
           OR s.school_level::text = ANY(p_school_levels))
      AND (p_statuses IS NULL OR array_length(p_statuses, 1) IS NULL
           OR s.status::text = ANY(p_statuses))
      AND (p_schools IS NULL OR array_length(p_schools, 1) IS NULL
           OR s.school = ANY(p_schools))
      -- 수강 과목 (있을 때만). 현재 진행 중 강좌(end_date NULL/미래)의 classes.subject.
      -- enrollments.subject 는 ETL 상 항상 NULL 이라 classes 경유 (student_profiles 0063 동일).
      -- match_all=false → 하나라도(합집합), true → 전부(교집합).
      AND (p_subjects IS NULL OR array_length(p_subjects, 1) IS NULL
           OR (CASE WHEN p_subjects_match_all THEN
                 (SELECT COUNT(DISTINCT c.subject)
                    FROM public.crm_enrollments e
                    JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
                   WHERE e.student_id = s.id
                     AND c.subject = ANY(p_subjects)
                     AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
                     AND public.crm_class_is_ongoing(c.name, c.subject)
                 ) = array_length(p_subjects, 1)
               ELSE
                 EXISTS (
                   SELECT 1
                     FROM public.crm_enrollments e
                     JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
                    WHERE e.student_id = s.id
                      AND c.subject = ANY(p_subjects)
                      AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
                      AND public.crm_class_is_ongoing(c.name, c.subject)
                 )
               END))
      -- 강좌 코드 (있을 때만). 강좌명 접두 [연도][#|@][R|S] 파싱 — 현재 진행 중 강좌.
      -- mark/kind 는 같은 강좌에서 함께 만족(단일 EXISTS). 둘 다 비면 조건 무효.
      AND ((p_class_marks IS NULL OR array_length(p_class_marks, 1) IS NULL)
           AND (p_class_kinds IS NULL OR array_length(p_class_kinds, 1) IS NULL)
           OR EXISTS (
             SELECT 1
               FROM public.crm_enrollments e
               JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
              WHERE e.student_id = s.id
                AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
                AND public.crm_class_is_ongoing(c.name, c.subject)
                AND (p_class_marks IS NULL OR array_length(p_class_marks, 1) IS NULL
                     OR substring(c.name from '^[^0-9]*[0-9]{2}([#@])') = ANY(p_class_marks))
                AND (p_class_kinds IS NULL OR array_length(p_class_kinds, 1) IS NULL
                     OR upper(substring(c.name from '^[^0-9]*[0-9]{2}[#@]([A-Za-z])')) = ANY(p_class_kinds))
           ))
      AND (v_like IS NULL
           OR s.name ILIKE v_like
           OR s.school ILIKE v_like
           OR (CASE WHEN v_digits IS NOT NULL
                    THEN s.parent_phone ILIKE '%' || v_digits || '%'
                    ELSE s.parent_phone ILIKE v_like END))
      AND (p_include_hidden
           OR p_grades IS NOT NULL AND array_length(p_grades, 1) > 0
           OR s.grade::text NOT IN ('졸업', '미정'))
  ),
  counted AS (
    SELECT b.id, b.registered_at, b.name,
           COUNT(*) OVER () AS total_count
    FROM base b
  )
  SELECT c.id, c.total_count
  FROM counted c
  ORDER BY
    CASE WHEN p_sort = 'registered_asc'  THEN c.registered_at END ASC NULLS LAST,
    CASE WHEN p_sort = 'name_asc'        THEN c.name END ASC,
    CASE WHEN p_sort = 'name_desc'       THEN c.name END DESC,
    CASE WHEN p_sort NOT IN ('registered_asc','name_asc','name_desc')
         THEN c.registered_at END DESC NULLS LAST
  OFFSET p_offset
  LIMIT p_limit;
END;
$function$;

COMMENT ON FUNCTION public.search_students_by_region IS
  '학생 명단 region/subjects/강좌코드 필터 전용 RPC. crm_students 베이스 + id/total_count 반환. 0126 — 과목·강좌코드 판정에 crm_class_is_ongoing 을 AND 결합해 student_profiles(0101/0124) 와 진행 중 정의를 통일(종강/폐강 접두 강좌 수강생이 대상에 섞이던 문제 해소). 0067/0098/0100/0126.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동): 아래 세 곳의
--   AND public.crm_class_is_ongoing(c.name, c.subject)
-- 를 제거하고 본 CREATE OR REPLACE 를 재실행한다.
--   (과목 match_all / 과목 EXISTS / 강좌코드 mark·kind EXISTS)
-- ※ 되돌리면 종강 강좌 수강생이 다시 발송 대상에 섞인다.
-- ============================================================
