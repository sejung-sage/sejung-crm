-- ============================================================
-- 0129_skip_redundant_etl_updates.sql
-- ETL 무변경 UPDATE 억제 — 값이 그대로면 쓰기 자체를 취소한다.
-- ------------------------------------------------------------
-- 배경 (2026-08-25 진단):
--   scripts/etl/migrate_*.py 11개는 아카(Aca2000) MSSQL 뷰를 **매번 전량**
--   SELECT 해서 upsert 한다. 원본 뷰에 "마지막 수정 시각" 컬럼이 없어
--   (예: V_student_list 는 날짜 컬럼이 아예 없다) 소스에서 증분을 못 거른다.
--
--   결과: 값이 하나도 안 바뀐 행까지 매 run 마다 ON CONFLICT DO UPDATE 로
--   다시 쓴다. 누적 UPDATE 실측 —
--     aca_tickets        6.88억 | aca_payments       2.58억
--     aca_students       1.58억 | crm_enrollments    1.65억
--     crm_students       1.37억 | aca_enrollments    1.03억
--     aca_class_accounts 1.09억 | crm_attendances    0.75억
--     aca_attendances    0.48억 | aca_classes        0.05억
--   aca_students 는 **실제 신규 706명**을 넣으려고 1.58억 번 UPDATE 했다.
--
--   UPDATE 는 값이 같아도 새 튜플을 쓴다(MVCC) → heap 쓰기 + 인덱스 갱신 +
--   WAL + dead tuple + autovacuum 이 전부 발생. 이 낭비가 DB 실행시간의
--   큰 몫을 차지해 같은 인스턴스를 쓰는 CRM 발송·대상조회를 느리게 했다.
--
-- 해결: BEFORE UPDATE 트리거로 "내용이 같으면 RETURN NULL" → 쓰기 취소.
--   ETL 파이썬은 한 줄도 안 고친다. 계속 전량을 보내되 DB 가 걸러낸다.
--
--   ⚠️ 없어지는 것은 **쓰기 비용**뿐이다. 아카에서 112만 행 SELECT, 네트워크
--      전송, ON CONFLICT 판정용 인덱스 조회는 그대로 남는다.
--
-- 구성:
--   1) skip_redundant_update() — updated_at 을 비교에서 제외한 뒤 OLD/NEW 를
--      행 단위 비교. 같으면 NULL 반환(쓰기 취소).
--      TG_ARGV[0]='true' 면 변경된 행에 한해 updated_at 을 now() 로 찍는다.
--   2) updated_at 이 있는 12개 테이블에 부착.
--   3) updated_at 이 없는 2개 테이블(*_attendances)은 코어 내장
--      suppress_redundant_updates_trigger() 사용 — C 구현이라 더 빠르다.
--
-- ⚠️ aca_tickets 는 **제외**한다.
--   0114 의 삭제 전파가 last_seen_at 을 매 run 갱신하는 데 의존한다. UPDATE 를
--   취소하면 last_seen_at 이 멈춰 aca_tickets_sweep_stale() 이 살아있는 행을
--   잔존으로 오판한다(5% 안전 상한에 걸려 sweep 중단 → 삭제 전파 무력화).
--   티켓의 쓰기 낭비(6.88억)는 별건으로 다룬다.
--
-- 부수 효과 (의도된 것):
--   aca_* 의 updated_at 이 "ETL 이 만진 시각" → "값이 실제로 바뀐 시각" 이 된다.
--   지금까지는 전 행이 매 run now() 로 밀려 워터마크로 못 썼다(aca_students
--   109,319행 중 109,024행이 "최근 1시간 내 변경"으로 보였다). 앞으로는
--   `WHERE updated_at > ?` 로 진짜 변경분을 뽑을 수 있다.
--
--   crm_* 는 stamp=false 로 붙인다. apply_aca_to_crm() 이 SET updated_at=now()
--   를 명시하고 있어 변경된 행은 그대로 now() 가 들어가고, 앱이 직접 하는
--   UPDATE 의 updated_at 처리도 지금과 동일하게 유지된다(동작 변화 없음).
--
-- ROLLBACK:
--   -- 트리거 제거 (aca_* 는 기존 set_updated_at 트리거를 되살려야 한다)
--   DROP TRIGGER IF EXISTS trg_aca_students_skip_redundant  ON public.aca_students;
--   CREATE TRIGGER trg_students_updated_at BEFORE UPDATE ON public.aca_students
--     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--   -- (나머지 테이블도 아래 목록대로 동일하게)
--   DROP FUNCTION IF EXISTS public.skip_redundant_update();
-- ============================================================

BEGIN;

-- ─── 1) 비교 함수 ───────────────────────────────────────────
--
-- updated_at 정규화가 핵심이다. 호출자가 SET updated_at=now() 를 넣든
-- (apply_aca_to_crm) 안 넣든(ETL upsert) 비교 결과가 흔들리지 않게, 비교
-- 직전에 OLD 값으로 되돌린 뒤 행 전체를 IS NOT DISTINCT FROM 으로 대조한다.
-- NULL 은 NULL 과 같다고 보고, numeric 1.0 과 1.00 은 같다고 본다(검증 완료).
--
-- jsonb 변환 대신 행 비교를 쓰는 이유: 매 run 112만 행을 통과하므로 행당
-- 비용이 곧 총비용이다. to_jsonb() 2회보다 레코드 비교가 훨씬 싸다.
CREATE OR REPLACE FUNCTION public.skip_redundant_update()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  -- TG_ARGV[0]='true' → 변경된 행의 updated_at 을 now() 로 찍는다
  --                     (aca_* 에서 기존 set_updated_at 트리거의 역할을 승계).
  --                 false → 들어온 값을 그대로 둔다(crm_*: 동작 변화 없음).
  v_stamp    boolean     := COALESCE(TG_ARGV[0], 'false')::boolean;
  v_incoming timestamptz := NEW.updated_at;
BEGIN
  NEW.updated_at := OLD.updated_at;

  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;  -- 쓰기 취소. heap·인덱스·WAL·dead tuple 전부 발생하지 않는다.
  END IF;

  NEW.updated_at := CASE WHEN v_stamp THEN now() ELSE v_incoming END;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.skip_redundant_update IS
  'BEFORE UPDATE 트리거 — updated_at 을 제외한 나머지 컬럼이 OLD 와 완전히 같으면 RETURN NULL 로 쓰기를 취소한다. ETL 이 매 run 전량 upsert 해도 실제 변경분만 기록되게 한다. TG_ARGV[0]=''true'' 면 변경된 행의 updated_at 을 now() 로 찍는다(set_updated_at 승계). updated_at 컬럼이 있는 테이블 전용. 0129.';

-- ─── 2) updated_at 이 있는 테이블 ───────────────────────────
--
-- aca_* : 기존 trg_*_updated_at(set_updated_at)을 걷어내고 이 함수로 교체한다.
--         두 트리거를 함께 두면 set_updated_at 이 먼저 now() 를 찍어버려
--         "변경 없음" 판정이 항상 거짓이 된다(트리거는 이름순 실행).
-- crm_* : 기존 트리거가 없다. stamp=false 로 붙여 updated_at 동작을 보존한다.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- (테이블, updated_at 을 now() 로 찍을지, 걷어낼 기존 트리거명)
      ('aca_students',         true,  'trg_students_updated_at'),
      ('aca_classes',          true,  'trg_classes_updated_at'),
      ('aca_enrollments',      true,  'trg_enrollments_updated_at'),
      ('aca_payments',         true,  'trg_aca_payments_updated_at'),
      ('aca_unpaid',           true,  'trg_aca_unpaid_updated_at'),
      ('aca_class_accounts',   true,  'trg_aca_class_accounts_updated_at'),
      ('aca_class_types',      true,  'trg_aca_class_types_updated_at'),
      ('aca_teachers',         true,  'trg_aca_teachers_updated_at'),
      ('aca_teacher_subjects', true,  'trg_aca_teacher_subjects_updated_at'),
      -- crm_* 는 apply_aca_to_crm() 이 updated_at 을 직접 넣으므로 stamp 불필요
      ('crm_students',         false, NULL),
      ('crm_classes',          false, NULL),
      ('crm_enrollments',      false, NULL)
    ) AS v(tbl, stamp, old_trg)
  LOOP
    IF r.old_trg IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.old_trg, r.tbl);
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_skip_redundant ON public.%I',
                   r.tbl, r.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_skip_redundant BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.skip_redundant_update(%L)',
      r.tbl, r.tbl, r.stamp::text);
  END LOOP;
END $$;

-- ─── 3) updated_at 이 없는 테이블 ───────────────────────────
--
-- *_attendances 는 updated_at 컬럼이 없다. 컬럼을 새로 만들 이유가 없으므로
-- PostgreSQL 코어 내장 함수를 그대로 쓴다 — C 구현이라 plpgsql 보다 빠르고,
-- 하는 일은 동일하다(튜플이 같으면 UPDATE 스킵).
DROP TRIGGER IF EXISTS trg_aca_attendances_skip_redundant ON public.aca_attendances;
CREATE TRIGGER trg_aca_attendances_skip_redundant
  BEFORE UPDATE ON public.aca_attendances
  FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger();

DROP TRIGGER IF EXISTS trg_crm_attendances_skip_redundant ON public.crm_attendances;
CREATE TRIGGER trg_crm_attendances_skip_redundant
  BEFORE UPDATE ON public.crm_attendances
  FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger();

-- ─── 4) 적용 결과 확인 ──────────────────────────────────────
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND t.tgname LIKE '%_skip_redundant';

  IF v_count <> 14 THEN
    RAISE EXCEPTION '[0129] 트리거 14개가 붙어야 하는데 %개입니다.', v_count;
  END IF;

  RAISE NOTICE '[0129] 무변경 UPDATE 억제 트리거 %개 적용 (aca_tickets 는 0114 last_seen_at 때문에 제외)', v_count;
END $$;

COMMIT;
