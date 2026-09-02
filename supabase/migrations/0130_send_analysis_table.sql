-- ============================================================
-- 0130_send_analysis_table.sql
-- 발송 패턴 분석용 평면 테이블 — 캠페인 × 강사 단위.
-- ------------------------------------------------------------
-- 목적 (2026-09-02, 정책비 기획안):
--   문자비 절감 룰을 만들려면 "누가 · 언제 · 무슨 강좌를 · 어느 학년/학교에 ·
--   얼마 들여" 보냈는지를 한 표에서 피벗할 수 있어야 한다. 지금은 그 정보가
--   crm_campaigns(제목·비용) · crm_campaigns.body(강사) · crm_messages+crm_students
--   (실제 수신자 학년/학교) 세 곳에 흩어져 있다.
--
-- 이 테이블이 푸는 것 3가지:
--   1) 강사 귀속 — 제목에 강사명이 없는 캠페인이 절반 가까이(205/436)인데
--      body 에는 항상 `홍길동T` 형태로 적혀 있다. body 에서 추출한다.
--   2) 학년·학교 복원 — send_filters 컬럼은 0121 이후(2026-08-11~)에만 기록돼
--      그 이전 264건(비용의 85%)은 필터를 알 수 없다. crm_messages 에 수신자
--      student_id 가 100% 남아 있어 실제 수신자 구성으로 역산한다.
--   3) 요일·시각 — KST 기준. 발송 루틴(수요일 미발송 등) 분석용.
--
-- ⚠️ 그레인과 금액 (오독 주의)
--   한 행 = (캠페인 × 강사). 캠페인 하나에 강사가 여러 명이면 행이 늘어난다
--   (실측 최대 10명). 따라서:
--     - `금액`      = 캠페인 총액. 강사별로 **같은 값이 반복**된다. 그대로 SUM 하면
--                     강사 수만큼 부풀려진다. 캠페인 단위 집계에만 쓸 것.
--     - `금액_배분` = 금액 ÷ 강사수. **어떻게 group by 해도 합계가 실제 총액과
--                     일치**한다. 강사별·과목별 집계에는 이쪽을 쓸 것.
--   강사를 한 명도 못 뽑은 캠페인은 강사=NULL 로 1행 남긴다(누락 방지).
--
-- ⚠️ 복원값의 한계
--   crm_students.grade / school 은 **현재 값**이지 발송 시점 값이 아니다. 학년은
--   학기 중 바뀌지 않아 신뢰할 만하지만, 전학·학교 정보 갱신은 반영돼 있다.
--   또 수신거부·번호 없음으로 빠진 인원은 애초에 crm_messages 에 없다.
--
-- 판정 기준:
--   학년 — 수신자의 99% 이상이 한 학년이면 그 학년, 아니면 'ALL'
--   학교 — 수신자의 90% 이상이 한 학교면 그 학교, 아니면 'ALL'
--   (실측 436건 중 434건이 단일 학년 99%+ 로, 학년은 사실상 확정이다)
--
-- 갱신: 스냅샷 테이블이다. 새 발송을 반영하려면
--   SELECT public.rebuild_crm_send_analysis();
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.rebuild_crm_send_analysis();
--   DROP TABLE IF EXISTS public.crm_send_analysis;
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_send_analysis (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id   uuid        NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  branch        text        NOT NULL,
  보낸사람      text,
  전송일        date        NOT NULL,
  요일          text        NOT NULL,
  전송시각      timestamptz NOT NULL,
  제목          text        NOT NULL,
  강좌          text,
  과목          text        NOT NULL,
  유형          text        NOT NULL,
  강사          text,
  강사수        integer     NOT NULL,
  학년          text        NOT NULL,
  학교          text        NOT NULL,
  대상수        integer     NOT NULL,
  금액          integer     NOT NULL,
  금액_배분     numeric(12,2) NOT NULL,
  문자내용      text,
  생성시각      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.crm_send_analysis IS
  '발송 패턴 분석용 평면 스냅샷. 한 행 = 캠페인 × 강사. crm_campaigns(비용·제목) + body(강사 추출) + crm_messages/crm_students(수신자 역산)를 합친 것. rebuild_crm_send_analysis() 로 재생성. 0130.';

COMMENT ON COLUMN public.crm_send_analysis.campaign_id IS '원본 캠페인 id. 캠페인 단위로 되돌아가려면 이걸로 묶는다.';
COMMENT ON COLUMN public.crm_send_analysis.branch      IS '발송 분원 (대치/반포/송도/방배).';
COMMENT ON COLUMN public.crm_send_analysis.보낸사람    IS '캠페인을 만든 계정의 표시 이름 (crm_users_profile.name). 계정이 삭제되었으면 NULL.';
COMMENT ON COLUMN public.crm_send_analysis.전송일      IS '실제 발송일 (KST). sent_at 이 없는 예약·드레인 발송은 created_at 으로 보정.';
COMMENT ON COLUMN public.crm_send_analysis.요일        IS '전송일의 한글 요일 (월~일). 발송 루틴 분석용.';
COMMENT ON COLUMN public.crm_send_analysis.전송시각    IS '실제 발송 시각 (timestamptz). 시간대별 분석용.';
COMMENT ON COLUMN public.crm_send_analysis.제목        IS '캠페인 제목 원문.';
COMMENT ON COLUMN public.crm_send_analysis.강좌        IS '제목에서 머리기호(■♠)·괄호 날짜·꼬리말(안내/개강/모집/공지)을 걷어낸 강좌 표기. 한 통이 여러 강좌를 묶은 경우 묶음 이름 그대로다.';
COMMENT ON COLUMN public.crm_send_analysis.과목        IS '제목 기준 과목 분류: 국어/영어/수학/과학/사회/기타. 여러 과목이 섞이면 과학>사회>국어>영어>수학 순으로 하나만 잡힌다.';
COMMENT ON COLUMN public.crm_send_analysis.유형        IS '캠페인 성격: 방학특강/내신대비/수능정시/정규개강/설명회/기타.';
COMMENT ON COLUMN public.crm_send_analysis.강사        IS '본문(body)에서 추출한 강사명. 한 캠페인에 여러 명이면 행이 나뉜다. 못 뽑으면 NULL.';
COMMENT ON COLUMN public.crm_send_analysis.강사수      IS '이 캠페인 본문에 등장한 강사 수. 금액_배분의 분모. 강사 미추출이면 1.';
COMMENT ON COLUMN public.crm_send_analysis.학년        IS '실제 수신자의 99% 이상이 한 학년이면 그 학년(중3 은 ''중3(예비고1)''), 아니면 ''ALL''. send_filters 가 없는 기간도 수신자 역산으로 채운다.';
COMMENT ON COLUMN public.crm_send_analysis.학교        IS '실제 수신자의 90% 이상이 한 학교면 그 학교명, 아니면 ''ALL''(학교 무관 발송).';
COMMENT ON COLUMN public.crm_send_analysis.대상수      IS '캠페인의 총 발송 대상 수 (crm_campaigns.total_recipients).';
COMMENT ON COLUMN public.crm_send_analysis.금액        IS '캠페인 총 발송 비용(원). ⚠️ 강사별로 같은 값이 반복되므로 그대로 SUM 하면 부풀려진다. 캠페인 단위 집계에만 쓸 것.';
COMMENT ON COLUMN public.crm_send_analysis."금액_배분" IS '금액 ÷ 강사수. 어떤 기준으로 group by 해도 합계가 실제 총액과 일치한다. 강사별·과목별 집계에는 이쪽을 쓸 것.';
COMMENT ON COLUMN public.crm_send_analysis.문자내용    IS '발송 본문 원문(crm_campaigns.body). 가드(광고 표기·수신거부 footer) 적용 전 원문이다.';
COMMENT ON COLUMN public.crm_send_analysis.생성시각    IS '이 스냅샷 행이 만들어진 시각.';

CREATE INDEX IF NOT EXISTS idx_send_analysis_campaign ON public.crm_send_analysis (campaign_id);
CREATE INDEX IF NOT EXISTS idx_send_analysis_date     ON public.crm_send_analysis (branch, 전송일 DESC);
CREATE INDEX IF NOT EXISTS idx_send_analysis_teacher  ON public.crm_send_analysis (강사);
CREATE INDEX IF NOT EXISTS idx_send_analysis_grade    ON public.crm_send_analysis (학년, 과목);

-- 캠페인 본문·비용이 담기므로 캠페인과 동일한 분원 가드를 건다.
ALTER TABLE public.crm_send_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS send_analysis_read_by_branch ON public.crm_send_analysis;
CREATE POLICY send_analysis_read_by_branch ON public.crm_send_analysis
  FOR SELECT USING (can_read_branch(branch));

-- ─── 재생성 함수 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rebuild_crm_send_analysis()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  -- 1) 캠페인 기본 + 분류
  CREATE TEMP TABLE _base ON COMMIT DROP AS
  SELECT
    c.id, c.branch, c.title, c.body, c.total_recipients, c.total_cost,
    p.name AS sender,
    (COALESCE(c.sent_at, c.created_at) AT TIME ZONE 'Asia/Seoul') AS kst,
    COALESCE(c.sent_at, c.created_at) AS sent_ts,
    btrim(regexp_replace(regexp_replace(regexp_replace(
      c.title, '^[■♠\[\]]+\s*', ''), '\([^)]*\)', ''), '\s*(안내|개강|모집|공지)\s*$', '')) AS class_label,
    CASE
      WHEN c.title ~ '통합과학|통과|물리|화학|생명|지구|과학' THEN '과학'
      WHEN c.title ~ '통합사회|통사|한국사|사회|경제|법과'     THEN '사회'
      WHEN c.title ~ '국어'                                    THEN '국어'
      WHEN c.title ~ '영어'                                    THEN '영어'
      WHEN c.title ~ '수학|Math'                               THEN '수학'
      ELSE '기타' END AS subj,
    CASE
      WHEN c.title LIKE '%설명회%'                     THEN '설명회'
      WHEN c.title ~ '여름방학|겨울방학|봄방학'         THEN '방학특강'
      WHEN c.title ~ '중간내신|기말내신|내신'           THEN '내신대비'
      WHEN c.title ~ '수능|정시|집중반|All Day'         THEN '수능정시'
      WHEN c.title ~ '정규'                            THEN '정규개강'
      ELSE '기타' END AS seg
  FROM public.crm_campaigns c
  LEFT JOIN public.crm_users_profile p ON p.user_id = c.created_by
  WHERE c.is_test = false AND c.status = '완료';

  -- 2) 수신자 역산 — 학년·학교
  CREATE TEMP TABLE _aud ON COMMIT DROP AS
  WITH g AS (
    SELECT m.campaign_id cid, s.grade, count(*) n
    FROM public.crm_messages m
    JOIN public.crm_students s ON s.id = m.student_id
    WHERE m.campaign_id IN (SELECT id FROM _base)
    GROUP BY 1, 2),
  gg AS (
    SELECT cid, sum(n) tot, max(n) top_n, (array_agg(grade ORDER BY n DESC))[1] top_grade
    FROM g GROUP BY 1),
  sc AS (
    SELECT m.campaign_id cid, s.school, count(*) n
    FROM public.crm_messages m
    JOIN public.crm_students s ON s.id = m.student_id
    WHERE m.campaign_id IN (SELECT id FROM _base) AND s.school IS NOT NULL
    GROUP BY 1, 2),
  ss AS (
    SELECT cid, max(n) top_n, (array_agg(school ORDER BY n DESC))[1] top_school
    FROM sc GROUP BY 1)
  SELECT gg.cid,
    CASE WHEN gg.tot > 0 AND gg.top_n::numeric / gg.tot >= 0.99
         THEN CASE WHEN gg.top_grade = '중3' THEN '중3(예비고1)' ELSE gg.top_grade END
         ELSE 'ALL' END AS grade_label,
    CASE WHEN gg.tot > 0 AND COALESCE(ss.top_n, 0)::numeric / gg.tot >= 0.90
         THEN ss.top_school ELSE 'ALL' END AS school_label
  FROM gg LEFT JOIN ss ON ss.cid = gg.cid;

  -- 3) 본문에서 강사 추출 (캠페인당 중복 제거)
  CREATE TEMP TABLE _tea ON COMMIT DROP AS
  SELECT DISTINCT b.id AS cid,
         (regexp_matches(COALESCE(b.body, ''), '([가-힣]{2,6})T[ ,\)\n]', 'g'))[1] AS teacher
  FROM _base b;

  DELETE FROM public.crm_send_analysis;

  INSERT INTO public.crm_send_analysis (
    campaign_id, branch, 보낸사람, 전송일, 요일, 전송시각, 제목, 강좌, 과목, 유형,
    강사, 강사수, 학년, 학교, 대상수, 금액, "금액_배분", 문자내용)
  SELECT
    b.id, b.branch, b.sender, b.kst::date,
    CASE extract(isodow FROM b.kst)
      WHEN 1 THEN '월' WHEN 2 THEN '화' WHEN 3 THEN '수' WHEN 4 THEN '목'
      WHEN 5 THEN '금' WHEN 6 THEN '토' ELSE '일' END,
    b.sent_ts, b.title, NULLIF(b.class_label, ''), b.subj, b.seg,
    t.teacher, tc.cnt,
    COALESCE(a.grade_label, 'ALL'), COALESCE(a.school_label, 'ALL'),
    b.total_recipients, b.total_cost,
    round(b.total_cost::numeric / tc.cnt, 2),
    b.body
  FROM _base b
  LEFT JOIN _aud a ON a.cid = b.id
  LEFT JOIN LATERAL (SELECT greatest(count(*), 1) cnt FROM _tea WHERE cid = b.id) tc ON true
  LEFT JOIN _tea t ON t.cid = b.id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$fn$;

COMMENT ON FUNCTION public.rebuild_crm_send_analysis IS
  'crm_send_analysis 를 전량 재생성한다(DELETE 후 INSERT). 새 발송을 반영하려면 호출. SECURITY DEFINER — crm_messages 전량 스캔이 필요해 RLS 를 우회한다. 마스터/관리자만 실행 가능. 0130.';

REVOKE ALL ON FUNCTION public.rebuild_crm_send_analysis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_crm_send_analysis() TO service_role;

COMMIT;
