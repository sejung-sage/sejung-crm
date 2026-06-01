-- ============================================================
-- 0082_seminar_invitations.sql
-- 설명회 신청 시스템 — Aca2000 식 학생별 개인 URL 모델로 재설계.
-- ------------------------------------------------------------
-- 배경:
--   0080·0081 에서 도입한 "폼 기반(이름·전화 입력) + 설명회당 1개의 공개
--   토큰" 모델은 학부모 입장에선 같은 정보를 매 설명회마다 다시 입력해야
--   하고, 운영자 입장에선 누가 어느 설명회를 받을지 정해 발송할 수 없는
--   문제가 있었다. 운영진 인터뷰(2026-06-01) 후 Aca2000 식 매트릭스
--   모델로 전환한다.
--
--   새 모델(사용자 확정):
--     1) 운영자가 차수별 설명회(crm_seminars) 를 사전에 만든다.
--     2) 발송 시 (선택한 설명회 N개) × (대상 학생 M명) → 학생당
--        invitation 1행 자동 생성, 각 invitation 에 학생 페이지 토큰
--        (nanoid 12) 1개 + 안에 N개 seminar item.
--     3) 학생별 SMS 본문 끝에 그 학생 고유 URL `/s/<token>` 박혀 발송.
--     4) 학부모가 URL 클릭 → 학생 페이지: 상단 학생명·전화 + 설명회
--        카드 N개. 각 카드 = 그 학생에게 보낸 차수 1개. [신청하기] 버튼.
--     5) 카드별 [신청하기] = 그 차수만 status='signed'. 멱등(이미 signed
--        인 카드 재클릭 무해).
--     6) 학부모는 폼 입력 없음, 클릭 1회 = 신청 완료.
--
-- 변경:
--   - DROP crm_seminars.link_token  (설명회별 공개 토큰 폐기).
--   - DROP FUNCTION lookup_seminar_by_token(text).
--   - DROP FUNCTION signup_for_seminar(text, text, text, text, text).
--   - CREATE TABLE crm_seminar_invitations          (학생 단위 페이지 토큰).
--   - CREATE TABLE crm_seminar_invitation_items     (invitation × seminar 매트릭스).
--   - CREATE FUNCTION lookup_invitation_by_token(text)
--                       반환: 학생 메타 + items 배열(jsonb).
--   - CREATE FUNCTION claim_invitation_item(text, uuid)
--                       반환: status(signed/already_signed/closed/ended/cancelled
--                              /invalid/out_of_window), item_id, reason.
--
-- 미변경:
--   - crm_seminar_signups (폼 기반 옛 테이블) — 과거 데이터 보존을 위해
--     테이블·기존 RLS 그대로 둠. 새 흐름에선 더 이상 INSERT/UPDATE 하지
--     않는다. 향후 별도 마이그에서 정리(아카이브 또는 DROP).
--
-- 의존성:
--   - 0049 RLS 헬퍼: is_master(), can_read_branch(t), can_write_branch(t).
--   - 0080 crm_seminars (link_token 제외한 다른 컬럼은 그대로 사용).
--
-- 권한 모델:
--   - crm_seminar_invitations / invitation_items 의 테이블 SELECT/UPDATE 는
--     master/admin(분원) 만. anon 차단.
--   - 학부모 페이지·신청은 lookup_invitation_by_token / claim_invitation_item
--     RPC(SECURITY DEFINER) 만 통과 가능.
--   - 학생 메타(이름·전화)는 학부모 본인 화면 노출 의도이므로 RPC 반환에
--     포함(마스킹 X). 토큰(72bit 엔트로피) 보유 = 학부모 본인 가정.
--
-- 롤백:
--   BEGIN;
--   DROP FUNCTION public.claim_invitation_item(text, uuid);
--   DROP FUNCTION public.lookup_invitation_by_token(text);
--   DROP TABLE   public.crm_seminar_invitation_items;
--   DROP TABLE   public.crm_seminar_invitations;
--   ALTER TABLE  public.crm_seminars ADD COLUMN link_token text;
--   CREATE UNIQUE INDEX crm_seminars_link_token_key ON public.crm_seminars(link_token);
--   -- (0080·0081 RPC 본문은 git history 에서 복원)
--   COMMIT;
-- ============================================================

BEGIN;

-- ─── 0) 옛 모델 정리 ──────────────────────────────────────────
-- 학부모 폼 RPC 와 설명회별 토큰 폐기. 데이터 손실: link_token 값 자체.
-- crm_seminar_signups 테이블은 보존(과거 신청 이력 감사용).

DROP FUNCTION IF EXISTS public.signup_for_seminar(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.lookup_seminar_by_token(text);

-- link_token 컬럼 DROP. UNIQUE 제약·인덱스도 함께 사라진다.
ALTER TABLE public.crm_seminars DROP COLUMN IF EXISTS link_token;

-- ─── 1) crm_seminar_invitations — 학생 단위 페이지 토큰 ──────
-- 한 학생에게 1번 발송하면 1행 생성. 토큰 1개가 학생 페이지 1개.
-- 같은 학생에게 다른 캠페인으로 재발송하면 새 invitation 행이 추가된다.
CREATE TABLE public.crm_seminar_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch       text NOT NULL,
  student_id   uuid NOT NULL REFERENCES public.crm_students(id) ON DELETE CASCADE,
  link_token   text NOT NULL UNIQUE,
  campaign_id  uuid,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.crm_seminar_invitations IS
  '설명회 초대(학생 단위 페이지). 학생당 발송 1회 = 1행. '
  'link_token 으로 학부모가 /s/<token> 접근. invitation_items 에 카드 N개 매달림. '
  '폼 기반 옛 모델(crm_seminar_signups)을 대체하는 새 모델 — 0080 의 '
  'crm_seminars.link_token / lookup_seminar_by_token / signup_for_seminar 폐기와 함께 도입.';

COMMENT ON COLUMN public.crm_seminar_invitations.id IS '초대 PK (UUID).';
COMMENT ON COLUMN public.crm_seminar_invitations.branch IS
  '분원 (대치/송도/반포/방배). RLS 격리 기준 — 학생의 분원과 동일하게 채워야 한다(app 책임).';
COMMENT ON COLUMN public.crm_seminar_invitations.student_id IS
  '학생 FK (crm_students.id). 학생 삭제 시 함께 삭제(ON DELETE CASCADE) — 학부모 페이지도 자동 무효화.';
COMMENT ON COLUMN public.crm_seminar_invitations.link_token IS
  '학부모 공개 URL 토큰 (nanoid 12, URL-safe). UNIQUE. ~72bit 엔트로피 추측 차단. '
  '서버에서 INSERT 시점에 생성 — 외부 지정 금지.';
COMMENT ON COLUMN public.crm_seminar_invitations.campaign_id IS
  '이 invitation 을 만들어 발송한 캠페인 id(crm_campaigns.id reference). 추적·집계용. '
  'FK 없음(캠페인 삭제 시 invitation 은 살려두어 학부모 페이지 깨지지 않게).';
COMMENT ON COLUMN public.crm_seminar_invitations.created_by IS
  '생성자(auth.users.id reference, FK 없음 — 감사용). NULL 허용.';
COMMENT ON COLUMN public.crm_seminar_invitations.created_at IS '생성 시각(UTC).';

CREATE INDEX crm_seminar_invitations_student_created_idx
  ON public.crm_seminar_invitations (student_id, created_at DESC);
-- link_token UNIQUE 제약이 이미 인덱스 생성함.

-- ─── 2) crm_seminar_invitation_items — 카드 N개 ──────────────
-- invitation × seminar 매트릭스. 학생 페이지에 표시될 설명회 카드들.
CREATE TABLE public.crm_seminar_invitation_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id  uuid NOT NULL REFERENCES public.crm_seminar_invitations(id) ON DELETE CASCADE,
  seminar_id     uuid NOT NULL REFERENCES public.crm_seminars(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','signed','cancelled')),
  signed_at      timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid,
  CONSTRAINT crm_seminar_invitation_items_unique_pair
    UNIQUE (invitation_id, seminar_id),
  CONSTRAINT crm_seminar_invitation_items_signed_consistency_chk
    CHECK (
      (status = 'signed'    AND signed_at IS NOT NULL)
      OR (status <> 'signed' AND signed_at IS NULL)
    ),
  CONSTRAINT crm_seminar_invitation_items_cancelled_consistency_chk
    CHECK (
      (status = 'cancelled'    AND cancelled_at IS NOT NULL)
      OR (status <> 'cancelled' AND cancelled_at IS NULL)
    )
);

COMMENT ON TABLE public.crm_seminar_invitation_items IS
  'invitation 의 카드들. 각 행 = "이 학생에게 이 설명회를 안내했고, 학부모가 그 카드의 [신청하기] 를 눌렀는지" 상태. '
  '(invitation_id, seminar_id) UNIQUE — 같은 학생 페이지 안에 같은 설명회 카드 중복 차단.';

COMMENT ON COLUMN public.crm_seminar_invitation_items.id IS '카드 PK (UUID).';
COMMENT ON COLUMN public.crm_seminar_invitation_items.invitation_id IS
  '소속 invitation FK. invitation 삭제 시 함께 삭제(ON DELETE CASCADE).';
COMMENT ON COLUMN public.crm_seminar_invitation_items.seminar_id IS
  '설명회 FK. crm_seminars 삭제 시 함께 삭제(ON DELETE CASCADE).';
COMMENT ON COLUMN public.crm_seminar_invitation_items.status IS
  '카드 상태 enum — pending(미신청 기본) / signed(학부모가 신청 클릭) / cancelled(운영자 취소).';
COMMENT ON COLUMN public.crm_seminar_invitation_items.signed_at IS
  '학부모가 [신청하기] 를 누른 시각. status=signed 이면 NOT NULL, 그 외 NULL(CHECK).';
COMMENT ON COLUMN public.crm_seminar_invitation_items.cancelled_at IS
  '운영자가 신청을 취소한 시각. status=cancelled 이면 NOT NULL, 그 외 NULL(CHECK).';
COMMENT ON COLUMN public.crm_seminar_invitation_items.cancelled_by IS
  '취소한 운영자(auth.users.id reference, FK 없음 — 감사 메타). NULL 허용.';

-- 어드민 명단 조회용 — 설명회별 신청자 목록 (signed 기준 최신순).
CREATE INDEX crm_seminar_invitation_items_seminar_status_signed_idx
  ON public.crm_seminar_invitation_items (seminar_id, status, signed_at DESC);

-- 신청자 수 카운트 가속 (부분 인덱스 — signed 행만).
CREATE INDEX crm_seminar_invitation_items_signed_partial_idx
  ON public.crm_seminar_invitation_items (seminar_id)
  WHERE status = 'signed';

-- ─── 3) RLS ───────────────────────────────────────────────────
ALTER TABLE public.crm_seminar_invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_seminar_invitation_items  ENABLE ROW LEVEL SECURITY;

-- invitations: 읽기 = master 전사 / admin·manager·viewer 본인 분원.
CREATE POLICY crm_seminar_invitations_read_branch ON public.crm_seminar_invitations
  FOR SELECT TO authenticated
  USING (public.can_read_branch(branch));

CREATE POLICY crm_seminar_invitations_write_branch ON public.crm_seminar_invitations
  FOR ALL TO authenticated
  USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

COMMENT ON POLICY crm_seminar_invitations_read_branch ON public.crm_seminar_invitations IS
  'invitation 읽기 — master 전사 / admin·manager·viewer 본인 분원. anon 차단. '
  'anon 의 학부모 페이지 조회는 lookup_invitation_by_token RPC(SECURITY DEFINER)로 우회.';
COMMENT ON POLICY crm_seminar_invitations_write_branch ON public.crm_seminar_invitations IS
  'invitation 쓰기 — master + admin(본인 분원) 만. manager/viewer 차단. '
  'anon 의 학부모 클릭(items.status UPDATE)은 claim_invitation_item RPC 만 가능.';

-- items: 읽기는 invitation 의 분원 권한, 쓰기는 master/admin(취소만 일반 운영).
-- INSERT 는 invitation 생성 트랜잭션이 SECURITY DEFINER 또는 service-role 로 수행.
CREATE POLICY crm_seminar_invitation_items_read_branch ON public.crm_seminar_invitation_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_seminar_invitations inv
      WHERE inv.id = crm_seminar_invitation_items.invitation_id
        AND public.can_read_branch(inv.branch)
    )
  );

CREATE POLICY crm_seminar_invitation_items_update_branch ON public.crm_seminar_invitation_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_seminar_invitations inv
      WHERE inv.id = crm_seminar_invitation_items.invitation_id
        AND public.can_write_branch(inv.branch)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.crm_seminar_invitations inv
      WHERE inv.id = crm_seminar_invitation_items.invitation_id
        AND public.can_write_branch(inv.branch)
    )
  );

COMMENT ON POLICY crm_seminar_invitation_items_read_branch ON public.crm_seminar_invitation_items IS
  '카드 읽기 — invitation 의 분원 권한 따라감. master 전사 / admin·manager·viewer 본인 분원.';
COMMENT ON POLICY crm_seminar_invitation_items_update_branch ON public.crm_seminar_invitation_items IS
  '카드 UPDATE (운영자 취소) — master + admin 본인 분원. '
  '학부모의 [신청하기] 는 claim_invitation_item RPC(SECURITY DEFINER) 만 가능 — '
  '일반 INSERT/UPDATE 정책 없음(기본 거부).';

-- INSERT/DELETE 정책 없음 → 기본 거부. items INSERT 는 invitation 생성 액션이
-- service-role 또는 별도 SECURITY DEFINER 헬퍼로 일괄 적재.

-- ─── 4) lookup_invitation_by_token(text) RPC ─────────────────
-- 학부모 공개 페이지(/s/<token>) 가 호출. anon 권한. SECURITY DEFINER 로 RLS 우회.
-- 반환: 1행 또는 0행. items 는 jsonb 배열(각 원소 = 카드 1개 메타+상태).
CREATE OR REPLACE FUNCTION public.lookup_invitation_by_token(p_token text)
RETURNS TABLE (
  invitation_id  uuid,
  student_id     uuid,
  student_name   text,
  parent_phone   text,
  branch         text,
  items          jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    inv.id                  AS invitation_id,
    inv.student_id          AS student_id,
    stu.name                AS student_name,
    stu.parent_phone        AS parent_phone,
    inv.branch              AS branch,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'item_id',     it.id,
            'seminar_id',  sm.id,
            'name',        sm.name,
            'description', sm.description,
            'held_at',     sm.held_at,
            'venue',       sm.venue,
            'status',      it.status,
            'signed_at',   it.signed_at
          )
          ORDER BY sm.held_at NULLS LAST, sm.name
        )
        FROM public.crm_seminar_invitation_items it
        JOIN public.crm_seminars sm ON sm.id = it.seminar_id
        WHERE it.invitation_id = inv.id
      ),
      '[]'::jsonb
    ) AS items
  FROM public.crm_seminar_invitations inv
  JOIN public.crm_students stu ON stu.id = inv.student_id
  WHERE inv.link_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_invitation_by_token(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_invitation_by_token(text) IS
  '학부모 공개 페이지(/s/<token>) 가 호출하는 invitation 메타 조회. '
  '반환 1행 = 학생 메타(이름·전화·분원) + items jsonb 배열(카드 N개). '
  '존재하지 않으면 0행. status=cancelled 인 카드도 노출(화면에서 회색 처리).';

-- ─── 5) claim_invitation_item(text, uuid) RPC ───────────────
-- 학부모가 카드별 [신청하기] 클릭 시 호출. anon 권한.
-- 트랜잭션·row-lock. 정원·창·취소 검증을 함수 내부에서 수행.
-- 반환 status 가능 값:
--   'signed'         : 정상 접수(이번 클릭으로 status 가 pending → signed)
--   'already_signed' : 이미 signed (멱등 — 학부모 재클릭 무해)
--   'closed'         : 정원 마감
--   'ended'          : 행사 종료
--   'cancelled'      : 설명회 또는 카드가 취소됨
--   'invalid'        : 토큰 또는 (token, seminar) 매치 실패
--   'out_of_window'  : 신청 창 밖
CREATE OR REPLACE FUNCTION public.claim_invitation_item(
  p_token      text,
  p_seminar_id uuid
)
RETURNS TABLE (
  status   text,
  item_id  uuid,
  reason   text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id          uuid;
  v_seminar         public.crm_seminars%ROWTYPE;
  v_item            public.crm_seminar_invitation_items%ROWTYPE;
  v_now             timestamptz := now();
  v_signed_count    integer;
BEGIN
  -- 0) 입력 sanity.
  IF p_token IS NULL OR length(btrim(p_token)) = 0 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '유효하지 않은 링크입니다'::text;
    RETURN;
  END IF;
  IF p_seminar_id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '설명회 정보가 누락되었습니다'::text;
    RETURN;
  END IF;

  -- 1) invitation lookup by token.
  SELECT inv.id INTO v_inv_id
  FROM public.crm_seminar_invitations inv
  WHERE inv.link_token = p_token
  LIMIT 1;

  IF v_inv_id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '유효하지 않은 링크입니다'::text;
    RETURN;
  END IF;

  -- 2) item lookup by (invitation_id, seminar_id) + row lock.
  --    "이 학생에게 안 보낸 설명회" 거부.
  SELECT * INTO v_item
  FROM public.crm_seminar_invitation_items it
  WHERE it.invitation_id = v_inv_id
    AND it.seminar_id    = p_seminar_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '이 설명회는 신청 대상이 아닙니다'::text;
    RETURN;
  END IF;

  -- 3) 멱등: 이미 signed.
  IF v_item.status = 'signed' THEN
    RETURN QUERY SELECT 'already_signed'::text, v_item.id, NULL::text;
    RETURN;
  END IF;

  -- 4) 운영자가 취소한 카드.
  IF v_item.status = 'cancelled' THEN
    RETURN QUERY SELECT 'cancelled'::text, v_item.id, '취소된 신청입니다'::text;
    RETURN;
  END IF;

  -- 5) seminar 조회 + 동시성 정원 검증을 위한 row lock.
  SELECT * INTO v_seminar
  FROM public.crm_seminars sm
  WHERE sm.id = p_seminar_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- FK 가 있으므로 사실상 발생 X. 방어.
    RETURN QUERY SELECT 'invalid'::text, v_item.id, '설명회 정보를 찾을 수 없습니다'::text;
    RETURN;
  END IF;

  -- 6) 설명회 상태별 조기 종료.
  IF v_seminar.status = 'cancelled' THEN
    RETURN QUERY SELECT 'cancelled'::text, v_item.id, '취소된 설명회입니다'::text;
    RETURN;
  END IF;
  IF v_seminar.status = 'ended' THEN
    RETURN QUERY SELECT 'ended'::text, v_item.id, '종료된 설명회입니다'::text;
    RETURN;
  END IF;

  -- 7) 신청 창 검증.
  IF v_seminar.signup_opens_at IS NOT NULL AND v_now < v_seminar.signup_opens_at THEN
    RETURN QUERY SELECT 'out_of_window'::text, v_item.id, '신청 시작 전입니다'::text;
    RETURN;
  END IF;
  IF v_seminar.signup_closes_at IS NOT NULL AND v_now > v_seminar.signup_closes_at THEN
    RETURN QUERY SELECT 'out_of_window'::text, v_item.id, '신청이 마감되었습니다'::text;
    RETURN;
  END IF;

  IF v_seminar.status = 'closed' THEN
    RETURN QUERY SELECT 'closed'::text, v_item.id, '정원이 마감되었습니다'::text;
    RETURN;
  END IF;

  -- 8) 정원 검증 (다른 학생이 먼저 채웠을 수 있음).
  --    capacity 가 NULL 이면 무제한.
  IF v_seminar.capacity IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_signed_count
    FROM public.crm_seminar_invitation_items it
    WHERE it.seminar_id = p_seminar_id
      AND it.status     = 'signed';

    IF v_signed_count >= v_seminar.capacity THEN
      -- 정원 도달 → seminar 도 closed 로 전이(다음 클릭부터 6번에서 차단).
      IF v_seminar.status = 'open' THEN
        UPDATE public.crm_seminars sm2
           SET status = 'closed'
         WHERE sm2.id     = p_seminar_id
           AND sm2.status = 'open';
      END IF;
      RETURN QUERY SELECT 'closed'::text, v_item.id, '정원이 마감되었습니다'::text;
      RETURN;
    END IF;
  END IF;

  -- 9) pending → signed.
  UPDATE public.crm_seminar_invitation_items it
     SET status    = 'signed',
         signed_at = v_now
   WHERE it.id = v_item.id;

  -- 10) 이번 신청으로 정원 도달이면 seminar.status='closed' 전이.
  IF v_seminar.capacity IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_signed_count
    FROM public.crm_seminar_invitation_items it
    WHERE it.seminar_id = p_seminar_id
      AND it.status     = 'signed';

    IF v_signed_count >= v_seminar.capacity AND v_seminar.status = 'open' THEN
      UPDATE public.crm_seminars sm2
         SET status = 'closed'
       WHERE sm2.id     = p_seminar_id
         AND sm2.status = 'open';
    END IF;
  END IF;

  RETURN QUERY SELECT 'signed'::text, v_item.id, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invitation_item(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_invitation_item(text, uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.claim_invitation_item(text, uuid) IS
  '학부모 [신청하기] 클릭 1건 처리(SECURITY DEFINER, row-lock). '
  '반환 status: signed(정상 접수) / already_signed(멱등) / closed(정원마감) / '
  'ended(행사종료) / cancelled(설명회·카드 취소) / invalid(토큰·매핑 오류) / '
  'out_of_window(신청 창 밖). 이번 신청으로 정원 도달이면 seminar.status=closed 자동 전이.';

COMMIT;
