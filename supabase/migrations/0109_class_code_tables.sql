-- ============================================================
-- 0109_class_code_tables.sql
-- 강의코드 저장용 CRM 전용 테이블 2개.
-- ------------------------------------------------------------
-- 배경(2026-07-14 확정 규칙, Notion "강의 코드 정리"):
--   강의코드 형식 [연도][분원][과목][학년][구분][강사][순번] 를 강의별로 부여한다.
--   예: 26#RY 국현식T 고3 수학 → 26-DC-MA-H3-S-010-01
--
-- 왜 별도 테이블인가:
--   crm_classes 는 apply_aca_to_crm() 이 'INSERT INTO crm_classes SELECT * FROM
--   aca_classes' (위치 기반)로 채운다(0101). crm_classes 에 컬럼을 직접 추가하면
--   컬럼 수가 어긋나 ETL 동기화가 통째로 깨진다(0073 주석 참조). 그래서 코드는
--   crm_classes.id 를 참조하는 별도 테이블에 저장한다 — crm_class_signup_pages(0084)
--   와 동일 패턴. ETL 과 완전히 분리돼 재동기화에 영향받지 않는다.
--
-- 테이블:
--   crm_teacher_codes  강사명 → 3자리 번호(가나다순). 더미(세정T·ST·YT)는 code=NULL.
--                      별칭(문브라더스→문브라더스T, 혁명이승혁T→혁명T)은 정식 번호 공유.
--                      신규 강사는 append. 코드 생성기가 강사 자리 해석에 참조.
--   crm_class_codes    crm_classes.id → 강의코드 문자열. 생성기가 백필/재생성해 upsert.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) 강사 코드표
-- ------------------------------------------------------------
CREATE TABLE public.crm_teacher_codes (
  teacher_name text PRIMARY KEY,
  code         text,
  is_dummy     boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.crm_teacher_codes IS
  '강사명 → 강의코드용 3자리 번호(가나다순 001~). 더미(설명회/독학관 placeholder)는 code=NULL·is_dummy=true → 코드에서 강사 자리 생략. 별칭 강사명은 정식 강사 번호를 공유.';
COMMENT ON COLUMN public.crm_teacher_codes.teacher_name IS '강사명 원본(crm_classes.teacher_name 과 매칭). 별칭 이름도 행으로 존재.';
COMMENT ON COLUMN public.crm_teacher_codes.code IS '3자리 강사 번호(문자, 앞자리 0 보존). 더미는 NULL.';
COMMENT ON COLUMN public.crm_teacher_codes.is_dummy IS '실제 강사가 아닌 placeholder(세정T=설명회·ST=독학관·YT=프로그램) 여부.';

INSERT INTO public.crm_teacher_codes (teacher_name, code, is_dummy) VALUES
  ('강슬기T', '001', false),
  ('강용범T', '002', false),
  ('강지연T', '003', false),
  ('강형종T', '004', false),
  ('고연승T', '005', false),
  ('고정민T', '006', false),
  ('곽서진T', '007', false),
  ('곽정혁T', '008', false),
  ('구본경T', '009', false),
  ('국현식T', '010', false),
  ('권녹영T', '011', false),
  ('권미나T', '012', false),
  ('권정미T', '013', false),
  ('금현윤T', '014', false),
  ('김강용T', '015', false),
  ('김강우T', '016', false),
  ('김강현T', '017', false),
  ('김경현T', '018', false),
  ('김관수T', '019', false),
  ('김규희T', '020', false),
  ('김기대T', '021', false),
  ('김기배T', '022', false),
  ('김나영T', '023', false),
  ('김다희T', '024', false),
  ('김동준T', '025', false),
  ('김미성T', '026', false),
  ('김미향T', '027', false),
  ('김민성T', '028', false),
  ('김범구T', '029', false),
  ('김성재T', '030', false),
  ('김세연T', '031', false),
  ('김세영T', '032', false),
  ('김세준T', '033', false),
  ('김수희T', '034', false),
  ('김승미T', '035', false),
  ('김영민T', '036', false),
  ('김영부T', '037', false),
  ('김원태T', '038', false),
  ('김은비T', '039', false),
  ('김재연T', '040', false),
  ('김재현T', '041', false),
  ('김재호T', '042', false),
  ('김정규T', '043', false),
  ('김정림T', '044', false),
  ('김정연T', '045', false),
  ('김정원T', '046', false),
  ('김종우T', '047', false),
  ('김주하T', '048', false),
  ('김준호T', '049', false),
  ('김지인T', '050', false),
  ('김지혁T', '051', false),
  ('김지형T', '052', false),
  ('김지훈T', '053', false),
  ('김진영T', '054', false),
  ('김찬T', '055', false),
  ('김태환T', '056', false),
  ('김한울T', '057', false),
  ('김현곤T', '058', false),
  ('김현종T', '059', false),
  ('김형모T', '060', false),
  ('김형택T', '061', false),
  ('김혜강T', '062', false),
  ('김효진T', '063', false),
  ('김휘영T', '064', false),
  ('남궁원T', '065', false),
  ('남휘종T', '066', false),
  ('노강영T', '067', false),
  ('류승오T', '068', false),
  ('마로리T', '069', false),
  ('모예림T', '070', false),
  ('문브라더스', '072', false),
  ('문브라더스T', '072', false),
  ('문현수T', '073', false),
  ('바울T', '074', false),
  ('박대준T', '075', false),
  ('박민용T', '076', false),
  ('박병준T', '077', false),
  ('박성호T', '078', false),
  ('박영찬T', '079', false),
  ('박용재T', '080', false),
  ('박장원T', '081', false),
  ('박정인T', '082', false),
  ('박지원T', '083', false),
  ('박진아T', '084', false),
  ('박천익T', '085', false),
  ('박치욱T', '086', false),
  ('배인영T', '087', false),
  ('배정기T', '088', false),
  ('백봉용T', '089', false),
  ('백현우T', '090', false),
  ('서성록T', '091', false),
  ('서유택T', '092', false),
  ('서이현T', '093', false),
  ('서지민T', '094', false),
  ('선승범T', '095', false),
  ('선화희T', '096', false),
  ('세정T', NULL, true),
  ('션T', '098', false),
  ('소순영T', '099', false),
  ('손나래T', '100', false),
  ('손석표T', '101', false),
  ('손용문T', '102', false),
  ('손윤희T', '103', false),
  ('손해광T', '104', false),
  ('송명환T', '105', false),
  ('송민정T', '106', false),
  ('송정화T', '107', false),
  ('송주연T', '108', false),
  ('송필립T', '109', false),
  ('송화림T', '110', false),
  ('신기철T', '111', false),
  ('신수영T', '112', false),
  ('신숙원T', '113', false),
  ('신용화T', '114', false),
  ('신우림T', '115', false),
  ('신준섭T', '116', false),
  ('신지현T', '117', false),
  ('심세희T', '118', false),
  ('심윤우T', '119', false),
  ('심재열T', '120', false),
  ('써니T', '121', false),
  ('안민형T', '122', false),
  ('안상후T', '123', false),
  ('안중훈T', '124', false),
  ('안철우T', '125', false),
  ('안현남T', '126', false),
  ('양장섭T', '127', false),
  ('양형준T', '128', false),
  ('양희진T', '129', false),
  ('엄기은T', '130', false),
  ('엄용성T', '131', false),
  ('오르새T', '132', false),
  ('우마리아T', '133', false),
  ('원정의T', '134', false),
  ('위정혜T', '135', false),
  ('유대종T', '136', false),
  ('유명현T', '137', false),
  ('유승재T', '138', false),
  ('유현주T', '139', false),
  ('유현준T', '140', false),
  ('윤나훈T', '141', false),
  ('윤미성T', '142', false),
  ('윤민T', '143', false),
  ('윤민혁T', '144', false),
  ('윤봉희T', '145', false),
  ('윤수빈T', '146', false),
  ('윤시원T', '147', false),
  ('윤여숙T', '148', false),
  ('윤원중T', '149', false),
  ('윤혜은T', '150', false),
  ('이경민T', '151', false),
  ('이관우T', '152', false),
  ('이광희T', '153', false),
  ('이다지T', '154', false),
  ('이민성T', '155', false),
  ('이상복T', '156', false),
  ('이상혁T', '157', false),
  ('이세경T', '158', false),
  ('이소영T', '159', false),
  ('이수영T', '160', false),
  ('이영훈T', '161', false),
  ('이예섭T', '162', false),
  ('이유나T', '163', false),
  ('이윤정T', '164', false),
  ('이은직T', '165', false),
  ('이재령T', '166', false),
  ('이재현T', '167', false),
  ('이재호T', '168', false),
  ('이정수T', '169', false),
  ('이종원T', '170', false),
  ('이준석T', '171', false),
  ('이준환T', '172', false),
  ('이지연T', '173', false),
  ('이지혜T', '174', false),
  ('이지호T', '175', false),
  ('이진아T', '176', false),
  ('이하영T', '177', false),
  ('이해진T', '178', false),
  ('이현아T', '179', false),
  ('이형수T', '180', false),
  ('이훈섭T', '181', false),
  ('임동호T', '182', false),
  ('임정현T', '183', false),
  ('임해성T', '184', false),
  ('장해든누리T', '185', false),
  ('정석민T', '186', false),
  ('정승호T', '187', false),
  ('정양규T', '188', false),
  ('정우성T', '189', false),
  ('정윤제T', '190', false),
  ('정을T', '191', false),
  ('정해국T', '192', false),
  ('정훈구T', '193', false),
  ('제임스송T', '194', false),
  ('조혜수T', '195', false),
  ('주성우T', '196', false),
  ('주재선T', '197', false),
  ('지오T', '198', false),
  ('차해나T', '199', false),
  ('최낙현T', '200', false),
  ('최대한T', '201', false),
  ('최민석T', '202', false),
  ('최오성T', '203', false),
  ('최우석T', '204', false),
  ('최우식T', '205', false),
  ('최원영T', '206', false),
  ('최지수T', '207', false),
  ('최택T', '208', false),
  ('최현우T', '209', false),
  ('최형란T', '210', false),
  ('추상혁T', '211', false),
  ('카렌T', '212', false),
  ('표혜영T', '213', false),
  ('하지웅T', '214', false),
  ('한강T', '215', false),
  ('한지우T', '216', false),
  ('허선행T', '217', false),
  ('혁명T', '218', false),
  ('혁명이승혁T', '218', false),
  ('현자의돌T', '220', false),
  ('홍승재T', '221', false),
  ('홍지운T', '222', false),
  ('황길주T', '223', false),
  ('황보휘T', '224', false),
  ('황신호T', '225', false),
  ('황인환T', '226', false),
  ('황진형T', '227', false),
  ('ST', NULL, true),
  ('YT', NULL, true);

-- ------------------------------------------------------------
-- 2) 강의코드 저장
-- ------------------------------------------------------------
CREATE TABLE public.crm_class_codes (
  class_id     uuid PRIMARY KEY REFERENCES public.crm_classes(id) ON DELETE CASCADE,
  lecture_code text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.crm_class_codes IS
  '강의별 강의코드(2026-07-14 규칙). 생성기가 강의명·분원·과목·강사에서 파생해 upsert. crm_classes.id 참조 — ETL(apply_aca_to_crm)과 분리돼 재동기화에 안 덮인다.';
COMMENT ON COLUMN public.crm_class_codes.class_id IS 'crm_classes.id (FK). 강의 삭제 시 CASCADE.';
COMMENT ON COLUMN public.crm_class_codes.lecture_code IS '강의코드 문자열 예: 26-DC-MA-H3-S-010-01. 없는 자리는 생략.';

CREATE INDEX idx_crm_class_codes_code ON public.crm_class_codes (lecture_code);

-- ------------------------------------------------------------
-- 3) RLS — 읽기: 로그인 사용자 전원(코드는 분원 민감정보 아님). 쓰기: master.
--    백필/재생성은 service role(RLS 우회)로 수행.
-- ------------------------------------------------------------
ALTER TABLE public.crm_teacher_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_class_codes   ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_teacher_codes_read ON public.crm_teacher_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY crm_teacher_codes_write ON public.crm_teacher_codes
  FOR ALL TO authenticated USING (public.is_master()) WITH CHECK (public.is_master());

CREATE POLICY crm_class_codes_read ON public.crm_class_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY crm_class_codes_write ON public.crm_class_codes
  FOR ALL TO authenticated USING (public.is_master()) WITH CHECK (public.is_master());

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP TABLE IF EXISTS public.crm_class_codes;
-- DROP TABLE IF EXISTS public.crm_teacher_codes;
-- COMMIT;
-- ============================================================
