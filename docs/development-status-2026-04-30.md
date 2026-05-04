# 세정학원 CRM 개발 현황

**기준일**: 2026-04-30
**저장소**: github.com/sejung-sage/sejung-crm
**스택**: Next.js 15 (App Router) · TypeScript strict · Supabase (PostgreSQL 15) · Tailwind + shadcn/ui · 솔라피(SMS)
**배포**: Vercel (hnd1 도쿄 리전)

---

## 한 줄 요약

Aca2000 의 학생·강좌·수강·출결 데이터를 Supabase 로 이관하고, 분원·과목·강사·요일·출석률 기준으로 빠르게 조회·필터·정렬·문자 발송 그룹을 구성할 수 있는 행정팀용 CRM. MVP F1~F4 (학생 명단 / 발송 그룹 / 문자 발송 / 계정 권한) 기본 골격 + 강좌 모듈 + 출결 격자 + 정렬·필터링 강화까지 1차 완료.

---

## 1. 완료된 기능

### 1.1 데이터 모델 (Supabase 마이그레이션 0001~0019)

| # | 마이그레이션 | 내용 |
|---|---|---|
| 0001 | initial_schema | students / enrollments / attendances / groups / templates / campaigns / messages / users_profile / unsubscribes |
| 0002 | student_profiles_view | 학생 + 수강·출석 집계 뷰 |
| 0003 | rls_policies | 분원별 RLS, master/admin/manager/viewer 권한 함수 |
| 0004~0007 | 보강 | student_key 재구성, templates 광고 플래그, users_profile, messages 테스트 플래그 |
| 0008~0012 | 학생 스키마 | grade 자유형 → 9종 enum 정규화 (중1~고3/재수/졸업/미정), school_level 도출, parent_phone 제약 완화 |
| 0013 | 복구 | prod 누락된 groups/templates/messages 테이블·정책 재생성 |
| 0014 | 대학교 = 졸업 | school ILIKE '%대학교%' 학생을 졸업으로 분류 |
| 0015 | classes 테이블 | 강좌 마스터 (반명·강사·과목·요일·시간·정원·청구회차·회차당금액·정가·등록일·active) |
| 0016 | enrollments 링크 | enrollments.aca_class_id (FK 없는 매칭 키) |
| 0017 | attendances 추적 | attendances.aca_attendance_id UNIQUE (idempotent UPSERT) |
| 0018 | 보강 status | attendances.status 5종 확장 (출석/지각/결석/조퇴/**보강**), aca_class_id 추가, 출석률 계산에 보강 인정 |
| 0019 | 개강일 | classes.start_date + 백필 (enrollments.start_date MIN) |

### 1.2 학생 관리 (`/students`)

- **명단 페이지**: 분원·학년·학교급·계열·재원상태 필터, 검색 (이름/학교/학부모번호), 페이지네이션
- **정렬·필터 강화** (2026-04-30):
  - 추가 필터: **과목 / 강사 / 학교** (다중 선택)
  - 정렬 8종: 등록일·이름·**출석률**·수강횟수·누적결제 (각 ASC/DESC)
  - 강사·학교 옵션은 prefetch (분원별)
- **상세 페이지** (`/students/[id]`):
  - 프로필 헤더, KPI 4종 (총 수강 / 출석률 / 결석 / 누적결제)
  - 수강 이력: 회당단가 × 회차 = 총액 표시
  - **출석 강좌×일자 격자**: 강좌별 row, 일자 column, 출/지/결/조/보 칩
  - 발송 이력 탭

### 1.3 강좌 관리 (`/classes`)

- **리스트 페이지**: 검색 (반명/강사명), 분원/과목/강사/요일 필터, 미사용 강좌 토글, 정렬 13종
  - 정렬: 기본(분원>과목>반명) / 등록일 / **개강일** / 반명 / 수강생 수 / 정원 / 회당단가 / 총회차
- **상세 페이지** (`/classes/[id]`):
  - 헤더 메타: 분원·과목·강사·요일/시간·정원·**개강일**·회차×단가=정가
  - KPI 4종 (수강생 수 / 평균 출석률 / 누적 결석 / 누적 보강)
  - 수강생 명단: 학생별 출/결/지/조/보 카운트 + 학생 상세 링크
  - **출석 학생×일자 격자**: 학생들 row, 일자 column

### 1.4 발송 그룹 (`/groups`)

- 그룹 CRUD
- 수신자 조건: 학년·학교·과목 다중 선택
- **수신자 미리보기**: 실시간 카운트 + 상위 5명 샘플 (1000-cap 버그 수정)

### 1.5 문자 발송 (`/campaigns`)

- 새 발송 작성, 발송 내역, 템플릿 관리
- 솔라피 SMS 어댑터 1순위 구현
- 발송 안전 가드 골격 (광고 prefix, 080 footer, 야간 차단, 수신거부 제외)

### 1.6 계정·권한 (`/accounts`)

- 마스터 / 관리자 / 매니저 / 뷰어 4단계
- 분원별 RLS 자동 격리

### 1.7 데이터 이관 (ETL)

| 스크립트 | 원본 (Aca2000 뷰) | 우리 테이블 | 적재 결과 |
|---|---|---|---|
| migrate_students.py | V_student_list | students | 약 6만명 |
| migrate_classes.py | V_class_list | classes | 2,919건 (4분원) |
| migrate_enrollments.py | V_student_class_list | enrollments | 55,049건 |
| migrate_attendances.py | V_Attend_List | attendances | 33,170건 |

- 모두 UPSERT (idempotent, 재실행 안전)
- 학년 정규화 9종 (대학교 = 졸업 포함)
- 4분원: 대치 / 송도 / 반포 / 방배

### 1.8 UI 셸

- 사이드바: 학생 명단 / 강좌 / 문자 발송 / 계정 권한 / 데이터 관리(엑셀 가져오기)
- 활성 메뉴 강조 (SidebarNavLink)
- 흰+검정 미니멀, 40~60대 사용자 배려 (15px 폰트, 40px 최소 입력 높이)

---

## 2. 작성됐으나 활성화 대기

### 2.1 자동 동기화 워크플로우 (GitHub Actions)

- 파일: `.github/workflows/sync-aca.yml`
- 스케줄: **매일 11:00 KST**
- 흐름: students → classes → enrollments → attendances → start_date 백필
- Slack 알림 (성공/실패)
- **활성화 대기**: GitHub Secrets 4개 등록 필요 (ACA_MSSQL_PASSWORD, SUPABASE_URL, SUPABASE_SECRET_KEY, SLACK_WEBHOOK_URL)

---

## 3. 다음 우선순위 후보 (인터뷰 기반)

### 3.1 강좌 상세 명단 정렬·필터
- 출석률 낮은 순 정렬 (케어 필요 학생 식별)
- 결석순 정렬

### 3.2 학년별 권한 분리
- 현재 RLS 는 분원 격리만. 인터뷰: "고3 데스크 직원은 고1·2 DB 못 봐야 함"

### 3.3 정산 시스템
- 강사별 정산 뷰 (현재 Aca2000 도 한 반 기준만 지원)
- 출결 티켓 기준 자동 집계
- **회계 픽스 정책**: 지급처리 후 출결 락, 미정산 다음 달 이월
- 정산서 자동 생성

### 3.4 출석 자동화
- 오늘 수업 출석부 자동 생성 (강의실 배치표 → 당일 수업 리스트)
- 태블릿/모바일 체크 → 즉시 DB 반영

### 3.5 학생 관리 도구
- **중복 학생 통합**: 학생명+학부모번호 매칭 → 기준학생 설정 → 수강·납입 이력 이동
- **삭제 요청 워크플로우**: 실장·팀장은 요청만, 행정팀(과장) 승인

### 3.6 대시보드
- 데일리 매출 (확정 출결 기준)
- 출석률 통계
- 미납 추적

### 3.7 문자 발송 고도화
- 결석생 자동 알림 (수업 끝난 시간 +15분)
- 영상 강의 트래킹 (LMS 레이어)
- 지역별 필터 (강남구/송파구/서초구 — 학교 → 지역 매핑 테이블 필요)

### 3.8 강사 관리
- 성범죄 조회 PDF 등록·조회 기능
- 교육청 신고 자동화

### 3.9 결제 연동
- 카카오페이 / 토스 PG
- 부분 환불 / 이월 처리

### 3.10 LMS (학습관리)
- 영상 강의 링크 + 시청 트래킹
- 모의고사·시험 점수
- 학부모 대상 결과 리포트

---

## 4. 알려진 이슈 / 기술 부채

| 이슈 | 영향 | 대응 우선순위 |
|---|---|---|
| `student_profiles` 뷰 무거운 정렬·필터 조합에서 statement timeout | 일부 사용자가 페이지 3+ 에서 에러 | 인덱스 보강 또는 RPC 함수로 분리 |
| 강사·학교 distinct prefetch 풀 스캔 | 6만 학생에서 느림 | RPC `list_distinct_*` 로 이전 (코드에 TODO) |
| 종강 강좌도 active=true 로 잡힘 | 리스트 노이즈 | ETL 에서 반명 (종) prefix 매칭 또는 V_class_list 의 다른 컬럼 추정 |
| attendances.enrollment_id 항상 NULL | 출결 ↔ 수강 1:1 매칭 부재 | V_Attend_List 에 수강이력_코드 없음. JOIN으로 추정하는 백필 마이그 가능 |
| ETL 수동 트리거 | 실시간 동기화 부재 | GitHub Actions cron (워크플로우 작성됨, Secrets 등록 대기) |
| Aca2000 V_Attend_List 보존 기간 한정 | 종강 강좌의 출결 데이터 부재 | 정책 — 신규 출결만 누적, 과거 archive 는 재구성 불가 |

---

## 5. 통계

- **마이그레이션**: 19개 (모두 prod 적용 완료)
- **커밋**: 21개 (main 브랜치)
- **prod 데이터**:
  - 학생 약 6만명
  - 강좌 2,919건 (개강일 백필 2,479건 / 85%)
  - 수강 등록 55,049건
  - 출결 33,170건
- **분원**: 4개 (대치 · 송도 · 반포 · 방배)

---

## 6. 즉시 결정 필요 (사용자 액션)

1. **GitHub Secrets 4개 등록** → 자동 동기화 시작
   - ACA_MSSQL_PASSWORD / SUPABASE_URL / SUPABASE_SECRET_KEY / SLACK_WEBHOOK_URL
2. **다음 작업 선택** (위 §3 항목 중 우선순위)

---

## 7. 참조

- PRD: `docs/sejung-crm-mvp-prd.md`
- 행정팀 인터뷰 메모: `~/.claude/projects/.../memory/project_admin_workflow.md`
- ETL 스크립트: `scripts/etl/`
- 마이그레이션: `supabase/migrations/`
- 자동 동기화 워크플로우: `.github/workflows/sync-aca.yml`
