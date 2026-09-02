-- ============================================================
-- 0132_send_analysis_all.sql
-- CRM + 아카2000 통합 발송 분석 테이블.
-- ------------------------------------------------------------
-- 배경 (2026-09-02, 정책비 기획안):
--   0130 의 crm_send_analysis 는 CRM 경유 발송(436건)만 담아 대치 문자비의 절반만
--   보였다. 0131 로 아카 원본(2,063,033건)을 적재했으니 둘을 한 축으로 합친다.
--
-- 이중계상이 아닌 근거 (실측):
--   같은 (날짜, 번호) 쌍이 426,961개 겹치지만, 본문을 공백·기호 제거 후 앞 60자로
--   대조하면 CRM 본문 307종 중 아카에도 있는 것은 7종뿐이다. 즉 겹친 쌍은 "같은
--   학부모가 하루에 CRM 문자와 아카 문자를 각각 받은" 경우이지 같은 문자가 아니다.
--   → 두 소스를 합산해도 비용이 두 번 세어지지 않는다.
--   ⚠️ 반대로, 학부모 체감 수신량은 어느 한쪽만 볼 때보다 많다.
--
-- 그레인:
--   한 행 = (발송 건 × 강사). crm_send_analysis 와 동일하다.
--     CRM  : 발송 건 = 캠페인 1건
--     아카 : 발송 건 = (발송일, 보낸이, division, 제목, 본문) 묶음
--            실측 2,063,033 메시지 → 83,136 발송 건
--
-- 금액:
--   CRM  = crm_campaigns.total_cost (실제 청구액)
--   아카 = 수신자 수 × 24원 (LMS 단가). 아카 원본에 금액 컬럼이 없어 추정치다.
--          적재분은 msg_type 전량 LMS 라 단가 혼용 문제는 없다.
--   금액_배분 = 금액 ÷ 강사수. 어떻게 group by 해도 합계가 총액과 일치한다.
--   ⚠️ 금액 컬럼은 강사별로 반복되므로 그대로 SUM 하면 부풀려진다.
--
-- 발송성격 (아카는 마케팅과 일상 운영이 섞여 있어 반드시 분리해서 볼 것):
--   대량홍보 3,000명+ / 중량 1,000~3,000 / 소량 300~1,000 / 소규모 50~300 / 개별 50 미만
--   실측 아카 83,136건 중 82,455건이 '개별'(결제알림·상담 등)이고,
--   '대량홍보' 298건이 아카 전체 수신의 81%(1,674,410건)를 차지한다.
--
-- 학년·학교 판정 (양쪽 동일 규칙):
--   실제 수신자의 99% 이상이 한 학년이면 그 학년, 아니면 'ALL'
--   실제 수신자의 90% 이상이 한 학교면 그 학교, 아니면 'ALL'
--   CRM  : crm_messages → crm_students 로 역산
--   아카 : aca_sms_messages 의 school·grade_raw 사용. grade_raw 는 '3'이 고3·중3
--          양쪽이라 모호하므로 학교명으로 급(고/중)을 먼저 가른다(실측 99.1% 판별).
--
-- 갱신: SELECT public.rebuild_send_analysis_all();
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.rebuild_send_analysis_all();
--   DROP TABLE IF EXISTS public.send_analysis_all;
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.send_analysis_all (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  출처          text        NOT NULL,
  발송키        text        NOT NULL,
  branch        text,
  division      text,
  보낸사람      text,
  전송일        date        NOT NULL,
  요일          text        NOT NULL,
  제목          text,
  강좌          text,
  과목          text        NOT NULL,
  유형          text        NOT NULL,
  발송성격      text        NOT NULL,
  강사          text,
  강사수        integer     NOT NULL,
  학년          text        NOT NULL,
  학교          text        NOT NULL,
  대상수        integer     NOT NULL,
  금액          integer     NOT NULL,
  금액_배분     numeric(14,2) NOT NULL,
  금액추정여부  boolean     NOT NULL,
  생성시각      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.send_analysis_all IS
  'CRM(crm_campaigns) + 아카2000(aca_sms_messages) 통합 발송 분석 스냅샷. 한 행 = 발송 건 × 강사. 두 소스는 본문 대조 결과 사실상 겹치지 않아 합산해도 이중계상이 아니다. rebuild_send_analysis_all() 로 재생성. 0132.';

COMMENT ON COLUMN public.send_analysis_all.출처         IS '''CRM''(CRM 경유 발송) 또는 ''ACA''(아카2000 발송).';
COMMENT ON COLUMN public.send_analysis_all.발송키       IS '발송 건 식별자. CRM 은 캠페인 uuid, 아카는 (발송일|보낸이|division|제목|본문해시) 조합 문자열.';
COMMENT ON COLUMN public.send_analysis_all.branch       IS '분원. 아카는 회신번호로 해석하며 매핑 실패 시 NULL.';
COMMENT ON COLUMN public.send_analysis_all.division     IS '발신 division. 아카는 회신번호로 해석한다 — 025670606=본원 / 0262651010=수학관 / 025531010=독학관. CRM 은 crm_campaigns.sender_division 그대로이며 미기록분은 NULL.';
COMMENT ON COLUMN public.send_analysis_all.보낸사람     IS '발송한 사람. CRM 은 계정 표시명, 아카는 보낸이 컬럼.';
COMMENT ON COLUMN public.send_analysis_all.전송일       IS '발송일. CRM 은 KST 변환값, 아카는 원본 날짜.';
COMMENT ON COLUMN public.send_analysis_all.요일         IS '전송일의 한글 요일(월~일). 발송 루틴 분석용.';
COMMENT ON COLUMN public.send_analysis_all.제목         IS '문자 제목 원문.';
COMMENT ON COLUMN public.send_analysis_all.강좌         IS '제목에서 머리기호·괄호 날짜·꼬리말을 걷어낸 강좌 표기. 여러 강좌를 묶은 문자면 묶음 이름 그대로다.';
COMMENT ON COLUMN public.send_analysis_all.과목         IS '제목 기준 과목: 국어/영어/수학/과학/사회/기타.';
COMMENT ON COLUMN public.send_analysis_all.유형         IS '방학특강/내신대비/수능정시/정규개강/설명회/기타.';
COMMENT ON COLUMN public.send_analysis_all.발송성격     IS '대상 규모 구간: 대량홍보(3000+)/중량(1000~3000)/소량(300~1000)/소규모(50~300)/개별(50미만). 아카는 개별 발송(결제알림·상담)이 대부분이라 마케팅 분석 시 반드시 필터할 것.';
COMMENT ON COLUMN public.send_analysis_all.강사         IS '본문에서 추출한 강사명(`홍길동T` 패턴). 한 발송에 여러 명이면 행이 나뉜다. 못 뽑으면 NULL.';
COMMENT ON COLUMN public.send_analysis_all.강사수       IS '해당 발송 본문에 등장한 강사 수. 금액_배분의 분모. 미추출이면 1.';
COMMENT ON COLUMN public.send_analysis_all.학년         IS '실제 수신자의 99% 이상이 한 학년이면 그 학년(고1/고2/고3/중3(예비고1) 등), 아니면 ''ALL''.';
COMMENT ON COLUMN public.send_analysis_all.학교         IS '실제 수신자의 90% 이상이 한 학교면 그 학교명, 아니면 ''ALL''.';
COMMENT ON COLUMN public.send_analysis_all.대상수       IS '발송 대상 수. CRM 은 total_recipients, 아카는 그 묶음의 메시지 수.';
COMMENT ON COLUMN public.send_analysis_all.금액         IS '발송 건의 총비용(원). ⚠️ 강사별로 같은 값이 반복되므로 그대로 SUM 하면 부풀려진다. 집계에는 금액_배분을 쓸 것.';
COMMENT ON COLUMN public.send_analysis_all."금액_배분"  IS '금액 ÷ 강사수. 어떤 기준으로 group by 해도 합계가 실제 총액과 일치한다.';
COMMENT ON COLUMN public.send_analysis_all.금액추정여부 IS 'true = 아카(수신자수 × LMS 24원 추정), false = CRM(실제 청구액).';
COMMENT ON COLUMN public.send_analysis_all.생성시각     IS '이 스냅샷 행이 만들어진 시각.';

CREATE INDEX IF NOT EXISTS idx_saa_date    ON public.send_analysis_all (전송일);
CREATE INDEX IF NOT EXISTS idx_saa_src     ON public.send_analysis_all (출처, 발송성격);
CREATE INDEX IF NOT EXISTS idx_saa_teacher ON public.send_analysis_all (강사);
CREATE INDEX IF NOT EXISTS idx_saa_gs      ON public.send_analysis_all (학년, 과목);
CREATE INDEX IF NOT EXISTS idx_saa_key     ON public.send_analysis_all (발송키);

ALTER TABLE public.send_analysis_all ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saa_read ON public.send_analysis_all;
CREATE POLICY saa_read ON public.send_analysis_all
  FOR SELECT USING ((branch IS NOT NULL AND can_read_branch(branch)) OR is_master());

-- ─── 재생성 함수 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rebuild_send_analysis_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('statement_timeout', '900s', true);

  -- 대상 규모 → 발송성격. 양쪽 소스에 같은 기준을 쓴다.
  CREATE TEMP TABLE _kind(lo int, label text) ON COMMIT DROP;
  INSERT INTO _kind VALUES (3000,'대량홍보'),(1000,'중량'),(300,'소량'),(50,'소규모'),(0,'개별');

  ------------------------------------------------------------------
  -- A. CRM 측
  ------------------------------------------------------------------
  CREATE TEMP TABLE _crm ON COMMIT DROP AS
  SELECT c.id::text AS key, c.branch, c.sender_division AS division,
         p.name AS sender, c.title, c.body,
         (COALESCE(c.sent_at, c.created_at) AT TIME ZONE 'Asia/Seoul')::date AS d,
         c.total_recipients AS r, c.total_cost AS cost
  FROM public.crm_campaigns c
  LEFT JOIN public.crm_users_profile p ON p.user_id = c.created_by
  WHERE c.is_test = false AND c.status = '완료';

  -- 수신자 역산 (학년·학교)
  CREATE TEMP TABLE _crm_aud ON COMMIT DROP AS
  WITH g AS (
    SELECT m.campaign_id cid, s.grade, count(*) n
    FROM public.crm_messages m JOIN public.crm_students s ON s.id = m.student_id
    WHERE m.campaign_id IN (SELECT key::uuid FROM _crm) GROUP BY 1,2),
  gg AS (SELECT cid, sum(n) tot, max(n) top_n, (array_agg(grade ORDER BY n DESC))[1] tg FROM g GROUP BY 1),
  sc AS (
    SELECT m.campaign_id cid, s.school, count(*) n
    FROM public.crm_messages m JOIN public.crm_students s ON s.id = m.student_id
    WHERE m.campaign_id IN (SELECT key::uuid FROM _crm) AND s.school IS NOT NULL GROUP BY 1,2),
  ss AS (SELECT cid, max(n) top_n, (array_agg(school ORDER BY n DESC))[1] tsch FROM sc GROUP BY 1)
  SELECT gg.cid::text AS key,
    CASE WHEN gg.tot>0 AND gg.top_n::numeric/gg.tot >= 0.99
         THEN CASE WHEN gg.tg='중3' THEN '중3(예비고1)' ELSE gg.tg END ELSE 'ALL' END AS grade_label,
    CASE WHEN gg.tot>0 AND COALESCE(ss.top_n,0)::numeric/gg.tot >= 0.90
         THEN ss.tsch ELSE 'ALL' END AS school_label
  FROM gg LEFT JOIN ss ON ss.cid = gg.cid;

  ------------------------------------------------------------------
  -- B. 아카 측 — (발송일, 보낸이, division, 제목, 본문) 을 한 발송 건으로 묶는다
  ------------------------------------------------------------------
  CREATE TEMP TABLE _aca ON COMMIT DROP AS
  SELECT
    a.sent_on::text||'|'||COALESCE(a.sender_name,'')||'|'||COALESCE(a.division,'')||'|'||
      COALESCE(a.subject,'')||'|'||COALESCE(a.body_hash,'') AS key,
    max(a.branch) AS branch, max(a.division) AS division,
    max(a.sender_name) AS sender, max(a.subject) AS title,
    max(b.body) AS body, a.sent_on AS d,
    count(*)::int AS r, (count(*)*24)::int AS cost
  FROM public.aca_sms_messages a
  LEFT JOIN public.aca_sms_bodies b ON b.body_hash = a.body_hash
  GROUP BY a.sent_on, a.sender_name, a.division, a.subject, a.body_hash;

  -- 학년·학교 역산. grade_raw 는 '3'이 고3·중3 양쪽이라 학교명으로 급을 먼저 가른다.
  CREATE TEMP TABLE _aca_aud ON COMMIT DROP AS
  WITH norm AS (
    SELECT
      a.sent_on::text||'|'||COALESCE(a.sender_name,'')||'|'||COALESCE(a.division,'')||'|'||
        COALESCE(a.subject,'')||'|'||COALESCE(a.body_hash,'') AS key,
      CASE
        WHEN a.grade_raw !~ '^[1-3]$' THEN NULL
        WHEN a.school ~ '고$|고등|여고' THEN '고'||a.grade_raw
        WHEN a.school ~ '중$|중학|여중' THEN
          CASE WHEN a.grade_raw='3' THEN '중3(예비고1)' ELSE '중'||a.grade_raw END
        ELSE NULL END AS g,
      NULLIF(a.school,'') AS sch
    FROM public.aca_sms_messages a),
  gg AS (
    SELECT key, count(*) tot, max(c) top_n, (array_agg(g ORDER BY c DESC))[1] tg FROM (
      SELECT key, g, count(*) c FROM norm WHERE g IS NOT NULL GROUP BY 1,2) x GROUP BY 1),
  ss AS (
    SELECT key, max(c) top_n, (array_agg(sch ORDER BY c DESC))[1] tsch, sum(c) tot FROM (
      SELECT key, sch, count(*) c FROM norm WHERE sch IS NOT NULL GROUP BY 1,2) y GROUP BY 1)
  SELECT COALESCE(gg.key, ss.key) AS key,
    CASE WHEN gg.tot>0 AND gg.top_n::numeric/gg.tot >= 0.99 THEN gg.tg ELSE 'ALL' END AS grade_label,
    CASE WHEN ss.tot>0 AND ss.top_n::numeric/ss.tot >= 0.90 THEN ss.tsch ELSE 'ALL' END AS school_label
  FROM gg FULL JOIN ss ON ss.key = gg.key;

  ------------------------------------------------------------------
  -- C. 두 소스를 같은 모양으로 합치기
  ------------------------------------------------------------------
  CREATE TEMP TABLE _u ON COMMIT DROP AS
  SELECT 'CRM' src, key, branch, division, sender, title, body, d, r, cost, false est FROM _crm
  UNION ALL
  SELECT 'ACA', key, branch, division, sender, title, body, d, r, cost, true  FROM _aca;

  CREATE TEMP TABLE _aud ON COMMIT DROP AS
  SELECT key, grade_label, school_label FROM _crm_aud
  UNION ALL SELECT key, grade_label, school_label FROM _aca_aud;
  CREATE INDEX ON _aud (key);

  CREATE TEMP TABLE _tea ON COMMIT DROP AS
  SELECT DISTINCT u.key, (regexp_matches(COALESCE(u.body,''), '([가-힣]{2,6})T[ ,\)\n]', 'g'))[1] AS teacher
  FROM _u u;
  CREATE INDEX ON _tea (key);

  DELETE FROM public.send_analysis_all;

  INSERT INTO public.send_analysis_all (
    출처, 발송키, branch, division, 보낸사람, 전송일, 요일, 제목, 강좌, 과목, 유형,
    발송성격, 강사, 강사수, 학년, 학교, 대상수, 금액, "금액_배분", 금액추정여부)
  SELECT
    u.src, u.key, u.branch, u.division, u.sender, u.d,
    CASE extract(isodow FROM u.d)
      WHEN 1 THEN '월' WHEN 2 THEN '화' WHEN 3 THEN '수' WHEN 4 THEN '목'
      WHEN 5 THEN '금' WHEN 6 THEN '토' ELSE '일' END,
    u.title,
    NULLIF(btrim(regexp_replace(regexp_replace(regexp_replace(
      COALESCE(u.title,''), '^[■♠\[\]]+\s*',''), '\([^)]*\)',''),
      '\s*(안내|개강|모집|공지)\s*$','')), ''),
    CASE
      WHEN u.title ~ '통합과학|통과|물리|화학|생명|지구|과학' THEN '과학'
      WHEN u.title ~ '통합사회|통사|한국사|사회|경제|법과'     THEN '사회'
      WHEN u.title ~ '국어' THEN '국어' WHEN u.title ~ '영어' THEN '영어'
      WHEN u.title ~ '수학|Math' THEN '수학' ELSE '기타' END,
    CASE
      WHEN u.title LIKE '%설명회%'             THEN '설명회'
      WHEN u.title ~ '여름방학|겨울방학|봄방학' THEN '방학특강'
      WHEN u.title ~ '중간내신|기말내신|내신'   THEN '내신대비'
      WHEN u.title ~ '수능|정시|집중반|All Day' THEN '수능정시'
      WHEN u.title ~ '정규'                    THEN '정규개강'
      ELSE '기타' END,
    (SELECT label FROM _kind WHERE u.r >= lo ORDER BY lo DESC LIMIT 1),
    t.teacher, tc.cnt,
    COALESCE(a.grade_label,'ALL'), COALESCE(a.school_label,'ALL'),
    u.r, u.cost, round(u.cost::numeric / tc.cnt, 2), u.est
  FROM _u u
  LEFT JOIN _aud a ON a.key = u.key
  LEFT JOIN LATERAL (SELECT greatest(count(*),1) cnt FROM _tea WHERE key = u.key) tc ON true
  LEFT JOIN _tea t ON t.key = u.key;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$fn$;

COMMENT ON FUNCTION public.rebuild_send_analysis_all IS
  'send_analysis_all 전량 재생성. CRM 캠페인과 아카 발송(묶음 단위)을 같은 스키마로 합친다. crm_messages·aca_sms_messages 전량 스캔이 필요해 SECURITY DEFINER. service_role 만 실행 가능. 0132.';

REVOKE ALL ON FUNCTION public.rebuild_send_analysis_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_send_analysis_all() TO service_role;

COMMIT;
