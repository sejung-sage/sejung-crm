-- ============================================================
-- 0123_student_profiles_lateral_rewrite.sql
-- student_profiles 를 GROUP BY 집계 → LATERAL 집계로 재작성.
-- (1) 필터 푸시다운을 막던 구조 제거  (2) total_paid 카테시안 부풀림 버그 수정
-- ------------------------------------------------------------
-- 배경 (2026-08-20 장애):
--   원장 제보 "대상을 찾지를 못하고 너무 오래 걸리며 결국 전송 실패".
--   /students 와 캠페인 큐 적재가 나란히
--   'canceling statement due to statement timeout' 로 죽었다.
--
-- ── 문제 1. 성능: GROUP BY 가 필터 푸시다운을 막는다 ──
--   0101 정의는 최상위에 GROUP BY s.id, sr.region 이 있다. Postgres 는 그룹핑
--   컬럼(여기선 사실상 id/region)에 대한 qual 만 서브쿼리 안으로 밀어 넣는다.
--   따라서 school·grade·status·branch·name 같은 **일반 필터는 푸시다운되지 않고**,
--   109,203명 전원에 대해 조인 + 집계를 끝낸 뒤에야 걸러진다.
--
--   프로덕션 실측(2026-08-20):
--     crm_students 원본, 학교+학년 필터           0.57초
--     student_profiles, id 1건 (그룹핑 컬럼)       0.70초
--     student_profiles, id IN (50건)              5.5 ~ 18초
--     student_profiles, 학교+학년 + 정렬          20.6초
--     search_students_by_region RPC(지역 필터)    10 ~ 114초
--   → authenticated 롤 statement_timeout 초과 → 학생 명단 오류.
--
--   해결: 최상위 GROUP BY 를 없애고 집계를 LATERAL 로 내린다. 최상위가 단순
--   조인이 되므로 s.* 에 대한 qual 이 crm_students 스캔으로 그대로 내려가고,
--   LATERAL 은 **살아남은 행에 대해서만** 실행된다. 인덱스는 이미 있다
--   (idx_enrollments_student_id / idx_attendances_student_id / school_regions PK).
--
-- ── 문제 2. 정합성: total_paid 가 출석 횟수만큼 부풀려져 있다 ──
--   0101 정의는 crm_enrollments 와 crm_attendances 를 **동시에** LEFT JOIN 한다.
--   학생당 (등록 수 x 출석 수) 카테시안이 생기고, SUM(e.amount) 가 그 중복을
--   그대로 더한다. COUNT(DISTINCT)/ARRAY_AGG(DISTINCT)/MAX 는 중복에 면역이라
--   무사했고 total_paid 만 오염됐다.
--
--   프로덕션 실측(2026-08-20) — 검사한 12명 전원 불일치:
--     고현준  출석 152 → 뷰 393,794,000원 / 실제 2,590,750원  (152배)
--     김도현  출석 119 → 뷰 993,300,000원 / 실제 7,095,000원  (140배)
--     박서윤  출석  54 → 뷰  89,100,000원 / 실제 1,650,000원  ( 54배)
--   배수 = 그 학생의 출석 행 수와 정확히 일치(= 카테시안 확정).
--   출석 기록이 없는 학생만 우연히 맞았다.
--
--   영향 범위: 학생 명단 '누적 결제 많은 순' 정렬, /explorer 의 total_paid 컬럼.
--   학생 상세의 '총 결제금액' 카드는 클라이언트가 enrollments 로 직접 계산하므로
--   (student-kpi-cards.tsx) 원래부터 정상이었다.
--   LATERAL 로 분리하면 카테시안 자체가 사라져 자동으로 교정된다.
--
-- ── 의미 보존 (컬럼 19개, 이름·순서·타입 동일) ──
--   enrollment_count        COUNT(DISTINCT e.id) → LATERAL COUNT(*)  (id 가 PK 라 동일)
--   active_enrollment_count 0101 상관 서브쿼리를 **그대로** LATERAL 로 옮김.
--                           crm_class_is_ongoing(c2.name, c2.subject) 판정 불변.
--   subjects / teachers     ARRAY_AGG(DISTINCT ...) 그대로.
--                           ※ crm_enrollments.subject/teacher_name 은 ETL 정책상
--                             항상 NULL 이라 이 두 컬럼은 현재도 항상 NULL 이다.
--                             0063 이 classes 기반으로 바꿨다가 0066/0101 재작성에서
--                             되돌아간 상태. **이번 변경은 현행 동작을 그대로 보존**
--                             한다 — 되살릴지는 별도 판단(범위 밖).
--   last_attended_at        MAX(a.attended_at) 그대로 (LATERAL 분리해도 동일).
--   last_paid_at            MAX(e.paid_at) 그대로.
--   region                  COALESCE(sr.region,'기타') 그대로.
--                           school_regions.school 이 PK 라 행 증식 없음.
--   total_paid              카테시안 제거로 **값이 바뀐다(= 버그 수정)**.
--
-- ── 범위 밖 (건드리지 않음) ──
--   security_invoker: 0071 이 on 으로 켰으나 0101 의 DROP VIEW 가 되돌려 현재
--   off 다(0114 주석도 지적). 본 파일도 DROP+CREATE 라 off 로 유지된다 —
--   RLS 적용 범위가 바뀌는 변경을 성능 수정에 섞지 않기 위함. 별도 처리 필요.
--
-- ROLLBACK: 본 파일 하단 블록 참조 (0101 의 CREATE VIEW 재실행).
-- ============================================================

BEGIN;

SET LOCAL statement_timeout = '5min';

DROP VIEW IF EXISTS public.student_profiles;

CREATE VIEW public.student_profiles AS
SELECT
  s.id,
  s.name,
  s.school,
  s.grade,
  s.grade_raw,
  s.school_level,
  s.status,
  s.branch,
  s.parent_phone,
  s.phone,
  s.registered_at,
  enr.enrollment_count,
  act.active_enrollment_count,
  enr.total_paid,
  enr.subjects,
  enr.teachers,
  att.last_attended_at,
  enr.last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.crm_students s
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school

-- 등록 기반 집계 — 출석과 분리되어 카테시안이 생기지 않는다.
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                           AS enrollment_count,
    COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
    ARRAY_AGG(DISTINCT e.subject)
      FILTER (WHERE e.subject IS NOT NULL)      AS subjects,
    ARRAY_AGG(DISTINCT e.teacher_name)
      FILTER (WHERE e.teacher_name IS NOT NULL) AS teachers,
    MAX(e.paid_at)                     AS last_paid_at
  FROM public.crm_enrollments e
  WHERE e.student_id = s.id
) enr ON TRUE

-- 진행 중 등록 수 — 0101 의 상관 서브쿼리를 판정 로직 변경 없이 옮긴 것.
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS active_enrollment_count
  FROM public.crm_enrollments e2
  LEFT JOIN public.crm_classes c2 ON c2.aca_class_id = e2.aca_class_id
  WHERE e2.student_id = s.id
    AND (e2.end_date IS NULL OR e2.end_date >= CURRENT_DATE)
    AND public.crm_class_is_ongoing(c2.name, c2.subject)
) act ON TRUE

-- 출석 기반 집계.
LEFT JOIN LATERAL (
  SELECT MAX(a.attended_at) AS last_attended_at
  FROM public.crm_attendances a
  WHERE a.student_id = s.id
) att ON TRUE;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer). 0123 — 최상위 GROUP BY 를 LATERAL 집계로 대체해 school/grade/status/branch 필터가 crm_students 스캔까지 푸시다운되도록 함(20초+ → 1초 미만). 동시에 enrollments x attendances 카테시안으로 total_paid 가 출석 횟수만큼 부풀려지던 버그 수정. active_enrollment_count 판정(crm_class_is_ongoing)은 0101 그대로. subjects/teachers 는 crm_enrollments 컬럼이 ETL 상 항상 NULL 이라 현재도 항상 NULL(현행 보존).';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP VIEW IF EXISTS public.student_profiles;
-- 그리고 0101 의 CREATE VIEW public.student_profiles 블록을 재실행.
-- COMMIT;
-- ※ 되돌리면 total_paid 부풀림 버그도 함께 되살아난다.
-- ============================================================
