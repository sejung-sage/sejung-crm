-- ============================================================
-- 0074_campaigns_dedupe_by_phone.sql
-- crm_campaigns 에 "동일번호 1회 발송"(중복 번호 dedupe) 토글 영속화.
--
-- 배경 (2026-05-26):
--   Aca2000(구 프로그램) SMS 화면의 "동일번호한번" 체크박스 대응.
--   한 학부모 번호(parent_phone)에 형제 N명이 묶이면 광고/안내 문자가
--   N번 중복 발송돼 문자비가 N배가 된다. 이를 1건으로 합쳐(=collapse)
--   문자비를 절감한다(프로젝트 핵심 목표: 20~30% 절감).
--
--   현재 발송 파이프라인은 학생 1명당 메시지 1건을 만든다. 같은
--   parent_phone 을 공유해도 각각 발송된다. 이 플래그가 ON 이면 발송 큐
--   적재 직전 같은 정규화 번호(`.replace(/\D/g,'')`)를 1건으로 합친다.
--
-- 왜 campaigns 에 영속화하는가:
--   즉시 발송 외에 예약 발송(dispatch-scheduled) / 드레인(drain) / 실패
--   재발송(resend-failed) 경로는 발송 시점에 수신자를 "재조회"한다. 발송
--   당시 사용자가 켠 토글 값을 그 시점에 재현하려면 campaign row 에 값이
--   저장돼 있어야 모든 경로에서 일관 적용된다. (0027 의 body/type/is_ad
--   영속화와 동일한 동기 — 발송 payload 재현성 확보.)
--
-- 변경:
--   - dedupe_by_phone BOOLEAN NOT NULL DEFAULT FALSE
--       동일 학부모 번호 N건을 1건으로 합쳐 발송할지 여부.
--       기존 행/미지정 발송은 모두 FALSE(=종전 동작: 학생 1명당 1건) 유지.
--
-- 개인화({이름}) 상호배타 정책 (애플리케이션 계약):
--   본문에 {이름} 등 학생별 개인화 변수가 있으면 dedupe 와 상호배타다.
--   합쳐진 형제 중 누구 이름을 쓸지 결정 불가 → 잘못된 이름 발송 위험.
--   이 제약은 발송 시점에 본문을 봐야 판단 가능하므로 DB CHECK 가 아니라
--   Zod/Server Action 레이어에서 강제한다(아래 컬럼 COMMENT 에 기록).
--
-- 발송 안전 가드와의 독립성:
--   [광고] prefix · 080 수신거부 footer · 21~08시 광고 차단 · 수신거부 DB
--   제외 · 비활성(탈퇴) 학생 제외 가드는 dedupe 와 무관하게 그대로 적용된다.
--   dedupe 는 가드 통과 후 eligible 목록에서 번호 기준 collapse 만 수행한다.
--
-- 안전성:
--   - 컬럼 추가만 (DROP 없음). DEFAULT FALSE 라 기존 행은 종전 동작 보존.
--   - 마이그 멱등 (IF NOT EXISTS 사용).
--   - 단일 트랜잭션.
--
-- 롤백 (수동):
--   ALTER TABLE public.crm_campaigns
--     DROP COLUMN IF EXISTS dedupe_by_phone;
-- ============================================================

BEGIN;

ALTER TABLE public.crm_campaigns
  ADD COLUMN IF NOT EXISTS dedupe_by_phone BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.crm_campaigns.dedupe_by_phone IS
  '동일번호 1회 발송 여부. TRUE 면 같은 학부모 번호(parent_phone 정규화 기준) N건을 1건으로 합쳐 발송해 문자비를 절감한다(형제 중복 방지). 본문에 {이름} 등 개인화 변수가 있으면 상호배타 — 애플리케이션 레이어에서 dedupe 비활성. 기본 FALSE(학생 1명당 1건).';

COMMIT;
