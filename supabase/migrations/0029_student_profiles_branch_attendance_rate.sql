-- 0029_student_profiles_branch_attendance_rate.sql
-- public.student_profiles VIEW 의 attendance_rate 식을 분원별 분기로 변경.
--
-- 운영 정책 (사용자 확정 · 2026-05-08):
--   "방배" 분원은 5종 status (출석/지각/결석/조퇴/보강) 를 그대로 운영하며
--   출석률은 0018 와 동일하게 (출석+지각+보강) / 전체 로 계산한다.
--   그 외 분원(대치/송도/반포) 은 결석 외 모든 status 를 출석으로 간주 →
--   출석률은 (전체 - 결석) / 전체 로 계산한다.
--
-- 변경 대상:
--   public.student_profiles.attendance_rate
--
-- 변경 전 (0026 정의 — 0018 의 식 그대로):
--   ROUND(AVG(CASE WHEN a.status IN ('출석','지각','보강') THEN 1.0 ELSE 0.0 END) * 100, 1)
--
-- 변경 후 (0029):
--   ROUND(
--     AVG(
--       CASE
--         WHEN s.branch = '방배' THEN
--           CASE WHEN a.status IN ('출석','지각','보강') THEN 1.0 ELSE 0.0 END
--         ELSE
--           -- 방배 외: 결석만 비출석. 출석/지각/조퇴/보강 모두 출석 인정.
--           CASE WHEN a.status = '결석' THEN 0.0 ELSE 1.0 END
--       END
--     ) * 100, 1
--   )
--
-- 다른 컬럼·구조는 0026 그대로 유지 — region 컬럼 + school_regions LEFT JOIN.
-- DROP VIEW + CREATE VIEW 패턴 (CREATE OR REPLACE 는 컬럼 순서·시그니처가
-- 같을 때만 사용 가능 — 본 변경은 식만 바꾸지만 안전하게 DROP 후 재생성).
--
-- 영향 범위:
--   - 학생 명단(/students) attendance_rate 정렬·표시
--   - 학생 상세(/students/[id]) KPI 카드 출석률
--   - 발송 그룹 빌더 미리보기 sample 의 attendance_rate
--
-- 그리드 chip 렌더·강좌 KPI 평균 출석률 등 앱 레이어 표시는 별도로
-- attendance-policy 모듈에서 동일 정책 적용.
--
-- ROLLBACK 계획 (수동):
--   BEGIN;
--     DROP VIEW IF EXISTS public.student_profiles;
--     -- 0026 정의 그대로 복원 (CASE WHEN s.branch = '방배' ... 분기 제거)
--   COMMIT;

BEGIN;

DROP VIEW IF EXISTS public.student_profiles;

CREATE VIEW public.student_profiles AS
SELECT
  s.id,
  s.name,
  s.school,
  s.grade,
  s.grade_raw,
  s.school_level,
  s.track,
  s.status,
  s.branch,
  s.parent_phone,
  s.phone,
  s.registered_at,
  COUNT(DISTINCT e.id) AS enrollment_count,
  COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
  ARRAY_AGG(DISTINCT e.subject)
    FILTER (WHERE e.subject IS NOT NULL) AS subjects,
  ARRAY_AGG(DISTINCT e.teacher_name)
    FILTER (WHERE e.teacher_name IS NOT NULL) AS teachers,
  ROUND(
    AVG(
      CASE
        WHEN s.branch = '방배' THEN
          CASE WHEN a.status IN ('출석', '지각', '보강') THEN 1.0 ELSE 0.0 END
        ELSE
          -- 방배 외: 결석만 비출석. 출석/지각/조퇴/보강 모두 출석 인정.
          CASE WHEN a.status = '결석' THEN 0.0 ELSE 1.0 END
      END
    ) * 100, 1
  ) AS attendance_rate,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.students s
LEFT JOIN public.enrollments e   ON e.student_id = s.id
LEFT JOIN public.attendances a   ON a.student_id = s.id
LEFT JOIN public.school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (students + enrollments + attendances 집계 + school_regions 지역 매핑). 0029 에서 attendance_rate 식을 분원별 분기로 변경 — "방배" 만 (출석+지각+보강)/전체, 그 외는 (전체-결석)/전체 (지각·조퇴·보강 모두 출석 인정).';
COMMENT ON COLUMN public.student_profiles.grade IS
  '정규화된 학년 (중1~고3/재수/졸업/미정 9종). UI 필터 대상.';
COMMENT ON COLUMN public.student_profiles.grade_raw IS
  '아카 V_student_list.학년 원본 값. 디버그·ETL 재처리용.';
COMMENT ON COLUMN public.student_profiles.school_level IS
  '학교급 (중/고/기타). UI 1차 필터.';
COMMENT ON COLUMN public.student_profiles.enrollment_count IS '총 수강 횟수';
COMMENT ON COLUMN public.student_profiles.total_paid IS '총 결제 금액 (원 단위)';
COMMENT ON COLUMN public.student_profiles.subjects IS '수강 과목 목록';
COMMENT ON COLUMN public.student_profiles.teachers IS '수강한 강사 목록';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (분원별 분기, 소수 1자리). 방배: (출석+지각+보강)/전체. 그 외: (전체-결석)/전체 — 지각·조퇴·보강 모두 출석. 0029 변경.';
COMMENT ON COLUMN public.student_profiles.last_attended_at IS '마지막 출석일';
COMMENT ON COLUMN public.student_profiles.last_paid_at IS '마지막 결제일';
COMMENT ON COLUMN public.student_profiles.region IS
  '지역명 (예: "강남구", "서초구"). school_regions LEFT JOIN 결과. 매칭 실패/학교 NULL 시 ''기타''. 학생 명단/발송 그룹의 지역 필터 대상. 0026 추가.';

COMMIT;
