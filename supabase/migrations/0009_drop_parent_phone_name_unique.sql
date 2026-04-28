-- ============================================================
-- 0009_drop_parent_phone_name_unique.sql
-- (parent_phone, name) UNIQUE 제약 제거 + 일반 인덱스로 전환
--
-- 배경:
--   0004 에서 (parent_phone, name) 복합 UNIQUE 를 학생 식별 보조키로 추가했으나,
--   아카(Aca2000) 실 데이터로 ETL 해보니 한 V_student_list 안에서도 같은
--   (parent_phone, name) 이 다수 존재함:
--     - placeholder 행 (01000000000 / 빈 이름)
--     - 같은 학생 재등록 (학년 변경·졸업 후 재가입)
--     - 형제자매 동명이인 (드묾)
--   진짜 유일 식별은 aca2000_id ("{branch_id}-{학생_코드}") 가 담당.
--
-- 영향:
--   - F1-03 CSV Import 의 학생 매칭 정책이 (parent_phone, name) → aca2000_id 로
--     자연 이전. CSV 에 aca2000_id 없으면 새 행으로 INSERT (운영팀 수동 정리 가능).
--
-- 롤백 (수동, 단 충돌 행 정리 후):
--   DROP INDEX IF EXISTS public.idx_students_parent_phone_name;
--   CREATE UNIQUE INDEX idx_students_parent_phone_name ON public.students (parent_phone, name);
-- ============================================================

BEGIN;

-- 기존 UNIQUE 인덱스 제거
DROP INDEX IF EXISTS public.idx_students_parent_phone_name;

-- 일반 (non-unique) 인덱스로 재생성 — 검색·매칭 성능은 유지
CREATE INDEX IF NOT EXISTS idx_students_parent_phone_name
  ON public.students (parent_phone, name);

COMMENT ON INDEX public.idx_students_parent_phone_name IS
  '학부모 연락처+이름 일반 인덱스. UNIQUE 아님 — 같은 부모/이름의 다수 행 허용 (재등록·placeholder).';

COMMIT;
