-- ============================================================
-- 0004_student_key_rework.sql
-- 세정학원 CRM · 학생 식별키 재정의
-- ============================================================
--
-- 변경 의도:
--   Aca2000 탈출 이후 학생 식별을 (parent_phone, name) 복합 UNIQUE 로 전환.
--   - Aca2000 의 원본 ID 는 이관 추적용 보조키로만 유지 (NULL 허용).
--   - CSV/엑셀 이관시 자연스러운 식별(학부모 번호 + 학생 이름)을 사용.
--   - 형제자매는 이름으로 구분, 동명이인 형제는 실운영상 거의 없다고 판단.
--
-- 사용자 사전 확인 사항 (본 마이그레이션 적용 전 반드시 보장할 것):
--   1) students.parent_phone 에 NULL 레코드가 없어야 함.
--      쿼리: SELECT count(*) FROM public.students WHERE parent_phone IS NULL;
--      → 0 이 아니면 먼저 채워넣을 것. 이 마이그레이션은 단순 SET NOT NULL 만 수행.
--   2) (parent_phone, name) 조합이 중복된 레코드가 없어야 함.
--      쿼리:
--        SELECT parent_phone, name, count(*)
--        FROM public.students
--        GROUP BY parent_phone, name
--        HAVING count(*) > 1;
--      → 결과가 비어있어야 UNIQUE 인덱스 생성 성공.
--
-- 주의:
--   롤백이 깔끔하지 않음. aca2000_id NOT NULL 복귀 시 NULL 들어간 레코드는
--   별도 backfill 해야 하므로 주의. 실제 운영 적용 시 백업 필수.
-- ============================================================

BEGIN;

-- 1) parent_phone NOT NULL 전환
ALTER TABLE public.students
  ALTER COLUMN parent_phone SET NOT NULL;

-- 2) aca2000_id NOT NULL 해제 (UNIQUE 제약은 유지)
ALTER TABLE public.students
  ALTER COLUMN aca2000_id DROP NOT NULL;

-- 3) 기존 일반 인덱스 제거 (복합 UNIQUE 가 prefix 로 커버)
DROP INDEX IF EXISTS public.idx_students_parent_phone;

-- 4) 복합 UNIQUE 인덱스 추가 · 식별키
CREATE UNIQUE INDEX idx_students_parent_phone_name
  ON public.students (parent_phone, name);

COMMENT ON INDEX public.idx_students_parent_phone_name IS
  '(학부모 연락처, 이름) 복합 UNIQUE · 학생 식별 자연키';

-- 5) 한글 COMMENT 갱신
COMMENT ON COLUMN public.students.parent_phone IS
  '학부모 연락처 (PK 보조, NOT NULL, name 과 복합 UNIQUE)';

COMMENT ON COLUMN public.students.aca2000_id IS
  '아카2000 원본 ID (이관 추적 보조키, NULL 허용)';

COMMIT;
