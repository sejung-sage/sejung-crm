-- 0048_auto_status_and_school_backfill.sql
-- 회의 피드백 (2026-05-19) 기반 일괄 정리:
--   1) status 자동 판정 — '진행 중 enrollment 있는 학생 = 재원생' 룰 일괄 적용.
--   2) 재원생 중 school NULL 학생의 학교를 classes.name 에서 자동 추출.
--
-- 룰 결정 근거:
--   현재 모든 학생이 ETL 시점 일괄 '재원생' 으로 박혀 있음(아카 MSSQL 에
--   status 정보 부재). 실제 재원/이력자 혼재 → 발송 대상이 부정확.
--   "지금 듣고 있는 강좌(티켓) 가 있으면 재원생" 룰로 정리.
--
-- 안전:
--   - 탈퇴는 그대로 유지 (수동 표시 — 자동 룰이 덮어쓰면 안 됨).
--   - 학교 자동 백필은 재원생 + school IS NULL 만 — 기존 입력 보존.
--   - school_regions 의 매핑된 학교명 풀과 substring 매칭. false positive 방지
--     위해 학교명 길이 ≥ 2 만. 단순 '고','중','초' 같은 한 글자 매핑은 제외.
--
-- ROLLBACK:
--   복구 불가 (이전 status / school NULL 상태 미보존). 정확한 백업이 필요하면
--   별도 snapshot 후 실행.

BEGIN;

SET LOCAL statement_timeout = '10min';

-- ── 1) status 자동 판정 ───────────────────────────────────
-- 1-A) 진행 중 enrollment 있는 학생 → '재원생'.
WITH active_students AS (
  SELECT DISTINCT student_id
  FROM public.enrollments
  WHERE end_date IS NULL OR end_date >= CURRENT_DATE
)
UPDATE public.students s
SET status = '재원생'
WHERE s.id IN (SELECT student_id FROM active_students)
  AND s.status <> '탈퇴'  -- 탈퇴는 보존
  AND s.status <> '재원생';

-- 1-B) 진행 중 enrollment 없는 학생 → '수강이력자' (탈퇴 제외).
WITH inactive_students AS (
  SELECT s.id
  FROM public.students s
  LEFT JOIN public.enrollments e
    ON e.student_id = s.id
   AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
  WHERE e.id IS NULL
)
UPDATE public.students s
SET status = '수강이력자'
WHERE s.id IN (SELECT id FROM inactive_students)
  AND s.status <> '탈퇴'
  AND s.status <> '수강이력자';

-- ── 2) 학교 자동 백필 (재원생 + school NULL 만) ──────────
-- 2-A) school_regions 의 학교명 풀 중 길이 ≥ 2 인 키만 후보로.
-- 학생의 진행 중·과거 enrollment 의 classes.name 에 매핑 학교명이 substring 으로
-- 나타나면 후보. 한 학생당 가장 빈도 높은 학교를 채택.
WITH known_schools AS (
  SELECT school
  FROM public.school_regions
  WHERE LENGTH(school) >= 2  -- '고','중','초' 같은 한 글자 매핑 제외
),
candidate_hits AS (
  SELECT
    e.student_id,
    ks.school,
    COUNT(*) AS hits
  FROM public.enrollments e
  JOIN public.classes c ON c.aca_class_id = e.aca_class_id
  JOIN known_schools ks ON c.name LIKE '%' || ks.school || '%'
  WHERE e.student_id IN (
    SELECT id FROM public.students
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
    LENGTH(school) DESC  -- 동률 시 더 긴(구체적) 학교명 우선
)
UPDATE public.students s
SET school = bs.school
FROM best_school bs
WHERE s.id = bs.student_id
  AND s.school IS NULL
  AND s.status = '재원생';

COMMIT;
