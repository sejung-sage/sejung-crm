-- ============================================================
-- 0078_service_role_statement_timeout.sql
-- service_role 의 statement_timeout 을 role 단에서 20분으로 상향.
-- ------------------------------------------------------------
-- 배경:
--   ETL 마지막 step apply_to_crm 가 apply_aca_to_crm() RPC 를 호출하면
--   매번 57014 "canceling statement due to statement timeout" (약 8s) 발생.
--
--   0072 는 함수 본문 첫 줄에 `SET LOCAL statement_timeout = '20min'` 을
--   넣어 해결을 시도했으나 무효였다. PostgreSQL 의 statement_timeout 타이머는
--   문(statement) 시작 시점에 한 번 arming 되고, 함수 본문 안에서 SET LOCAL 로
--   값을 바꿔도 이미 실행 중인 바깥 `SELECT apply_aca_to_crm()` 문의 타이머는
--   재설정되지 않는다. 따라서 호출은 여전히 기본 8s 에 잘린다.
--
-- 수정:
--   PostgREST(supabase-py service key) 는 요청마다 service_role 로 전환한다.
--   role 단에 statement_timeout 을 걸면 문 시작 시점부터 20분 타이머가 잡혀
--   대용량 정제 UPSERT(6만 학생 + 38만 ticket 등)가 완주한다.
--
--   사용자 대면 role(anon / authenticated)은 건드리지 않으므로 웹 UI 쿼리는
--   기존 기본 타임아웃(8s)을 그대로 유지한다 — ETL(service_role)만 길어진다.
--
-- 적용 후 PostgREST 가 새 설정을 읽도록 reload 신호를 보낸다.
-- ============================================================

ALTER ROLE service_role SET statement_timeout = '20min';

COMMENT ON FUNCTION public.apply_aca_to_crm() IS
  'ETL 직후 호출 — aca_*(raw) → crm_*(curated) 일괄 정제 UPSERT. '
  'status/school 자동 룰 + 나머지 1:1. 타임아웃은 0078 에서 service_role '
  'statement_timeout=20min 으로 해결 (0072 의 함수내 SET LOCAL 은 무효였음).';

NOTIFY pgrst, 'reload config';
