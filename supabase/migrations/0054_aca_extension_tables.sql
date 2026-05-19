-- ============================================================
-- 0054_aca_extension_tables.sql
-- 아카(Aca2000) ETL 확장 — 미사용 7개 view 를 모두 raw 계층으로 이관
--
-- 배경:
--   기존 aca_students / aca_enrollments / aca_classes / aca_attendances 4개에 더해,
--   원본 MSSQL 의 미사용 7개 view 를 모두 ETL 대상으로 확정 (사용자 결정 2026-05-19).
--   payments / tickets / class_accounts / unpaid / teachers / teacher_subjects /
--   class_types 의 원시 스냅샷을 보관해, 향후 정산·강사·반형태 분석의 anchor 로 사용.
--
-- 매핑 요약 (view → 테이블):
--   V_Pay_List                        → aca_payments         (32,985~67,666 rows/분원)
--   V_Ticket_student_income_List      → aca_tickets          (19,147~220,128 rows/분원)
--   V_class_account_list              → aca_class_accounts   ( 6,298~32,677 rows/분원)
--   V_income_List                     → aca_unpaid           (    19~616 rows/분원)
--   V_People_List                     → aca_teachers         (    51~179 rows/분원)
--   V_People_Subject_List             → aca_teacher_subjects (   189~1,538 rows/분원)
--   V_classqqtype_list                → aca_class_types      (     2~15 rows/분원)
--
-- 공통 패턴 (0001 / 0015 / 0017 / 0049 / 0051 답습):
--   - PK 는 UUID (gen_random_uuid)
--   - aca_*_id TEXT UNIQUE NOT NULL — "{branch_id}-{원본PK 또는 복합키}" 형태,
--     ETL UPSERT 의 ON CONFLICT 대상. raw 계층이라 일부 view 는 자체 PK 가 없어
--     복합 키로 합성 (테이블별 주석 참고).
--   - branch TEXT NOT NULL + idx_*_branch — 분원 RLS 격리 기준.
--   - timestamps + trg_*_updated_at — 0001 의 set_updated_at() 재사용.
--   - 모든 컬럼에 한글 COMMENT.
--   - RLS ENABLE + can_read_branch(branch) SELECT 정책 (0051 의 raw 패턴).
--     INSERT/UPDATE/DELETE 는 service_role 키로만 — service_role 은 RLS bypass
--     이므로 별도 정책 불필요. (ETL 만 write, 사용자 UI 는 read only.)
--   - FK 는 명시하지 않음 — 0051 의 raw 계층 정책. 외부 무결성은 ETL 단에서 보장.
--   - CHECK 제약 없음 — raw 데이터라 예상 외 enum 값이 올 수 있음.
--
-- 컬럼 alignment:
--   각 테이블의 컬럼 집합은 `scripts/etl/migrate_*.py` 의 transform() return dict
--   키와 1:1 동일. ETL 이 source of truth — 새 컬럼 추가 시 양쪽 동시 갱신 필요.
--
-- 멱등성:
--   CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS
--   / DROP TRIGGER IF EXISTS 패턴으로 재실행 안전.
--
-- 롤백 (수동):
--   DROP TABLE IF EXISTS public.aca_payments         CASCADE;
--   DROP TABLE IF EXISTS public.aca_tickets          CASCADE;
--   DROP TABLE IF EXISTS public.aca_class_accounts   CASCADE;
--   DROP TABLE IF EXISTS public.aca_unpaid           CASCADE;
--   DROP TABLE IF EXISTS public.aca_teachers         CASCADE;
--   DROP TABLE IF EXISTS public.aca_teacher_subjects CASCADE;
--   DROP TABLE IF EXISTS public.aca_class_types      CASCADE;
-- ============================================================

BEGIN;

SET LOCAL statement_timeout = '5min';


-- ============================================================
-- 0) 사전 조건 · set_updated_at() 존재 보장 (0001 정의 재사용)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1) aca_payments · 수납 이력 (V_Pay_List)
--    원본 PK: 수납_코드 (NOT NULL)
--    자연키: "{branch_id}-{수납_코드}"
-- ============================================================
CREATE TABLE IF NOT EXISTS public.aca_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca_payment_id    TEXT UNIQUE NOT NULL,
  aca_student_id    TEXT,
  aca_class_id      TEXT,
  aca_unpaid_id     TEXT,
  branch            TEXT NOT NULL,
  student_name      TEXT,
  class_name        TEXT,
  due_date          DATE,
  paid_at           DATE,
  item              TEXT,
  amount            INT,
  payment_method    TEXT,
  approval_no       TEXT,
  business_no       TEXT,
  handler           TEXT,
  teacher_name      TEXT,
  subject_raw       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.aca_payments                IS '아카 수납 이력 raw (V_Pay_List)';
COMMENT ON COLUMN public.aca_payments.id             IS '수납 행 UUID PK';
COMMENT ON COLUMN public.aca_payments.aca_payment_id IS '아카 수납 추적 키 "{branch_id}-{수납_코드}" — UPSERT 키';
COMMENT ON COLUMN public.aca_payments.aca_student_id IS '아카 학생 키 (학생_코드) — aca_students.aca2000_id 와 join';
COMMENT ON COLUMN public.aca_payments.aca_class_id   IS '아카 반 키 (반고유_코드) — aca_classes.aca_class_id 와 join';
COMMENT ON COLUMN public.aca_payments.aca_unpaid_id  IS '연결된 미납 키 (미납_코드) — aca_unpaid 와 join';
COMMENT ON COLUMN public.aca_payments.branch         IS '분원 short name (방배/대치/반포/송도)';
COMMENT ON COLUMN public.aca_payments.student_name   IS '학생명 denorm (검색·표시용)';
COMMENT ON COLUMN public.aca_payments.class_name     IS '반명 denorm';
COMMENT ON COLUMN public.aca_payments.due_date       IS '납입기한';
COMMENT ON COLUMN public.aca_payments.paid_at        IS '실 납입일';
COMMENT ON COLUMN public.aca_payments.item           IS '항목 (수강료/교재비/기타 등)';
COMMENT ON COLUMN public.aca_payments.amount         IS '납입금액 (원)';
COMMENT ON COLUMN public.aca_payments.payment_method IS '납입형태 (카드/이체/현금 등)';
COMMENT ON COLUMN public.aca_payments.approval_no    IS '카드 승인번호';
COMMENT ON COLUMN public.aca_payments.business_no    IS '사업자번호 (현금영수증·세금계산서)';
COMMENT ON COLUMN public.aca_payments.handler        IS '처리자 (수납 입력 직원명)';
COMMENT ON COLUMN public.aca_payments.teacher_name   IS '담당 강사명 denorm';
COMMENT ON COLUMN public.aca_payments.subject_raw    IS '과목명 원값 denorm';
COMMENT ON COLUMN public.aca_payments.created_at     IS '레코드 생성 시각 (ETL 적재)';
COMMENT ON COLUMN public.aca_payments.updated_at     IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_aca_payments_branch          ON public.aca_payments (branch);
CREATE INDEX IF NOT EXISTS idx_aca_payments_aca_student_id  ON public.aca_payments (aca_student_id);
CREATE INDEX IF NOT EXISTS idx_aca_payments_aca_class_id    ON public.aca_payments (aca_class_id);
CREATE INDEX IF NOT EXISTS idx_aca_payments_aca_unpaid_id   ON public.aca_payments (aca_unpaid_id);
CREATE INDEX IF NOT EXISTS idx_aca_payments_paid_at         ON public.aca_payments (paid_at);

DROP TRIGGER IF EXISTS trg_aca_payments_updated_at ON public.aca_payments;
CREATE TRIGGER trg_aca_payments_updated_at
  BEFORE UPDATE ON public.aca_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.aca_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aca_payments_read_by_branch ON public.aca_payments;
CREATE POLICY aca_payments_read_by_branch ON public.aca_payments
  FOR SELECT USING (public.can_read_branch(branch));


-- ============================================================
-- 2) aca_tickets · 수강권 (V_Ticket_student_income_List · 슈퍼셋)
--    원본 PK: 티켓_코드 (nullable — ETL 에서 skip)
--    자연키: "{branch_id}-{티켓_코드}"
-- ============================================================
CREATE TABLE IF NOT EXISTS public.aca_tickets (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca_ticket_id             TEXT UNIQUE NOT NULL,
  aca_student_id            TEXT,
  aca_class_id              TEXT,
  aca_enrollment_id         TEXT,
  aca_unpaid_id             TEXT,
  aca_payment_id            TEXT,
  branch                    TEXT NOT NULL,
  student_name              TEXT,
  student_school            TEXT,
  student_grade             TEXT,
  class_name                TEXT,
  class_type1               TEXT,
  class_type2               TEXT,
  class_type3               TEXT,
  class_total_amount        INT,
  class_capacity            INT,
  class_total_sessions      NUMERIC(8, 2),
  class_amount_per_session  INT,
  settings_value            TEXT,
  close_flag                TEXT,
  class_grade               TEXT,
  teacher_name              TEXT,
  subject_raw               TEXT,
  subject_detail            TEXT,
  class_detail              TEXT,
  schedule_days             TEXT,
  schedule_time             TEXT,
  etc                       TEXT,
  classroom                 TEXT,
  due_date                  DATE,
  used_at                   TIMESTAMPTZ,
  class_date                DATE,
  normal_amount             INT,
  discount_amount           INT,
  payment_state             TEXT,
  paid_at                   DATE,
  paid_amount               INT,
  payment_method            TEXT,
  business_no               TEXT,
  recorded_at               TIMESTAMPTZ,
  recorded_on               DATE,
  created_on                DATE,
  teacher_names             TEXT,
  teacher_codes             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.aca_tickets                          IS '아카 수강권 raw — 회차 단위 결제 단위 (V_Ticket_student_income_List 슈퍼셋)';
COMMENT ON COLUMN public.aca_tickets.id                       IS '티켓 행 UUID PK';
COMMENT ON COLUMN public.aca_tickets.aca_ticket_id            IS '아카 티켓 추적 키 "{branch_id}-{티켓_코드}" — UPSERT 키';
COMMENT ON COLUMN public.aca_tickets.aca_student_id           IS '아카 학생 키 (학생_코드)';
COMMENT ON COLUMN public.aca_tickets.aca_class_id             IS '아카 반 키 (반고유_코드)';
COMMENT ON COLUMN public.aca_tickets.aca_enrollment_id        IS '아카 수강이력 키 (수강이력_코드) — aca_enrollments 와 join';
COMMENT ON COLUMN public.aca_tickets.aca_unpaid_id            IS '연결된 미납 키 (미납_코드)';
COMMENT ON COLUMN public.aca_tickets.aca_payment_id           IS '연결된 수납 키 (수납_코드)';
COMMENT ON COLUMN public.aca_tickets.branch                   IS '분원 short name';
COMMENT ON COLUMN public.aca_tickets.student_name             IS '학생명 denorm';
COMMENT ON COLUMN public.aca_tickets.student_school           IS '학교 denorm';
COMMENT ON COLUMN public.aca_tickets.student_grade            IS '학년 원값 denorm';
COMMENT ON COLUMN public.aca_tickets.class_name               IS '반명 denorm';
COMMENT ON COLUMN public.aca_tickets.class_type1              IS '반형태1 (대분류)';
COMMENT ON COLUMN public.aca_tickets.class_type2              IS '반형태2 (중분류)';
COMMENT ON COLUMN public.aca_tickets.class_type3              IS '반형태3 (소분류)';
COMMENT ON COLUMN public.aca_tickets.class_total_amount       IS '반 총 수강료 (원)';
COMMENT ON COLUMN public.aca_tickets.class_capacity           IS '반 정원';
COMMENT ON COLUMN public.aca_tickets.class_total_sessions     IS '반 청구회차 수';
COMMENT ON COLUMN public.aca_tickets.class_amount_per_session IS '회차당 금액 (원)';
COMMENT ON COLUMN public.aca_tickets.settings_value           IS '아카 설정값 raw (운영 메타)';
COMMENT ON COLUMN public.aca_tickets.close_flag               IS '마감여부 raw';
COMMENT ON COLUMN public.aca_tickets.class_grade              IS '반 학년 raw';
COMMENT ON COLUMN public.aca_tickets.teacher_name             IS '강사명 (단일) denorm';
COMMENT ON COLUMN public.aca_tickets.subject_raw              IS '과목명 원값';
COMMENT ON COLUMN public.aca_tickets.subject_detail           IS '세부과목명';
COMMENT ON COLUMN public.aca_tickets.class_detail             IS '세부반명';
COMMENT ON COLUMN public.aca_tickets.schedule_days            IS '수업 요일 표시';
COMMENT ON COLUMN public.aca_tickets.schedule_time            IS '수업 시간 표시';
COMMENT ON COLUMN public.aca_tickets.etc                      IS '기타 메모 raw';
COMMENT ON COLUMN public.aca_tickets.classroom                IS '강의관+강의실 합성';
COMMENT ON COLUMN public.aca_tickets.due_date                 IS '납입기한일';
COMMENT ON COLUMN public.aca_tickets.used_at                  IS '티켓 사용 시각 (2050-01-01 = 미사용 sentinel 가능)';
COMMENT ON COLUMN public.aca_tickets.class_date               IS '수업일 (티켓 매핑된 수업 회차일)';
COMMENT ON COLUMN public.aca_tickets.normal_amount            IS '정상금액 (할인 전)';
COMMENT ON COLUMN public.aca_tickets.discount_amount          IS '할인 적용금액';
COMMENT ON COLUMN public.aca_tickets.payment_state            IS '결제상태 raw (대기/완료/취소 등 — enum 강제 X)';
COMMENT ON COLUMN public.aca_tickets.paid_at                  IS '납입일';
COMMENT ON COLUMN public.aca_tickets.paid_amount              IS '납입금액';
COMMENT ON COLUMN public.aca_tickets.payment_method           IS '납입형태 (카드/이체/현금 등)';
COMMENT ON COLUMN public.aca_tickets.business_no              IS '사업자번호';
COMMENT ON COLUMN public.aca_tickets.recorded_at              IS '티켓기록 일시 (nvarchar → timestamptz 변환)';
COMMENT ON COLUMN public.aca_tickets.recorded_on              IS '티켓기록일 (날짜만)';
COMMENT ON COLUMN public.aca_tickets.created_on               IS '티켓생성일';
COMMENT ON COLUMN public.aca_tickets.teacher_names            IS '담당강사 목록 (콤마 구분 문자열)';
COMMENT ON COLUMN public.aca_tickets.teacher_codes            IS '담당강사 코드 목록 (콤마 구분)';
COMMENT ON COLUMN public.aca_tickets.created_at               IS '레코드 생성 시각';
COMMENT ON COLUMN public.aca_tickets.updated_at               IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_aca_tickets_branch            ON public.aca_tickets (branch);
CREATE INDEX IF NOT EXISTS idx_aca_tickets_aca_student_id    ON public.aca_tickets (aca_student_id);
CREATE INDEX IF NOT EXISTS idx_aca_tickets_aca_class_id      ON public.aca_tickets (aca_class_id);
CREATE INDEX IF NOT EXISTS idx_aca_tickets_aca_enrollment_id ON public.aca_tickets (aca_enrollment_id);
CREATE INDEX IF NOT EXISTS idx_aca_tickets_payment_state     ON public.aca_tickets (payment_state);
CREATE INDEX IF NOT EXISTS idx_aca_tickets_class_date        ON public.aca_tickets (class_date);

DROP TRIGGER IF EXISTS trg_aca_tickets_updated_at ON public.aca_tickets;
CREATE TRIGGER trg_aca_tickets_updated_at
  BEFORE UPDATE ON public.aca_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.aca_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aca_tickets_read_by_branch ON public.aca_tickets;
CREATE POLICY aca_tickets_read_by_branch ON public.aca_tickets
  FOR SELECT USING (public.can_read_branch(branch));


-- ============================================================
-- 3) aca_class_accounts · 반×수업일 회계 (V_class_account_list)
--    원본 PK 없음 — 복합키 "{branch_id}-{반고유_코드}-{수업일 YYYYMMDD}"
-- ============================================================
CREATE TABLE IF NOT EXISTS public.aca_class_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca_class_account_id  TEXT UNIQUE NOT NULL,
  aca_class_id          TEXT,
  aca_class_type_id     TEXT,
  branch                TEXT NOT NULL,
  class_name            TEXT,
  total_amount          INT,
  capacity              INT,
  total_sessions        NUMERIC(8, 2),
  amount_per_session    INT,
  settings_value        TEXT,
  close_flag            TEXT,
  class_grade           TEXT,
  teacher_name          TEXT,
  subject_raw           TEXT,
  subject_detail        TEXT,
  class_detail          TEXT,
  schedule_days         TEXT,
  schedule_time         TEXT,
  etc                   TEXT,
  class_type_sort       INT,
  class_sort            INT,
  class_date            DATE,
  unsettled             INT,
  recall_target         INT,
  completed             INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.aca_class_accounts                      IS '아카 반×수업일 회계 스냅샷 raw (V_class_account_list)';
COMMENT ON COLUMN public.aca_class_accounts.id                   IS '회계 행 UUID PK';
COMMENT ON COLUMN public.aca_class_accounts.aca_class_account_id IS '아카 회계 추적 키 "{branch_id}-{반고유_코드}-{수업일YYYYMMDD}"';
COMMENT ON COLUMN public.aca_class_accounts.aca_class_id         IS '아카 반 키 (반고유_코드)';
COMMENT ON COLUMN public.aca_class_accounts.aca_class_type_id    IS '아카 반형태 키 (반형태_코드)';
COMMENT ON COLUMN public.aca_class_accounts.branch               IS '분원 short name';
COMMENT ON COLUMN public.aca_class_accounts.class_name           IS '반명 denorm';
COMMENT ON COLUMN public.aca_class_accounts.total_amount         IS '반 총 수강료 (원)';
COMMENT ON COLUMN public.aca_class_accounts.capacity             IS '반 정원';
COMMENT ON COLUMN public.aca_class_accounts.total_sessions       IS '청구회차 수';
COMMENT ON COLUMN public.aca_class_accounts.amount_per_session   IS '회차당 금액 (원)';
COMMENT ON COLUMN public.aca_class_accounts.settings_value       IS '아카 설정값 raw';
COMMENT ON COLUMN public.aca_class_accounts.close_flag           IS '마감여부 raw';
COMMENT ON COLUMN public.aca_class_accounts.class_grade          IS '반 학년 raw';
COMMENT ON COLUMN public.aca_class_accounts.teacher_name         IS '강사명 denorm';
COMMENT ON COLUMN public.aca_class_accounts.subject_raw          IS '과목명 원값';
COMMENT ON COLUMN public.aca_class_accounts.subject_detail       IS '세부과목명';
COMMENT ON COLUMN public.aca_class_accounts.class_detail         IS '세부반명';
COMMENT ON COLUMN public.aca_class_accounts.schedule_days        IS '수업 요일';
COMMENT ON COLUMN public.aca_class_accounts.schedule_time        IS '수업 시간';
COMMENT ON COLUMN public.aca_class_accounts.etc                  IS '기타 메모';
COMMENT ON COLUMN public.aca_class_accounts.class_type_sort      IS '반형태 정렬 순서';
COMMENT ON COLUMN public.aca_class_accounts.class_sort           IS '반 정렬 순서';
COMMENT ON COLUMN public.aca_class_accounts.class_date           IS '수업일';
COMMENT ON COLUMN public.aca_class_accounts.unsettled            IS '미정산 회계건수';
COMMENT ON COLUMN public.aca_class_accounts.recall_target        IS '회수 대상 건수';
COMMENT ON COLUMN public.aca_class_accounts.completed            IS '정상 완료 건수';
COMMENT ON COLUMN public.aca_class_accounts.created_at           IS '레코드 생성 시각';
COMMENT ON COLUMN public.aca_class_accounts.updated_at           IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_aca_class_accounts_branch       ON public.aca_class_accounts (branch);
CREATE INDEX IF NOT EXISTS idx_aca_class_accounts_aca_class_id ON public.aca_class_accounts (aca_class_id);
CREATE INDEX IF NOT EXISTS idx_aca_class_accounts_class_date   ON public.aca_class_accounts (class_date);

DROP TRIGGER IF EXISTS trg_aca_class_accounts_updated_at ON public.aca_class_accounts;
CREATE TRIGGER trg_aca_class_accounts_updated_at
  BEFORE UPDATE ON public.aca_class_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.aca_class_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aca_class_accounts_read_by_branch ON public.aca_class_accounts;
CREATE POLICY aca_class_accounts_read_by_branch ON public.aca_class_accounts
  FOR SELECT USING (public.can_read_branch(branch));


-- ============================================================
-- 4) aca_unpaid · 미납 항목 (V_income_List)
--    원본 PK: 미납_코드
-- ============================================================
CREATE TABLE IF NOT EXISTS public.aca_unpaid (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca_unpaid_id   TEXT UNIQUE NOT NULL,
  aca_student_id  TEXT,
  aca_class_id    TEXT,
  branch          TEXT NOT NULL,
  student_name    TEXT,
  student_school  TEXT,
  student_grade   TEXT,
  class_type1     TEXT,
  class_type2     TEXT,
  class_type3     TEXT,
  class_name      TEXT,
  due_date        DATE,
  item            TEXT,
  amount          INT,
  handler         TEXT,
  settings_value  TEXT,
  close_flag      TEXT,
  class_grade     TEXT,
  teacher_name    TEXT,
  subject_raw     TEXT,
  subject_detail  TEXT,
  class_detail    TEXT,
  schedule_days   TEXT,
  schedule_time   TEXT,
  etc             TEXT,
  classroom       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.aca_unpaid                IS '아카 미납 항목 raw (V_income_List)';
COMMENT ON COLUMN public.aca_unpaid.id             IS '미납 행 UUID PK';
COMMENT ON COLUMN public.aca_unpaid.aca_unpaid_id  IS '아카 미납 추적 키 "{branch_id}-{미납_코드}"';
COMMENT ON COLUMN public.aca_unpaid.aca_student_id IS '아카 학생 키';
COMMENT ON COLUMN public.aca_unpaid.aca_class_id   IS '아카 반 키';
COMMENT ON COLUMN public.aca_unpaid.branch         IS '분원 short name';
COMMENT ON COLUMN public.aca_unpaid.student_name   IS '학생명 denorm';
COMMENT ON COLUMN public.aca_unpaid.student_school IS '학교 denorm';
COMMENT ON COLUMN public.aca_unpaid.student_grade  IS '학년 raw denorm';
COMMENT ON COLUMN public.aca_unpaid.class_type1    IS '반형태1';
COMMENT ON COLUMN public.aca_unpaid.class_type2    IS '반형태2';
COMMENT ON COLUMN public.aca_unpaid.class_type3    IS '반형태3';
COMMENT ON COLUMN public.aca_unpaid.class_name     IS '반명 denorm';
COMMENT ON COLUMN public.aca_unpaid.due_date       IS '납입 기한일';
COMMENT ON COLUMN public.aca_unpaid.item           IS '항목 (수강료/교재 등)';
COMMENT ON COLUMN public.aca_unpaid.amount         IS '미납 금액 (원)';
COMMENT ON COLUMN public.aca_unpaid.handler        IS '처리자 (입력 직원)';
COMMENT ON COLUMN public.aca_unpaid.settings_value IS '아카 설정값 raw';
COMMENT ON COLUMN public.aca_unpaid.close_flag     IS '마감여부 raw';
COMMENT ON COLUMN public.aca_unpaid.class_grade    IS '반 학년 raw';
COMMENT ON COLUMN public.aca_unpaid.teacher_name   IS '강사명 denorm';
COMMENT ON COLUMN public.aca_unpaid.subject_raw    IS '과목명 원값';
COMMENT ON COLUMN public.aca_unpaid.subject_detail IS '세부과목명';
COMMENT ON COLUMN public.aca_unpaid.class_detail   IS '세부반명';
COMMENT ON COLUMN public.aca_unpaid.schedule_days  IS '수업 요일';
COMMENT ON COLUMN public.aca_unpaid.schedule_time  IS '수업 시간';
COMMENT ON COLUMN public.aca_unpaid.etc            IS '기타 메모';
COMMENT ON COLUMN public.aca_unpaid.classroom      IS '강의관+강의실';
COMMENT ON COLUMN public.aca_unpaid.created_at     IS '레코드 생성 시각';
COMMENT ON COLUMN public.aca_unpaid.updated_at     IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_aca_unpaid_branch         ON public.aca_unpaid (branch);
CREATE INDEX IF NOT EXISTS idx_aca_unpaid_aca_student_id ON public.aca_unpaid (aca_student_id);
CREATE INDEX IF NOT EXISTS idx_aca_unpaid_due_date       ON public.aca_unpaid (due_date);

DROP TRIGGER IF EXISTS trg_aca_unpaid_updated_at ON public.aca_unpaid;
CREATE TRIGGER trg_aca_unpaid_updated_at
  BEFORE UPDATE ON public.aca_unpaid
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.aca_unpaid ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aca_unpaid_read_by_branch ON public.aca_unpaid;
CREATE POLICY aca_unpaid_read_by_branch ON public.aca_unpaid
  FOR SELECT USING (public.can_read_branch(branch));


-- ============================================================
-- 5) aca_teachers · 강사·직원 마스터 (V_People_List)
--    원본 PK: 강사_코드
-- ============================================================
CREATE TABLE IF NOT EXISTS public.aca_teachers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca_teacher_id  TEXT UNIQUE NOT NULL,
  branch          TEXT NOT NULL,
  name            TEXT,
  login_id        TEXT,
  phone           TEXT,
  birthday        DATE,
  role_type       TEXT,
  position        TEXT,
  department      TEXT,
  status_label    TEXT,
  postal_code     TEXT,
  road_address    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.aca_teachers                IS '아카 강사·직원 마스터 raw (V_People_List)';
COMMENT ON COLUMN public.aca_teachers.id             IS '강사 행 UUID PK';
COMMENT ON COLUMN public.aca_teachers.aca_teacher_id IS '아카 강사 추적 키 "{branch_id}-{강사_코드}"';
COMMENT ON COLUMN public.aca_teachers.branch         IS '분원 short name';
COMMENT ON COLUMN public.aca_teachers.name           IS '강사·직원명';
COMMENT ON COLUMN public.aca_teachers.login_id       IS '아카 시스템 로그인 아이디';
COMMENT ON COLUMN public.aca_teachers.phone          IS '강사 휴대폰 (정규화 010~019, 실패 시 NULL)';
COMMENT ON COLUMN public.aca_teachers.birthday       IS '생년월일 (원본 nvarchar 다양 형식 — DATE 변환 실패 시 NULL)';
COMMENT ON COLUMN public.aca_teachers.role_type      IS '유형 (강사/직원/관리자 등)';
COMMENT ON COLUMN public.aca_teachers.position       IS '직책';
COMMENT ON COLUMN public.aca_teachers.department     IS '부서';
COMMENT ON COLUMN public.aca_teachers.status_label   IS '구분 (재직/퇴사 등 — 6자 raw)';
COMMENT ON COLUMN public.aca_teachers.postal_code    IS '우편번호';
COMMENT ON COLUMN public.aca_teachers.road_address   IS '도로명 주소';
COMMENT ON COLUMN public.aca_teachers.created_at     IS '레코드 생성 시각';
COMMENT ON COLUMN public.aca_teachers.updated_at     IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_aca_teachers_branch ON public.aca_teachers (branch);
CREATE INDEX IF NOT EXISTS idx_aca_teachers_name   ON public.aca_teachers (name);

DROP TRIGGER IF EXISTS trg_aca_teachers_updated_at ON public.aca_teachers;
CREATE TRIGGER trg_aca_teachers_updated_at
  BEFORE UPDATE ON public.aca_teachers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.aca_teachers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aca_teachers_read_by_branch ON public.aca_teachers;
CREATE POLICY aca_teachers_read_by_branch ON public.aca_teachers
  FOR SELECT USING (public.can_read_branch(branch));


-- ============================================================
-- 6) aca_teacher_subjects · 강사-반 배정 이력 (V_People_Subject_List)
--    원본 PK 없음 — 복합키 "{branch_id}-{강사_코드}-{반고유_코드}-{배정일YYYYMMDD}"
-- ============================================================
CREATE TABLE IF NOT EXISTS public.aca_teacher_subjects (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca_teacher_subject_id   TEXT UNIQUE NOT NULL,
  aca_teacher_id           TEXT,
  aca_class_id             TEXT,
  branch                   TEXT NOT NULL,
  subject_raw              TEXT,
  teacher_name             TEXT,
  class_name               TEXT,
  assigned_at              DATE,
  ended_at                 DATE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.aca_teacher_subjects                        IS '아카 강사-반 배정 이력 raw (V_People_Subject_List)';
COMMENT ON COLUMN public.aca_teacher_subjects.id                     IS '배정 행 UUID PK';
COMMENT ON COLUMN public.aca_teacher_subjects.aca_teacher_subject_id IS '아카 배정 추적 키 "{branch_id}-{강사_코드}-{반고유_코드}-{배정일YYYYMMDD}"';
COMMENT ON COLUMN public.aca_teacher_subjects.aca_teacher_id         IS '아카 강사 키 — aca_teachers 와 join';
COMMENT ON COLUMN public.aca_teacher_subjects.aca_class_id           IS '아카 반 키 — aca_classes 와 join';
COMMENT ON COLUMN public.aca_teacher_subjects.branch                 IS '분원 short name';
COMMENT ON COLUMN public.aca_teacher_subjects.subject_raw            IS '과목명 원값';
COMMENT ON COLUMN public.aca_teacher_subjects.teacher_name           IS '강사명 denorm';
COMMENT ON COLUMN public.aca_teacher_subjects.class_name             IS '반명 denorm';
COMMENT ON COLUMN public.aca_teacher_subjects.assigned_at            IS '배정 시작일';
COMMENT ON COLUMN public.aca_teacher_subjects.ended_at               IS '배정 종료일 (NULL = 현재 배정중)';
COMMENT ON COLUMN public.aca_teacher_subjects.created_at             IS '레코드 생성 시각';
COMMENT ON COLUMN public.aca_teacher_subjects.updated_at             IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_aca_teacher_subjects_branch         ON public.aca_teacher_subjects (branch);
CREATE INDEX IF NOT EXISTS idx_aca_teacher_subjects_aca_teacher_id ON public.aca_teacher_subjects (aca_teacher_id);
CREATE INDEX IF NOT EXISTS idx_aca_teacher_subjects_aca_class_id   ON public.aca_teacher_subjects (aca_class_id);

DROP TRIGGER IF EXISTS trg_aca_teacher_subjects_updated_at ON public.aca_teacher_subjects;
CREATE TRIGGER trg_aca_teacher_subjects_updated_at
  BEFORE UPDATE ON public.aca_teacher_subjects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.aca_teacher_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aca_teacher_subjects_read_by_branch ON public.aca_teacher_subjects;
CREATE POLICY aca_teacher_subjects_read_by_branch ON public.aca_teacher_subjects
  FOR SELECT USING (public.can_read_branch(branch));


-- ============================================================
-- 7) aca_class_types · 반형태 분류 (V_classqqtype_list)
--    원본 PK: 반형태_코드
-- ============================================================
CREATE TABLE IF NOT EXISTS public.aca_class_types (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca_class_type_id   TEXT UNIQUE NOT NULL,
  branch              TEXT NOT NULL,
  registered_at       DATE,
  type1               TEXT,
  type2               TEXT,
  type3               TEXT,
  brand_code          INT,
  brand_name          TEXT,
  sort_order          INT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.aca_class_types                   IS '아카 반형태 분류 raw — 반형태1/2/3 트리 (V_classqqtype_list)';
COMMENT ON COLUMN public.aca_class_types.id                IS '분류 행 UUID PK';
COMMENT ON COLUMN public.aca_class_types.aca_class_type_id IS '아카 반형태 추적 키 "{branch_id}-{반형태_코드}"';
COMMENT ON COLUMN public.aca_class_types.branch            IS '분원 short name';
COMMENT ON COLUMN public.aca_class_types.registered_at     IS '등록일';
COMMENT ON COLUMN public.aca_class_types.type1             IS '반형태1 (대분류)';
COMMENT ON COLUMN public.aca_class_types.type2             IS '반형태2 (중분류)';
COMMENT ON COLUMN public.aca_class_types.type3             IS '반형태3 (소분류)';
COMMENT ON COLUMN public.aca_class_types.brand_code        IS '브랜치 코드 (아카 내부 — 우리 branch 와 다름)';
COMMENT ON COLUMN public.aca_class_types.brand_name        IS '브랜치명';
COMMENT ON COLUMN public.aca_class_types.sort_order        IS '정렬 순서';
COMMENT ON COLUMN public.aca_class_types.created_at        IS '레코드 생성 시각';
COMMENT ON COLUMN public.aca_class_types.updated_at        IS '레코드 최종 수정 시각';

CREATE INDEX IF NOT EXISTS idx_aca_class_types_branch ON public.aca_class_types (branch);

DROP TRIGGER IF EXISTS trg_aca_class_types_updated_at ON public.aca_class_types;
CREATE TRIGGER trg_aca_class_types_updated_at
  BEFORE UPDATE ON public.aca_class_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.aca_class_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aca_class_types_read_by_branch ON public.aca_class_types;
CREATE POLICY aca_class_types_read_by_branch ON public.aca_class_types
  FOR SELECT USING (public.can_read_branch(branch));


COMMIT;
