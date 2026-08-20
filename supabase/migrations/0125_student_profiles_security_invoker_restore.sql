-- ============================================================
-- 0125_student_profiles_security_invoker_restore.sql
-- student_profiles 뷰의 security_invoker 를 다시 on 으로 (0071 회귀 수정).
-- ------------------------------------------------------------
-- 회귀 경위:
--   0071 이 security_invoker = on 으로 켰다. 그런데 뷰 옵션은 DROP VIEW 하면
--   함께 사라지는데, 0101 이 DROP VIEW + CREATE VIEW 를 하면서 ALTER 를 다시
--   걸지 않아 off(기본값)로 돌아갔다. 0123/0124 도 DROP+CREATE 라 계속 off 다.
--   0114 주석이 "student_profiles 뷰가 security_invoker 가 아니라(reloptions
--   비어 있음)" 라고 이미 관찰했으나 복구는 되지 않았다.
--
-- security_invoker = off 이면 뷰가 **뷰 소유자 권한**으로 기반 테이블을 읽는다.
-- 즉 crm_students / crm_enrollments / crm_attendances 의 RLS 가 적용되지 않는다.
--
-- ── 왜 문제인가: 코드가 이 RLS 를 전제로 쓰여 있다 ──
--   src/lib/auth/branch-context.ts:
--     "cookie 는 UX 컨텍스트일 뿐. 실 보안은 RLS 가 분원 격리 담당.
--      일반 사용자가 cookie 변조해도 RLS 가 자기 branch 외 차단."
--   src/app/(features)/students/[id]/page.tsx:
--     "RLS 가 본인 분원 학생만 보이게 막아주므로 분원 격리는 자동."
--
--   학생 명단(/students)은 applyBranchContextToParams 가 비-master 를 본인 분원
--   으로 강제하므로 앱 단 가드가 받쳐준다. 그러나 **학생 상세(/students/[id])는
--   그 가드를 타지 않는다** — getStudentDetail(id) 가 UUID 로 바로 조회하고,
--   페이지는 학생이 없을 때만 notFound() 한다. 분원 검사가 없다.
--
--   게다가 학부모 번호 마스킹은 클라이언트 컴포넌트(PhoneReveal)가 하므로
--   canRevealPhone=false 여도 **raw parent_phone 이 클라이언트 페이로드에 실린다**.
--   결과: 로그인한 타 분원 직원이 학생 UUID 를 알면 그 학생의 이름·학교·학년·
--   수강/결제 이력은 화면으로, 학부모 연락처는 페이지 페이로드로 읽을 수 있다.
--   (익명 접근은 불가 — 인증된 직원 계정 + UUID 인지가 전제.)
--
--   security_invoker = on 이면 students_read_by_branch(can_read_branch(branch))가
--   적용돼 타 분원 학생은 조회 자체가 0행 → notFound() 로 떨어진다.
--
-- ── 성능 주의 (배포 후 반드시 확인) ──
--   on 으로 켜면 사용자 세션 조회에 RLS qual 이 붙는다. can_read_branch 는
--   SQL STABLE 이라 인라인되지만 EXISTS SubPlan 이 행마다 평가될 수 있다.
--   0123 이 되찾은 응답속도(0.1초대)가 유지되는지 **실제 로그인 세션으로**
--   /students 를 열어 확인할 것. service client 경로(필터 옵션·explorer·ETL)는
--   RLS 를 우회하므로 영향 없다.
--   느려지면 하단 ROLLBACK 한 줄로 즉시 되돌릴 수 있다(뷰 재생성 불필요).
--
-- 뷰 정의는 건드리지 않는다 — 옵션만 바꾼다. 앱 코드 변경 없음.
--
-- ── 별건으로 남는 것 (이 파일 범위 밖) ──
--   1) 학생 상세에 앱 단 분원 가드가 없다. RLS 가 유일한 방어가 된다.
--      branch-context 의 정책처럼 서버에서도 명시적으로 막는 편이 낫다.
--   2) raw parent_phone 이 클라이언트 페이로드에 실린다. 마스킹이 UI 전용이라
--      권한 없는 사용자에게도 원본이 전달된다. 서버에서 마스킹해 내려보내야
--      진짜 가드가 된다.
-- ============================================================

BEGIN;

ALTER VIEW public.student_profiles SET (security_invoker = on);

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer). 0124 정의 + 0125 로 security_invoker=on 복원(0071 이 켰다가 0101 의 DROP VIEW 로 유실). 사용자 세션 조회 시 crm_students/enrollments/attendances 의 RLS 가 적용돼 분원 격리가 뷰 레벨에서도 성립한다 — 학생 상세(/students/[id])는 앱 단 분원 가드가 없어 이 RLS 가 유일한 방어다. service client 경로는 종전대로 RLS 우회.';

COMMIT;

-- ============================================================
-- ROLLBACK (성능 회귀 시 즉시 실행 — 뷰 재생성 불필요):
--   ALTER VIEW public.student_profiles SET (security_invoker = off);
-- ============================================================
