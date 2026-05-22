-- ============================================================
-- 0071_student_profiles_security_invoker.sql
-- public.student_profiles 뷰를 security_invoker=on 으로 전환.
-- ------------------------------------------------------------
-- 배경:
--   Supabase Database Linter 가 "Security Definer View" 경고를 발생.
--   PostgreSQL 15 이전에는 뷰가 항상 소유자(postgres) 권한으로 실행되어
--   호출자의 RLS 정책을 우회. PostgreSQL 15+ 에서 `security_invoker=on`
--   옵션이 도입돼 호출자 권한으로 RLS 가 정상 적용된다.
--
--   세정-CRM 의 student_profiles 는 crm_students / crm_enrollments /
--   crm_attendances / crm_school_regions 를 LEFT JOIN + GROUP BY 한
--   풀 집계 뷰. 응용 레이어(list-students 등)에서 항상 .eq("branch", ...)
--   가드를 추가하고 있으나, RLS 가 뷰 단에서 무력화되어 있던 점이 보안
--   감사 안티패턴.
--
-- 변경 내용:
--   ALTER VIEW ... SET (security_invoker = on)
--   - 뷰의 SELECT 동작·컬럼·인덱스 모두 그대로 유지.
--   - 단지 호출자(인증된 사용자) 권한으로 baseline 테이블의 RLS 가
--     평가되어 통과/차단된다.
--
-- 영향 점검:
--   - master role: 어차피 모든 분원에 SELECT 권한 → 변동 없음.
--   - admin/manager: crm_students 의 RLS 정책상 자기 분원만 SELECT 가능 →
--     student_profiles 도 같은 결과로 좁힘. 응용 레이어 가드와 일관.
--   - 백엔드 서비스: createSupabaseServiceClient 는 service_role 로
--     RLS 우회 → 영향 없음.
--
-- 롤백 (필요 시):
--   ALTER VIEW public.student_profiles SET (security_invoker = off);
-- ============================================================

BEGIN;

ALTER VIEW public.student_profiles SET (security_invoker = on);

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 풀 집계 뷰 (crm_students + enrollments + attendances + school_regions). '
  '0071 에서 security_invoker=on 적용 — Supabase Linter 의 Security Definer View 경고 해소. '
  '호출자(인증된 사용자) 권한으로 baseline 테이블의 RLS 가 평가된다.';

COMMIT;
