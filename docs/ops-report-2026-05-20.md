# 세정학원 CRM 운영 보고 — 2026-05-20 기준

> 노션 붙여넣기용. 5/19~5/20 양일 운영팀 피드백 반영분 + 현재 기능 동작 정리.

---

## 1. 데이터 계층 (Aca2000 → CRM)

### 1.1 Dual layer 구조

```
MSSQL (Aca2000 4분원)  →  Supabase aca_*(raw)  →  apply_aca_to_crm()  →  crm_*(curated)
```

- **aca_\*** : 아카2000 ETL 원본 스냅샷. 손대지 않음.
- **crm_\*** : 정제 결과. 운영 화면이 보는 단일 진실 소스.
- ETL 주기: 수동 (사용자가 `python scripts/etl/migrate_*.py` 실행). 향후 cron 검토.

### 1.2 raw 계층 11개 테이블 (aca_*)

| 테이블 | 출처 view | 행수 (4분원 합) |
|---|---|---:|
| aca_students | V_student_list | 100,505 |
| aca_enrollments | V_student_class_list | 100,669 |
| aca_classes | V_class_list | 2,945 |
| aca_attendances | V_Attend_List | 41,110 |
| aca_payments | V_Pay_List | 147,279 |
| **aca_tickets** | V_Ticket_student_income_List | **384,552** |
| aca_class_accounts | V_class_account_list | 65,123 |
| aca_unpaid | V_income_List | 1,295 |
| aca_teachers | V_People_List | 387 |
| aca_teacher_subjects | V_People_Subject_List | 2,904 |
| aca_class_types | V_classqqtype_list | 34 |

### 1.3 curated 계층 (crm_*)

- crm_students / crm_enrollments / crm_classes / crm_attendances — 정제판
- crm_groups / crm_templates / crm_campaigns / crm_messages — CRM 자체 데이터
- crm_users_profile — 계정·권한
- crm_school_regions — 학교↔지역(5개구+기타) 매핑
- crm_unsubscribes — 수신거부

### 1.4 핵심 enum / 정책

- **재원 상태 4종**: 재원생 / 수강이력자 / 수강 x / 탈퇴
- **subject 8종**: 국어 / 영어 / 수학 / 과탐 / 사탐 / 컨설팅 / 기타 / **설명회**
- **분원**: 방배 / 대치 / 반포 / 송도
- **학년 9종**: 초등 / 중1~3 / 고1~3 / 재수 / 졸업 / 미정
- **출석 5종**: 출석 / 지각 / 결석 / 조퇴 / 보강

---

## 2. 학생 명단 (`/students`)

### 2.1 화면 구성

- 검색 (이름·학교·학부모 연락처)
- 분원 선택 (master 만 변경 가능)
- 학교급 토글 (전체 / 고등 / 중등 / 초등)
- 학년 칩 + "졸업·미정 포함 보기"
- 재원 상태 단일 선택 (전체 / 재원생 / 수강이력자 / 수강 x)
- 지역 다중 선택 (강남구 / 서초구 / 송파구 / 동작구 / 용산구 / 인천 송도 / 기타)
- 학교 다중 선택 — **현재 필터 결과의 학교만 노출** (분원 좁히면 자동 좁아짐)
- 정렬 (최근 등록순 / 출석률 / 결석 수 / 수강 중 등)
- 필터 초기화 (빨간 강조)

### 2.2 컬럼

- 이름 · 학교 · 학년 · 재원 상태 · **출석률** · **출석(결석 수)** · **수강 중(진행 강좌 수)** · 학부모 연락처
- 행 어디든 클릭 → 학생 상세

### 2.3 출석률 산출 (분원별 분기, 0057)

- **방배**: `(출석+지각+보강) / 전체 attendance row` × 100
- **대치/반포/송도**: `(결제완료 ticket 중 used_at real) / (결제완료 ticket 전체)` × 100
  - `used_at = '2050-01-01'` sentinel = 미사용 (분모 포함, 분자 제외)
- ticket 0건 (= 신규 등록자) → "—" 표시

### 2.4 진행중 강좌 산정 (0058, 0061)

- `enrollment.end_date >= 오늘 AND classes.subject != '설명회'`
- 설명회/간담회 만 있는 학생은 "수강 0개" 로 표시
- 0058 시점에 1,623명이 재원생 → 수강이력자/수강 x 로 재분류됨

---

## 3. 학생 상세 (`/students/[id]`)

### 3.1 헤더 KPI 4종

| 카드 | 값 | 산식 |
|---|---|---|
| 총 수강 횟수 | enrollment_count | crm_enrollments 행 수 |
| 출석률 | attendance_rate | 위 2.3 참조 |
| 결석 수 | absent_count | crm_attendances.status='결석' |
| 총 결제금액 | total_paid | Σ enrollments.amount (회당 단가 × 회차) |

### 3.2 탭 3종

#### 수강 이력 탭
- 진행 중 강좌 위 → end_date 내림차순
- 컬럼: 수업내용 · 선생님 · 과목 · 기간 · 금액 (결제일 컬럼 제거됨)
- 진행 중 강좌엔 녹색 "진행 중" 배지

#### 출석 탭
- **강좌별 accordion 카드 list**
- 접힘: 강좌 제목 · 강사·요일·시간 + 카운트 (총·출·결·지·조·보) + ▼
- 펼침: 그 강좌의 회차 일자만 column 으로 펼침
- 비-방배 분원: ticket 의 결제완료 회차 전체 column 노출
  - 사용된 회차: 출 chip
  - 미사용 회차: 점(·) — "예정 회차"
- 방배 분원: V_Attend_List 직접 기록 (5종 chip)

#### 발송 이력 탭
- 카드 list + accordion
- 접힘: 캠페인 제목 + 작성자 부제 · 수신 번호 · 상태 · 발송시각
- 펼침: 유형 (SMS/LMS) + 작성자 + 본문 (줄바꿈 보존)

---

## 4. 강좌 (`/classes`)

### 4.1 필터 (피드백 반영)

- 검색 (반명·강사명)
- 분원 / 과목 / 정렬
- **status 토글 3종**: 전체 / 진행중 / **설명회**
- **기간** (시작일 ~ 종료일) — 그 기간 안에 `aca_tickets.class_date` 가 1건이라도 있는 강좌만
- 요일 다중 선택
- **강사 dropdown** — 현재 필터 조건의 강좌가 있는 강사만 노출 (typeahead 검색)
- 종강·폐강 포함 토글

### 4.2 컬럼

- 반명 · 분원 · 과목 · 강사 · 요일/시간 · 회당단가 · 총회차 · 정가 · 수강생 수

### 4.3 정렬 옵션

- 최신 등록순 (default) · 개강일 · 종강일 · 반명 · 정원 · 회당단가 · 총회차 · 수강생 수

---

## 5. 발송 그룹 (`/groups`)

### 5.1 그룹 list

- 컬럼: 이름 · 분원 · 수신자 수 · 마지막 발송 · **작성자**
- 검색 / 분원 / 정렬

### 5.2 그룹 빌더 (생성·수정)

- 그룹명 / 분원 / 학년 칩 (졸업·미정 expand)
- **학교 다중 선택** — 분원 + 학년 추론으로 자동 좁힘
- 재원 상태 다중 (재원생 / 수강이력자 / 수강 x)
- 과목 / 지역 / 강사
- 학생 직접 추가 (이름·연락처로 검색)
- 실시간 수신자 카운트 + 상위 5명 미리보기
- **수정 모드**: "변경 확인" 버튼 → +N 추가(빨강) / -N 제외(회색) 표시

### 5.3 그룹 상세

- 소속 학생 list — **건별 휴지통** (개별 제외)
- 액션: 수정 · 복제(보류) · 삭제 · "이 그룹으로 발송"
- 삭제 시 로그아웃 회귀 fix 완료 (middleware race 방어)

---

## 6. 문자 발송 (`/compose`, `/campaigns`)

### 6.1 발송 흐름 (4단계 wizard)

1. **그룹 선택** — 드롭다운 + "+ 그룹 추가하기" 새 탭 옵션
2. **템플릿 선택** — SMS / LMS
3. **미리보기** — [광고] prefix / 080 수신거부 suffix 자동 부착 시뮬레이션
4. **발송** — sendon 즉시 발송 또는 예약

### 6.2 발송 안전 가드 (서버 최종 검증)

- **수신거부**: crm_unsubscribes 자동 제외
- **탈퇴/비활성 학생**: 항상 제외
- **광고 야간 차단**: 21:00 ~ 08:00
- **[광고] prefix + 080 수신거부**: 광고 메시지 자동 부착
- **학부모 연락처 마스킹**: 로그에서 `010-****-1234`
- 발송 단가: SMS 7.4원 / LMS 24원 (sendon, 부가세 별도)

### 6.3 캠페인 list

- 컬럼: 제목 · 그룹 · 유형 · 발송시각 · **발송자** · 도달/전체 · 비용

---

## 7. 템플릿 (`/templates`)

### 7.1 list

- 컬럼: 제목 · 유형 (SMS/LMS) · **광고** chip · 바이트 · 최근 수정일 · **작성자**
- 행 클릭 → /templates/[id]/edit
- 알림톡 옵션 제거 완료 (0059)

### 7.2 편집 폼

- 좌측: 제목 · 유형 · 본문 · 광고 체크
- 우측: **실시간 미리보기 panel** — 광고 prefix/suffix 시뮬레이션
- 생성 후 → /templates 목록 페이지 이동

---

## 8. 계정 관리 (`/accounts`)

### 8.1 권한 — master 전용 (0001 이후 admin 차단)

- 사이드바 "계정과 권한 관리" 메뉴 master 만 노출
- 역할: master / admin / manager / viewer
- master: 전 분원, role/branch 변경 가능
- 그 외: 본인 분원 read

### 8.2 계정 생성 흐름

- master 가 이메일 + 이름 + 분원 + 역할 입력
- 임시 비밀번호 발급 → 첫 로그인 시 must_change_password 가드 → /me 강제

---

## 9. 데이터 관리

### 9.1 엑셀 가져오기 (`/import`)
- 학생 일괄 추가
- 컬럼 매핑 + 미리보기 + 검증

### 9.2 학교 지역매핑 (`/regions`)
- 226개 학교 ↔ 5개구+기타 매핑
- 매핑 안 된 학교는 자동 '기타'

---

## 10. 인프라 / 운영 정책

### 10.1 RLS (Row Level Security)

| 테이블 | 정책 |
|---|---|
| crm_students/classes | `can_read_branch(branch)` — master 전체, 그 외 본인 분원 |
| crm_enrollments/attendances | student 의 branch 로 격리 |
| crm_groups/campaigns/templates | branch 격리 + master 전체 |
| aca_*(raw) | service_role 만 INSERT/UPDATE, SELECT 는 branch 격리 |

### 10.2 마이그레이션 이력 (5/19~5/20)

| 마이그 | 내용 |
|---|---|
| 0054 | aca_* raw 7개 확장 |
| 0055 | crm_templates.branch 추가 |
| 0056 | student_profiles attendance_rate 버그 fix |
| 0057 | attendance_rate 분원별 분기 (방배 attendance / 그 외 ticket) |
| 0058 | subject '설명회' enum + 재원생 판정에서 제외 |
| 0059 | crm_templates 정리 (ALIMTALK / teacher_name 제거) |
| 0060 | student_profiles active_enrollment_count / absent_count 추가 |
| 0061 | active_enrollment_count 설명회 제외 fix (classes join) |
| 0062 | 간담회 → 설명회 backfill |
| 0063 | student_profiles.subjects/teachers classes join 으로 산출 |

### 10.3 SMS 벤더

- **sendon** 단일 운영. 어댑터 패턴 유지 (env 로 벤더 전환 가능).
- 인증: SENDON_USER_ID + SENDON_API_KEY + SENDON_FROM_NUMBER 3종.
- 단가: SMS 7.4 / LMS 24 / 알림톡 6.4 (알림톡은 Phase 1 으로 미룸).

### 10.4 배포

- **Vercel** 자동 배포 (main push)
- **Supabase** 마이그 수동 (`supabase db push --linked --include-all`)
- 환경: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY + SENDON_* + ACA_MSSQL_*

---

## 11. 5/19~5/20 운영팀 피드백 처리 현황

| 영역 | 항목 | 상태 |
|---|---|:---:|
| 학생 명단 | '최근 수강' → '수강 중' 컬럼 교체 | ✅ |
| 학생 명단 | 행 클릭으로 상세 진입 | ✅ |
| 학생 명단 | 필터 초기화 빨간색 강조 | ✅ |
| 학생 명단 | '출석' 컬럼 추가 | ✅ |
| 학생 명단 | 필터 칩 토글 즉시 list 갱신 | ✅ |
| 강좌 | 최신 등록순 + 종강 토글 | ✅ |
| 강좌 | 강사 dropdown 타이핑 검색 | ✅ |
| 강좌 | status 토글 3종 (전체/진행중/설명회) | ✅ |
| 강좌 | 기간 range 필터 (ticket 기반) | ✅ |
| 강좌 | 강사 옵션 필터 결과 좁힘 | ✅ |
| 발송 그룹 | [+ 그룹 추가하기] 버튼 오류 | ✅ (이전 commit 에서 해결됨 추정) |
| 발송 그룹 | 학생 건별 삭제 (휴지통) | ✅ |
| 발송 그룹 | 수정 시 +N/-N 미리보기 | ✅ |
| 발송 그룹 | 재원/퇴원 조건 | ✅ |
| 발송 그룹 | 삭제 시 로그아웃 회귀 | ✅ |
| 발송 그룹 | 학년별 학교 옵션 좁힘 | ✅ |
| 발송 그룹 | 학년 세그먼트 토글 제거 | ✅ |
| 템플릿 | 미리보기 우측 노출 | ✅ |
| 템플릿 | 알림톡 유형 삭제 | ✅ |
| 템플릿 | 강사명 필드 삭제 | ✅ |
| 템플릿 | 생성 후 목록 이동 | ✅ |
| 발송 | 새 발송 작성에 그룹 추가 | ✅ |
| 워딩 | '지역 매핑' → '학교 지역매핑' | ✅ |
| 계정 | master 전용 가드 | ✅ |
| 출석 탭 | ticket 기반 정확 출석 표시 | ✅ |
| 출석 탭 | 강좌별 회차 모두 column 펼침 | ✅ |
| 발송 이력 | 본문·작성자 펼침 | ✅ |
| 작성자 추적 | 그룹/템플릿/캠페인 모두 노출 | ✅ |
| 미납 태그 | 결제일 컬럼 제거 | ✅ |
| 광고 chip | 줄바꿈 wrap fix | ✅ |
| 루트 | / → /students 자동 이동 | ✅ |

### 미해결 / 후속 follow-up

- `last_attended_at` 도 분원별 source 분기 (현재 attendance row 만 봄)
- 캠페인 상세 페이지 본문 노출 (학생 발송 이력엔 노출됨)
- RLS — crm_users_profile 의 다른 분원 행 차단 시 작성자 "—" 로 fallback
- ticket 기간 필터 distinct class_id 10K 초과 시 chunk 처리 (운영 모니터링)
- 송도+고3+수강X+기타 카운트 실패 — 학교 옵션 좁힘으로 자동 해결 가능성 (재현 시 추가 진단)
