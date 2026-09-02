-- ============================================================
-- 0131_aca_sms_log_import.sql
-- 아카(Aca2000) 문자 발송 원본 적재용 테이블 2종.
-- ------------------------------------------------------------
-- 배경 (2026-09-02, 정책비 기획안):
--   CRM 경유 발송(crm_campaigns)은 2026-06-04 부터, 그것도 대치 문자비의 절반뿐이다.
--   나머지 절반 이상이 아카2000 에서 나갔고 그 내역은 DB 에 없었다. 아카에서 뽑은
--   MDB 익스포트 9개를 병합해 여기에 담는다.
--
--   병합 실측: 원본 3,965,945행 → T_ID 중복 제거 후 2,063,033행 (48% 가 중복).
--   MDB 파일 4개는 다른 파일에 100% 포함돼 신규 기여가 0이었다.
--   커버리지 2026-06-16 ~ 09-02, 79일 연속 (빠진 날 0일).
--   ⚠️ 1~5월분을 담았어야 할 LMS_20260101_20260902.mdb 는 빈 파일이라 그 기간은 없다.
--
-- 왜 테이블이 둘인가 — 본문 분리:
--   대량 발송이라 같은 문구가 수천 명에게 나간다. 실측 고유 본문은 전체의 3.6%
--   (2,063,033행 → 73,724건). 본문을 인라인으로 두면 약 4GB, 분리하면 608MB 다.
--   본문은 aca_sms_bodies 에 한 번만 두고 메시지는 body_hash 로 참조한다.
--
-- 적재:
--   \copy public.aca_sms_bodies   (body_hash, body, char_len) FROM 'db_bodies.csv'   CSV HEADER
--   \copy public.aca_sms_messages (...)                       FROM 'db_messages.csv' CSV HEADER
--   (본문 → 메시지 순서. FK 때문에 역순이면 실패한다)
--
-- 이 테이블은 ETL 이 관리하지 않는다. 수동 1회성 적재이며, 새 기간을 넣으려면
-- 같은 방식으로 MDB 를 뽑아 T_ID 기준 UPSERT 한다.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.aca_sms_messages;
--   DROP TABLE IF EXISTS public.aca_sms_bodies;
-- ============================================================

BEGIN;

-- ─── 1) 본문 사전 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aca_sms_bodies (
  body_hash  text    PRIMARY KEY,
  body       text    NOT NULL,
  char_len   integer NOT NULL
);

COMMENT ON TABLE  public.aca_sms_bodies IS
  '아카 문자 본문 사전. 같은 문구가 수천 건에 반복되므로 본문을 여기 한 번만 두고 aca_sms_messages 가 body_hash 로 참조한다. 실측 2,063,033건 → 고유 73,724건(3.6%). 0131.';
COMMENT ON COLUMN public.aca_sms_bodies.body_hash IS '본문 원문의 SHA-1 16진 문자열. aca_sms_messages.body_hash 의 참조 대상.';
COMMENT ON COLUMN public.aca_sms_bodies.body      IS '문자 본문 원문(아카 메시지내용 컬럼). 광고 표기·수신거부 문구가 이미 포함된 실제 발송 문구다.';
COMMENT ON COLUMN public.aca_sms_bodies.char_len  IS '본문 글자 수. 바이트가 아니라 문자 수이며 SMS/LMS 판정용이 아니라 분포 파악용이다.';

-- ─── 2) 메시지 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aca_sms_messages (
  t_id                 text PRIMARY KEY,
  sent_on              date,
  sent_time            text,
  sender_name          text,
  student_name         text,
  phone                text,
  school               text,
  grade_raw            text,
  msg_type             text,
  subject              text,
  body_hash            text REFERENCES public.aca_sms_bodies(body_hash),
  reply_number         text,
  branch               text,
  division             text,
  result               text,
  carrier_accepted_at  text,
  carrier_responded_at text,
  source_file          text,
  imported_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.aca_sms_messages IS
  '아카2000 문자 발송 원본 1건 = 1행. MDB 익스포트 9개를 T_ID 기준으로 중복 제거해 적재. 커버리지 2026-06-16~09-02(79일 연속). 1~5월분은 원본 MDB 가 비어 있어 없다. ETL 이 관리하지 않는 수동 적재본. 0131.';

COMMENT ON COLUMN public.aca_sms_messages.t_id                 IS '아카가 부여한 메시지 고유번호. MDB 여러 개를 합칠 때 이 값으로 중복을 제거했다.';
COMMENT ON COLUMN public.aca_sms_messages.sent_on              IS '발송일 (아카 날짜 컬럼).';
COMMENT ON COLUMN public.aca_sms_messages.sent_time            IS '발송 예약 시각 문자열(HH:MM:SS). 실제 전송 완료는 carrier_responded_at 을 볼 것.';
COMMENT ON COLUMN public.aca_sms_messages.sender_name          IS '보낸 사람 이름(아카 보낸이). 원장·행정팀 등 계정 표시명이다.';
COMMENT ON COLUMN public.aca_sms_messages.student_name         IS '수신 학생 이름.';
COMMENT ON COLUMN public.aca_sms_messages.phone                IS '수신 번호(대부분 학부모 연락처). 개인정보 — 로그·화면 노출 시 010-****-1234 로 마스킹할 것.';
COMMENT ON COLUMN public.aca_sms_messages.school               IS '수신 학생의 학교명(발송 시점 아카 기준).';
COMMENT ON COLUMN public.aca_sms_messages.grade_raw            IS '아카 원본 학년 코드 문자열. crm_students.grade 처럼 정규화되어 있지 않다.';
COMMENT ON COLUMN public.aca_sms_messages.msg_type             IS '메시지 구분(LMS/SMS 등). 적재분은 전량 LMS.';
COMMENT ON COLUMN public.aca_sms_messages.subject              IS '문자 제목.';
COMMENT ON COLUMN public.aca_sms_messages.body_hash            IS 'aca_sms_bodies 참조 키. 본문 원문은 그 테이블에 있다.';
COMMENT ON COLUMN public.aca_sms_messages.reply_number         IS '회신(발신)번호 원문. 이 값으로 분원·발신 division 을 해석했다.';
COMMENT ON COLUMN public.aca_sms_messages.branch               IS 'reply_number 로 해석한 분원. 매핑에 없는 번호(개인 휴대폰 등)는 NULL.';
COMMENT ON COLUMN public.aca_sms_messages.division             IS 'reply_number 로 해석한 발신 division(본원/수학관 등). 매핑에 없으면 NULL.';
COMMENT ON COLUMN public.aca_sms_messages.result               IS '발송 결과(성공/실패 등) 아카 원문.';
COMMENT ON COLUMN public.aca_sms_messages.carrier_accepted_at  IS '이동통신사 접수 시각 원문 문자열. 파싱하지 않고 원문 보존.';
COMMENT ON COLUMN public.aca_sms_messages.carrier_responded_at IS '이동통신사 응답 시각 원문 문자열. 실제 전송 완료 시점으로 볼 수 있다.';
COMMENT ON COLUMN public.aca_sms_messages.source_file          IS '이 행이 처음 등장한 MDB 파일명. 중복 제거 시 먼저 읽힌 파일이 기록된다.';
COMMENT ON COLUMN public.aca_sms_messages.imported_at          IS '이 행이 DB 에 적재된 시각.';

CREATE INDEX IF NOT EXISTS idx_aca_sms_sent_on ON public.aca_sms_messages (sent_on);
CREATE INDEX IF NOT EXISTS idx_aca_sms_sender  ON public.aca_sms_messages (sender_name);
CREATE INDEX IF NOT EXISTS idx_aca_sms_branch  ON public.aca_sms_messages (branch, sent_on);
CREATE INDEX IF NOT EXISTS idx_aca_sms_body    ON public.aca_sms_messages (body_hash);
CREATE INDEX IF NOT EXISTS idx_aca_sms_phone   ON public.aca_sms_messages (phone);

-- ─── 3) RLS ────────────────────────────────────────────────
-- 학부모 연락처가 담기고 분원이 섞여 있다. 분원 권한이 있으면 그 분원 행만,
-- 분원 해석이 안 된 행(branch NULL)은 마스터만 본다.
ALTER TABLE public.aca_sms_bodies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aca_sms_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aca_sms_bodies_read ON public.aca_sms_bodies;
CREATE POLICY aca_sms_bodies_read ON public.aca_sms_bodies
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.crm_users_profile up
    WHERE up.user_id = (SELECT auth.uid()) AND up.active = true));

DROP POLICY IF EXISTS aca_sms_messages_read ON public.aca_sms_messages;
CREATE POLICY aca_sms_messages_read ON public.aca_sms_messages
  FOR SELECT USING (
    (branch IS NOT NULL AND can_read_branch(branch)) OR is_master());

COMMIT;
