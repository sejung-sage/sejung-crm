-- ============================================================
-- 0108_normalize_student_phone_digits.sql
-- crm_students 의 번호 표기를 숫자만으로 통일한다.
-- ------------------------------------------------------------
-- 배경:
--   ETL(scripts/etl/migrate_students.py 의 normalize_phone)은 항상 숫자만 저장한다.
--   그러나 CRM 화면의 학생 등록(createStudentAction)이 입력값을 정규화 없이 그대로
--   INSERT 해서, 수동 등록 행(aca2000_id LIKE 'MANUAL-%')에만 하이픈 표기가 섞였다.
--   2026-07-09 시점 parent_phone 107,745 건 중 정확히 4 건이 하이픈 표기였다.
--   (공백·괄호·+ 등 다른 비숫자 문자가 든 행은 0 건임을 확인했다.)
--
--   이 표기 불일치가 0106 의 수신거부 등가 비교(`u.phone = s.parent_phone`)를 그 4 건에
--   대해 조용히 무력화시켰다. 0107 이 비교식을 정규화해 발송 가드 자체는 표기와
--   무관해졌고, 애플리케이션의 저장 경로도 숫자만 저장하도록 고쳤다.
--   본 마이그레이션은 남아 있는 기존 행을 정리한다.
--
-- 안전성:
--   - parent_phone 은 **NOT NULL** 이다(0004). 따라서 절대 NULL 로 만들지 않는다.
--     정규화 결과가 빈 문자열이 될 행은 아예 건드리지 않는다(WHERE 에서 배제).
--     현재 그런 행은 없지만, 마이그레이션이 데이터 상태에 의존해 실패하지 않게 한다.
--   - (parent_phone, name) 복합 UNIQUE 는 0009 에서 제거됐다. 정규화로 인한 유니크
--     충돌은 발생하지 않는다. (아래 COMMENT 도 그에 맞춰 정정한다 — 기존 코멘트는
--     0009 이후 갱신되지 않아 "PK 보조, 복합 UNIQUE" 라는 낡은 설명이 남아 있었다.)
--   - phone(학생 본인)은 NULL 허용. 현재 위반 행 0 건이나 같은 유입 경로를 공유하므로
--     함께 정리한다. 숫자가 하나도 없던 값은 NULL 로 둔다(빈 문자열은 "번호 있음" 으로
--     오인돼 발송 레그가 만들어질 수 있다).
--   - 표시 계층은 src/lib/phone.ts 의 formatPhone 이 숫자를 받아 하이픈을 붙이므로
--     화면 출력은 바뀌지 않는다.
--
-- CHECK 제약은 걸지 않는다. crm_students 는 ETL 이 대량 upsert 하는 테이블이라,
-- 예기치 못한 값 하나가 동기화 전체를 실패시키는 위험이 이득보다 크다. 발송 가드는
-- 0107 로 이미 표기에 의존하지 않는다.
--
-- 롤백: 원래 표기를 복원할 수 없다(데이터 정정). 되돌리지 않는다.
-- ============================================================

BEGIN;

-- 학부모 연락처 — 숫자만 남긴다. NOT NULL 이라 빈 결과가 되는 행은 건드리지 않는다.
UPDATE public.crm_students
   SET parent_phone = regexp_replace(parent_phone, '[^0-9]', '', 'g')
 WHERE parent_phone IS NOT NULL
   AND parent_phone <> regexp_replace(parent_phone, '[^0-9]', '', 'g')
   AND regexp_replace(parent_phone, '[^0-9]', '', 'g') <> '';

-- 학생 본인 번호 — NULL 허용이라 숫자가 없던 값은 NULL 로.
UPDATE public.crm_students
   SET phone = NULLIF(regexp_replace(phone, '[^0-9]', '', 'g'), '')
 WHERE phone IS NOT NULL
   AND phone <> regexp_replace(phone, '[^0-9]', '', 'g');

COMMENT ON COLUMN public.crm_students.parent_phone IS
  '학부모 연락처 (발송 주 대상. NOT NULL. 하이픈 없는 숫자만 — ETL·수동등록 공통 규약)';

COMMENT ON COLUMN public.crm_students.phone IS
  '학생 연락처 (하이픈 없는 숫자만. 없으면 NULL)';

COMMIT;
