-- ============================================================
-- 0119_sweep_stale_format_fix.sql
-- aca_tickets_sweep_stale() — format() 런타임 에러 수정 + 정상 run 비용 절감
-- ------------------------------------------------------------
-- 배경:
--   0114 파일에 직접 가한 수정을 정식 마이그레이션으로 분리한 것이다.
--   0114 는 이미 원격에 적용됐고, 적용된 마이그레이션 파일을 고쳐도 db push 는
--   다시 실행하지 않는다 — 즉 파일만 바뀌고 DB 는 그대로였다.
--
-- ── 1) 버그: format() 의 %.2f 는 런타임 에러 ─────────────────
--   PostgreSQL format() 이 지원하는 타입 지정자는 %s / %I / %L 뿐이다.
--   0114 의 안전 상한 초과 분기는 '%.2f%%' 를 썼다:
--
--     format('안전 상한 초과 — 삭제 대상 %s/%s (%.2f%%) > %s%%. ...', ...)
--
--   이 분기가 실행되면 "unrecognized format() type specifier" 로 예외가 난다.
--   하필 이 분기는 "원본 추출이 부분 실패한 것 같으니 지우지 말고 사유를
--   돌려주자" 는 **보호 경로**다. migrate_tickets.py 는 sweep 호출을 try/except
--   로 감싸 "삭제 전파 실패(무시)" 로 넘기므로(migrate_tickets.py:355-357)
--   데이터가 잘못 지워지지는 않았지만, 운영자는 왜 건너뛰었는지 알 수 없는
--   마스킹된 에러만 보게 된다. round(v_pct, 2) + %s 로 고친다.
--
-- ── 2) 정상 run 에서 분원 전체 count 생략 ────────────────────
--   종전에는 분원 전체 count(*) 를 먼저 돌리고 잔존 행을 셌다. 그러나 정상
--   run 은 대부분 잔존 0건이라, 지울 게 없는데도 매 run·매 분원마다 27만 행
--   (대치) 스캔이 돈다. aca_tickets 는 ETL 이 매시간 전량 재적재해 처닝이 심해
--   visibility map 이 정착하지 못하고 index-only scan 이 되지 않는다
--   (0113 에서 실측한 그 패턴).
--   → 잔존 행부터 세고, 0 이면 전체 count 없이 즉시 반환한다.
--
--   반환 계약 변경: 지울 게 없으면 total_before 가 NULL 이다(종전 0 또는 실제 수).
--   호출부 migrate_tickets.py 는 skipped_reason / deleted_count 만 읽고
--   total_before 는 쓰지 않으므로(migrate_tickets.py:359-365) 영향 없다.
--
--   함께 사라지는 분기: 종전의 "해당 분원 행 없음 — sweep 생략" 사유 문자열.
--   분원 행이 0이면 잔존도 0이라 위의 조기 반환에 흡수된다. 지울 게 없다는
--   사실은 같고, 운영자에게 경고로 보일 이유가 없다.
--
-- ── 주기 표기 정정 ──────────────────────────────────────────
--   0114 주석은 ETL 을 "20분 주기" 로 적었으나 실제 스케줄은 매시간이다
--   (sejung-etl.xml PT1H). 안전 상한 근거도 그에 맞춰 다시 계산한다:
--   주간 삭제량 실측 ≈ 5,000행 ÷ 168 run = run 당 ≈ 30행.
--
-- ── 0114 의 1회성 DO 블록은 옮기지 않는다 ────────────────────
--   0114 상단의 "잔존 행 일괄 삭제" DO 블록에도 분원별 가드를 추가하는 수정이
--   있었으나, 그 블록은 0114 적용 시점에 이미 실행된 **1회성 정리**다. 여기서
--   다시 돌리면 행을 또 지우게 되고 마이그레이션이 멱등하지 않게 된다.
--   그 가드는 "빈 DB 에 0114 를 처음부터 재적용" 하는 경우에만 의미가 있고,
--   상시 운영의 삭제 전파는 아래 sweep 함수가 전담한다.
--   (판단 근거: ETL 은 분원 루프에서 MSSQL 추출 실패 시 그 분원만 건너뛴다.
--    테이블 전체 max(updated_at) 만 보는 가드는 나머지 분원이 정상인 것에 가려
--    실패한 분원의 살아있는 행을 통째로 지울 수 있다. sweep 함수는 애초에
--    분원 단위로만 동작하므로 이 위험이 없다.)
--
-- ROLLBACK: 0114 의 함수 정의를 다시 적용한다.
--   단 %.2f 버그가 되살아나므로 권장하지 않는다.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.aca_tickets_sweep_stale(
  p_branch         text,
  p_run_started    timestamptz,
  p_max_delete_pct numeric DEFAULT 5.0
)
RETURNS TABLE(deleted_count int, total_before int, skipped_reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_total   int;
  v_stale   int;
  v_pct     numeric;
  v_deleted int;
BEGIN
  -- 잔존 행부터 센다. 정상 run 은 대부분 0건이고, 그 경우 분원 전체 count 를
  -- 아예 돌리지 않는다 — 대치 27만 행 스캔은 ETL 처닝 때문에 visibility map 이
  -- 정착 못 해 index-only 가 되지 않는다(0113 에서 실측한 그 패턴).
  -- (branch, last_seen_at) 인덱스로 이 조회 자체는 저렴하다.
  SELECT count(*) INTO v_stale
  FROM public.aca_tickets
  WHERE branch = p_branch AND last_seen_at < p_run_started;

  IF v_stale = 0 THEN
    -- 지울 게 없음. total_before 는 세지 않았으므로 NULL.
    RETURN QUERY SELECT 0, NULL::int, NULL::text;
    RETURN;
  END IF;

  -- 여기부터는 v_stale > 0 이므로 분원 행이 반드시 존재한다(0 나눗셈 불가).
  SELECT count(*) INTO v_total FROM public.aca_tickets WHERE branch = p_branch;

  v_pct := v_stale::numeric / v_total * 100;

  -- 안전 상한. 정상 운영에서는 1회 run 당 수~수십 행이면 충분하다
  -- (주간 삭제량 실측 ≈ 5,000행 ÷ 매시간 168 run = run 당 ≈ 30행). 이를 크게
  -- 벗어나면 원본 추출이 부분 실패했을 가능성이 높으므로 지우지 않고 사유만 돌려준다.
  IF v_pct > p_max_delete_pct THEN
    RETURN QUERY SELECT
      0,
      v_total,
      -- format() 의 타입 지정자는 %s/%I/%L 뿐이다. %.2f 는 런타임 에러(0119 수정).
      format('안전 상한 초과 — 삭제 대상 %s/%s (%s%%) > %s%%. 원본 추출 부분 실패 의심으로 sweep 중단.',
             v_stale, v_total, round(v_pct, 2), p_max_delete_pct)::text;
    RETURN;
  END IF;

  DELETE FROM public.aca_tickets
  WHERE branch = p_branch AND last_seen_at < p_run_started;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_deleted, v_total, NULL::text;
END;
$fn$;

COMMENT ON FUNCTION public.aca_tickets_sweep_stale IS
  'ETL 삭제 전파 — 분원별 upsert 를 무오류로 마친 뒤 호출하면, 이번 run 에서 보지 못한(last_seen_at < p_run_started) 티켓을 삭제한다. 삭제 비율이 p_max_delete_pct 를 넘으면 원본 추출 부분 실패로 보고 중단하고 사유를 돌려준다. 지울 게 없으면 total_before 는 NULL(분원 전체 count 를 생략). migrate_tickets.py 전용. 0114 → 0119(format 버그 수정).';

-- CREATE OR REPLACE 는 기존 권한을 보존하지만, 0114 와 동일한 상태임을 파일만 보고
-- 확인할 수 있도록 다시 명시한다(멱등).
REVOKE ALL ON FUNCTION public.aca_tickets_sweep_stale(text, timestamptz, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aca_tickets_sweep_stale(text, timestamptz, numeric) TO service_role;

COMMIT;
