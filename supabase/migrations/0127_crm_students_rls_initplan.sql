-- ============================================================
-- 0127_crm_students_rls_initplan.sql
-- crm_students RLS 정책을 행마다 함수 호출 → InitPlan 1회 평가로 재작성.
-- ------------------------------------------------------------
-- 배경 (2026-08-20, 0123 이후 남은 마지막 병목):
--   0123 으로 student_profiles 뷰는 0.1초가 됐는데 /students 가 여전히 느렸다.
--   실측해 보니 병목이 뷰가 아니라 **목록 상단의 학생 수 count 쿼리** 였다.
--
--   EXPLAIN (마스터 세션, 대치 65,570행):
--     Index Only Scan on crm_students
--       Filter: (status <> '탈퇴')
--               AND (can_write_branch(branch) OR can_read_branch(branch))
--     → 두 함수가 **65,570행 전부에 대해 호출**된다.
--       (write 정책이 FOR ALL 이라 SELECT 에도 OR 로 붙는다)
--       각 호출이 crm_users_profile EXISTS 조회 → 1.07초.
--
--   왜 함수가 매 행 도는가: can_read_branch(target_branch) 가 **인자를 받으므로**
--   행마다 평가될 수밖에 없다. STABLE 이어도 인자가 바뀌면 캐시되지 않는다.
--
--   ※ 헬퍼 본문만 고쳐 전체 정책을 한 번에 살리는 방법을 두 가지 시도했으나
--     (본문을 무인자 헬퍼 조합으로 교체 / SET search_path·SECURITY DEFINER 제거해
--     인라인 유도) 둘 다 인라인되지 않았고 오히려 6~10초로 악화됐다.
--     실측으로 효과가 확인된 건 정책 표현식 재작성뿐이다.
--
-- 해결:
--   현재 사용자의 role/branch 를 **바깥 행과 무관한 스칼라 서브쿼리**로 만들면
--   플래너가 InitPlan 으로 끌어올려 statement 당 1회만 평가한다. 행마다 남는 일은
--   단순 문자열 비교뿐이다.
--
--   실측 (마스터·대치 65,570행, 워밍 후 3회):
--     이전  1,067 / 1,049 / 1,090 ms
--     이후     58 /    57 /    58 ms      → 약 18배
--
-- 동등성 검증 (적용 전 트랜잭션 안에서 42개 조합 대조, 불일치 0건):
--   신원  master / admin-대치 / admin-반포 / 미등록uid / manager / viewer / 비활성
--   분원  대치 / 반포 / 방배 / 송도 / 없는분원 / NULL
--   → can_read_branch·can_write_branch 결과와 새 표현식 결과가 전부 일치.
--   (NULL 은 RLS 에서 거부로 취급되므로 COALESCE 로 false 고정)
--
-- 범위:
--   can_read_branch/can_write_branch 를 쓰는 정책은 22개 테이블 43개다. 그중
--   대량 스캔이 실제로 확인된 crm_students 2개만 바꾼다. 함수 자체는 그대로 두어
--   나머지 41개 정책은 무영향이다.
--   남은 후보: crm_messages(122만 행) — 캠페인 상세가 캠페인 1건으로 좁혀 읽으므로
--   지금은 문제되지 않으나 같은 패턴이다. 필요해지면 동일한 방식으로 고칠 것.
--
-- ROLLBACK: 하단 블록 참조.
-- ============================================================

BEGIN;

-- ─── 활성 프로필 기준 무인자 헬퍼 ────────────────────────────
-- 인자가 없으므로 `(SELECT ...)` 로 감싸면 InitPlan 으로 1회만 평가된다.
-- active=false 이거나 프로필이 없으면 NULL → 호출부에서 거부로 귀결.
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT up.role
  FROM public.crm_users_profile up
  WHERE up.user_id = (SELECT auth.uid())
    AND up.active = TRUE;
$$;

COMMENT ON FUNCTION public.auth_role() IS
  '현재 로그인 사용자의 role (비활성/미등록이면 NULL). 무인자라 RLS 정책에서 (SELECT auth_role()) 로 감싸면 InitPlan 1회 평가된다 — can_read_branch(branch) 처럼 인자를 받는 헬퍼가 행마다 도는 비용을 피하기 위함. 0127.';

CREATE OR REPLACE FUNCTION public.auth_branch()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT up.branch
  FROM public.crm_users_profile up
  WHERE up.user_id = (SELECT auth.uid())
    AND up.active = TRUE;
$$;

COMMENT ON FUNCTION public.auth_branch() IS
  '현재 로그인 사용자의 소속 분원 (비활성/미등록이면 NULL). auth_role() 과 같은 목적. 0127.';

GRANT EXECUTE ON FUNCTION public.auth_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_branch() TO authenticated, service_role;

-- ─── crm_students 정책 재작성 ───────────────────────────────
-- 표현식만 바꾼다. 정책 이름·대상 명령(cmd)·권한 의미는 종전과 동일.
DROP POLICY IF EXISTS crm_students_read_by_branch ON public.crm_students;
CREATE POLICY crm_students_read_by_branch ON public.crm_students
  FOR SELECT USING (
    COALESCE(
      (SELECT public.auth_role()) = 'master'
      OR branch = (SELECT public.auth_branch()),
      FALSE
    )
  );

COMMENT ON POLICY crm_students_read_by_branch ON public.crm_students IS
  '읽기: master 이거나 본인 분원. can_read_branch(branch) 와 동일 판정이되, 현재 사용자 조회를 InitPlan 으로 1회만 수행해 행마다 함수 호출이 돌지 않게 한 형태(0127). 65,570행 count 기준 1.07초 → 0.058초.';

DROP POLICY IF EXISTS crm_students_write_by_branch ON public.crm_students;
CREATE POLICY crm_students_write_by_branch ON public.crm_students
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

COMMENT ON POLICY crm_students_write_by_branch ON public.crm_students IS
  '쓰기: master 이거나 본인 분원 admin. can_write_branch(branch) 와 동일 판정, InitPlan 형태(0127). FOR ALL 이라 SELECT 에도 OR 로 붙으므로 이쪽도 같이 가볍게 만들어야 효과가 난다.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP POLICY IF EXISTS crm_students_read_by_branch ON public.crm_students;
-- CREATE POLICY crm_students_read_by_branch ON public.crm_students
--   FOR SELECT USING (public.can_read_branch(branch));
-- DROP POLICY IF EXISTS crm_students_write_by_branch ON public.crm_students;
-- CREATE POLICY crm_students_write_by_branch ON public.crm_students
--   FOR ALL USING (public.can_write_branch(branch));
-- COMMIT;
-- ※ auth_role()/auth_branch() 는 남겨도 무해하다(다른 곳에서 미사용).
-- ============================================================
