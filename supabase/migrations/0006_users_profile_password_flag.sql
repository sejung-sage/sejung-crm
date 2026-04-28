-- ============================================================
-- 0006_users_profile_password_flag.sql
-- 세정학원 CRM · F4 계정/권한 · 초대 기반 회원가입 지원
--
-- 목적:
--   1) users_profile 에 must_change_password 플래그 추가 (첫 로그인 시 강제 변경).
--   2) users_profile 에 email 컬럼(보조 캐시) 추가.
--      목록 UI 에서 auth.users JOIN 비용을 줄이기 위한 비정규화.
--      실 소유는 auth.users. UNIQUE 제약은 걸지 않음(auth.users 가 주 owner).
--
-- email sync 정책:
--   Supabase Cloud 는 일반 마이그레이션 권한으로 auth schema 에 트리거를 생성할 수 없다
--   ("must be owner of relation users"). 따라서 단방향 동기화는 앱 레이어가 책임진다:
--     - 초대 생성: createAccountAction 이 inviteUserByEmail 후 users_profile INSERT 시
--       email 컬럼을 함께 채운다.
--     - 사용자 email 변경: F4 MVP 범위에선 변경 UI 없음. 향후 추가 시 같은 액션에서 갱신.
--   필요 시 Supabase Auth Hook(Pro 이상) 또는 Database Webhook 으로 강화 가능.
--
-- 롤백 메모 (수동):
--   ALTER TABLE public.users_profile DROP COLUMN IF EXISTS email;
--   ALTER TABLE public.users_profile DROP COLUMN IF EXISTS must_change_password;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) must_change_password · 첫 로그인 강제 변경 플래그
-- ------------------------------------------------------------
ALTER TABLE public.users_profile
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.users_profile.must_change_password IS
  '첫 로그인 시 비밀번호 변경 강제 플래그. 초대 직후 TRUE, 사용자가 /me 에서 변경 후 FALSE.';


-- ------------------------------------------------------------
-- 2) email · auth.users.email 복사본 (비정규화 캐시, 앱 레이어 sync)
-- ------------------------------------------------------------
ALTER TABLE public.users_profile
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN public.users_profile.email IS
  'auth.users.email 복사본. 계정 목록 UI JOIN 비용 절감용. 앱 레이어(createAccountAction)가 INSERT 시 채움. UNIQUE 없음 (실 소유는 auth.users).';

-- 기존 레코드 1회 백필 — 앱이 INSERT 한 후 email 누락 방지.
-- auth.users 는 supabase auth schema. 마이그레이션 권한으로 SELECT 는 가능.
UPDATE public.users_profile up
SET email = au.email
FROM auth.users au
WHERE up.user_id = au.id
  AND up.email IS DISTINCT FROM au.email;

COMMIT;
