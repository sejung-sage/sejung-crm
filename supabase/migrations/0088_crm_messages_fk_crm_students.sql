-- ============================================================================
-- 0088_crm_messages_fk_crm_students.sql
-- crm_messages.student_id FK 타겟을 aca_students(id) → crm_students(id) 로 교체
-- ============================================================================
--
-- [의도]
--   설명회/문자 실발송 시 crm_messages.student_id 가 FK 제약을 위반해
--   live 큐 적재가 막히는 문제(schema drift)를 해소한다.
--   crm_enrollments / crm_attendances 와 동일하게 FK 타겟을 crm_students 로 맞춘다.
--
-- [근본 원인]
--   - crm_messages.student_id FK 의 제약 이름은 messages_student_id_fkey 이며,
--     0013 에서 students(id) 를 가리키도록 생성됨.
--   - 0049 에서 students → aca_students 로 RENAME 되면서 이 FK 가 자동으로
--     aca_students(id) 를 가리키게 됨 (messages → crm_messages 도 함께 rename).
--   - 0051 에서 운영용 crm_students 를 별도 신설하고 crm_enrollments /
--     crm_attendances 의 FK 는 crm_students 로 재연결했으나, crm_messages 의
--     FK 만 손대지 않아 여전히 aca_students 를 가리킴.
--   - 운영 시스템(설명회·강좌·/students)은 전부 crm_students 기준으로 동작하며
--     발송 시 student_id 에 crm_students.id 를 넣음. 특히 "CRM 내에서 직접 생성한
--     학생"은 aca_students 에 존재하지 않으므로 현재 FK 로는 무조건 위반.
--   - 지금까지 mock 발송이라 드러나지 않다가, 첫 live 큐 적재에서 터짐.
--
-- [수술 범위]
--   - 건드리는 객체: public.crm_messages 의 student_id FK 제약 1개.
--   - 데이터: crm_students 에 없는 orphan student_id 값만 NULL 로 정리(이력 보존).
--     phone 등 나머지 발송 이력 컬럼은 그대로 보존됨.
--
-- [되돌리기(down)]
--   BEGIN;
--   ALTER TABLE public.crm_messages DROP CONSTRAINT crm_messages_student_id_fkey;
--   ALTER TABLE public.crm_messages
--     ADD CONSTRAINT messages_student_id_fkey
--     FOREIGN KEY (student_id) REFERENCES public.aca_students(id) ON DELETE SET NULL;
--   COMMIT;
--   (단, aca_students 에 없는 student_id 가 NULL 로 정리된 행은 복구되지 않음)
--
-- [진단 쿼리 — 정리 대상 orphan 건수 미리보기 (실행 안 함)]
--   SELECT COUNT(*) AS orphan_count
--   FROM public.crm_messages m
--   WHERE m.student_id IS NOT NULL
--     AND NOT EXISTS (
--       SELECT 1 FROM public.crm_students s WHERE s.id = m.student_id
--     );
-- ============================================================================

BEGIN;

-- 1) orphan 정리: 새 FK(crm_students) 기준으로 존재하지 않는 student_id 를 NULL 로.
--    (과거 aca-only id 등) — FK 추가 전에 선행해야 ADD CONSTRAINT 실패를 막는다.
--    phone/발송 결과 등 나머지 이력은 보존된다.
UPDATE public.crm_messages
SET student_id = NULL
WHERE student_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.crm_students s
    WHERE s.id = public.crm_messages.student_id
  );

-- 2) 기존 FK(aca_students 를 가리킴) 제거.
ALTER TABLE public.crm_messages
  DROP CONSTRAINT messages_student_id_fkey;

-- 3) 새 FK 추가 — crm_students 를 가리킴. 학생 삭제 시 이력 보존을 위해 NULL 처리.
--    student_id 는 기존과 동일하게 nullable 유지(컬럼 정의 변경 없음).
ALTER TABLE public.crm_messages
  ADD CONSTRAINT crm_messages_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.crm_students(id) ON DELETE SET NULL;

-- 4) 한글 COMMENT — 제약 의도 및 컬럼 의미 갱신.
COMMENT ON CONSTRAINT crm_messages_student_id_fkey ON public.crm_messages IS
  '발송 대상 학생 FK. 운영 테이블 crm_students(id) 를 참조한다(0051 의 crm_enrollments/crm_attendances 와 동일 기준). 0088 에서 aca_students → crm_students 로 교체(schema drift 해소). 학생 삭제 시 발송 이력 보존을 위해 NULL 로 처리.';

COMMENT ON COLUMN public.crm_messages.student_id IS
  '학생 ID (crm_students FK, 학생 삭제 시 NULL 로 이력 보존)';

COMMIT;
