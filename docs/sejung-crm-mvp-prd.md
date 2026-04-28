# sejung-crm-mvp-prd.md

> 세정학원 CRM MVP · Product Requirements Document
> 버전 v2.0 · 2026.04.22
> 대상: Claude Code 에이전틱 개발 (harness-based agent orchestration)

---

## 1. Product Overview

### 1.1 목표

세정학원 CRM MVP는 **학생 목록 필터링과 문자 발송 CRM 핵심**에 집중한다. 원장·실장(40~60대 여성 직원)이 직관적으로 쓸 수 있는 깔끔한 웹 UI로, Aca2000 대비 확실한 편의성 개선을 증명한다.

### 1.2 3가지 문제 (요약)

- **세그먼트 오류** · 타겟 아닌 학생에게 문자 발송, 월 500~1,000만원 중 상당 부분 낭비
- **편의성 부족** · Aca2000 UI 구식, 모바일 불가, 업무 절차 복잡
- **원장 1인 의존** · 일 7,000건+ 문자를 원장 혼자 관리, 감각 기반 판단

### 1.3 MVP 성공 지표

| 지표 | 현재 (Aca2000) | MVP 목표 |
|---|---|---|
| 발송 작업 시간 | 건당 15~20분 | 5분 이하 |
| 월 문자비 | 500~1,000만원 | 20~30% 절감 |
| 비활성 DB 자동 제외 | 불가능 | 100% |
| 원장 부재 시 | 발송 불가 | 실장급 발송 가능 |

---

## 2. Tech Stack

### 2.1 Core Stack

| 레이어 | 기술 | 비고 |
|---|---|---|
| Framework | Next.js 15 (App Router) | TypeScript strict mode |
| UI | Tailwind CSS + shadcn/ui | 흰색+검정 미니멀 (세정 공식 스타일) |
| Font | Pretendard + 로고용 Serif | 본문 Pretendard, SEJUNG 로고만 세리프 |
| Icons | lucide-react | 얇은 선 아이콘 통일 |
| State | TanStack Query + Zustand | 서버/클라이언트 상태 분리 |
| Database | Supabase (PostgreSQL 15) | RLS 기반 권한 |
| Auth | Supabase Auth | 이메일 + 비밀번호 |
| Background Jobs | Supabase pg_cron + Edge Functions | 예약 발송 |
| SMS Provider | 솔라피(SOLAPI) (1순위) 어댑터 패턴 | 섹션 2.3 참조 |
| Deployment | Vercel + Supabase Cloud | |
| Testing | Vitest + Playwright | 단위 + E2E |

### 2.2 Design Tokens (세정 공식 스타일)

**핵심 철학** · 보라색 같은 강한 색상 제거. **흰색 배경 + 검정 텍스트 + 회색 보조색** 위주. 버튼만 검정 CTA. 40~60대 여성 직원이 한눈에 알아보기 쉬운 UI.

```css
/* 배경 */
--bg: #ffffff               /* 기본 배경 · 완전 흰색 */
--bg-muted: #f8f9fa         /* 섹션 구분용 아주 옅은 회색 */
--bg-hover: #f1f3f5         /* 호버 상태 */

/* 텍스트 */
--text: #212529             /* 기본 텍스트 · 거의 검정 */
--text-muted: #6c757d       /* 보조 텍스트 · 중간 회색 */
--text-dim: #adb5bd         /* 플레이스홀더 · 연한 회색 */

/* 경계·구분선 */
--border: #e9ecef           /* 기본 보더 */
--border-strong: #ced4da    /* 강조 보더 (인풋 focus 등) */

/* 액션 */
--action: #212529           /* 주요 버튼 배경 · 검정 */
--action-hover: #000000     /* 호버 시 완전 검정 */
--action-text: #ffffff      /* 검정 버튼 위 텍스트 */

/* 상태 색상 (아주 절제된 톤) */
--success: #2b8a3e          /* 성공 · 차분한 녹색 */
--warning: #d97706          /* 경고 · 차분한 오렌지 */
--danger: #c92a2a           /* 위험 · 차분한 빨강 */
--info: #1971c2             /* 정보 · 차분한 파랑 */

/* 상태 배경 (매우 연하게) */
--success-bg: #ebfbee
--warning-bg: #fff4e6
--danger-bg: #fff5f5
--info-bg: #e7f5ff
```

**레이아웃 규격**

| 요소 | 값 | 비고 |
|---|---|---|
| 사이드바 폭 | 240px | 이미지 기준 |
| 상단 여백 | 24px | 헤더 위 |
| 카드 radius | 12px | 부드러운 느낌 |
| 버튼 radius | 8px | |
| 입력창 radius | 8px | |
| 기본 폰트 크기 | 15px | 노안 대응, 일반 14px보다 조금 큼 |
| 본문 line-height | 1.6 | 읽기 편하게 |
| 버튼 최소 높이 | 40px | 터치/클릭 편의성 |
| 입력창 최소 높이 | 40px | |

**타이포그래피**

- 페이지 타이틀: 20px / weight 600
- 섹션 타이틀: 16px / weight 600
- 본문: 15px / weight 400
- 보조 텍스트: 13px / weight 400
- 버튼: 14px / weight 500
- 테이블 헤더: 13px / weight 500 / color muted

**로고 취급** · `SEJUNG Academy` 로고는 세리프체(예: Cormorant Garamond 또는 Playfair Display)로 고정. 로고 외 모든 텍스트는 Pretendard.

### 2.3 SMS Provider 통합 전략

세정이 실제로 활용할 가능성이 높은 4개 벤더를 어댑터 패턴으로 통합. 언제든 환경변수로 전환 가능.

| 벤더 | SMS 단가 | LMS 단가 | MMS 단가 | 알림톡 | 세정 메모 | 연동 방식 |
|---|---|---|---|---|---|---|
| **솔라피(SOLAPI)** | **8원** | **14원** | **22원** | **13원** | **1순위 · MVP 실제 구현 · 가격 우위** | REST API · https://solapi.com |
| 문자나라 | 20원 | 25원 (세정특가) | 50원 | 15원 | Phase 1+ 백업 옵션 (가격 경쟁력 부족) | REST API |
| Aca2000 현재 | - | 27원 | - | - | 레거시 (이관 대상) | - |
| SK C&C to-go | - | 27원 | - | 지원 | Phase 1 · 대기업 안정성 | REST API · https://to-go.io/ |
| Sendwise | - | 27원 | - | 지원 | Phase 1 · 개발자 친화 문서 | REST API · https://sendwise.unless.co.kr/pricing |

**통합 방식 · 어댑터 패턴**

```
src/lib/messaging/adapters/
├── types.ts              // 공통 인터페이스 (SmsAdapter)
├── solapi.ts             // 솔라피(SOLAPI) · 1순위 (MVP 실제 구현)
├── munjanara.ts          // 문자나라 (Phase 1+ · 백업 스텁)
├── sk-togo.ts            // SK C&C to-go (Phase 1 · 스텁만)
├── sendwise.ts           // Sendwise (Phase 1 · 스텁만)
└── index.ts              // 환경변수 SMS_PROVIDER 로 선택
```

모든 벤더는 동일한 `SmsAdapter` 인터페이스를 따르므로, **운영 중에도 벤더 교체 가능**. 환경변수 `SMS_PROVIDER=solapi` 만 바꾸면 됨.

**Phase별 SMS 전략**

- **MVP (Phase 0)** · 솔라피 1개 어댑터만 실제 구현. 나머지는 인터페이스만 준비.
- **Phase 1** · 문자나라 / SK C&C to-go / Sendwise 추가 연동. A/B 테스트로 도달률·비용 비교.
- **Phase 2** · 최적 벤더를 primary, 차선을 failover로 운영. 장애 시 자동 전환.

**연동 전 체크리스트 (팀장·총무 확인 필요)**

- [ ] 솔라피(SOLAPI) 콘솔 가입 · API Key + Secret 발급 · IP 화이트리스트
- [ ] 발신번호 사전 등록 (각 벤더 공통, 통신사 검증 1~3 영업일)
- [ ] 080 무료수신거부 번호 발급 (솔라피 공용 가능)
- [ ] 개인정보 처리 위탁 계약 체결
- [ ] 대량문자 전송자격 인증 벤더 여부 확인
- [ ] API 사용량 상한 설정 (비용 폭주 방지)
- [ ] 알림톡 사용 시 카카오 비즈채널 + PFID + 템플릿 사전 검수 (1~2주)

---

## 3. System Architecture

### 3.1 전체 구조

```
┌────────────────────────────────────────────────────┐
│            Frontend (Next.js 15 · 흰색+검정)       │
│     학생 명단 · 발송 그룹 · 문자 발송              │
└──────────────────────┬─────────────────────────────┘
                       │ Supabase Client SDK
                       ▼
┌────────────────────────────────────────────────────┐
│          Server Actions + Edge Functions            │
│   필터 쿼리 · 그룹 저장 · 발송 트리거               │
└──────┬────────────────────┬────────────────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐   ┌────────────────────────────────┐
│   Supabase    │   │  SMS Adapter Layer                  │
│  PostgreSQL   │   │  ┌──────┬──────┬──────┬──────────┐ │
│  + RLS        │   │  │SOLAPI│문자  │SK    │Sendwise  │ │
│  + pg_cron    │   │  │(1순위)│나라  │to-go │(스텁)    │ │
└──────────────┘   │  └──────┴──────┴──────┴──────────┘ │
                   └──────────────────────────────────────┘
```

### 3.2 모듈 경계 (에이전트 담당 구분)

| 모듈 (한글명) | 영어명 | 담당 에이전트 | 디렉토리 |
|---|---|---|---|
| 데이터 레이어 · 데이터베이스 | data-layer | architect | `supabase/migrations/` |
| 학생 프로필 엔진 · 프로필엔진 | profile-engine | backend-dev | `src/lib/profile/` |
| 문자 발송 · 메시징 | messaging | backend-dev | `src/lib/messaging/` |
| UI 셸 · UI 골격 | ui-shell | frontend-dev | `src/components/shell/` |
| 기능 페이지 · 기능들 | features | frontend-dev | `src/app/(features)/` |

### 3.3 사이드바 네비게이션 (이미지 기반)

이미지 사이드바 구조 그대로 구현:

```
SEJUNG Academy (로고)

🔍 검색 (전체 검색)

👤 계정과 권한 관리
🎓 학생 명단
✉️  문자 발송
   └─ 발송 그룹
   └─ 문자 & 알림톡 템플릿
   └─ 문자 발송 내역
```

---

## 4. Data Model

### 4.1 테이블 (영어/한글 병기)

모든 컬럼은 **영어 변수명(DB 컬럼) · 한글 의미(UI 표기)** 를 병기. Claude Code는 두 쌍을 모두 인식해 코드에는 영어, UI에는 한글 사용. DB 파일 작성 시 각 컬럼에 한글 COMMENT 를 필수로 붙인다.

#### students · 학생

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| id | 학생 ID | UUID | 내부 고유 키 |
| aca2000_id | 아카2000 ID | TEXT UNIQUE | Aca2000 원본 ID (마이그레이션 키) |
| name | 이름 | TEXT | 학생 이름 |
| phone | 학생 연락처 | TEXT | 학생 본인 번호 |
| parent_phone | 학부모 연락처 | TEXT | 발송 주 대상 |
| school | 학교 | TEXT | 휘문고, 단대부고 등 |
| grade | 학년 | INT | 1, 2, 3 (고1~고3) |
| track | 계열 | TEXT | 문과, 이과 |
| status | 재원 상태 | TEXT | 재원생, 수강이력자, 신규리드, 탈퇴 |
| branch | 분원 | TEXT | 대치, 송도 등 |
| registered_at | 등록일 | DATE | 학원 최초 등록일 |
| created_at | 생성시각 | TIMESTAMPTZ | 레코드 생성 |
| updated_at | 수정시각 | TIMESTAMPTZ | 레코드 수정 |

```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aca2000_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  parent_phone TEXT,
  school TEXT,
  grade INT CHECK (grade IN (1, 2, 3)),
  track TEXT CHECK (track IN ('문과', '이과', NULL)),
  status TEXT DEFAULT '재원생',
  branch TEXT NOT NULL,
  registered_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE students IS '학생';
COMMENT ON COLUMN students.id IS '학생 ID';
COMMENT ON COLUMN students.aca2000_id IS '아카2000 ID (마이그레이션 키)';
COMMENT ON COLUMN students.name IS '이름';
COMMENT ON COLUMN students.phone IS '학생 연락처';
COMMENT ON COLUMN students.parent_phone IS '학부모 연락처';
COMMENT ON COLUMN students.school IS '학교';
COMMENT ON COLUMN students.grade IS '학년 (1:고1, 2:고2, 3:고3)';
COMMENT ON COLUMN students.track IS '계열 (문과/이과)';
COMMENT ON COLUMN students.status IS '재원 상태 (재원생/수강이력자/신규리드/탈퇴)';
COMMENT ON COLUMN students.branch IS '분원 (대치/송도 등)';
COMMENT ON COLUMN students.registered_at IS '학원 최초 등록일';
```

#### enrollments · 수강 이력

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| id | 수강 ID | UUID | |
| student_id | 학생 ID | UUID | FK → students |
| course_name | 강좌명 | TEXT | 고2 수학 내신반 |
| teacher_name | 강사명 | TEXT | 백봉영T |
| subject | 과목 | TEXT | 수학, 국어, 영어, 탐구 |
| amount | 결제 금액 | INT | 원 단위 |
| paid_at | 결제일 | DATE | |
| start_date | 개강일 | DATE | |
| end_date | 종강일 | DATE | |

#### attendances · 출석 이력

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| id | 출석 ID | UUID | |
| student_id | 학생 ID | UUID | FK → students |
| enrollment_id | 수강 ID | UUID | FK → enrollments |
| attended_at | 출석일 | DATE | |
| status | 출석 상태 | TEXT | 출석, 지각, 결석, 조퇴 |

#### groups · 발송 그룹 (세그먼트)

이미지의 "발송 그룹"에 대응. 세그먼트 빌더로 만든 학생 묶음.

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| id | 그룹 ID | UUID | |
| name | 그룹명 | TEXT | "대치 고2 학부모" |
| branch | 분원 | TEXT | 대치, 송도 |
| filters | 필터 조건 | JSONB | `{ grades: [2], schools: [...], subjects: [...] }` |
| recipient_count | 총 연락처 | INT | 집계 캐시 |
| last_sent_at | 최근 발송일 | TIMESTAMPTZ | |
| last_message_preview | 마지막 발송 내용 | TEXT | "[광고] 여름 특강 안내..." |
| created_by | 생성자 | UUID | FK → auth.users |
| created_at | 생성시각 | TIMESTAMPTZ | |

#### templates · 문자 템플릿

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| id | 템플릿 ID | UUID | |
| name | 템플릿명 | TEXT | |
| subject | 제목 | TEXT | LMS 제목 |
| body | 본문 | TEXT | 메시지 본문 |
| type | 유형 | TEXT | SMS(단문), LMS(장문), ALIMTALK(알림톡) |
| teacher_name | 강사명 | TEXT | 선생님별 분류 |
| auto_captured | 자동 저장 여부 | BOOLEAN | 발송 시 자동 수집된 템플릿 |

#### campaigns · 발송 캠페인

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| id | 캠페인 ID | UUID | |
| title | 제목 | TEXT | |
| template_id | 템플릿 ID | UUID | FK |
| group_id | 그룹 ID | UUID | FK → groups |
| scheduled_at | 예약 시각 | TIMESTAMPTZ | |
| sent_at | 발송 완료 시각 | TIMESTAMPTZ | |
| status | 상태 | TEXT | 임시저장, 예약됨, 발송중, 완료, 실패, 취소 |
| total_recipients | 총 수신자 | INT | |
| total_cost | 총 비용 | INT | |

#### messages · 발송 건별 이력

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| id | 메시지 ID | UUID | |
| campaign_id | 캠페인 ID | UUID | FK |
| student_id | 학생 ID | UUID | FK |
| phone | 수신 번호 | TEXT | |
| status | 상태 | TEXT | 대기, 발송됨, 도달, 실패 |
| vendor_message_id | 벤더 ID | TEXT | 솔라피·문자나라·to-go 등 벤더 메시지 ID |
| cost | 비용 | INT | |
| sent_at | 발송 시각 | TIMESTAMPTZ | |
| delivered_at | 도달 시각 | TIMESTAMPTZ | |
| failed_reason | 실패 사유 | TEXT | |

#### unsubscribes · 수신 거부

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| phone | 전화번호 | TEXT PK | |
| unsubscribed_at | 거부일 | TIMESTAMPTZ | |
| reason | 사유 | TEXT | |

#### users_profile · 계정과 권한

이미지의 "계정과 권한 관리"에 대응.

| 컬럼명 | 한글 의미 | 타입 | 설명 |
|---|---|---|---|
| user_id | 사용자 ID | UUID PK | FK → auth.users |
| name | 이름 | TEXT | |
| role | 권한 | TEXT | 마스터, 관리자, 실장, 사용자 |
| branch | 소속 분원 | TEXT | 대치, 송도 |
| created_at | 생성시각 | TIMESTAMPTZ | |

### 4.2 학생 프로필 집계 뷰

```sql
CREATE VIEW student_profiles AS   -- 학생 프로필 (집계 뷰)
SELECT
  s.id,                                                   -- 학생 ID
  s.name,                                                 -- 이름
  s.school,                                               -- 학교
  s.grade,                                                -- 학년
  s.track,                                                -- 계열
  s.status,                                               -- 재원 상태
  s.branch,                                               -- 분원
  s.parent_phone,                                         -- 학부모 연락처
  COUNT(DISTINCT e.id) AS enrollment_count,               -- 총 수강 횟수
  COALESCE(SUM(e.amount), 0) AS total_paid,              -- 총 결제 금액
  ARRAY_AGG(DISTINCT e.subject)
    FILTER (WHERE e.subject IS NOT NULL) AS subjects,    -- 수강 과목 목록
  ROUND(AVG(
    CASE WHEN a.status IN ('출석','지각') THEN 1.0 ELSE 0.0 END
  ) * 100, 1) AS attendance_rate,                        -- 출석률
  MAX(a.attended_at) AS last_attended_at,                -- 마지막 출석일
  MAX(e.paid_at) AS last_paid_at                         -- 마지막 결제일
FROM students s
LEFT JOIN enrollments e ON e.student_id = s.id
LEFT JOIN attendances a ON a.student_id = s.id
GROUP BY s.id;
```

### 4.3 RLS 권한 (4단계로 축소)

MVP는 심플하게 4단계:

| 권한 (영어/한글) | 접근 범위 |
|---|---|
| master (마스터) | 전체 분원 |
| admin (관리자) | 본인 분원 전체 |
| manager (실장) | 본인 분원 읽기 + 발송 |
| viewer (사용자) | 본인 분원 읽기만 |

---

## 5. Feature Requirements (MVP 집중 · 학생 목록 + CRM 핵심)

MVP는 **학생 목록 + 필터링 + 발송 그룹 + 문자 발송** 4개 기능에 집중. 나머지는 Phase 1+.

### 5.1 F1 · 학생 명단 (P0, 최우선)

이미지 사이드바의 "학생 명단" 에 해당.

**F1-01 · 학생 목록 페이지** (`/students`)
- 테이블 뷰: 이름 · 학교 · 학년 · 계열 · 재원 상태 · 학부모 연락처 · 최근 수강
- 상단 검색창: 이름·학교·학부모 연락처 전체 검색
- 분원 드롭다운 필터 ("전체 분원")
- 학년·계열·재원상태 체크박스 필터 (접이식 사이드)
- 페이지네이션 (50건/페이지)
- 행 클릭 → 학생 상세 페이지
- 우상단 `학생 추가하기` 검정 버튼 (이미지의 `그룹 추가하기` 스타일 동일)
- 선택된 학생 → `선택 학생으로 그룹 만들기` 가능

**F1-02 · 학생 상세 페이지** (`/students/[id]`)
- 프로필 카드 (이름·학교·학년·계열·학부모 연락처)
- 수강 이력 타임라인
- 출석 통계 (출석률·결석 수)
- 발송 이력 탭 (이 학생/학부모가 받은 문자)

**F1-03 · Aca2000 CSV Import** (`/admin/import`)
- 학생·수강·출석 3개 엑셀 업로드
- 학생 ID 매칭 검증
- 실패 건 CSV 다운로드
- 트랜잭션 처리 (전체 성공 or 전체 롤백)

### 5.2 F2 · 발송 그룹 (P0, 이미지 핵심 화면)

이미지 메인 영역에 해당. 세그먼트 빌더 + 그룹 리스트.

**F2-01 · 발송 그룹 리스트 페이지** (`/groups`)

이미지 구조 그대로 구현:
- 상단 검색창 + 분원 필터 (`전체 분원`) + 우상단 `그룹 추가하기` 검정 버튼
- 테이블 컬럼: **체크박스 · 분원 · 그룹명 · 총 연락처 · 최근 발송일 · 마지막 발송 내용 · 메뉴(⋯)**
- 각 행 좌측 체크박스 (선택 가능, 다중 선택으로 일괄 삭제)
- 행 클릭 → 그룹 상세 또는 바로 발송 화면으로 이동
- 메뉴(⋯): 수정 · 복제 · 삭제 · 이 그룹으로 발송

**F2-02 · 그룹 추가 (세그먼트 빌더)** (`/groups/new`)
- 3-필터만: **학년 · 학교 · 과목**
- 실시간 인원 카운트 (디바운스 300ms)
- 자동 제외 (백그라운드, UI에 작게 안내): 비활성 DB · 수신거부 · 최근 3회 수신자
- 저장 시 그룹명 입력 → `groups` 테이블에 저장

**F2-03 · 그룹 상세** (`/groups/[id]`)
- 그룹에 포함된 학생 리스트 (테이블 뷰, F1-01 재활용)
- "이 그룹으로 문자 발송" CTA 버튼
- 그룹 수정·삭제

### 5.3 F3 · 문자 발송 (P0)

이미지 사이드바의 "문자 발송" 대분류. 하위는 "발송 그룹"(F2), "문자 & 알림톡 템플릿"(F3-01), "문자 발송 내역"(F3-02).

**F3-01 · 문자 & 알림톡 템플릿** (`/templates`)
- 템플릿 리스트 (제목 · 유형 · 강사명 · 최근 수정일)
- 템플릿 생성 폼
  - 유형 선택: SMS(단문 · 90 bytes) / LMS(장문 · 2,000 bytes · 25원) / 알림톡
  - 제목 (LMS/알림톡만)
  - 본문 (실시간 바이트 카운터)
  - 푸터 자동 삽입 안내 배너
- 강사별 분류 필터

**F3-02 · 문자 발송 내역** (`/campaigns`)
- 캠페인 리스트 (제목 · 그룹 · 발송 시각 · 상태 · 도달률 · 비용)
- 상태 필터 · 기간 필터
- 행 클릭 → 캠페인 상세
- 캠페인 상세: 건별 도달 상태 · 실패 건 재발송

**F3-03 · 새 발송 작성** (`/compose`)
- 1단계: 발송 그룹 선택 (기존 그룹에서 고르거나, 현장에서 빠른 필터로 새 그룹 만들기)
- 2단계: 템플릿 불러오기 또는 직접 작성
- 3단계: 미리보기 + 비용 확인 + 테스트 발송
- 4단계: 즉시 발송 또는 예약 발송

**F3-04 · SMS Provider 어댑터**
- `src/lib/messaging/adapters/` 하위
- 솔라피(SOLAPI)만 실제 구현 (MVP)
- 문자나라, SK to-go, Sendwise 어댑터는 인터페이스·스텁만 준비 (Phase 1 연결 가능 상태)

### 5.4 F4 · 계정과 권한 관리 (P0, 축소)

이미지 사이드바 최상단.

**F4-01 · 로그인** (`/login`)
- 이메일 + 비밀번호
- 로그인 실패 시 에러

**F4-02 · 계정 목록** (`/accounts`, 마스터·관리자만)
- 사용자 리스트 (이름·이메일·권한·분원)
- 권한 변경 · 계정 비활성화

### 5.5 MVP에서 명확히 빠지는 것 (Phase 1+)

- 비용 대시보드 (차트·예산) — Phase 1
- 자동 발송 트리거 (결석 자동 알림 등) — Phase 1
- A/B 테스트 — Phase 2
- 전화 상담 STT — Phase 2
- AI 스크립트 추천 — Phase 2
- 설명회 관리 / QR 체크인 — 별도 모듈
- 털기 작업 — 별도 모듈

---

## 6. Non-Functional Requirements

### 6.1 성능
- 학생 목록 페이지 < 1s (1만 건 기준)
- 그룹 인원 카운트 < 500ms
- 대량 발송 큐 적재 < 30초 (5,000건)

### 6.2 접근성 (40~60대 사용자 배려)
- 기본 폰트 15px (일반 14px보다 큼)
- 버튼·입력창 최소 높이 40px (작은 터치 영역 방지)
- 색상 대비 WCAG AA 이상
- 키보드 내비게이션 완전 지원
- 에러 메시지 한국어 평문 (전문 용어 최소화)

### 6.3 보안
- 학부모 연락처 로그 마스킹 (010-****-1234)
- API 키는 Supabase Vault
- 모든 요청 인증 필수

### 6.4 컴플라이언스
- [광고] 자동 삽입
- 080 수신거부 자동 삽입
- 21시~08시 광고 발송 차단
- 수신 거부 7일 내 반영

---

## 7. MVP Scope Boundary

### 7.1 IN (Phase 0)

- F1 학생 명단 (목록·상세·Import)
- F2 발송 그룹 (리스트·생성·상세)
- F3 문자 발송 (템플릿·작성·이력)
- F4 계정과 권한 (로그인·계정 관리)

### 7.2 OUT (Phase 1+)

- 비용 대시보드
- 자동 발송 트리거
- A/B 테스트
- 전화 상담 STT
- AI 추천
- 설명회 모듈
- 털기 모듈
- 학부모 포털

---

## 8. Development Constraints

- TypeScript strict · any 금지
- Zod 런타임 검증
- Server Component 우선
- 한글 주석 허용, 코드는 영어
- DB 컬럼 COMMENT 는 한글로 필수
- 커밋: Conventional Commits

---

## 9. Harness Agent Specification

### 9.1 Agent Roster

| Agent | 책임 | 산출물 |
|---|---|---|
| architect | 스키마·타입·디자인 토큰 | supabase/migrations/, src/config/ |
| backend-dev | profile·messaging 로직 | src/lib/ |
| frontend-dev | UI 컴포넌트·페이지 | src/components/, src/app/ |
| qa-engineer | 테스트·경계값 | tests/, e2e/ |

### 9.2 실행 패턴

```
architect → [backend-dev, frontend-dev (병렬)] → qa-engineer
```

---

## 10. Milestones

| 주차 | 산출물 |
|---|---|
| 0 | 벤더 계약 (솔라피) · Aca2000 샘플 추출 |
| 1-2 | 스키마 · Next.js 세팅 · 디자인 토큰 적용 · 레이아웃 |
| 3-4 | F1 학생 명단 · F2 발송 그룹 |
| 5-6 | F3 문자 발송 · F4 계정 권한 · 솔라피 연동 |
| 7-8 | 명원장 밀착 테스트 · 대치 파일럿 |

---

## 11. SMS Provider 연동 플랜

### 11.1 지금 당장 할 것 (주차 0)

**솔라피(SOLAPI)를 1순위로** 채택. (SMS 8원 / LMS 14원 / MMS 22원 / 알림톡 13원 — 문자나라 30/50 대비 절반 이하)

- [ ] 솔라피 콘솔 가입 + API Key + Secret 발급 (Secret 은 1회만 표시)
- [ ] IP 화이트리스트 등록 (개발 IP / 운영 서버 IP)
- [ ] 발신번호 등록 (사업자등록증 + 통신서비스 증빙, 통신사 검증 1~3 영업일)
- [ ] 080 무료수신거부 번호 신청 (솔라피 공용 사용 가능)
- [ ] 선불 잔액 충전 (MVP 1만원 권장)
- [ ] (알림톡 쓰면) 카카오 비즈채널 개설 + PFID + 템플릿 사전 검수 (1~2주)

### 11.2 개발 단계 (MVP 2개월 내)

- Week 1-2: `SmsAdapter` 공통 인터페이스 + 솔라피 스펙 정리 + 문자나라/SK to-go/Sendwise 스텁
- Week 3-4: 솔라피 어댑터 실제 구현 + 단위 테스트 + 실 API 소량 테스트
- Week 5-6: 대량 발송(큐·재시도) + Webhook 핸들러
- Week 7-8: 명원장 실전 테스트, 점진 확대

### 11.3 Phase 1 확장

1. 문자나라 어댑터 활성화 (스텁 → 실구현, failover 후보)
2. SK to-go 어댑터 활성화
3. Sendwise 어댑터 활성화
4. Failover: primary 장애 3회 연속 시 자동 전환
5. A/B 테스트로 도달률·비용 비교

### 11.5 Aca2000 → 자체 CRM 이관 주의

- 발신번호를 세정 명의로 재등록 (Aca2000 명의 재사용 불가 가능성)
- 기존 수신 거부 DB Aca2000 export → `unsubscribes` 이관
- 학부모 동의 고지 1회 발송

---

## 12. 다음 단계

1. 이 PRD를 Claude Code에 넣고 하네스 기반으로 개발 시작
2. 주차 0 항목 병렬 진행 (벤더 계약 + Aca2000 샘플)
3. 주차 1부터 개발 착수 · 주차 8 파일럿 런칭
