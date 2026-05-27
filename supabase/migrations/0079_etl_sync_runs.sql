-- ============================================================
-- 0079_etl_sync_runs.sql
-- ETL 동기화 실행 이력 테이블.
-- ------------------------------------------------------------
-- 목적:
--   매시간 ETL(scripts/etl/run_all.bat)이 Aca2000 → Supabase 동기화를
--   끝낼 때마다 결과(시각 + 성공/실패)를 1행 기록한다.
--   웹 UI 사이드바 하단에 "마지막 동기화: 5월 27일 오후 2:00 · 정상/실패" 표시.
--
-- 네이밍:
--   aca_*(raw) / crm_*(정제·도메인) 와 구분되는 ETL 인프라 메타 테이블이라
--   prefix 없이 etl_ 로 둔다.
--
-- 기록 주체:
--   scripts/etl/record_sync.py 가 run_all.bat 마지막에 호출되어 INSERT.
--   service_role(SUPABASE_SECRET_KEY) 사용 → RLS 우회.
-- ============================================================

BEGIN;

CREATE TABLE public.etl_sync_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  finished_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL CHECK (status IN ('success', 'failed')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.etl_sync_runs IS
  'Aca2000 → Supabase ETL(run_all.bat) 1회 실행 결과 이력. '
  'UI 사이드바의 "마지막 동기화 시각 + 성공/실패" 표시 소스. ETL 마지막에 1행 INSERT.';
COMMENT ON COLUMN public.etl_sync_runs.id IS '대리 키 (자동 증가).';
COMMENT ON COLUMN public.etl_sync_runs.finished_at IS
  'ETL 실행이 끝난 시각(UTC 저장, KST 표시는 UI). 기본값 now().';
COMMENT ON COLUMN public.etl_sync_runs.status IS
  '실행 결과: success(전 단계 성공) / failed(1개 이상 단계 실패).';
COMMENT ON COLUMN public.etl_sync_runs.error_message IS
  '실패 시 요약 메시지(예: "2 steps failed"). 성공 시 NULL.';
COMMENT ON COLUMN public.etl_sync_runs.created_at IS '행 생성 시각(감사용).';

-- 최신 1건 조회 최적화 (UI 가 finished_at DESC LIMIT 1 로 읽음).
CREATE INDEX etl_sync_runs_finished_at_desc_idx
  ON public.etl_sync_runs (finished_at DESC);

-- RLS: 운영 UI 는 service 키(RLS 우회)로 읽지만, 안전상 RLS 활성 +
-- 로그인 사용자 읽기만 허용. 분원 무관 전역 정보라 branch 가드 없음.
-- INSERT/UPDATE/DELETE 정책 없음 → service_role(ETL)만 가능, 일반 사용자 차단.
ALTER TABLE public.etl_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY etl_sync_runs_read_authenticated ON public.etl_sync_runs
  FOR SELECT TO authenticated USING (true);

COMMIT;
