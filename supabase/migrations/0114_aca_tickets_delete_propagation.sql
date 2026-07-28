-- ============================================================
-- 0114_aca_tickets_delete_propagation.sql
-- aca_tickets 삭제 전파 — 원본에서 사라진 티켓을 CRM 에서도 제거한다.
-- ------------------------------------------------------------
-- 배경 (2026-07-28 진단):
--   scripts/etl/migrate_tickets.py 는 aca_ticket_id 기준 UPSERT 만 한다. 원본
--   Aca2000 에서 티켓이 삭제되면(등록 취소·미납 정리) CRM 에는 영구히 남는다.
--
--   운영 실측 (총 512,731행 · ETL 은 20분마다 전량 재적재):
--     - 최근 2시간 내 갱신된 행 455,926 = 원본에 살아있는 행
--     - 갱신이 멈춘 행       56,805 = 원본에서 사라진 행 (11.1%)
--       분원별: 대치 35,960(13.1%) · 반포 16,578(11.2%) · 송도 3,325(4.9%)
--               방배 942(4.1%)  → 특정 분원 ETL 실패가 아니라 전 분원 공통 현상
--
--   "원본 뷰가 오래된 걸 안 준다" 가설은 기각됨:
--     class_date 3개월 이전 330,929행 중 잔존은 65행뿐. 오래돼서 빠지는 게 아니다.
--     반대로 미래 회차 티켓 65,683행 중 29,997행(46%)이 잔존이다.
--
--   payment_state 가 결정적:
--     결제전   : 잔존 30,275 / 살아있음 6,086  → 전체 결제전의 83%가 잔존
--     결제완료 : 잔존 26,473 / 살아있음 449,840
--   등록했다 취소·미납 정리된 건이 원본에서 삭제되는 패턴.
--   잔존 56,805행 중 같은 (학생·강좌·수업일) 로 살아있는 티켓이 있는 건 6,559행
--   (11.5%) 뿐 — 나머지 88.5% 는 실제로 그 회차에 오지 않는 학생이다.
--
-- 피해 (회차별 발송):
--   aca_tickets 는 (aca_class_id, class_date) 회차 명단의 단일 소스다
--   (src/lib/classes/get-class-sessions.ts → compose 프리필).
--     앞으로 예정된 회차 2,924개 중 1,918개(66%)에 취소 학생이 섞여 있고,
--     취소 슬롯 30,977 / 전체 68,044 (45%),
--     고유 학생 5,051명 중 연락처가 있어 실제 발송될 인원 4,743명.
--   즉 회차 발송 때마다 취소 학생 수천 명에게 문자가 나가고 문자비가 샌다.
--
-- 해결: 물리 삭제 + ETL 가드 (소프트 삭제 대비 선택 근거)
--   - aca_tickets 를 참조하는 외래키가 0개라 지워도 깨질 참조가 없다.
--   - student_profiles 뷰가 security_invoker 가 아니라(reloptions 비어 있음)
--     RLS 나 deleted_at 필터로는 그 뷰를 덮지 못한다. 물리 삭제면 발송·기간필터·
--     attendance_rate·explorer 가 읽기 코드 수정 없이 한 번에 정상화된다.
--   - ETL 이 20분마다 전량 재적재하므로 잘못 지워도 다음 사이클에 복구되는
--     자가치유 구조다.
--
-- 구성:
--   1) last_seen_at 컬럼 — ETL 이 이번 run 에서 본 행에 run 시작 시각을 찍는다.
--   2) 1회성 정리 — 지금 잔존 중인 행 삭제 (ETL 정상 동작 확인 가드 포함).
--   3) aca_tickets_sweep_stale() — ETL 이 분원별 upsert 를 무오류로 마친 뒤
--      호출한다. 이번 run 에서 못 본 행을 삭제하되 안전 상한을 넘으면 중단.
--
-- ROLLBACK (삭제된 행은 다음 ETL 사이클에 원본 기준으로 복구된다):
--   DROP FUNCTION IF EXISTS public.aca_tickets_sweep_stale(text, timestamptz, numeric);
--   DROP INDEX IF EXISTS public.idx_aca_tickets_branch_last_seen;
--   ALTER TABLE public.aca_tickets DROP COLUMN IF EXISTS last_seen_at;
--   그리고 migrate_tickets.py 의 last_seen_at / sweep 호출 제거.
-- ============================================================

BEGIN;

-- ─── 1) 1회성 정리 ───────────────────────────────────────────
--
-- ⚠️ 순서 주의: last_seen_at 컬럼 추가·백필보다 **먼저** 지운다.
--    백필 UPDATE 는 trg_aca_tickets_updated_at 트리거를 깨워 전 행의 updated_at 을
--    now() 로 밀어버리므로, 먼저 백필하면 "갱신이 멈춘 행" 판별 근거가 사라진다.
--    먼저 지우면 남는 행은 전부 방금 본 행이라 컬럼 DEFAULT now() 가 그대로 정확하다.
DO $$
DECLARE
  v_last    timestamptz;
  v_deleted int;
BEGIN
  SELECT max(updated_at) INTO v_last FROM public.aca_tickets;

  -- ETL 이 멈춘 상태에서 적용하면 살아있는 행을 지우게 된다.
  -- 20분 주기이므로 1시간 넘게 기록이 없으면 비정상으로 보고 중단한다.
  IF v_last IS NULL OR v_last < now() - interval '1 hour' THEN
    RAISE EXCEPTION
      'aca_tickets 최종 ETL 기록이 % 입니다. 20분 주기 동기화가 멈춘 상태에서는 '
      '살아있는 행을 지울 수 있으므로 중단합니다. ETL 정상 동작 확인 후 재적용하세요.',
      COALESCE(v_last::text, '(없음)');
  END IF;

  -- 2시간 = ETL 6사이클. 일시적 지연을 넉넉히 흡수하는 경계.
  DELETE FROM public.aca_tickets WHERE updated_at < now() - interval '2 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '[0114] 원본에서 사라진 잔존 티켓 %행 삭제', v_deleted;
END $$;

-- ─── 2) last_seen_at ────────────────────────────────────────
--
-- updated_at 을 재사용하지 않는 이유: updated_at 은 트리거가 자동으로 밀기 때문에
-- 향후 이 테이블에 어떤 UPDATE 라도 들어오면 "ETL 이 이번 run 에서 봤다" 는 의미가
-- 오염된다. ETL 이 명시적으로 찍는 별도 컬럼을 둔다.
-- 위에서 잔존 행을 이미 지웠으므로 남은 행은 전부 방금 본 행 = DEFAULT now() 가 정확.
ALTER TABLE public.aca_tickets
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.aca_tickets.last_seen_at IS
  'ETL 이 이 행을 원본에서 마지막으로 본 시각 (해당 run 의 시작 시각). aca_tickets_sweep_stale() 이 이 값으로 원본에서 사라진 행을 판별한다. updated_at 은 트리거가 자동 갱신해 의미가 오염되므로 별도 컬럼. 0114.';

-- sweep 의 WHERE (branch, last_seen_at) 전용.
CREATE INDEX IF NOT EXISTS idx_aca_tickets_branch_last_seen
  ON public.aca_tickets (branch, last_seen_at);

COMMENT ON INDEX public.idx_aca_tickets_branch_last_seen IS
  'aca_tickets_sweep_stale() 의 분원별 잔존 행 판별·삭제용. 0114.';

-- ─── 3) sweep 함수 ──────────────────────────────────────────
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
  SELECT count(*) INTO v_total FROM public.aca_tickets WHERE branch = p_branch;

  -- 분원 행이 아예 없으면 판단 근거가 없다. 지우지 않는다.
  IF v_total = 0 THEN
    RETURN QUERY SELECT 0, 0, '해당 분원 행 없음 — sweep 생략'::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_stale
  FROM public.aca_tickets
  WHERE branch = p_branch AND last_seen_at < p_run_started;

  IF v_stale = 0 THEN
    RETURN QUERY SELECT 0, v_total, NULL::text;
    RETURN;
  END IF;

  v_pct := v_stale::numeric / v_total * 100;

  -- 안전 상한. 정상 운영에서는 1회 run 당 수~수십 행이면 충분하다
  -- (주간 삭제량 실측 ≈ 5,000행 = run 당 ≈ 10행). 이를 크게 벗어나면 원본 추출이
  -- 부분 실패했을 가능성이 높으므로 지우지 않고 사유만 돌려준다.
  IF v_pct > p_max_delete_pct THEN
    RETURN QUERY SELECT
      0,
      v_total,
      format('안전 상한 초과 — 삭제 대상 %s/%s (%.2f%%) > %s%%. 원본 추출 부분 실패 의심으로 sweep 중단.',
             v_stale, v_total, v_pct, p_max_delete_pct)::text;
    RETURN;
  END IF;

  DELETE FROM public.aca_tickets
  WHERE branch = p_branch AND last_seen_at < p_run_started;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_deleted, v_total, NULL::text;
END;
$fn$;

COMMENT ON FUNCTION public.aca_tickets_sweep_stale IS
  'ETL 삭제 전파 — 분원별 upsert 를 무오류로 마친 뒤 호출하면, 이번 run 에서 보지 못한(last_seen_at < p_run_started) 티켓을 삭제한다. 삭제 비율이 p_max_delete_pct 를 넘으면 원본 추출 부분 실패로 보고 중단한다. migrate_tickets.py 전용. 0114.';

-- 삭제 함수이므로 ETL(service_role) 만 실행 가능. authenticated 에는 부여하지 않는다.
REVOKE ALL ON FUNCTION public.aca_tickets_sweep_stale(text, timestamptz, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aca_tickets_sweep_stale(text, timestamptz, numeric) TO service_role;

COMMIT;
