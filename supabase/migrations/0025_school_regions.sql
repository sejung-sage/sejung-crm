-- ============================================================
-- 0025_school_regions.sql
-- public.school_regions · 학교 → 지역(구/시) 매핑 테이블
--
-- 배경:
--   원장 요청 — 학생 명단 / 발송 그룹 필터에서 "강남구", "서초구" 같은
--   지역 단위로 모아보고 싶다.  students.school 은 자유 텍스트 ("휘문고",
--   "포스코고") 라서 학교명만으로는 지역을 알 수 없음.  학교 → 지역 매핑을
--   별도 테이블로 두고, student_profiles 뷰에서 LEFT JOIN 후 미매칭은
--   '기타' 로 fallback 한다 (0026 마이그).
--
--   운영자(admin) UI 에서 자유롭게 지역명을 추가/수정 가능해야 하므로
--   region 컬럼에는 CHECK enum 제약을 두지 않는다.  단 빈/공백만 차단.
--
-- 자연키:
--   school 자체가 PK.  school 은 students.school 과 정확 일치 (TEXT).
--   동일 학교가 두 지역에 매핑될 일은 없다 — 1:1.
--
-- 멱등성:
--   - CREATE TABLE / INDEX / TRIGGER 모두 IF (NOT) EXISTS.
--   - DROP POLICY IF EXISTS 선행 후 CREATE POLICY.
--   - 시드는 INSERT ... ON CONFLICT (school) DO UPDATE 로 재실행 안전.
--
-- 롤백 (수동):
--   BEGIN;
--     DROP TABLE IF EXISTS public.school_regions CASCADE;
--     -- student_profiles 뷰는 0026 롤백에서 함께 0018 정의로 복원.
--   COMMIT;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) 테이블 정의
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_regions (
  school     TEXT PRIMARY KEY,
  region     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_regions_region_nonblank
    CHECK (length(trim(region)) > 0)
);

COMMENT ON TABLE public.school_regions IS
  '학교 → 지역(구/시) 매핑. 학생 명단/발송 그룹의 지역 필터에 사용. 운영자가 admin UI 에서 자유 편집 가능.';
COMMENT ON COLUMN public.school_regions.school IS
  '학교명 PK (예: "휘문고"). students.school 과 정확 일치하는 자연키.';
COMMENT ON COLUMN public.school_regions.region IS
  '지역명 (예: "강남구", "서초구", "송파구", "인천 송도"). 자유 텍스트 — 운영자가 admin UI 에서 새 지역 임의 추가 가능. 빈/공백만 CHECK 로 차단.';
COMMENT ON COLUMN public.school_regions.created_at IS '레코드 생성 시각';
COMMENT ON COLUMN public.school_regions.updated_at IS '레코드 최종 수정 시각';

COMMENT ON CONSTRAINT school_regions_region_nonblank ON public.school_regions IS
  'region 빈 문자열/공백-only 방지. enum 자유성을 유지하면서도 무의미 입력만 차단.';


-- ------------------------------------------------------------
-- 2) 인덱스 — 지역별 학교 조회 (예: "강남구의 학교 모두") 자주.
--   PK 인덱스는 school 만 다루므로 region 별도 인덱스 필요.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_school_regions_region
  ON public.school_regions (region);


-- ------------------------------------------------------------
-- 3) updated_at 트리거 (0001/0015 의 set_updated_at() 재사용)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_school_regions_updated_at ON public.school_regions;
CREATE TRIGGER trg_school_regions_updated_at
  BEFORE UPDATE ON public.school_regions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ------------------------------------------------------------
-- 4) RLS — templates 와 동일한 "전사 공용" 패턴
--   SELECT: 모든 활성 사용자 (지역 필터는 전사 공용 메타데이터)
--   INSERT/UPDATE/DELETE: master / admin 만 (운영자 권한)
-- ------------------------------------------------------------
ALTER TABLE public.school_regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_regions_read_all ON public.school_regions;
CREATE POLICY school_regions_read_all ON public.school_regions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.user_id = auth.uid() AND up.active = TRUE
    )
  );

DROP POLICY IF EXISTS school_regions_write_by_admin ON public.school_regions;
CREATE POLICY school_regions_write_by_admin ON public.school_regions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.user_id = auth.uid()
        AND up.active = TRUE
        AND up.role IN ('master', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users_profile up
      WHERE up.user_id = auth.uid()
        AND up.active = TRUE
        AND up.role IN ('master', 'admin')
    )
  );


-- ------------------------------------------------------------
-- 5) 초기 시드 (UPSERT — 멱등)
--   원장 인터뷰 기준 주요 학교 매핑.  운영 중 admin UI 에서 추가/수정.
-- ------------------------------------------------------------
INSERT INTO public.school_regions (school, region) VALUES
  -- 강남구
  ('휘문고',   '강남구'),
  ('현대고',   '강남구'),
  ('숙명여고', '강남구'),
  ('단대부고', '강남구'),
  ('경기고',   '강남구'),
  ('중동고',   '강남구'),
  ('경기여고', '강남구'),
  ('진선여고', '강남구'),
  ('중대부고', '강남구'),
  ('영동고',   '강남구'),
  ('중산고',   '강남구'),
  ('압구정고', '강남구'),
  -- 서초구
  ('세화고',   '서초구'),
  ('세화여고', '서초구'),
  ('상문고',   '서초구'),
  ('서문여고', '서초구'),
  ('서울고',   '서초구'),
  ('반포고',   '서초구'),
  ('동덕여고', '서초구'),
  ('서초고',   '서초구'),
  ('양재고',   '서초구'),
  -- 송파구
  ('보인고',   '송파구'),
  -- 인천 송도
  ('포스코고', '인천 송도'),
  ('송도고',   '인천 송도'),
  ('해송고',   '인천 송도'),
  ('신송고',   '인천 송도')
ON CONFLICT (school) DO UPDATE
  SET region     = EXCLUDED.region,
      updated_at = NOW();

COMMIT;
