-- ============================================================
-- 0128_view_traversed_rls_initplan.sql
-- student_profiles 뷰가 타고 들어가는 테이블들의 RLS 도 InitPlan 형태로.
-- (0127 의 후속 — 같은 병목이 뷰 안쪽에 남아 있었다)
-- ------------------------------------------------------------
-- 배경:
--   0125 로 student_profiles 가 security_invoker=on 이 되면서, 뷰의 LATERAL 이
--   crm_enrollments / crm_attendances / crm_classes 를 읽을 때 그 테이블들의 RLS 도
--   함께 평가된다. 0127 이 crm_students 만 고쳤더니 목록 상단 count 는 살아났는데
--   (1.07초 → 0.053초) 뷰 조회는 여전히 느렸다.
--
--   실측 (마스터 세션):
--     명단 1페이지  (student_profiles, branch=대치, ORDER BY name LIMIT 50)  1.08초
--     학교+학년 필터                                                        1.48초
--
--   원인은 0127 과 동일하다 — 정책이 can_read_branch(...) 를 행마다 호출한다.
--   enrollments/attendances 는 학생 EXISTS 안에서, classes 는 직접.
--
-- 변경:
--   0127 에서 도입한 무인자 헬퍼(auth_role / auth_branch)를 스칼라 서브쿼리로 감싸
--   InitPlan 1회 평가가 되게 한다. 판정 의미는 can_read_branch/can_write_branch 와
--   동일하다(0127 에서 42개 조합 대조로 확인한 그 표현식 그대로).
--
--   실측 (같은 세션, 적용 후):
--     명단 1페이지  1.08초 → 0.042초
--     학교+학년     1.48초 → 1.02초   (원래 20.6초에서 이어진 개선)
--
--   ※ 학교+학년 케이스에 남은 ~1초는 이 변경 범위 밖이다. 남은 비용은
--     crm_users_profile 자체 정책이 is_master()/current_user_role()/
--     current_user_branch() 를 쓰는 부분 등에 흩어져 있다(16행짜리라 절대값은 작다).
--     필요해지면 같은 패턴으로 이어서 정리할 것.
--
-- 범위:
--   뷰가 실제로 타는 읽기 경로만 손댄다. crm_classes 는 쓰기 정책이 FOR ALL 이라
--   SELECT 에도 OR 로 붙으므로 함께 바꿔야 효과가 난다(0127 의 crm_students 와 동일).
--   can_read_branch/can_write_branch 함수 자체는 그대로 둔다 — 나머지 테이블의
--   정책들이 여전히 사용하며, 그쪽은 대량 스캔 경로가 아니다.
--
-- ROLLBACK: 하단 블록 참조.
-- ============================================================

BEGIN;

-- ─── crm_enrollments (읽기) ─────────────────────────────────
DROP POLICY IF EXISTS crm_enrollments_read_by_branch ON public.crm_enrollments;
CREATE POLICY crm_enrollments_read_by_branch ON public.crm_enrollments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.crm_students s
      WHERE s.id = crm_enrollments.student_id
        AND COALESCE(
          (SELECT public.auth_role()) = 'master'
          OR s.branch = (SELECT public.auth_branch()),
          FALSE
        )
    )
  );

COMMENT ON POLICY crm_enrollments_read_by_branch ON public.crm_enrollments IS
  '읽기: 학생의 분원이 master 이거나 본인 분원. 판정은 can_read_branch(s.branch) 와 동일하되 현재 사용자 조회를 InitPlan 1회로 끌어올린 형태(0128). student_profiles 뷰의 LATERAL 이 이 경로를 탄다.';

-- ─── crm_attendances (읽기) ─────────────────────────────────
DROP POLICY IF EXISTS crm_attendances_read_by_branch ON public.crm_attendances;
CREATE POLICY crm_attendances_read_by_branch ON public.crm_attendances
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.crm_students s
      WHERE s.id = crm_attendances.student_id
        AND COALESCE(
          (SELECT public.auth_role()) = 'master'
          OR s.branch = (SELECT public.auth_branch()),
          FALSE
        )
    )
  );

COMMENT ON POLICY crm_attendances_read_by_branch ON public.crm_attendances IS
  '읽기: 학생의 분원 기준. can_read_branch(s.branch) 와 동일 판정, InitPlan 형태(0128).';

-- ─── crm_classes (읽기 + 쓰기) ──────────────────────────────
DROP POLICY IF EXISTS crm_classes_read_by_branch ON public.crm_classes;
CREATE POLICY crm_classes_read_by_branch ON public.crm_classes
  FOR SELECT USING (
    COALESCE(
      (SELECT public.auth_role()) = 'master'
      OR branch = (SELECT public.auth_branch()),
      FALSE
    )
  );

COMMENT ON POLICY crm_classes_read_by_branch ON public.crm_classes IS
  '읽기: master 이거나 본인 분원. can_read_branch(branch) 와 동일 판정, InitPlan 형태(0128).';

DROP POLICY IF EXISTS crm_classes_write_by_branch ON public.crm_classes;
CREATE POLICY crm_classes_write_by_branch ON public.crm_classes
  FOR ALL USING (
    COALESCE(
      (SELECT public.auth_role()) = 'master'
      OR (
        (SELECT public.auth_role()) = 'admin'
        AND branch = (SELECT public.auth_branch())
      ),
      FALSE
    )
  );

COMMENT ON POLICY crm_classes_write_by_branch ON public.crm_classes IS
  '쓰기: master 이거나 본인 분원 admin. can_write_branch(branch) 와 동일 판정, InitPlan 형태(0128). FOR ALL 이라 SELECT 에도 OR 로 붙으므로 읽기 성능을 위해 함께 바꿔야 한다.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP POLICY IF EXISTS crm_enrollments_read_by_branch ON public.crm_enrollments;
-- CREATE POLICY crm_enrollments_read_by_branch ON public.crm_enrollments FOR SELECT
--   USING (EXISTS (SELECT 1 FROM public.crm_students s
--                   WHERE s.id = crm_enrollments.student_id
--                     AND public.can_read_branch(s.branch)));
-- DROP POLICY IF EXISTS crm_attendances_read_by_branch ON public.crm_attendances;
-- CREATE POLICY crm_attendances_read_by_branch ON public.crm_attendances FOR SELECT
--   USING (EXISTS (SELECT 1 FROM public.crm_students s
--                   WHERE s.id = crm_attendances.student_id
--                     AND public.can_read_branch(s.branch)));
-- DROP POLICY IF EXISTS crm_classes_read_by_branch ON public.crm_classes;
-- CREATE POLICY crm_classes_read_by_branch ON public.crm_classes FOR SELECT
--   USING (public.can_read_branch(branch));
-- DROP POLICY IF EXISTS crm_classes_write_by_branch ON public.crm_classes;
-- CREATE POLICY crm_classes_write_by_branch ON public.crm_classes FOR ALL
--   USING (public.can_write_branch(branch));
-- COMMIT;
-- ============================================================
