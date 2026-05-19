-- 0050_status_and_school_backfill_rpc.sql
-- 0048 의 status·school 백필 로직을 재실행 가능한 PG 함수로 등록.
--
-- 배경 (2026-05-19):
--   ETL (migrate_students) 가 UPSERT 시 모든 컬럼 덮어써서 0048 의
--   status 자동 분리·학교 백필 결과가 사라짐. ETL 재실행마다 백필 다시
--   적용해야 함 → 매번 마이그를 추가하기 비효율 → 함수로 wrapping.
--
-- 호출:
--   SELECT public.apply_student_status_and_school_rules();
--
-- 자동화 (향후):
--   sync-aca.yml 의 ETL 4개 실행 직후 step 으로 함수 호출 추가 권장.
--   학원 PC OS cron 이면 ETL 끝 부분에 psql -c "SELECT ..." 추가.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_student_status_and_school_rules()
RETURNS TABLE(
  active_promoted bigint,
  inactive_demoted bigint,
  schools_filled bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active bigint := 0;
  v_inactive bigint := 0;
  v_schools bigint := 0;
BEGIN
  -- 1) status 자동 판정
  -- 1-A) 진행 중 enrollment 있는 학생 → 재원생 (탈퇴는 보존).
  WITH active_students AS (
    SELECT DISTINCT student_id
    FROM public.aca_enrollments
    WHERE end_date IS NULL OR end_date >= CURRENT_DATE
  ),
  upd AS (
    UPDATE public.aca_students s
    SET status = '재원생'
    WHERE s.id IN (SELECT student_id FROM active_students)
      AND s.status <> '탈퇴'
      AND s.status <> '재원생'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_active FROM upd;

  -- 1-B) 진행 중 enrollment 없는 학생 → 수강이력자 (탈퇴는 보존).
  WITH inactive_students AS (
    SELECT s.id
    FROM public.aca_students s
    LEFT JOIN public.aca_enrollments e
      ON e.student_id = s.id
     AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
    WHERE e.id IS NULL
  ),
  upd AS (
    UPDATE public.aca_students s
    SET status = '수강이력자'
    WHERE s.id IN (SELECT id FROM inactive_students)
      AND s.status <> '탈퇴'
      AND s.status <> '수강이력자'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inactive FROM upd;

  -- 2) 학교 자동 백필 (재원생 + school NULL 만)
  WITH known_schools AS (
    SELECT school
    FROM public.crm_school_regions
    WHERE LENGTH(school) >= 2
  ),
  candidate_hits AS (
    SELECT
      e.student_id,
      ks.school,
      COUNT(*) AS hits
    FROM public.aca_enrollments e
    JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    JOIN known_schools ks ON c.name LIKE '%' || ks.school || '%'
    WHERE e.student_id IN (
      SELECT id FROM public.aca_students
      WHERE school IS NULL AND status = '재원생'
    )
    GROUP BY e.student_id, ks.school
  ),
  best_school AS (
    SELECT DISTINCT ON (student_id)
      student_id,
      school
    FROM candidate_hits
    ORDER BY
      student_id,
      hits DESC,
      LENGTH(school) DESC
  ),
  upd AS (
    UPDATE public.aca_students s
    SET school = bs.school
    FROM best_school bs
    WHERE s.id = bs.student_id
      AND s.school IS NULL
      AND s.status = '재원생'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_schools FROM upd;

  RETURN QUERY SELECT v_active, v_inactive, v_schools;
END;
$$;

COMMENT ON FUNCTION public.apply_student_status_and_school_rules() IS
  '0048 의 status·school 백필 로직 재실행. ETL 직후 SELECT 로 호출. 반환: 재원생/수강이력자 전환 수 + 학교 채운 수.';

GRANT EXECUTE ON FUNCTION public.apply_student_status_and_school_rules()
  TO authenticated;

COMMIT;
