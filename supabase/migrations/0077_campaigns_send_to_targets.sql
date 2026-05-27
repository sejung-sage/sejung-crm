-- ============================================================
-- 0077_campaigns_send_to_targets.sql
-- crm_campaigns 에 "발송 대상 번호 선택"(학부모/학생) 영속화.
--
-- 배경 (2026-05-27, 박은주 부원장 요청):
--   Aca2000(구 프로그램) SMS 화면은 "학부모" / "학생" 두 개의 독립
--   체크박스를 제공한다. 둘 다 체크하면 학부모 번호와 학생 번호 양쪽으로
--   같은 문자를 보낸다. 세정 운영 기본값은 대표번호(=학부모) 단독 발송이며,
--   학생 번호 단독, 또는 학부모·학생 동시 발송 케이스도 대응해야 한다.
--
--   crm_students 에는 parent_phone(학부모 대표번호)·phone(학생 개인번호)
--   두 컬럼이 모두 존재한다. 종전 발송 파이프라인은 parent_phone 단일만
--   사용했다. 이 두 플래그가 한 학생을 0~2개의 발송 레그(leg)로 확장한다:
--     - 학부모 레그: send_to_parent = TRUE 이고 parent_phone 이 존재할 때
--     - 학생   레그: send_to_student = TRUE 이고 phone 이 존재할 때
--   번호가 없는 레그는 스킵한다(학생 1명이 0·1·2건이 될 수 있음).
--
-- 왜 2-boolean 인가 (enum 'parent'|'student'|'both' 대비 결정 근거):
--   1) Aca2000 UI 와 1:1 대응 — 독립 체크박스 2개. "둘 다" 가 별도 enum
--      값이 아니라 두 체크가 모두 켜진 자연스러운 상태로 표현된다.
--   2) "학부모만 / 학생만 / 둘 다" 3-상태는 두 boolean 의 4조합 중 3개로
--      그대로 표현된다. enum 으로 가면 동일 의미를 별도 매핑 레이어로
--      이중 관리해야 한다.
--   3) 확장성 — 향후 "조부모 번호" 등 대상이 추가돼도 컬럼 1개 추가로 끝난다.
--      enum 은 값이 늘 때마다 조합 폭발('parent+grandparent' 등)이 일어난다.
--   4) 레그 확장 로직(번호 존재 시에만 발송)이 boolean 두 개를 독립 평가하는
--      형태라 코드가 단순하다.
--   유일한 함정인 "둘 다 false"(=발송 대상 없음)는 아래 CHECK 제약 +
--   Zod refine 의 이중 가드로 막는다.
--
-- 변경:
--   - send_to_parent  BOOLEAN NOT NULL DEFAULT TRUE
--       학부모 대표번호(parent_phone)로 발송할지. 세정 운영 기본값 = 발송.
--   - send_to_student BOOLEAN NOT NULL DEFAULT FALSE
--       학생 개인번호(phone)로 발송할지. 기본값 = 미발송.
--   기존 행은 DEFAULT 로 (parent=TRUE, student=FALSE) 가 채워져 종전 동작
--   (학부모 단독 발송)이 그대로 보존된다.
--
-- CHECK 제약 (둘 다 false 금지):
--   chk_campaigns_send_target — send_to_parent OR send_to_student 가 항상
--   참이어야 한다. 발송 대상이 0개인 캠페인은 의미가 없고, 레그 확장 결과가
--   무조건 0건이 되어 "수신자 없음" 으로만 끝나기 때문에 DB 레벨에서 차단.
--   (애플리케이션 Zod refine 이 1차 방어, 이 CHECK 가 최종 방어.)
--
-- dedupe(동일번호 1회 발송)와의 상호작용 (애플리케이션 계약):
--   레그 확장 → 발송 안전 가드(레그별 번호 기준) → dedupe(collapseByPhone)
--   순으로 적용한다. 학부모/학생 번호가 우연히 같거나, 형제가 같은 학부모
--   번호를 공유하는 경우 dedupe ON 이면 정규화 번호 기준으로 1건으로 합쳐진다.
--   dedupe 는 0074 의 dedupe_by_phone 플래그가 좌우하며 본 마이그와 독립이다.
--
-- 발송 안전 가드와의 독립성:
--   [광고] prefix · 080 수신거부 footer · 21~08시 광고 차단 · 비활성(탈퇴)
--   제외 가드는 본 변경과 무관하게 그대로 적용된다. 수신거부 DB 제외는
--   "레그의 번호" 기준으로 독립 판정한다 — 학생 번호 수신거부와 학부모 번호
--   수신거부를 따로 본다(한쪽이 거부돼도 다른 레그는 발송 가능).
--
-- 안전성:
--   - 컬럼 추가 + CHECK 추가만 (DROP 없음). DEFAULT 로 기존 행 동작 보존.
--   - 마이그 멱등 (ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS 선행).
--   - 단일 트랜잭션.
--
-- 롤백 (수동):
--   ALTER TABLE public.crm_campaigns
--     DROP CONSTRAINT IF EXISTS chk_campaigns_send_target;
--   ALTER TABLE public.crm_campaigns
--     DROP COLUMN IF EXISTS send_to_parent,
--     DROP COLUMN IF EXISTS send_to_student;
-- ============================================================

BEGIN;

ALTER TABLE public.crm_campaigns
  ADD COLUMN IF NOT EXISTS send_to_parent BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.crm_campaigns
  ADD COLUMN IF NOT EXISTS send_to_student BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.crm_campaigns.send_to_parent IS
  '학부모 대표번호(crm_students.parent_phone)로 발송할지 여부. TRUE 면 학부모 레그를 생성한다(번호 없으면 스킵). 세정 운영 기본값 TRUE. send_to_student 와 독립이며 둘 다 TRUE 면 한 학생이 학부모·학생 양쪽으로 최대 2건 발송된다. 둘 다 FALSE 는 CHECK(chk_campaigns_send_target)로 금지.';

COMMENT ON COLUMN public.crm_campaigns.send_to_student IS
  '학생 개인번호(crm_students.phone)로 발송할지 여부. TRUE 면 학생 레그를 생성한다(번호 없으면 스킵). 기본값 FALSE. send_to_parent 와 독립. 둘 다 FALSE 는 CHECK(chk_campaigns_send_target)로 금지. 수신거부 제외는 레그의 번호 기준으로 독립 판정한다.';

-- 둘 다 FALSE 금지 — 발송 대상이 0개인 캠페인 차단 (Zod refine 의 최종 방어선).
-- 멱등 재적용을 위해 기존 동명 제약을 먼저 제거.
ALTER TABLE public.crm_campaigns
  DROP CONSTRAINT IF EXISTS chk_campaigns_send_target;

ALTER TABLE public.crm_campaigns
  ADD CONSTRAINT chk_campaigns_send_target
  CHECK (send_to_parent OR send_to_student);

COMMENT ON CONSTRAINT chk_campaigns_send_target ON public.crm_campaigns IS
  '발송 대상(학부모/학생) 중 최소 하나는 선택되어야 한다. 둘 다 FALSE 인 캠페인은 발송 레그가 0개라 무의미하므로 차단.';

COMMIT;
