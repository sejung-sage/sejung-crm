# 세정학원 CRM 기능 명세서

> 버전: 2026-05-20 · MVP Phase 0 완료 시점
> 대상: 운영팀 (대치·방배·반포·송도 4분원)
> 목적: 각 기능의 입출력·비즈니스 룰·권한·에러 처리 정의

---

## 0. 공통 정책

### 0.1 권한 모델

| Role | 권한 |
|---|---|
| **master** | 전 분원 read/write/send. 계정 관리, role/branch 변경 가능 |
| **admin** | 본인 분원 모든 기능. 다른 분원 차단 |
| **manager** | 본인 분원 — 학생 read, 그룹·캠페인 read/write, 발송 가능 |
| **viewer** | 본인 분원 — 학생·그룹·캠페인 read only. 발송 불가 |

분원: 방배 / 대치 / 반포 / 송도

### 0.2 데이터 origin

- **aca_\*** : Aca2000(MSSQL) ETL raw 스냅샷. 11개 테이블. 수동 ETL.
- **crm_\*** : aca_* 정제판 + CRM 자체 데이터. 운영 화면이 사용.
- 정제 시점: ETL 직후 `SELECT apply_aca_to_crm()` 호출.

### 0.3 enum SSOT

| enum | 값 | 변경 시 영향 |
|---|---|---|
| 재원 상태 | 재원생 / 수강이력자 / 수강 x / 탈퇴 | 학생 분류·발송 안전 |
| 과목 (subject) | 국어 / 영어 / 수학 / 과탐 / 사탐 / 컨설팅 / 기타 / 설명회 | 강좌·필터·재원 판정 |
| 학년 (grade) | 초등 / 중1~3 / 고1~3 / 재수 / 졸업 / 미정 | 학생·발송 그룹 필터 |
| 출석 status | 출석 / 지각 / 결석 / 조퇴 / 보강 | KPI 산식 |
| 템플릿 유형 | SMS / LMS | 단가·바이트 한도 |
| 캠페인 상태 | 대기 / 발송중 / 완료 / 실패 | 메시지 처리 |

### 0.4 발송 안전 가드 (서버 최종 검증)

모든 발송은 클라이언트 가드와 무관하게 서버에서 최종 검사:

| 가드 | 조건 |
|---|---|
| **수신거부** | crm_unsubscribes 에 등록된 학부모 자동 제외 |
| **탈퇴 학생** | status='탈퇴' 자동 제외 |
| **광고 야간 차단** | is_ad=true 인 캠페인은 21:00~08:00 발송 거부 |
| **광고 prefix·suffix** | is_ad=true 시 본문 앞 `[광고]`, 뒤 `무료수신거부 080-...` 자동 부착 |
| **학부모 연락처 마스킹** | 모든 로그·에러 메시지에서 `010-****-1234` 형태 |
| **테스트 모드 가드** | is_test=true 캠페인은 본인 번호 1건만 |

---

## 1. 인증 (`/login`)

### 1.1 로그인

- **입력**: 이메일 + 비밀번호
- **출력**: 성공 시 `?next=` 또는 `/students` 로 리다이렉트
- **룰**:
  - 비활성 계정 (`active=false`) → 로그인 거부 + `?deactivated=1`
  - 첫 로그인 (`must_change_password=true`) → `/me?forced=1` 강제 이동
- **에러**: 잘못된 이메일/비번 → 401 "이메일 또는 비밀번호가 올바르지 않습니다"

### 1.2 비밀번호 변경 (`/me`)

- 변경 후 must_change_password=false 갱신 후 정상 페이지 진입 허용

### 1.3 미들웨어 가드

- 비로그인 + 보호 경로 접근 → `/login?next=<원래 경로>`
- 프로필 NULL/error (RLS race) → 강제 로그아웃 대신 통과 (안전 가드)

---

## 2. 학생 명단 (`/students`)

### 2.1 입력 (URL params)

| param | 형식 | 기본값 | 비고 |
|---|---|---|---|
| `q` | 문자열 | 빈 | 이름·학교·학부모 연락처 ILIKE |
| `branch` | enum | 전체 | master 만 변경 가능, 그 외 본인 분원 강제 |
| `grade` | array | [] | 다중 선택. 빈 = 전 학년 |
| `school_level` | array | [] | 고/중/초 다중 선택 (학교급 토글) |
| `status` | enum | 재원생 | 단일 선택 (4종) |
| `region` | array | [] | 5개구+기타 다중 |
| `school` | array | [] | 다중. 현재 필터 결과의 학교만 옵션으로 노출 |
| `include_hidden` | bool | false | true 면 grade='졸업'/'미정' 도 포함 |
| `sort` | enum | registered_desc | 12종 정렬 키 |
| `page` | int | 1 | 기본 pageSize=50 |

### 2.2 컬럼

이름 · 학교 · 학년 · 재원 상태 · **출석률(%)** · **출석(결석 수)** · **수강 중(진행 강좌 수)** · 학부모 연락처

### 2.3 비즈니스 룰

- **행 클릭** → `/students/[id]` (이름 외 어디든)
- **필터 변경** → URL push + `router.refresh()` 동반 → 학생 list 즉시 갱신
- **학교 옵션** = 현재 필터(분원/학년/상태) 조건의 distinct school. 분원만 좁혀도 자동 좁아짐.
- **HIDDEN_GRADES_BY_DEFAULT** = `["졸업", "미정"]` — 학년 미선택 시 자동 숨김. `include_hidden=1` 또는 직접 선택 시 노출.

### 2.4 권한

- master: 전 분원 + 학부모 연락처 풀 노출
- 그 외: 본인 분원 + 학부모 연락처 마스킹

---

## 3. 학생 상세 (`/students/[id]`)

### 3.1 헤더 KPI 4종

| 카드 | 값 | 산식 |
|---|---|---|
| 총 수강 횟수 | enrollment_count | crm_enrollments 행 수 (전체 기간) |
| **출석률** | attendance_rate | 분원별 분기 — §3.2 참조 |
| 결석 수 | absent_count | crm_attendances.status='결석' 행 수 |
| 총 결제금액 | total_paid | Σ enrollments.amount |

### 3.2 출석률 산식 (분원별 분기)

```
방배 분원:
  attendance_rate = (출석 + 지각 + 보강) / 전체 attendance row × 100

대치 / 반포 / 송도:
  attendance_rate = (결제완료 ticket 중 used_at real) / (결제완료 ticket 전체) × 100
  - used_at = '2050-01-01' sentinel → 미사용 (분모 포함, 분자 제외)
  - 결제전 ticket → 분모 제외

ticket 0건 (= 신규 등록자) → NULL ("—" 표시)
```

### 3.3 수강 이력 탭

- 정렬: 진행 중 위 → end_date 내림차순
- **진행 중** 판정: `end_date IS NULL OR end_date >= 오늘`
- 컬럼: 수업내용 · 선생님 · 과목 · 기간 · 금액 (회당단가 × 회차)
- 진행 중 강좌엔 녹색 "진행 중" 배지
- 선생님·과목 fallback 우선순위:
  1. enrollments 의 직접 값 (ETL 상 항상 NULL)
  2. classes 마스터 join 결과
  3. course_name 자유형 파싱
  4. "—"

### 3.4 출석 탭

#### UI: 강좌별 accordion 카드 list

- 접힘 헤더: 강좌 제목 · 강사·요일·시간 부제 · 카운트 (총·출·결·지·조·보) · ▼
- 펼침: 그 강좌의 회차 일자만 column 으로 mini timeline
- 정렬: 총 카운트 DESC + 강좌명 ko, "강좌 미매칭" 은 맨 아래

#### Cell 표시 룰

- **비-방배 분원**: column = byDate.keys() ∪ expectedSessions (결제완료 ticket 의 class_date 전체)
  - 출석한 회차 → 출 chip
  - 미사용 회차 → 점(·) "예정 회차"
- **방배 분원**: column = attendance row 일자만, 5종 raw chip

### 3.5 발송 이력 탭

- 카드 list + accordion
- 접힘: 캠페인 제목 + **작성자** 부제 · 수신 번호(mask) · 상태 · 발송시각
- 펼침: 유형 (SMS/LMS) + 작성자 + **본문** (campaign_body, 줄바꿈 보존)
- 본문 NULL → "본문 정보 없음" placeholder

---

## 4. 강좌 (`/classes`)

### 4.1 필터

| 필터 | 동작 |
|---|---|
| 검색 | 반명·강사명 ILIKE (sanitized) |
| 분원 | 단일 선택 |
| 과목 | 단일 선택 (8종) |
| 정렬 | 최신 등록순 default + 10종 옵션 |
| **status 토글** | **전체 / 진행중 / 설명회** |
| **기간** | 시작일 ~ 종료일 (한쪽만 입력 OK) |
| 요일 | 다중 선택 (월~일) |
| 강사 | dropdown + typeahead 검색. 현재 필터 결과의 강사만 노출 |
| 종강·폐강 포함 | checkbox (기본 off) |

### 4.2 status 토글 의미

| 값 | 매칭 |
|---|---|
| 전체 | 필터 미적용 |
| **진행중** | `end_date IS NULL OR >= 오늘` + name 에 종강 prefix 없음 + `subject != '설명회'` |
| **설명회** | `subject = '설명회'` |

종강 prefix 4종: `(종)` / `종)` / `(폐)` / `폐)` — name 에 있으면 종강 간주.

### 4.3 기간 필터 매칭

- 그 기간(start~end) 안에 `aca_tickets.class_date` 가 **1건이라도** 있는 강좌
- 운영 기간(start_date/end_date) 무관
- distinct class_id 10K+ 면 경고 + 절단 (운영 모니터링)

### 4.4 컬럼

반명 · 분원 · 과목 · 강사 · 요일/시간 · 회당단가 · 총회차 · 정가 · 수강생 수

---

## 5. 강좌 상세 (`/classes/[id]`)

- 강좌 메타 (분원·과목·강사·요일·시간·회당단가·총회차)
- 수강생 list (학생 이름·학교·학년·재원상태·출결 카운트)
- "이 강좌 학생에게 발송" 버튼 → `/groups/new?class=<id>` (prefill)

---

## 6. 발송 그룹 (`/groups`)

### 6.1 그룹 list

| 컬럼 | 비고 |
|---|---|
| 이름 | 클릭 → 상세 |
| 분원 | branch chip |
| 수신자 수 | 그룹 저장 시 계산된 값 |
| 마지막 발송 | last_sent_at |
| **작성자** | crm_users_profile.name |

### 6.2 그룹 빌더 (생성·수정)

#### 입력 필드

- 그룹명 (필수, 2~50자)
- 분원 (master 만 변경)
- 학년 칩 (다중) + 졸업·미정 expand
- 학교 (다중) — 분원·학년 추론으로 자동 좁힘
- 재원 상태 (다중): 재원생 / 수강이력자 / 수강 x
- 과목 (다중, 7종 + 설명회는 안 보임)
- 지역 (다중, 5개구+기타)
- 강사 검색
- 학생 직접 추가 (이름·연락처로 검색해 includeStudents)

#### 실시간 미리보기

- 우측 panel: 총 N명 + 상위 5명 sample
- 디바운스 300ms

#### 수정 모드 전용 — 변경 차이

- "변경 확인" 버튼 클릭 → diff 재계산
- `+N 추가됨` (빨강) / `-N 제외됨` (회색) 표시
- 자동 debounce 대신 명시적 버튼 (비용 절약)

#### 저장

- 수신자 카운트 서버 재계산 후 INSERT/UPDATE
- excludeStudentIds 보존 (개별 제외 학생)
- includeStudentIds 보존 (직접 추가 학생)

### 6.3 그룹 상세 (`/groups/[id]`)

- 메타 (이름·분원·작성자·생성일·마지막 발송)
- 소속 학생 list — **건별 휴지통**
  - 권한 (master 또는 본인 분원 admin) 가 있으면 노출
  - 클릭 → confirm dialog → excludeStudentIds 추가 → recipient_count 재계산
- 액션: 수정 · 복제(Phase 1) · **삭제** · "이 그룹으로 발송"

### 6.4 삭제 동작

- crm_groups DELETE + cascade
- campaigns.group_id 는 ON DELETE SET NULL — 기존 캠페인 보존
- middleware 가 profile NULL race 안전 가드 적용 (로그아웃 회귀 방지)

---

## 7. 문자 발송 (`/compose`)

### 7.1 4단계 wizard

| 단계 | 내용 |
|---|---|
| 1. 그룹 선택 | 드롭다운 + "+ 그룹 추가하기" 새 탭 옵션 |
| 2. 템플릿 | SMS / LMS 템플릿 선택 |
| 3. 미리보기 | 본문 + 광고 prefix/suffix 시뮬레이션 + 수신자 일부 sample |
| 4. 발송 | 즉시 또는 예약 |

### 7.2 발송 룰

- 발송 직전 서버에서 **수신자 재계산** (그룹 저장 시 → 발송 시 학생 변동 반영)
- 수신거부 + 탈퇴 + 비활성 자동 제외
- 광고 야간 차단 + prefix·suffix 자동 부착
- 본문 EUC-KR 바이트 한도 검증 (SMS 90 / LMS 2,000)

### 7.3 단가 (sendon, 부가세 별도)

| 유형 | 단가 |
|---|---|
| SMS | 7.4원 |
| LMS | 24원 |
| 알림톡 | 6.4원 (Phase 1 보류) |

---

## 8. 캠페인 (`/campaigns`)

### 8.1 list 컬럼

제목 · 그룹 · 유형 · 발송시각 · **발송자** · 도달/전체 · 비용

### 8.2 상태

| 상태 | 의미 |
|---|---|
| 대기 | 예약 대기 또는 디스패처 큐 |
| 발송중 | sendon 호출 중 (sweep cron 으로 stalled 회수) |
| 완료 | 전 메시지 처리 |
| 실패 | 디스패치 실패 |

### 8.3 캠페인 상세

- 메타 (제목·그룹·유형·발송시각·발송자·비용)
- 메시지 list (수신자·상태·sent_at)
- 도달률 / 실패률 KPI

---

## 9. 템플릿 (`/templates`)

### 9.1 list

| 컬럼 | 비고 |
|---|---|
| 제목 | 클릭 → /templates/[id]/edit |
| 유형 | SMS / LMS (ALIMTALK 제거됨) |
| **광고** | is_ad=true 시 빨강 chip |
| 바이트 | 본문 EUC-KR 바이트 / 한도 |
| 최근 수정일 | updated_at |
| **작성자** | crm_users_profile.name |

### 9.2 편집 폼

- 좌측: 제목 · 유형 · 본문 · 광고 체크
- 우측: **실시간 미리보기 panel**
  - 광고 체크 시 본문 앞에 `(광고)` prefix, 뒤에 `무료수신거부 080-...` suffix 자동 표시
- 생성 후 → `/templates` 목록 페이지 이동

### 9.3 바이트 한도

| 유형 | 한도 |
|---|---|
| SMS | 90 bytes (EUC-KR) |
| LMS | 2,000 bytes |

---

## 10. 계정 관리 (`/accounts`)

### 10.1 권한 — master 전용

- 사이드바 "계정과 권한 관리" 메뉴 master 만 노출
- admin 도 접근 차단 (피드백 반영)

### 10.2 list 컬럼

이름 · 이메일 · 권한 · 분원

### 10.3 계정 생성

- master 가 이메일 + 이름 + 분원 + 역할 입력
- 시스템이 임시 비밀번호 발급
- 첫 로그인 시 must_change_password=true → /me 강제

### 10.4 역할 변경

- role / branch 변경은 master 만
- admin 은 본인 분원 계정 read/deactivate 만

---

## 11. 데이터 관리

### 11.1 엑셀 가져오기 (`/import`)

- 학생 일괄 추가
- 컬럼 매핑 → 미리보기 → 검증 → 저장
- 검증: 이름 필수, 학부모 연락처 010~019 정규화, 중복 차단

### 11.2 학교 지역매핑 (`/regions`)

- 226개 학교 ↔ 5개구+기타 매핑
- 매핑 안 된 학교는 '기타' 로 자동 분류
- list 검색 + 일괄 편집

---

## 12. 알림·예약·자동화

### 12.1 pg_cron (Supabase)

| job | 주기 | 동작 |
|---|---|---|
| sweep_stalled_campaigns | 매 1분 | status='발송중' 인데 3분 이상 진행 안 된 캠페인 재처리 |
| 예약 발송 dispatcher | scheduled_at 도래 시 | crm_campaigns.body 읽어 sendon 호출 |

### 12.2 디스패처 안전 가드 (cron 측 재검증)

- 광고 야간 차단 재적용
- 수신거부 재조회
- 발송 직전 학생 status 재확인 (예약 시점과 발송 시점 간 변동 흡수)

---

## 13. 에러·예외 처리

### 13.1 공통 에러 응답

```json
{ "status": "failed", "reason": "사용자 친화 한글 메시지" }
```

### 13.2 주요 에러 케이스

| 상황 | 메시지 |
|---|---|
| 권한 없음 | "권한이 없습니다 (master / admin 만 가능)" |
| 입력 검증 실패 | Zod 첫 issue.message |
| Supabase RLS 차단 | "발송 그룹 조회에 실패했습니다: <err>" |
| 수신자 카운트 timeout | "수신자 카운트 조회에 실패했습니다" + 재시도 안내 |
| 발송 그룹 삭제 race | (자동 가드 — 로그아웃 안 시킴) |

---

## 14. 부록 — 자주 묻는 운영 룰

### Q. 학생이 재원생인데 수강 중 = 0 인 이유?

A. 진행 중 강좌 산정에서 **설명회/간담회 제외**. 설명회만 등록된 경우 진행 중 0, status 도 '수강이력자' 또는 '수강 x' 로 자동 분류 (0058).

### Q. 출석률 100% 인데 출석 탭이 비어 있는 이유?

A. 비-방배 분원은 V_Attend_List 에 결석만 기록. 출석은 ticket.used_at 으로 추적. 학생이 결석 0건이면 attendance row 도 0건이지만 출석률은 ticket 기반으로 정상 계산됨. (출석 탭 UI 도 ticket 데이터 포함 — 0061 이후)

### Q. 학생 명단에서 "수강이력자" 가 17,104 → 15,000 으로 줄어든 이유?

A. UI 가 졸업/미정 학생을 기본 숨김. 학년 필터에서 직접 선택하거나 "졸업·미정 포함 보기" 토글로 노출.

### Q. 그룹에 학생이 0명으로 잡히는 이유?

A. 분원·학년·상태·지역·과목 필터의 교집합. 특히 **과목 필터는 진행 중 강좌 기준** (0063). 학생이 그 과목을 현재 수강 중이 아니면 매칭 안 됨.

### Q. 광고 메시지가 발송 안 된 이유?

A. 21:00~08:00 야간 차단. 예약하면 다음날 08:00 이후 자동 발송.

### Q. 같은 이름 학생이 여러 명 보이는 이유?

A. ETL 이 학생_코드 별로 row 생성. 같은 학생이라도 분원 이동·재등록 시 새 코드 부여. 학부모 연락처로 판단.

---

## 15. 변경 이력 (5/19~5/20)

| 마이그 | 항목 |
|---|---|
| 0054 | aca_* raw 7개 확장 (payments/tickets/class_accounts/unpaid/teachers/teacher_subjects/class_types) |
| 0055 | crm_templates.branch 추가 + 분원 격리 RLS |
| 0056~0057 | attendance_rate 산식 fix + 분원별 분기 (방배 attendance / 그 외 ticket) |
| 0058 | subject '설명회' enum + 재원생 판정 제외 (1,623명 재분류) |
| 0059 | crm_templates ALIMTALK / teacher_name 제거 |
| 0060~0061 | active_enrollment_count / absent_count view 추가, 설명회 제외 fix |
| 0062 | 간담회 14건 → 설명회 backfill |
| 0063 | subjects/teachers classes join 으로 산출 (enrollments.subject 항상 NULL 우회) |

### Phase 1 (예정)

- 알림톡 (sendon.kakao API)
- 비용 대시보드
- 자동 트리거 (출결 알림·결제 임박 알림)
- A/B 테스트
- STT (강사 통화 텍스트화)
- AI 추천 (관심 학생 자동 식별)
- 설명회·털기 모듈

---

*문서 끝.*
