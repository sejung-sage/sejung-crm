-- ============================================================
-- 0031_pg_cron_sweep_stalled_campaigns.sql
-- 발송중인데 멈춘 캠페인을 3분마다 재킥하는 sweeper.
--
-- 배경:
--   즉시 발송은 `runImmediateSend` → messages('대기') INSERT →
--   `/api/messaging/drain` 호출 → drain 함수가 1,000건 청크씩 처리하고
--   자기 자신을 fetch 로 self-invocation 하는 구조.
--
--   문제: self-invocation 체인이 가끔 끊긴다.
--     - Vercel 함수 인스턴스 정리 타이밍과 fetch 가 겹치며 cancel
--     - alias 인증 이슈로 401 등
--   직전 커밋(422dc76, c9464cb) 도 같은 끊김을 패치했던 이력이 있음.
--
--   Vercel Cron 은 Hobby 플랜이 1일 1회 제약(0027 주변 기존 cron 코멘트
--   참조)이라 사용 불가. Supabase pg_cron + pg_net 으로 자체 완결.
--
-- 동작:
--   - cron job 'sweep-stalled-campaigns' 가 매 3분마다
--     `public.sweep_stalled_campaigns()` 실행
--   - 함수는 `find_stalled_campaigns(3)` 결과(= 발송중 + 대기 메시지 존재
--     + 마지막 발송이 3분 이상 전) 각각에 대해 `/api/messaging/drain` 을
--     `net.http_post` 로 재킥
--   - drain 라우트는 idempotent (campaignId 중복 호출 안전 — 대기 청크가
--     없으면 그냥 0 처리하고 종료) 라 sweeper 가 self-invocation 과 동시에
--     찔러도 문제 없음
--
-- ============================================================
-- ★ 운영 셋업 (필수) ★
-- ============================================================
-- 본 마이그 적용 후 Supabase Studio SQL Editor 에서 1회만 실행:
--
--   select vault.create_secret(
--     '<DRAIN_SECRET 환경변수와 동일한 값>',
--     'drain_secret',
--     '드레인 워커 API 인증 시크릿 (process.env.DRAIN_SECRET 와 일치)'
--   );
--
--   select vault.create_secret(
--     'https://<프로덕션 도메인>',  -- 예: https://sejung-crm.vercel.app
--     'app_base_url',
--     'Next.js 앱 base URL (drain API 재킥 대상)'
--   );
--
-- 두 secret 이 등록되지 않으면 sweep_stalled_campaigns() 는
-- raise warning 만 띄우고 0 을 반환하며 조용히 스킵된다 (안전 fail-open).
--
-- 등록 확인:
--   select name from vault.decrypted_secrets
--    where name in ('drain_secret', 'app_base_url');
--
-- 이미 등록되어 있다면 갱신:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'drain_secret'),
--     '<새 값>'
--   );
--
-- ============================================================
-- ★ 운영 검증 SQL ★
-- ============================================================
-- 1) cron job 등록 확인:
--    select jobid, schedule, command, active
--      from cron.job
--     where jobname = 'sweep-stalled-campaigns';
--
-- 2) 멈춘 캠페인 수동 조회:
--    select * from public.find_stalled_campaigns(3);
--
-- 3) sweep 수동 실행 (재킥 카운트 반환):
--    select public.sweep_stalled_campaigns();
--
-- 4) cron 실행 이력 확인:
--    select * from cron.job_run_details
--     where jobid = (select jobid from cron.job
--                     where jobname = 'sweep-stalled-campaigns')
--     order by start_time desc limit 20;
--
-- 5) 일시 정지(필요 시):
--    update cron.job set active = false
--     where jobname = 'sweep-stalled-campaigns';
--
-- ============================================================
-- 롤백 (수동):
--   select cron.unschedule('sweep-stalled-campaigns');
--   drop function if exists public.sweep_stalled_campaigns();
--   drop function if exists public.find_stalled_campaigns(int);
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) 익스텐션 활성화
--    pg_cron : 스케줄러
--    pg_net  : 비동기 HTTP 클라이언트 (net.http_post)
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;


-- ============================================================
-- 2) find_stalled_campaigns
--    멈춘(=발송중인데 진척 없는) 캠페인 ID 목록을 반환.
--
--    "멈춤" 판정:
--      - campaigns.status = '발송중'
--      - 해당 캠페인의 messages.status = '대기' 가 1건 이상 존재
--      - 다음 중 하나:
--        a) 한 건도 발송된 적 없음 (max(sent_at) IS NULL) AND
--           campaigns.created_at < now() - p_stall_minutes
--           → 처음부터 drain 이 안 돈 케이스
--        b) 마지막 발송 시각(max(sent_at)) <
--           now() - p_stall_minutes
--           → drain 이 중간에 끊긴 케이스
--
--    p_stall_minutes : 기본 3분. 한 청크 ≈ 20~40초이므로 3분이면
--                      정상 진행 중인 캠페인은 잡히지 않는다.
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_stalled_campaigns(
  p_stall_minutes int DEFAULT 3
)
RETURNS TABLE (campaign_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id AS campaign_id
    FROM public.campaigns c
   WHERE c.status = '발송중'
     AND EXISTS (
       SELECT 1
         FROM public.messages m
        WHERE m.campaign_id = c.id
          AND m.status = '대기'
     )
     AND COALESCE(
           (SELECT MAX(m.sent_at)
              FROM public.messages m
             WHERE m.campaign_id = c.id),
           c.created_at
         ) < (now() - make_interval(mins => p_stall_minutes));
$$;

COMMENT ON FUNCTION public.find_stalled_campaigns(int) IS
  '발송중인데 마지막 발송 시각이 p_stall_minutes 분 이상 전인 캠페인 ID 목록. '
  '한 건도 발송 안된 케이스는 campaigns.created_at 으로 판정. '
  'pg_cron sweep_stalled_campaigns() 가 사용.';


-- ============================================================
-- 3) sweep_stalled_campaigns
--    멈춘 캠페인 각각에 대해 /api/messaging/drain 을 비동기 재킥.
--    반환: 재킥 시도한 캠페인 수
--
--    Vault 에서 drain_secret / app_base_url 두 secret 을 읽고,
--    하나라도 없으면 raise warning 후 0 반환 (조용히 스킵).
--
--    HTTP 호출은 pg_net 의 net.http_post (비동기 fire-and-forget).
--    응답 상태는 net._http_response 에서 확인 가능 (디버깅용).
-- ============================================================
CREATE OR REPLACE FUNCTION public.sweep_stalled_campaigns()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_drain_secret text;
  v_app_base_url text;
  v_campaign_id  uuid;
  v_count        int := 0;
BEGIN
  -- Vault 에서 두 secret 조회
  SELECT decrypted_secret INTO v_drain_secret
    FROM vault.decrypted_secrets
   WHERE name = 'drain_secret'
   LIMIT 1;

  SELECT decrypted_secret INTO v_app_base_url
    FROM vault.decrypted_secrets
   WHERE name = 'app_base_url'
   LIMIT 1;

  IF v_drain_secret IS NULL OR v_app_base_url IS NULL THEN
    RAISE WARNING
      'sweep_stalled_campaigns: vault secret 누락 (drain_secret=% , app_base_url=%) — 스킵',
      (v_drain_secret IS NOT NULL),
      (v_app_base_url IS NOT NULL);
    RETURN 0;
  END IF;

  -- 끝의 '/' 제거 (정규화)
  v_app_base_url := rtrim(v_app_base_url, '/');

  -- 멈춘 캠페인 각각에 비동기 POST
  FOR v_campaign_id IN
    SELECT campaign_id FROM public.find_stalled_campaigns(3)
  LOOP
    PERFORM net.http_post(
      url     := v_app_base_url || '/api/messaging/drain',
      body    := jsonb_build_object('campaignId', v_campaign_id),
      headers := jsonb_build_object(
        'Content-Type',   'application/json',
        'x-drain-secret', v_drain_secret
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.sweep_stalled_campaigns() IS
  'pg_cron 매 3분 실행: 멈춘 발송중 캠페인을 찾아 /api/messaging/drain 을 net.http_post 로 재킥. '
  'Vault 의 drain_secret / app_base_url 두 secret 필요. 없으면 raise warning 후 0 반환.';


-- ============================================================
-- 4) pg_cron job 등록 (멱등)
--    동일 이름 job 이 이미 있으면 unschedule 후 재등록.
-- ============================================================
DO $$
BEGIN
  -- 기존 동일 이름 job 정리
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'sweep-stalled-campaigns'
  ) THEN
    PERFORM cron.unschedule('sweep-stalled-campaigns');
  END IF;

  -- 매 3분마다 실행
  PERFORM cron.schedule(
    'sweep-stalled-campaigns',
    '*/3 * * * *',
    $cron$SELECT public.sweep_stalled_campaigns();$cron$
  );
END;
$$;


COMMIT;
