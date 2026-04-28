-- ============================================================
-- 0006_users_profile_password_flag.sql
-- 세정학원 CRM · F4 계정/권한 · 초대 기반 회원가입 지원
--
-- 목적:
--   1) users_profile 에 must_change_password 플래그 추가 (첫 로그인 시 강제 변경).
--   2) users_profile 에 email 컬럼(보조 캐시) 추가 + auth.users 와 sync 트리거.
--      목록 UI 에서 auth.users JOIN 비용을 줄이기 위한 비정규화.
--      실 소유는 auth.users. UNIQUE 제약은 걸지 않음(auth.users 가 주 owner).
--
-- 관련:
--   - 앱에서 초대 생성 시 auth.admin.createUser() 로 auth.users 행 생성 후
--     Server Action 이 users_profile 에 insert 하는 책임. 이 마이그레이션은
--     auth.users → users_profile.email 단방향 동기화만 보장.
--
-- 롤백 메모 (수동):
--   DROP TRIGGER IF EXISTS trg_sync_users_profile_email ON auth.users;
--   DROP FUNCTION IF EXISTS public.sync_users_profile_email();
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
-- 2) email · auth.users.email 복사본 (비정규화 캐시)
--    UNIQUE 제약 없음. 실 소유는 auth.users.
-- ------------------------------------------------------------
ALTER TABLE public.users_profile
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN public.users_profile.email IS
  'auth.users.email 복사본. 계정 목록 UI 에서 JOIN 비용 줄이기 위한 비정규화. 실 소유는 auth.users. sync 트리거로 유지.';

-- 기존 레코드에 대해서는 1회 백필 (이후는 트리거로 자동 유지).
UPDATE public.users_profile up
SET email = au.email
FROM auth.users au
WHERE up.user_id = au.id
  AND up.email IS DISTINCT FROM au.email;


-- ------------------------------------------------------------
-- 3) sync 함수 + auth.users 트리거
--    auth.users 에 INSERT 되거나 email 이 UPDATE 되면
--    users_profile.email 을 최신 값으로 맞춘다.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_users_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.users_profile
     SET email = NEW.email
   WHERE user_id = NEW.id
     AND (email IS DISTINCT FROM NEW.email);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_users_profile_email() IS
  'auth.users.email 변경을 users_profile.email 로 단방향 동기화하는 트리거 함수.';

DROP TRIGGER IF EXISTS trg_sync_users_profile_email ON auth.users;

CREATE TRIGGER trg_sync_users_profile_email
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_users_profile_email();

COMMENT ON TRIGGER trg_sync_users_profile_email ON auth.users IS
  'auth.users 의 email 변경을 users_profile.email 로 자동 반영';

COMMIT;
