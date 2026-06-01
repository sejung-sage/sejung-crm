-- ============================================================
-- 0080_seminars.sql
-- 설명회 신청 시스템 (Phase 1) · 데이터 모델 + RLS + 신청 RPC.
-- ------------------------------------------------------------
-- 배경:
--   세정학원이 진행하는 학부모 대상 설명회의 신청 접수를 카톡/전화
--   대신 자체 링크(`/s/<token>`)로 받기 위한 최소 모델.
--
-- 스펙(사용자 확정 2026-06-01):
--   1) 설명회는 하루만 진행, 시작 시간만 받음. 신청 마감(`signup_closes_at`)은
--      별도 컬럼. 진행 종료 시각은 운영자가 'ended' 로 수동 마감.
--   2) 공개 링크 = nanoid(12) → `link_token`. 추측 방지(엔트로피 ~71bit).
--   3) 학부모 신청 폼 = 학생 이름 + 학부모 전화 + 개인정보 동의.
--      학교/학년 등 추가 필드는 Phase 2 로 보류.
--   4) 정원 진행률은 학부모 비공개(`capacity` 도달 시 자동 'closed').
--   5) 확인 SMS 자동 발송 X — 신청 후 화면 안내만.
--   6) 운영자만 취소 가능. 학부모 셀프 취소 X(=공개 RPC 없음).
--   7) 중복 신청 차단: 같은 (설명회, 학부모 전화, 학생 이름) 조합은
--      'signed' 상태로 1행만 허용. 취소('cancelled')된 후의 재신청은 허용.
--   8) 익명 접근: 학부모 페이지·신청 RPC 는 anon 권한.
--      SECURITY DEFINER 로 RLS 우회 + 함수 내부 검증.
--
-- 권한 모델:
--   - 테이블 직접 SELECT/INSERT/UPDATE 는 master/admin(분원) 에게만.
--   - manager/viewer 는 미관여(읽기 정책에 포함되지만 INSERT/UPDATE 차단).
--   - anon/일반 authenticated 의 학부모 페이지·신청은 두 RPC 만 통과 가능.
--
-- 의존성:
--   - 0049 갱신된 RLS 헬퍼: is_master(), can_read_branch(t), can_write_branch(t).
--
-- 롤백:
--   DROP FUNCTION public.signup_for_seminar(text, text, text, text, text);
--   DROP FUNCTION public.lookup_seminar_by_token(text);
--   DROP TABLE public.crm_seminar_signups;
--   DROP TABLE public.crm_seminars;
-- ============================================================

BEGIN;

-- ─── 1) 설명회 마스터 ──────────────────────────────────────────
CREATE TABLE public.crm_seminars (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch            text NOT NULL,
  name              text NOT NULL,
  description       text,
  held_at           timestamptz,
  venue             text,
  capacity          integer,
  signup_opens_at   timestamptz,
  signup_closes_at  timestamptz,
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closed', 'ended', 'cancelled')),
  link_token        text NOT NULL UNIQUE,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_seminars_capacity_positive_chk
    CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT crm_seminars_signup_window_chk
    CHECK (
      signup_opens_at IS NULL
      OR signup_closes_at IS NULL
      OR signup_opens_at <= signup_closes_at
    )
);

COMMENT ON TABLE public.crm_seminars IS
  '설명회 마스터. 하루+시작 시각으로 진행되는 학부모 대상 행사. '
  '학부모 공개 페이지(/s/<link_token>) 와 운영자 페이지(/seminars) 의 단일 소스.';

COMMENT ON COLUMN public.crm_seminars.id IS '설명회 PK (UUID).';
COMMENT ON COLUMN public.crm_seminars.branch IS
  '분원 (대치/송도/반포/방배). RLS 격리 기준 — 자기 분원 설명회만 조회/편집.';
COMMENT ON COLUMN public.crm_seminars.name IS '설명회 제목 (운영자 입력, 학부모 페이지 노출).';
COMMENT ON COLUMN public.crm_seminars.description IS
  '안내문/상세 설명 (학부모 공개 페이지에 그대로 표시). NULL 허용.';
COMMENT ON COLUMN public.crm_seminars.held_at IS
  '진행 일시(시작 시각, timestamptz). UI 폼은 date + time 분리 입력 → 합쳐서 저장. '
  '종료 시각은 별도 저장 안 함(하루 행사 가정).';
COMMENT ON COLUMN public.crm_seminars.venue IS '장소 (자유 텍스트). NULL 허용.';
COMMENT ON COLUMN public.crm_seminars.capacity IS
  '정원. NULL = 무제한. 양수만 허용. 도달 시 자동 status=closed 로 전이(RPC).';
COMMENT ON COLUMN public.crm_seminars.signup_opens_at IS
  '신청 시작 일시. NULL = "지금부터 가능" 으로 해석. RPC 가 검증.';
COMMENT ON COLUMN public.crm_seminars.signup_closes_at IS
  '신청 마감 일시. NULL = "별도 마감 없음(정원 도달까지)" 으로 해석. RPC 가 검증.';
COMMENT ON COLUMN public.crm_seminars.status IS
  '상태 enum — open(모집중) / closed(정원마감) / ended(행사종료) / cancelled(취소). '
  '신청 RPC 가 정원 도달 시 자동 closed 전이, 나머지는 운영자 수동.';
COMMENT ON COLUMN public.crm_seminars.link_token IS
  '학부모 공개 URL 의 토큰(nanoid 12자, URL-safe). UNIQUE. 추측 방지(~71bit 엔트로피). '
  '서버에서 INSERT 시점에 생성 — 외부에서 직접 지정 금지.';
COMMENT ON COLUMN public.crm_seminars.created_by IS
  '작성자(auth.users.id reference, FK 없음 — RLS/감사용 메타). NULL 허용.';
COMMENT ON COLUMN public.crm_seminars.created_at IS '생성 시각(UTC).';
COMMENT ON COLUMN public.crm_seminars.updated_at IS '마지막 수정 시각(UTC).';

CREATE INDEX crm_seminars_branch_status_created_idx
  ON public.crm_seminars (branch, status, created_at DESC);
-- link_token 은 UNIQUE 제약으로 이미 인덱스 생성됨.

-- ─── 2) 신청 명단 ─────────────────────────────────────────────
CREATE TABLE public.crm_seminar_signups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seminar_id    uuid NOT NULL REFERENCES public.crm_seminars(id) ON DELETE CASCADE,
  student_name  text NOT NULL,
  parent_phone  text NOT NULL,
  status        text NOT NULL DEFAULT 'signed'
                CHECK (status IN ('signed', 'cancelled')),
  client_ip     text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid,
  CONSTRAINT crm_seminar_signups_cancel_consistency_chk
    CHECK (
      (status = 'cancelled' AND cancelled_at IS NOT NULL)
      OR (status = 'signed' AND cancelled_at IS NULL)
    )
);

COMMENT ON TABLE public.crm_seminar_signups IS
  '설명회 신청 명단. 1신청 = 1행. 취소는 soft delete(status=cancelled). '
  '학부모는 RPC 로만 INSERT, 운영자만 SELECT/UPDATE(취소).';

COMMENT ON COLUMN public.crm_seminar_signups.id IS '신청 PK (UUID).';
COMMENT ON COLUMN public.crm_seminar_signups.seminar_id IS
  '설명회 FK. crm_seminars 삭제 시 함께 삭제(ON DELETE CASCADE).';
COMMENT ON COLUMN public.crm_seminar_signups.student_name IS
  '자녀 이름 (학부모 신청 폼 입력). 1자 이상.';
COMMENT ON COLUMN public.crm_seminar_signups.parent_phone IS
  '학부모 전화 — 숫자만 정규화 저장(예: "01012345678"). '
  '하이픈/공백/+82 prefix 제거는 RPC 가 수행. 8자 이상 보장(RPC 검증).';
COMMENT ON COLUMN public.crm_seminar_signups.status IS
  '신청 상태 — signed(접수) / cancelled(운영자 취소). 대기명단은 Phase 2.';
COMMENT ON COLUMN public.crm_seminar_signups.client_ip IS
  '신청자 IP (감사용, RPC 가 헤더에서 추출하여 전달). NULL 허용.';
COMMENT ON COLUMN public.crm_seminar_signups.user_agent IS
  '신청자 User-Agent (감사용). NULL 허용. 최대 길이 제한 없음(긴 UA 도 수용).';
COMMENT ON COLUMN public.crm_seminar_signups.created_at IS '신청 시각(UTC).';
COMMENT ON COLUMN public.crm_seminar_signups.cancelled_at IS
  '취소 시각. status=cancelled 면 NOT NULL.';
COMMENT ON COLUMN public.crm_seminar_signups.cancelled_by IS
  '취소한 운영자(auth.users.id reference, FK 없음 — 감사 메타). NULL 허용.';

-- 활성 신청만 UNIQUE — 같은 (설명회, 부모번호, 학생) 조합 중복 차단.
-- 취소 후 재신청은 허용(부분 인덱스라 cancelled row 는 검사 대상 아님).
CREATE UNIQUE INDEX crm_seminar_signups_unique_signed_idx
  ON public.crm_seminar_signups (seminar_id, parent_phone, student_name)
  WHERE status = 'signed';

-- 명단 조회용 (운영자 페이지: 신청 시각 역순).
CREATE INDEX crm_seminar_signups_seminar_status_created_idx
  ON public.crm_seminar_signups (seminar_id, status, created_at DESC);

-- ─── 3) updated_at trigger (crm_seminars) ─────────────────────
CREATE OR REPLACE FUNCTION public.tg_crm_seminars_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_seminars_set_updated_at
  BEFORE UPDATE ON public.crm_seminars
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_seminars_set_updated_at();

-- ─── 4) RLS ───────────────────────────────────────────────────
ALTER TABLE public.crm_seminars        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_seminar_signups ENABLE ROW LEVEL SECURITY;

-- crm_seminars: 운영자 권한만. anon 직접 SELECT 차단.
CREATE POLICY crm_seminars_read_branch ON public.crm_seminars
  FOR SELECT TO authenticated
  USING (public.can_read_branch(branch));

CREATE POLICY crm_seminars_write_branch ON public.crm_seminars
  FOR ALL TO authenticated
  USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

COMMENT ON POLICY crm_seminars_read_branch ON public.crm_seminars IS
  '설명회 읽기 — master 전사 / admin·manager·viewer 본인 분원. anon 차단.';
COMMENT ON POLICY crm_seminars_write_branch ON public.crm_seminars IS
  '설명회 쓰기 — master + admin(본인 분원). manager/viewer 차단. '
  'anon 의 학부모 페이지 조회는 lookup_seminar_by_token RPC(SECURITY DEFINER)로 우회.';

-- crm_seminar_signups: 운영자만 SELECT/UPDATE. INSERT 는 RPC 만.
CREATE POLICY crm_seminar_signups_read_branch ON public.crm_seminar_signups
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_seminars s
      WHERE s.id = crm_seminar_signups.seminar_id
        AND public.can_read_branch(s.branch)
    )
  );

CREATE POLICY crm_seminar_signups_update_branch ON public.crm_seminar_signups
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_seminars s
      WHERE s.id = crm_seminar_signups.seminar_id
        AND public.can_write_branch(s.branch)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.crm_seminars s
      WHERE s.id = crm_seminar_signups.seminar_id
        AND public.can_write_branch(s.branch)
    )
  );

COMMENT ON POLICY crm_seminar_signups_read_branch ON public.crm_seminar_signups IS
  '신청 명단 읽기 — 운영자 권한으로 본인 분원 설명회의 신청만. anon 차단.';
COMMENT ON POLICY crm_seminar_signups_update_branch ON public.crm_seminar_signups IS
  '신청 취소(soft delete) — master + admin(본인 분원) 만. anon/일반 사용자 차단. '
  '학부모 신청(INSERT) 은 signup_for_seminar RPC 만 가능(테이블 직접 INSERT 정책 없음).';

-- INSERT/DELETE 정책 없음 — RLS 가 기본 거부.
-- INSERT 는 signup_for_seminar RPC(SECURITY DEFINER) 가 service identity 로 수행.
-- DELETE 는 정책상 금지(취소는 UPDATE soft delete).

-- ─── 5) lookup_seminar_by_token RPC ──────────────────────────
-- 학부모 공개 페이지가 호출. anon 권한. capacity·신청 수 미노출.
CREATE OR REPLACE FUNCTION public.lookup_seminar_by_token(p_token text)
RETURNS TABLE (
  id               uuid,
  name             text,
  description      text,
  held_at          timestamptz,
  venue            text,
  status           text,
  signup_opens_at  timestamptz,
  signup_closes_at timestamptz,
  branch           text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    s.description,
    s.held_at,
    s.venue,
    s.status,
    s.signup_opens_at,
    s.signup_closes_at,
    s.branch
  FROM public.crm_seminars s
  WHERE s.link_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_seminar_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_seminar_by_token(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_seminar_by_token(text) IS
  '학부모 공개 페이지(/s/<token>) 가 호출하는 메타 조회 RPC. '
  '존재하지 않으면 0행 반환. capacity 와 신청 수는 비공개라 노출하지 않는다. '
  'SECURITY DEFINER 로 RLS 우회 — anon 도 token 만 알면 조회 가능.';

-- ─── 6) signup_for_seminar RPC ───────────────────────────────
-- 학부모 신청 1건 INSERT. anon 권한. 정원/창/중복 검증을 모두 함수 내부에서 수행.
CREATE OR REPLACE FUNCTION public.signup_for_seminar(
  p_token        text,
  p_student_name text,
  p_parent_phone text,
  p_client_ip    text DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
)
RETURNS TABLE (
  status    text,
  signup_id uuid,
  reason    text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seminar          public.crm_seminars%ROWTYPE;
  v_normalized_phone text;
  v_clean_name       text;
  v_now              timestamptz := now();
  v_existing_id      uuid;
  v_signed_count     integer;
  v_new_id           uuid;
BEGIN
  -- 입력 정규화: 전화번호 = 숫자만, 이름 = trim.
  v_clean_name := btrim(COALESCE(p_student_name, ''));
  v_normalized_phone := regexp_replace(COALESCE(p_parent_phone, ''), '[^0-9]', '', 'g');

  -- 입력 검증.
  IF v_clean_name = '' OR length(v_clean_name) > 40 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '학생 이름이 유효하지 않습니다'::text;
    RETURN;
  END IF;
  IF length(v_normalized_phone) < 8 OR length(v_normalized_phone) > 11 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '학부모 연락처가 유효하지 않습니다'::text;
    RETURN;
  END IF;

  -- 설명회 조회 + row lock (동시 신청 race 차단).
  SELECT * INTO v_seminar
  FROM public.crm_seminars
  WHERE link_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '유효하지 않은 링크입니다'::text;
    RETURN;
  END IF;

  -- 상태별 조기 종료.
  IF v_seminar.status = 'cancelled' THEN
    RETURN QUERY SELECT 'cancelled'::text, NULL::uuid, '취소된 설명회입니다'::text;
    RETURN;
  END IF;

  IF v_seminar.status = 'ended' THEN
    RETURN QUERY SELECT 'ended'::text, NULL::uuid, '종료된 설명회입니다'::text;
    RETURN;
  END IF;

  -- 신청 창 검증 (NULL = 제약 없음).
  IF v_seminar.signup_opens_at IS NOT NULL AND v_now < v_seminar.signup_opens_at THEN
    RETURN QUERY SELECT 'out_of_window'::text, NULL::uuid, '신청 시작 전입니다'::text;
    RETURN;
  END IF;
  IF v_seminar.signup_closes_at IS NOT NULL AND v_now > v_seminar.signup_closes_at THEN
    RETURN QUERY SELECT 'out_of_window'::text, NULL::uuid, '신청이 마감되었습니다'::text;
    RETURN;
  END IF;

  IF v_seminar.status = 'closed' THEN
    RETURN QUERY SELECT 'closed'::text, NULL::uuid, '정원이 마감되었습니다'::text;
    RETURN;
  END IF;

  -- 중복(활성 신청) 검증.
  SELECT id INTO v_existing_id
  FROM public.crm_seminar_signups
  WHERE seminar_id = v_seminar.id
    AND parent_phone = v_normalized_phone
    AND student_name = v_clean_name
    AND status = 'signed'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT 'duplicate'::text, v_existing_id, '이미 신청된 학생입니다'::text;
    RETURN;
  END IF;

  -- INSERT.
  INSERT INTO public.crm_seminar_signups (
    seminar_id, student_name, parent_phone,
    status, client_ip, user_agent, created_at
  ) VALUES (
    v_seminar.id, v_clean_name, v_normalized_phone,
    'signed', p_client_ip, p_user_agent, v_now
  )
  RETURNING id INTO v_new_id;

  -- 정원 도달 시 자동 'closed' 전이.
  IF v_seminar.capacity IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_signed_count
    FROM public.crm_seminar_signups
    WHERE seminar_id = v_seminar.id
      AND status = 'signed';

    IF v_signed_count >= v_seminar.capacity THEN
      UPDATE public.crm_seminars
         SET status = 'closed'
       WHERE id = v_seminar.id
         AND status = 'open';
    END IF;
  END IF;

  RETURN QUERY SELECT 'signed'::text, v_new_id, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.signup_for_seminar(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signup_for_seminar(text, text, text, text, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.signup_for_seminar(text, text, text, text, text) IS
  '학부모 설명회 신청 1건 처리(SECURITY DEFINER). '
  '반환 status: signed(접수) / duplicate(중복) / closed(정원마감) / '
  'ended(행사종료) / cancelled(취소된 설명회) / invalid(유효하지 않은 링크/입력) / '
  'out_of_window(신청 창 밖). 정원 도달 시 자동으로 설명회 status 를 closed 로 전이.';

COMMIT;
