-- ============================================================
-- 0015_classes_table.sql
-- public.classes · Aca2000 V_class_list 강좌 마스터 이관용 테이블
--
-- 배경:
--   학생 상세 페이지의 enrollments.amount 는 실제로 "회차당 금액" 임이 확인됨.
--   "75,000원 × 12회 = 900,000원" 형태의 노출/검증을 위해 V_class_list 의
--   청구회차 / 회차당금액 / 반수강료 를 우리 DB 에 anchor 로 둔다.
--
--   이 테이블은 향후 attendances/payments 보강 ETL 에서도 동일한
--   "{학원_코드}-{반고유_코드}" 키로 join 되는 anchor 가 된다.
--
-- 자연키 패턴:
--   aca_class_id = "{branch_id}-{V_class_list.반고유_코드}"
--   분원별 반고유_코드 충돌 방지. students/enrollments 와 동일 패턴.
--
-- 멱등성:
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   - DROP TRIGGER IF EXISTS · DROP POLICY IF EXISTS 선행
--
-- 롤백 (수동):
--   DROP TABLE IF EXISTS public.classes CASCADE;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 사전 조건 · updated_at 트리거 함수 존재 확인
-- (0001 의 set_updated_at() 재사용)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.set_updated_at() IS 'updated_at 컬럼 자동 갱신용 공통 트리거 함수';


-- ============================================================
-- 1) classes · 강좌 마스터
-- ============================================================
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca_class_id TEXT,
  branch TEXT NOT NULL,
  name TEXT NOT NULL,
  teacher_name TEXT,
  subject_raw TEXT,
  subject TEXT
    CHECK (subject IS NULL OR subject IN ('수학', '국어', '영어', '탐구')),
  total_sessions NUMERIC(6, 2),
  amount_per_session INT,
  total_amount INT,
  capacity INT,
  schedule_days TEXT,
  schedule_time TEXT,
  classroom TEXT,
  registered_at DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- aca_class_id UNIQUE 제약 (NULL 다중 허용).
-- 0011 패턴 따라 partial index 가 아닌 일반 UNIQUE 제약 — ON CONFLICT 대상.
-- IF NOT EXISTS 가 ALTER TABLE ADD CONSTRAINT 에는 없어 DO 블록으로 멱등 보장.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'classes_aca_class_id_key'
      AND conrelid = 'public.classes'::regclass
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_aca_class_id_key UNIQUE (aca_class_id);
  END IF;
END
$$;

COMMENT ON TABLE public.classes IS '강좌 마스터 (Aca2000 V_class_list 이관)';
COMMENT ON COLUMN public.classes.id IS '강좌 ID (PK, UUID)';
COMMENT ON COLUMN public.classes.aca_class_id IS
  '아카(Aca2000) V_class_list.반고유_코드 추적 키. "{학원_코드}-{반고유_코드}" 형태. 우리 CRM 에서 직접 생성한 row 는 NULL. ETL UPSERT 의 ON CONFLICT 대상.';
COMMENT ON COLUMN public.classes.branch IS '분원 (대치/송도/반포/방배). RLS 격리 기준.';
COMMENT ON COLUMN public.classes.name IS '반명 (V_class_list.반명)';
COMMENT ON COLUMN public.classes.teacher_name IS '강사명 (V_class_list.강사명)';
COMMENT ON COLUMN public.classes.subject_raw IS '아카 원본 과목명 (V_class_list.과목명) — 정규화 안 된 원값 보존';
COMMENT ON COLUMN public.classes.subject IS '정규화된 과목 (수학/국어/영어/탐구). subject_raw 매칭 실패 시 NULL.';
COMMENT ON COLUMN public.classes.total_sessions IS '청구회차 (총 회차 수). V_class_list.청구회차 (decimal) 원본 보존.';
COMMENT ON COLUMN public.classes.amount_per_session IS '회차당 금액 (원). V_class_list.회차당금액. enrollments.amount 와 동일 의미.';
COMMENT ON COLUMN public.classes.total_amount IS '강좌 정가 (원). V_class_list.반수강료. 보통 amount_per_session × total_sessions 와 일치 (참고치).';
COMMENT ON COLUMN public.classes.capacity IS '정원 (V_class_list.정원)';
COMMENT ON COLUMN public.classes.schedule_days IS '요일 자유형 표기 (예: "화목"). V_class_list.요일.';
COMMENT ON COLUMN public.classes.schedule_time IS '시간 자유형 표기 (예: "18:00-22:00"). V_class_list.시간.';
COMMENT ON COLUMN public.classes.classroom IS '강의관+강의실 합친 표기 또는 강의실만. V_class_list.강의관/강의실.';
COMMENT ON COLUMN public.classes.registered_at IS '강좌 등록일 (V_class_list.등록일)';
COMMENT ON COLUMN public.classes.active IS '활성 여부. V_class_list.미사용반구분 = "Y" 면 FALSE.';
COMMENT ON COLUMN public.classes.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.classes.updated_at IS '레코드 최종 수정 시각';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_classes_branch ON public.classes (branch);
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON public.classes (teacher_name);
CREATE INDEX IF NOT EXISTS idx_classes_subject ON public.classes (subject);
CREATE INDEX IF NOT EXISTS idx_classes_active ON public.classes (active);

-- updated_at 트리거 (재실행 안전)
DROP TRIGGER IF EXISTS trg_classes_updated_at ON public.classes;
CREATE TRIGGER trg_classes_updated_at
  BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 2) RLS · students/enrollments 와 동일한 분원 격리 패턴
--    helper 함수: 0003 의 can_read_branch / can_write_branch / is_master 재사용.
--    INSERT/UPDATE 는 admin 이상 (manager/viewer 는 읽기만).
--    DELETE 는 master 만.
-- ============================================================
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classes_select_by_branch ON public.classes;
CREATE POLICY classes_select_by_branch ON public.classes
  FOR SELECT USING (public.can_read_branch(branch));

DROP POLICY IF EXISTS classes_insert_by_admin ON public.classes;
CREATE POLICY classes_insert_by_admin ON public.classes
  FOR INSERT WITH CHECK (public.can_write_branch(branch));

DROP POLICY IF EXISTS classes_update_by_admin ON public.classes;
CREATE POLICY classes_update_by_admin ON public.classes
  FOR UPDATE USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

DROP POLICY IF EXISTS classes_delete_by_master ON public.classes;
CREATE POLICY classes_delete_by_master ON public.classes
  FOR DELETE USING (public.is_master());

COMMIT;
