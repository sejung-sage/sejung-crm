-- ============================================================
-- 0134_aca_unit_cost_fix.sql
-- 아카2000 발송 단가 정정 — LMS 24원(sendon 단가) → 아카 실단가 SMS 10원 / LMS 28원.
-- ------------------------------------------------------------
-- 왜:
--   0132 는 아카 발송 비용을 `메시지 수 × 24원` 으로 잡았다. 24원은 세정학원의
--   **sendon** LMS 단가이지 아카2000 단가가 아니다. 아카 단가는 SMS 10원 / LMS 28원
--   (부가세 별도) 이다.
--
--   aca_sms_messages.msg_type 에 실제 발송 종류가 들어 있으므로 건별로 단가를 태운다.
--   2026-09-03 적재분 기준으로는 2,063,033 건 전부 LMS(SMS 0건)라 사실상 24 → 28 이다.
--     총 비용 49,512,792원 → 57,764,924원 (+8,252,132원)
--   앞으로 SMS 가 섞여 들어오면 자동으로 10원이 적용된다.
--
--   ⚠️ 여전히 추정치다(금액추정여부 = true). 아카 원본 로그에 청구 금액 컬럼이 없어
--   단가 × 건수로 역산한 값이다. 또 msg_type='LMS' 인데 본문이 4자인 건도 있어,
--   벤더가 실제로 SMS 로 과금했다면 그만큼 과대 계상된다.
--
-- ROLLBACK: 아래 CASE 를 (count(*)*24) 로 되돌린 뒤 rebuild_send_analysis_all() 재실행.
-- ============================================================

BEGIN;

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

  CREATE TEMP TABLE _kind(lo int, label text) ON COMMIT DROP;
  INSERT INTO _kind VALUES (3000,'대량홍보'),(1000,'중량'),(300,'소량'),(50,'소규모'),(0,'개별');

  ------------------------------------------------------------------
  -- A. CRM 측 (0132 와 동일)
  ------------------------------------------------------------------
  CREATE TEMP TABLE _crm ON COMMIT DROP AS
  SELECT c.id::text AS key, c.branch, c.sender_division AS division,
         p.name AS sender, c.title, c.body,
         (COALESCE(c.sent_at, c.created_at) AT TIME ZONE 'Asia/Seoul')::date AS d,
         c.total_recipients AS r, c.total_cost AS cost
  FROM public.crm_campaigns c
  LEFT JOIN public.crm_users_profile p ON p.user_id = c.created_by
  WHERE c.is_test = false AND c.status = '완료';

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
  -- B. 아카 측 — 묶음 키는 0133 그대로(본문 제외), 단가만 정정 (0134)
  ------------------------------------------------------------------
  CREATE TEMP TABLE _aca ON COMMIT DROP AS
  SELECT
    a.sent_on::text||'|'||COALESCE(a.sender_name,'')||'|'||COALESCE(a.division,'')||'|'||
      COALESCE(a.subject,'') AS key,
    max(a.branch) AS branch, max(a.division) AS division,
    max(a.sender_name) AS sender, max(a.subject) AS title,
    -- 개인화로 본문이 수신자마다 다르므로 대표 1건(가장 긴 것)을 쓴다.
    -- 강사·강좌 정보는 어느 본문에나 동일하게 들어 있다.
    (array_agg(b.body ORDER BY length(b.body) DESC NULLS LAST))[1] AS body,
    a.sent_on AS d,
    count(*)::int AS r,
    -- 아카2000 단가: SMS 10원 / LMS 28원 (부가세 별도). msg_type 이 비면 LMS 로 본다.
    sum(CASE WHEN a.msg_type = 'SMS' THEN 10 ELSE 28 END)::int AS cost
  FROM public.aca_sms_messages a
  LEFT JOIN public.aca_sms_bodies b ON b.body_hash = a.body_hash
  GROUP BY a.sent_on, a.sender_name, a.division, a.subject;

  CREATE TEMP TABLE _aca_aud ON COMMIT DROP AS
  WITH norm AS (
    SELECT
      a.sent_on::text||'|'||COALESCE(a.sender_name,'')||'|'||COALESCE(a.division,'')||'|'||
        COALESCE(a.subject,'') AS key,
      CASE
        WHEN a.grade_raw !~ '^[1-3]$' THEN NULL
        WHEN a.school ~ '고$|고등|여고' THEN '고'||a.grade_raw
        WHEN a.school ~ '중$|중학|여중' THEN
          CASE WHEN a.grade_raw='3' THEN '중3(예비고1)' ELSE '중'||a.grade_raw END
        ELSE NULL END AS g,
      NULLIF(a.school,'') AS sch
    FROM public.aca_sms_messages a),
  gg AS (
    SELECT key, sum(c) tot, max(c) top_n, (array_agg(g ORDER BY c DESC))[1] tg FROM (
      SELECT key, g, count(*) c FROM norm WHERE g IS NOT NULL GROUP BY 1,2) x GROUP BY 1),
  ss AS (
    SELECT key, max(c) top_n, (array_agg(sch ORDER BY c DESC))[1] tsch, sum(c) tot FROM (
      SELECT key, sch, count(*) c FROM norm WHERE sch IS NOT NULL GROUP BY 1,2) y GROUP BY 1)
  SELECT COALESCE(gg.key, ss.key) AS key,
    CASE WHEN gg.tot>0 AND gg.top_n::numeric/gg.tot >= 0.99 THEN gg.tg ELSE 'ALL' END AS grade_label,
    CASE WHEN ss.tot>0 AND ss.top_n::numeric/ss.tot >= 0.90 THEN ss.tsch ELSE 'ALL' END AS school_label
  FROM gg FULL JOIN ss ON ss.key = gg.key;

  ------------------------------------------------------------------
  -- C. 합치기 (0132 와 동일)
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

COMMENT ON COLUMN public.send_analysis_all.금액추정여부 IS
  'true = 아카(메시지별 msg_type 에 아카 단가 SMS 10원 / LMS 28원 적용한 추정치), false = CRM(실제 청구액). 0134 에서 24원 → 10/28원 정정.';

COMMIT;
