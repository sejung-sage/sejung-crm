-- ============================================================
-- 0124_student_profiles_subjects_teachers_restore.sql
-- student_profiles.subjects / teachers 를 crm_classes 기반으로 복원 (0063 회귀 수정).
-- ------------------------------------------------------------
-- 회귀 경위:
--   0063 이 subjects/teachers 를 crm_classes 메타에서 산출하도록 고쳤다
--   (crm_enrollments.subject / teacher_name 은 ETL 정책상 **항상 NULL**).
--   그런데 0064 가 attendance_rate 를 손보며 뷰 전체를 다시 쓰는 과정에서
--   두 컬럼이 e.subject / e.teacher_name 로 되돌아갔고, 그 정의가
--   0065 → 0066 → 0101 → 0123 까지 그대로 복사돼 왔다.
--   0064 의 목적은 attendance_rate 였으므로 정책 변경이 아니라 재작성 사고다.
--
-- 현재 피해 (프로덕션 실측 2026-08-20):
--   crm_enrollments 표본 200건의 subject / teacher_name 이 100% NULL
--   → 뷰의 두 컬럼도 전 학생 NULL
--   → student_profiles.teachers 로 거는 강사 필터가 **항상 0명**
--      (list-students 의 강사 필터는 RPC 경로로 라우팅되지 않아 뷰를 직접 탄다)
--   → /explorer 에서 student_profiles 데이터셋의 두 컬럼이 항상 빈 값
--   대조: 같은 조건을 정상 경로(search_students_by_region RPC)로 물으면
--        대치 재원생 중 '국어' 1,217명. 뷰로 물으면 0명.
--
-- '진행 중' 판정 기준 — 0063 과 의도적으로 다르다:
--   0063 은 c.subject <> '설명회' 만 봤다(그때는 헬퍼가 없었다).
--   0101 이 crm_class_is_ongoing(name, subject) 를 '진행 중' 단일 정의로 세웠고
--   active_enrollment_count 가 이미 그걸 쓴다. 같은 뷰 안에서 두 컬럼이 서로
--   다른 '진행 중' 을 쓰면 또 갈라지므로 헬퍼로 통일한다.
--   실질 차이: 종강/폐강 접두((종)/종)/(폐)/폐)) 강좌가 subjects/teachers 에서도
--   빠진다 — active_enrollment_count 와 일관.
--
-- 구조 주의 — 카테시안 재발 방지:
--   subjects/teachers 는 crm_classes 조인이 필요하지만, crm_classes.aca_class_id 에
--   UNIQUE 제약이 **없다**(현재 3,813건 전부 유니크이나 ETL 이 언제든 중복 생성 가능).
--   그 조인을 등록 집계 LATERAL 안에 넣으면 중복 발생 시 enrollment_count 와
--   total_paid 가 다시 부풀려진다(0123 이 방금 고친 그 버그).
--   따라서 classes 조인이 필요한 두 컬럼만 **별도 LATERAL** 로 분리한다.
--   COUNT/SUM 은 classes 를 모르는 LATERAL 에 그대로 남아 구조적으로 안전하다.
--
-- 나머지 컬럼(19개 구성·이름·순서·타입)은 0123 그대로. 앱 코드 변경 없음.
--
-- ROLLBACK: 하단 블록 참조 (0123 의 CREATE VIEW 재실행).
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
  meta.subjects,
  meta.teachers,
  att.last_attended_at,
  enr.last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.crm_students s
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school

-- 등록 기반 수치 집계. crm_classes 를 **조인하지 않는다** — aca_class_id 중복이
-- 생겨도 COUNT/SUM 이 부풀려지지 않도록 구조적으로 격리한 것(0123 버그 재발 방지).
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                           AS enrollment_count,
    COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
    MAX(e.paid_at)                     AS last_paid_at
  FROM public.crm_enrollments e
  WHERE e.student_id = s.id
) enr ON TRUE

-- 진행 중 등록 수 — 0101/0123 그대로.
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS active_enrollment_count
  FROM public.crm_enrollments e2
  LEFT JOIN public.crm_classes c2 ON c2.aca_class_id = e2.aca_class_id
  WHERE e2.student_id = s.id
    AND (e2.end_date IS NULL OR e2.end_date >= CURRENT_DATE)
    AND public.crm_class_is_ongoing(c2.name, c2.subject)
) act ON TRUE

-- 과목·강사 — 진행 중 강좌의 crm_classes 메타에서 산출(0063 복원).
-- ARRAY_AGG(DISTINCT ...) 라 설령 classes 가 중복돼도 값이 왜곡되지 않는다.
LEFT JOIN LATERAL (
  SELECT
    ARRAY_AGG(DISTINCT c3.subject) FILTER (
      WHERE c3.subject IS NOT NULL
        AND public.crm_class_is_ongoing(c3.name, c3.subject)
    ) AS subjects,
    ARRAY_AGG(DISTINCT c3.teacher_name) FILTER (
      WHERE c3.teacher_name IS NOT NULL
        AND public.crm_class_is_ongoing(c3.name, c3.subject)
    ) AS teachers
  FROM public.crm_enrollments e3
  JOIN public.crm_classes c3 ON c3.aca_class_id = e3.aca_class_id
  WHERE e3.student_id = s.id
    AND (e3.end_date IS NULL OR e3.end_date >= CURRENT_DATE)
) meta ON TRUE

-- 출석 기반 집계 — 0123 그대로.
LEFT JOIN LATERAL (
  SELECT MAX(a.attended_at) AS last_attended_at
  FROM public.crm_attendances a
  WHERE a.student_id = s.id
) att ON TRUE;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer). 0124 — subjects/teachers 를 crm_classes 메타 기반으로 복원(0063 이 도입했다가 0064 재작성에서 유실된 회귀). crm_enrollments.subject/teacher_name 은 ETL 상 항상 NULL 이라 그 컬럼으로는 강사 필터가 항상 0명이었다. 진행 중 판정은 crm_class_is_ongoing 으로 active_enrollment_count 와 통일. 집계 구조는 0123 의 LATERAL 유지(필터 푸시다운 + total_paid 카테시안 방지), classes 조인이 필요한 두 컬럼만 별도 LATERAL 로 격리.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP VIEW IF EXISTS public.student_profiles;
-- 그리고 0123 의 CREATE VIEW public.student_profiles 블록을 재실행.
-- COMMIT;
-- ※ 되돌리면 subjects/teachers 가 다시 전 학생 NULL 이 된다.
-- ============================================================
