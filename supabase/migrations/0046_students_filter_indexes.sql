-- 0046_students_filter_indexes.sql
-- 학생 명단 필터·정렬 가속용 composite 인덱스.
--
-- 배경 (2026-05-18):
--   사용자 보고: 학년 칩(고1·고2) 토글 시 결과 반영이 느림. listStudents 가
--   student_profiles 뷰(LEFT JOIN enrollments + attendances + GROUP BY) 를
--   페이지네이션하는 구조라 6만 학생 풀 materialize 후 LIMIT 적용 → 큰 비용.
--
--   추가로 코드 리팩토링으로 2단계 fetch (students 에서 id 만 좁힌 후 그 id IN
--   으로 student_profiles 작은 set 만 view) 도입. 그 1단계의 WHERE/ORDER 가
--   인덱스를 잘 타도록 composite 인덱스 추가.
--
-- 추가 인덱스:
--   1) students(branch, status, school_level, grade) — 학생 명단 default 필터
--      조합. 분원(첫 컬럼) → 상태(재원생 default) → 학교급 → 학년 순.
--   2) students(branch, registered_at DESC) — default 정렬(최근 등록순).
--   3) students(branch, name) — name 정렬용.
--   4) students(school) — '학교' 다중 필터용. NULL 제외.
--
-- 안전:
--   - CREATE INDEX IF NOT EXISTS — 재실행 안전.
--   - CONCURRENTLY 는 트랜잭션 안에서 못 씀 → BEGIN/COMMIT 없이 각 인덱스
--     별로 자동 commit. 6만 row 인덱스 생성은 보통 수초.
--   - 인덱스는 추가만 — 기존 쿼리·plan 깨지지 않음 (planner 가 알아서 선택).
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_students_branch_status_level_grade;
--   DROP INDEX IF EXISTS idx_students_branch_registered_at;
--   DROP INDEX IF EXISTS idx_students_branch_name;
--   DROP INDEX IF EXISTS idx_students_school;

-- branch + status + school_level + grade composite — 가장 자주 사용되는 WHERE 조합.
CREATE INDEX IF NOT EXISTS idx_students_branch_status_level_grade
  ON public.students (branch, status, school_level, grade);

-- branch + registered_at DESC — 기본 정렬(최근 등록순).
CREATE INDEX IF NOT EXISTS idx_students_branch_registered_at
  ON public.students (branch, registered_at DESC NULLS LAST);

-- branch + name — 이름 가나다 정렬.
CREATE INDEX IF NOT EXISTS idx_students_branch_name
  ON public.students (branch, name);

-- school — 학교 다중 필터. partial (NULL 제외) 로 인덱스 가벼움.
CREATE INDEX IF NOT EXISTS idx_students_school
  ON public.students (school)
  WHERE school IS NOT NULL;

COMMENT ON INDEX public.idx_students_branch_status_level_grade IS
  '학생 명단 default 필터(branch + status=재원생 + 학교급 + 학년) 가속. 0046 추가.';
COMMENT ON INDEX public.idx_students_branch_registered_at IS
  '기본 정렬(최근 등록순) 가속. 0046 추가.';
COMMENT ON INDEX public.idx_students_branch_name IS
  '이름 가나다 정렬 가속. 0046 추가.';
COMMENT ON INDEX public.idx_students_school IS
  '학교 다중 필터(IN) 가속. partial — NULL 제외. 0046 추가.';
