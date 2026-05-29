# 세정학원 CRM — 프로덕트 개요

> 2026-05-29 기준. 코드(main 브랜치) · 마이그레이션 0001~0079 · 운영 인터뷰 종합.
> Claude/외부 컨텍스트 주입용. 변경 시 본 문서도 함께 갱신.

---

## 1. 개요

- 세정학원의 **학생 명단 필터링 + 문자 발송 CRM**.
- 기존 시스템(Aca2000)을 대체. 목표 3가지:
  1. Aca2000 대비 **편의성 개선** (특히 40~60대 행정/실장 직원 사용성)
  2. **원장 1인 의존 탈피** (담당 분리 + 권한·감사 가능한 구조)
  3. **문자비 20~30% 절감** (가드·dedupe·정확한 타겟팅)
- MVP(Phase 0) 범위: 학생 명단(F1) · 발송 그룹(F2) · 문자 발송(F3) · 계정 권한(F4).
- 비용/자동트리거/A/B/STT/AI 추천/설명회·털기 모듈은 Phase 1 보류.

## 2. 비즈니스 맥락

- 학원 규모: **학생 약 6만, 강좌 약 6천, 결제·티켓 약 38만, 출결 다년치**.
- 분원: **대치 · 송도 · 반포 · 방배** 4곳. 운영팀은 분원 단위로 분리, 행정팀이 통합 관리.
- 운영 사용자: 행정 과장/팀장, 실장, 부원장, 원장. 40~60대 비중 높음 → 접근성·실수 방지 우선.
- 외부 SMS 벤더: **sendon** 단일(공식 SDK `@alipeople/sendon-sdk-typescript`). 어댑터 패턴 유지하지만 구현체는 sendon 하나.

## 3. 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | **Next.js 15 App Router** + TypeScript strict (`any` 금지) |
| UI | Tailwind v4 + shadcn 일부 + `@base-ui/react`, lucide-react |
| 폰트 | Pretendard (본문) / Serif(로고만) |
| 데이터 | **Supabase**(PostgreSQL 17) + RLS + Edge Functions + pg_cron |
| 클라이언트 상태 | **TanStack Query**, Zustand |
| 검증 | Zod (모든 외부 입력 런타임 검증) |
| 테스트 | **Vitest** (804건 이상). Playwright 미도입(현재) |
| 파일 | papaparse(CSV), xlsx |
| 호스팅 | Vercel (Fluid Compute · Node 24) |
| Supabase 클라이언트 | `@supabase/ssr` (서버) / `supabase-js` (브라우저) |

빌드/검증 스크립트:
```bash
npm run dev          # next dev
npm run build
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
```

## 4. 디렉토리 구조

```
src/
├── app/
│   ├── (auth)/          # 로그인·분원 선택·비밀번호 변경
│   ├── (features)/
│   │   ├── students/    # F1 학생 명단
│   │   ├── classes/     # F0 강좌 리스트·상세 (수강생·출결 격자)
│   │   ├── groups/      # F2 발송 그룹
│   │   ├── compose/     # F3 문자 발송 위저드
│   │   ├── campaigns/   # F3 발송 내역 리스트·상세
│   │   ├── templates/   # 메시지 템플릿
│   │   ├── accounts/    # F4 계정·권한
│   │   ├── regions/     # 학교↔분원/지역 매핑
│   │   ├── admin/       # Aca2000 import 등 운영자 도구
│   │   └── me/          # 본인 정보
│   └── api/             # Server Actions 외 일부 Edge/Route
├── components/
│   ├── shell/           # 사이드바, 드롭다운, 공통 UI 셸
│   ├── students/ classes/ groups/ campaigns/ templates/ compose/ messaging/
│   └── ui/              # 토스트 등 원자 컴포넌트
├── lib/
│   ├── auth/            # current-user, branch-context, can()
│   ├── supabase/        # server/client/service 클라이언트
│   ├── schemas/         # Zod 단일 출처 (group/class/student/compose/common 등)
│   ├── profile/         # 학생 프로필 엔진, dev-seed
│   ├── classes/         # 강좌 조회·필터·옵션
│   ├── groups/          # 필터 해석, 수신자 로드, count/diff
│   ├── messaging/       # 발송 파이프라인 (architect + backend-dev)
│   ├── campaigns/       # 캠페인 조회/리스트
│   ├── templates/       # 템플릿 조회
│   ├── etl/             # ETL 보조 (sync-status 등)
│   ├── regions/         # 지역 매핑
│   └── import/          # CSV/XLSX import
├── types/               # DB row 타입 (수동 유지, 마이그와 1:1)
├── config/              # 분원/지역 상수
└── styles/globals.css   # 디자인 토큰 (@theme inline)

supabase/migrations/     # 0001~0079 (한글 COMMENT 필수)
tests/unit/              # Vitest 단위 테스트 (49 파일)
scripts/etl/             # Aca2000 → Supabase ETL (Python, 협업자 영역)
docs/                    # 본 문서 및 PRD
```

## 5. 데이터 모델

### 5.1 2계층 구조 (raw / curated)

- **`aca_*` (raw)** — Aca2000 ETL 적재 원본. 정제 X, 외부 매시간 동기화.
  - `aca_students, aca_classes, aca_enrollments, aca_attendances, aca_payments, aca_tickets, aca_class_accounts, aca_unpaid, aca_teachers, aca_teacher_subjects, aca_class_types` (총 11개, 0048까지 누적 + 5월 확장)
- **`crm_*` (curated)** — 앱이 직접 읽고 쓰는 정제 계층. 분원 RLS·정책 적용.
  - `crm_students, crm_classes, crm_enrollments, crm_attendances`(raw 1:1 + 정제 룰)
  - `crm_users_profile, crm_groups, crm_templates, crm_campaigns, crm_messages, crm_unsubscribes, crm_school_regions`
- **ETL 함수 `apply_aca_to_crm()`** — raw → curated 일괄 UPSERT (status·school 자동 룰 + 1:1 매핑). 함수 단에서 `SET LOCAL statement_timeout = '20min'` (0072).

### 5.2 핵심 테이블 요약

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `crm_students` | id, aca2000_id, name, phone, parent_phone, school, grade(enum 10종), grade_raw, school_level(초/중/고/기타), status(재원생/수강이력자/수강 x/탈퇴), branch, registered_at | enum은 `schemas/common.ts` 단일 출처 |
| `crm_classes` | id, aca_class_id, branch, name, teacher_name, subject(7종)+subject_raw, total_sessions, amount_per_session, total_amount, capacity, schedule_days/time, start_date/end_date, active | 시즌 분류는 0073에서 폐기 |
| `crm_enrollments` | id, student_id, course_name, teacher_name, subject(NULL — classes.subject만 신뢰), amount(회차당), paid_at, start_date/end_date, aca_class_id | aca_class_id로 classes 매칭 |
| `crm_attendances` | id, student_id, enrollment_id, attended_at, status(출석/지각/결석/조퇴/보강), aca_attendance_id, aca_class_id | "강좌 × 일자" 격자 group by 키 |
| `crm_groups` | id, name, branch, **filters(JSONB)**, recipient_count, last_sent_at, last_message_preview, created_by | filters = GroupFiltersSchema (kind, 조건, 제외) 단일 출처 |
| `crm_templates` | id, name, subject, body, type(SMS/LMS), is_ad, byte_count, branch, created_by | LMS만 제목 필수 |
| `crm_campaigns` | id, title, template_id, group_id, scheduled_at, sent_at, status(임시저장/예약됨/발송중/완료/실패/취소), total_recipients, total_cost, branch, is_test, body(inline), subject, type, is_ad, **dedupe_by_phone**(0074), **send_to_parent/send_to_student**(0077) | 0075 RLS: 본인 것만 + master 전체 |
| `crm_messages` | id, campaign_id, student_id, phone, name, status(대기/발송됨/도달/실패), failed_reason, vendor_message_id, cost, sent_at, is_test | 캠페인별 행 |
| `crm_unsubscribes` | phone(정규화), unsubscribed_at, source | 080 수신거부 + 운영 수동 등록 |
| `crm_school_regions` | school, region(NFC 정규화, 0035) | UI 지역 필터/그룹 빌더 매핑 키 |
| `crm_users_profile` | user_id(auth.users FK), name, email, role(master/admin/manager/viewer), branch, active, must_change_password | RLS 헬퍼의 단일 소스 |

### 5.3 주요 뷰

- **`student_profiles`** — 학생 상세/명단의 단일 뷰. 분원/학년/학교/상태/등록일/출석률(분원별 분기) 집계. 0064~0066 정제.

## 6. 인증 & 권한

### 6.1 역할 4단계
- **master**: 전 분원 전체 R/W. 발송자 필터·캠페인 전체 가시성.
- **admin**: 본인 분원 R/W (그룹·템플릿·캠페인 생성/수정/발송).
- **manager**: 본인 분원 R, 일부 W. 발송 권한 제한.
- **viewer**: 본인 분원 R-only.

### 6.2 RLS 헬퍼 (0003 도입 → 0049에서 `crm_users_profile` 참조로 갱신)
```
current_user_role()  current_user_branch()  is_master()
can_write_branch(b)  can_send_branch(b)  can_read_branch(b)
```

### 6.3 발송내역 가시성 (0075, 박은주 5/22)
- `crm_campaigns_read_own_or_master` 정책: **master 전체, 그 외 created_by=auth.uid() 본인 발송분만**.
- 앱 레이어 1차 가드도 동일(`list-campaigns.ts`/`get-campaign.ts`). 발송자 필터 UI는 master 전용.

### 6.4 분원 컨텍스트 (`branch-context.ts`)
- 사이드바 헤더의 분원 셀렉터 → URL `?branch=` 으로 전파 → 서버 페이지가 `applyBranchContextToParams` 로 받음.
- master는 전 분원 토글 + "전체" 옵션. 그 외는 본인 분원 강제.

## 7. 핵심 기능

### 7.1 학생 명단 (`/students`)
- 필터: 학년(10종) · 학교(MultiSelectDropdown 강사 패턴) · 학교 등록/미등록 토글 · 지역(`crm_school_regions` 매핑) · 과목 · 재원 상태(4종).
- 학생 상세: 프로필 + 강좌별 출결 격자 + 발송된 메시지(개별 재발송 버튼 포함, 2026-05-27).
- 학교명은 NFC 정규화(0035). region 매칭은 byte-level 일치 보장.
- 학년 enum 10종 (초등/중1~고3/재수/졸업/미정). `0041`에서 초1~초6 추가 후 `0043`에서 초등 단일값으로 통합.

### 7.2 강좌 (`/classes`, `/classes/[id]`)
- 리스트: 분원/과목/강사/요일/정렬/진행상태(전체·진행중·설명회) + 기간 필터(ticket 기준).
- 행별 **"발송" 액션**(2026-05-27): write/group 권한자에게 `/groups/new?class=<id>` 진입점.
- 상세: 수강생 명단(학생 상세 링크) + 출결 격자 + **"다음 시즌 미등록 학생" 패널**(2026-05-27)
  - `isLapsedStudent(status) = status !== '재원생'` 술어. 그 수강생 중 진행중 강좌 없는 학생 명단 + "이 학생들에게 발송"(`?class=&filter=lapsed`).
- 시즌 분류(`season` 6종 enum)는 0070에서 도입 후 **0073에서 전면 제거**.

### 7.3 발송 그룹 (`/groups`, `/groups/new`, `/groups/[id]`)
**그룹은 두 종류** (kind = 'filter' | 'custom'). JSONB `filters.kind` 저장, 키 없으면 'filter'.

#### 필터 그룹 (filter, 동적 동기화)
- 조건만 저장: grades, schools, subjects, regions, statuses, unmappedSchool/mappedSchool.
- 제외: excludeStudentIds(개별), **excludeSchools**(학교별, 2026-05-27), **excludeClassIds**(강좌별 동적, 2026-05-27).
- 발송 시점 재조회 → **신규 학생 자동 반영**.

#### 커스텀 그룹 (custom, 정적 스냅샷)
- includeStudentIds 명단만. 조건·학교/강좌 제외는 무시.
- 빌더에서는 **종류 선택 UI/수동 학생추가 미노출**(2026-05-28).
  - 사용자는 항상 필터 그룹만 직접 생성.
  - 커스텀은 **prefill 진입점**으로만 생성:
    - `?student=<id>` 학생 상세 → 1명
    - `?class=<id>` 강좌 상세 → 그 강좌 수강생 전부
    - `?class=<id>&filter=lapsed` 종강 강좌의 이탈 학생
- 빌더가 prefill을 감지하면 **담긴 명단 review(칩 + X 제거) + 저장**만 노출.

#### 빌더 UX 추가
- **학교 선택 MultiSelectDropdown**(2026-05-28): 강사 선택과 동일. 전체선택/전체해제(검색·학년 좁힘 적용된 결과 대상). 20개 초과 시 개별 칩 대신 "N개 선택됨" 요약 칩.
- **우측 sticky 선택 요약 패널**(2026-05-29): 포함(학년·학교·재원·지역·과목) + 제외(학교·강좌, `--danger` 톤) 한눈에. 학교는 4개 초과면 "휘문고, 단대부고 외 N개" 축약.
- 인원 카운트: `crm_groups.recipient_count`(저장 시점) vs `studentsTotal`(현재 재조회). 다르면 "저장 시 2,287명 → 3,767명 (+1,480)" 표시(필터 그룹의 동기화 의미).

#### 검증 규칙 (`isValidCustomGroupFilters`)
- custom → `includeStudentIds >= 1` 강제 (Zod refine, 한글 에러 path `filters.includeStudentIds`).
- filter → 무제약(빈 조건이면 분원 전체).

#### 목록·상세 배지
- `GroupKindBadge`: [필터] / [커스텀]. 스냅샷/동기화 구분에 유용.

### 7.4 문자 발송 (`/compose`)
4단계 위저드 (Client wizard + Server Actions):
1. **그룹 선택** — `?groupId=` prefill 가능, 분원 필터, 종류 배지.
2. **템플릿/본문 작성 + 옵션** —
   - SMS / LMS 선택 (`type`).
   - 광고(`isAd`) 토글 → (광고) prefix + 080 footer 자동 적용 (서버 최종 가드).
   - **동일번호 1회 발송** (`dedupeByPhone`, 2026-05-27): 형제·공유번호 1건 collapse.
   - **발송 대상 번호** (`sendToParent`/`sendToStudent`, 2026-05-27): 학부모만/학생만/둘 다. Zod refine으로 둘 다 false 금지.
   - `{이름}{날짜}` 변수 토큰 (cursor 위치 삽입). dedupe ON일 땐 `{이름}` 사용 금지(Zod refine).
   - 핸드폰 형태 미리보기에서 **인라인 편집** (제목/본문/광고 푸터 학원명·수신거부 번호). 우측 sticky 컬럼 480px (2026-05-28). 말풍선은 editable 시 `w-full max-w-[90%]`로 폭 고정 → 40바이트 한 줄 보장 (2026-05-29).
   - 실시간 EUC-KR 바이트 카운터 (`sms-bytes.ts` 단일 계산). 한도: SMS 90b, LMS 2000b.
3. **미리보기·재계산** — `previewRecipients` 호출. `DedupeCounts(targetStudents/legs/actualMessages/collapsed/dedupeApplied)` 표시.
4. **즉시발송 / 예약발송 / 테스트발송** — 확인 다이얼로그 → Server Action.

### 7.5 캠페인/발송 내역 (`/campaigns`, `/campaigns/[id]`)
- 리스트: 본인 발송분만 (master 전체). 필터: 상태·기간·발송자·강사·강좌(본문 ilike).
- 상세: 상태 배지 · 진행률(폴링) · 캠페인 메타 · 메시지 테이블(상태 필터 칩, 학생/번호/상태/사유/시각).
- **재발송 2종**:
  - 실패건 일괄: `ResendFailedButton` (캠페인 우상단).
  - **단건 행별**: `ResendSingleButton`(2026-05-27). 실패·발송됨 행만 활성, 대기/도달 차단. {이름}/{날짜} 치환 재적용(2026-05-27 픽스 — 단건 재발송이 `{이름}` 글자 그대로 보내던 버그 수정).
- 학생 상세 페이지의 메시지 패널에도 행별 재발송 버튼(2026-05-27).

### 7.6 템플릿 (`/templates`)
- 분원별 저장(0055). SMS/LMS, 광고 토글, 자동 바이트 계산.
- compose 단계 2에서 dropdown 빠른 불러오기.
- ALIMTALK 카카오 알림톡은 0059에서 제거(광고 발송 채널 부적합 → Phase 1).

### 7.7 계정·권한 (`/accounts`)
- master만 접근. crm_users_profile 관리.
- 분원·역할·활성·강제 비밀번호 변경 플래그.
- 본인 페이지(`/me`)에서 비밀번호 변경.

### 7.8 학교 지역 매핑 (`/regions`)
- master만 편집. `crm_school_regions` 의 학교↔지역(강남구/서초구/송파구/동작구/용산구/인천 송도/기타) 관리.
- 미매핑 학교 카운트 RPC(`count_unmapped_schools`, `list_unmapped_school_counts`)로 누락 추적.

### 7.9 어드민·Import (`/admin`)
- Aca2000 CSV/XLSX import (F1-03). students/enrollments/attendances.
- 운영팀이 수동으로 raw 갱신할 때 사용 (평소엔 ETL 자동).

## 8. 문자 발송 파이프라인 상세

### 8.1 수신자 해석 순서 (전 경로 일관)
모든 경로(`count-recipients`, `load-all-group-recipients`, `preview-recipients`, `dispatch-scheduled`, `apply-filters` dev-seed)가 **`isCustomGroup(filters)`** 술어로 분기:

```
[필터 그룹]
  분원 필터
  → 조건(학년/학교/지역/과목/상태/등록·미등록)
  → 제외(excludeStudentIds + excludeSchools + excludeClassIds)
  → 탈퇴/수신거부 자동 제외
  → 후보 학생 set

[커스텀 그룹]
  분원 필터
  → includeStudentIds 명단만
  → excludeStudentIds 차감(개별 제거)
  → 탈퇴/수신거부 자동 제외
  → 후보 학생 set

[공통 후속]
  → 레그 확장 (expandRecipientLegs)
       학생 1명 → 최대 2 레그(학부모 / 학생)
       번호 결측 레그 스킵, 레그별 수신거부 독립 판정
  → 가드(applyAllGuards): (광고) prefix · 080 footer · 야간광고 차단(21~08시)
  → dedupe(collapseByPhone)
       dedupeByPhone=true 시 정규화 번호 기준 collapse, 첫 row(최근 등록) 유지
  → 어댑터(sendon) 일괄 발송(청크 100건)
  → crm_messages INSERT + crm_campaigns.total_cost 누적
```

### 8.2 핵심 모듈
- `src/lib/messaging/`
  - `send-campaign.ts` 즉시 발송 진입. campaign INSERT + reloadEligibleRecipients + 발송 루프.
  - `dispatch-scheduled.ts` 예약 발송 cron 처리. campaign의 send_to_*/dedupe를 읽어 동일 흐름 재현.
  - `drain-campaign.ts` 청크 발송 self-invocation 워커(/api/messaging/drain).
  - `resend-failed.ts` 실패건 일괄 재발송.
  - `resend-single.ts` 단건 재발송(개인화 치환 포함).
  - `expand-legs.ts` 학생→레그 확장 + 레그별 수신거부.
  - `dedupe-recipients.ts` `collapseByPhone` 순수 함수.
  - `personalize.ts` `applyDateToken`/`applyNameToken` 치환.
  - `guards/` insert-ad-tag · insert-unsubscribe-footer · check-quiet-hours · filter-recipients.
  - `adapters/sendon.ts` sendon 어댑터 (live 모드 SMS/LMS, MMS는 컬럼만).
  - `cost-rates.ts` sendon 단가: SMS 7.4 / LMS 24 / 알림톡 6.4 / MMS 59.2 (원, 부가세 별도).
  - `unsubscribed-phones.ts` 수신거부 phone 캐시 페치 (React cache dedupe).

### 8.3 카운트 계약 (`DedupeCounts`, `src/types/messaging.ts`)
- `targetStudents` 발송 후보 **학생 수**(사람).
- `legs` 학부모/학생 레그 합계(번호 결측·수신거부 차감 후). 단일 대상이면 = targetStudents.
- `actualMessages` dedupe 후 큐 적재 건수. dedupe OFF면 = legs.
- `collapsed` = legs − actualMessages.
- `dedupeApplied` 캠페인의 `dedupe_by_phone`.
- **비용은 actualMessages 기준** (절감액 발생).

## 9. ETL (aca → crm)

- **GitHub Actions 워크플로우** `.github/workflows/sync-aca.yml` (협업자 영역).
- Python 스크립트 `scripts/etl/migrate_students.py` 등 4단계 + classes.start_date/end_date 백필 SQL.
- 매시간 실행, Slack 통보.
- **상시 노트북 ETL 배포 (윈도우)**: scripts/etl의 run_all.bat + register-task.ps1. record_sync.py가 `etl_sync_runs` 테이블(0079)에 실행 이력 기록 → 사이드바 "마지막 동기화 시각" 표시.
- `apply_aca_to_crm()` SQL 함수가 ETL 종료 후 호출 — raw → curated 정제 UPSERT.

> ⚠️ **알려진 이슈**: sync-aca.yml의 백필 단계가 `public.classes` / `public.enrollments` 옛 테이블명 참조 — 0049의 `aca_classes` / `aca_enrollments` 리네임 이후 깨졌을 가능성. 협업자가 ETL 책임자라 별도 트랙.

## 10. 디자인 시스템

`src/app/globals.css` 의 `@theme inline` + `:root` CSS 변수가 단일 출처:

```
배경:  --bg(#fafbfc) --bg-card(#fff) --bg-muted(#f1f3f5) --bg-hover(#e9ecef)
텍스트: --text(#212529) --text-muted(#6c757d) --text-dim(#adb5bd)
보더:  --border(transparent) --border-strong(#ced4da)
액션:  --action(#212529 검정) --action-hover(#000) --action-text(#fff)
경고:  --danger(#c92a2a) --danger-bg(#fff5f5)
```

- **흰색+검정 미니멀**. 보라색·형광·강한 색 금지.
- 폰트 기본 15px (40~60대 가독성).
- 인터랙티브 요소 최소 높이 40px, AA 대비.
- 빨강은 위험/제외 의미로만(필터 초기화·제외 칩·"광고" 경고 등).
- 색만으로 정보 전달 금지 — 아이콘+텍스트 병기.

## 11. 개발 규약 (CLAUDE.md 핵심)

1. **DB 컬럼 영어 snake_case, UI 라벨 한글**. 예: `parent_phone` → "학부모 연락처".
2. **모든 DB 컬럼에 한글 COMMENT 필수**. 마이그에 `COMMENT ON COLUMN ...` 빠뜨리지 말 것.
3. **TypeScript strict, `any` 금지**. 외부 입력은 Zod 검증.
4. **Server Component 우선**. 상호작용 필요한 곳만 `"use client"`.
5. 디자인 토큰 준수 (위 §10).
6. **40~60대 사용자 배려**: 폰트 15px, 인터랙티브 40px+, AA 대비.
7. **SMS 어댑터 패턴 유지** (환경변수 기반 벤더 전환 가능 구조).
8. **발송 안전 가드는 서버에서 최종 검증**:
   - [광고] 자동 삽입, 080 수신거부 footer, 21시~08시 광고 차단
   - 수신거부 DB 제외, 비활성/탈퇴 학생 제외
   - 클라이언트 가드는 UI 보조용일 뿐.
9. **로그 연락처 마스킹** (`010-****-1234`). API 키는 Supabase Vault.
10. **Conventional Commits** (`feat(scope): ...`, `fix(scope): ...`).

## 12. 에이전트 워크플로우 (.claude/agents/)

기능 1개를 만들 때 표준 흐름:
```
architect → [backend-dev, frontend-dev 병렬] → qa-engineer
```

- **architect** — 마이그·타입·Zod·디자인 토큰. 한글 COMMENT 강제. JSONB 활용 가능하면 마이그 회피.
- **backend-dev** — `src/lib/profile/`, `src/lib/messaging/`, Server Actions, Edge, pg_cron.
- **frontend-dev** — `src/components/shell/`, `src/app/(features)/`, shadcn/base-ui.
- **qa-engineer** — Vitest 단위·경계, 가드 회귀 방어.

스킬: `/feature` `/migrate` `/review-send`. 자세한 룰은 `.claude/agents/*.md`.

## 13. 테스트

- **Vitest** 49 파일, 843건 통과(2026-05-29 기준).
- 발송/그룹 로직은 dev-seed(`SEJUNG_DEV_SEED=1`)로 DB 미접속 검증.
- 가드/dedupe/레그/exclude/kind 분기는 순수 함수 단위 + dev-seed로 회귀 방어.
- Playwright E2E는 미도입(필요 인식만). RPC/RLS 실매칭은 통합 환경에서 별도 확인 필요.

## 14. 환경변수

```
# Supabase
SUPABASE_URL
SUPABASE_SECRET_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_DB_URL              # ETL psql 전용

# sendon (필수 3종)
SENDON_USER_ID
SENDON_API_KEY
SENDON_FROM_NUMBER

# Drain (예약·청크 발송 self-invocation 인증)
DRAIN_SECRET

# Dev
SEJUNG_DEV_SEED=1            # 가상 master + 시드 학생 50명, 실 발송 차단
```

## 15. 마이그레이션 이정표 (요약)

| 번호 | 핵심 변경 |
|---|---|
| 0001 | 기본 스키마 |
| 0003 | RLS 정책 + 헬퍼 함수(role/branch/master/can_*_branch) |
| 0012 | 학년 자유 TEXT → enum |
| 0015~0020 | classes 마스터 + start/end_date 백필 |
| 0035 | 학교명 NFC 정규화 |
| 0041 | 초1~초6 학년 추가 |
| 0044 | 문과/이과(`track`) 폐기 |
| 0049 | **테이블 리네임** students→aca_students 등 + crm_* 계층 분리 |
| 0051 | crm 큐레이티드 레이어 본격 적용 |
| 0055 | crm_templates 분원별 |
| 0058 | subject enum '설명회' 추가, 재원생 룰 보정(대치 1,623명 재분류) |
| 0059 | ALIMTALK 제거 (SMS/LMS만) |
| 0067 | search_students_by_region RPC |
| 0068 | search_recipients_by_subjects RPC |
| 0070 | classes.season 추가 |
| 0072 | apply_aca_to_crm timeout 20min |
| **0073** | classes.season 전면 제거 (0070 롤백) |
| **0074** | campaigns.dedupe_by_phone (동일번호 1회) |
| **0075** | campaigns RLS own-or-master (발송내역 본인 가시성) |
| **0076** | exclude RPC 파라미터 (학교/강좌 제외) + 협업자 패치 |
| **0077** | send_to_parent/send_to_student (학부모·학생 번호 선택) |
| 0078 | service_role statement_timeout (협업자 ETL) |
| 0079 | etl_sync_runs (협업자 ETL) |

## 16. 최근 변경 (2026-05-26 ~ 05-29)

박은주 부원장 5/22 인터뷰 리스트를 우선순위순으로 6개 + 그룹 모델 정리:

1. **발송내역 본인 것만** (마스터 전체) — 0075 RLS + 앱 가드 + 발송자 필터 master 전용.
2. **학교별/강좌별 제외** — `excludeSchools`/`excludeClassIds`(동적) + 0076 RPC 확장.
3. **학생/학부모 번호 토글** + 동시 발송 — 0077 + 레그 확장 모델.
4. **개별 학생 1명 재발송** — 메시지 행별 버튼 + 학생 상세 패널.
5. **강좌별 발송 전용 진입** — 강좌 리스트/상세 → /groups/new?class=
6. **종강 강좌 다음 시즌 미등록 추적** — isLapsedStudent 술어 + `?filter=lapsed` prefill + 강좌 상세 미등록 패널.
7. **동일번호 1회 발송** (Aca2000 "동일번호한번" 대응) — 0074 + collapseByPhone, {이름}과 상호배타.
8. **그룹 kind(필터/커스텀) 도입** → **빌더에서 커스텀 숨김**(prefill만 유지) — JSONB 기반, 마이그 없음.
9. **학교 선택 MultiSelectDropdown + 전체선택 + 선택 요약 패널**.
10. **단건 재발송 {이름}/{날짜} 치환 픽스** (글자 그대로 보내던 버그).
11. **미리보기 입력칸 폭 확장** — 우측 컬럼 480px + editable 말풍선 폭 고정 → 40바이트 한 줄 보장.

## 17. 알려진 이슈 / 협업 주의사항

### 17.1 협업자 존재 ⚠️
- 이 repo와 Supabase 프로젝트에 **다른 개발자/PC가 같이 push** 함 (주로 ETL 영역).
- 작업 전 `git pull --rebase` 권장. 마이그 번호 충돌(둘이 동시에 같은 번호 쓰는) 위험.
- 협업자가 0076 RPC 오버로드 충돌도 패치한 적 있음(83ebd64).

### 17.2 sync-aca.yml 옛 테이블명
- 백필 단계가 `public.classes`/`public.enrollments` 사용 — 0049 리네임 이후 깨졌을 가능성.
- ETL 담당자 영역이라 별도 추적.

### 17.3 `readFromNumber` 더미 fallback
- `src/lib/messaging/message-update-helpers.ts` 의 sendon fallback `"01000000000"`.
- CLAUDE.md "발신번호 하드코딩 금지"와 형식상 충돌하지만 실 발송은 dev-seed가 막음 → 안전망.
- env 누락 시 더미로 발송 시도가 가능한 구조이긴 함. 의도 확인 권장.

### 17.4 시드 한계
- `DEV_ENROLLMENTS` 11건 전부 `aca_class_id NULL` → dev-seed에서 강좌 매칭 경로 일부 검증 불가.
- excludeClassIds 실제 차감 매칭, RPC subjects-path 등은 통합 환경 E2E에서만 확인.

### 17.5 강좌별 prefill의 정적 스냅샷 특성
- `?class=`/`?filter=lapsed` 로 만든 커스텀 그룹은 includeStudentIds **저장 시점 스냅샷**.
- 신규 수강생 자동 반영은 안 됨(filter 그룹의 동기화와 대비). 의도된 동작이지만 운영자에게 안내 필요.

---

## 부록 A. 단어장

| 한글 | 의미 |
|---|---|
| 재원생 | 현재 진행 중 강좌 보유 학생 (active enrollment) |
| 수강이력자 | 과거 수강했으나 현재 active 아님 |
| 수강 x | 등록 자체가 없거나 모두 종강 + 설명회 아님 |
| 탈퇴 | 의도적 종료. 발송 자동 제외 |
| 종강 | end_date < 오늘 또는 이름 prefix (종)/종)/(폐)/폐) |
| 미정 | end_date >= 2050 (Aca2000 placeholder) |
| 설명회 | subject = '설명회'. 0058에서 enum 추가, 재원생 산정 제외 |
| 동기화 | 필터 그룹이 신규 학생을 자동 포함하는 동작 |
| 레그 | 학생 1명에게 발송되는 번호 단위(학부모/학생 = 최대 2 레그) |
| 동일번호 1회 | 같은 정규화 번호의 레그를 collapse해 1건만 발송 |

## 부록 B. 자주 보는 파일 빠른 인덱스

| 영역 | 파일 |
|---|---|
| Zod 단일 출처 | `src/lib/schemas/{group,class,student,compose,template,common}.ts` |
| 권한 가드 | `src/lib/auth/{current-user,can}.ts` |
| 수신자 해석 | `src/lib/groups/{count-recipients,load-all-group-recipients,apply-filters,resolve-exclusions}.ts` |
| 발송 코어 | `src/lib/messaging/{send-campaign,dispatch-scheduled,drain-campaign,resend-failed,resend-single,expand-legs,dedupe-recipients,personalize}.ts` |
| 가드 | `src/lib/messaging/guards/{insert-ad-tag,insert-unsubscribe-footer,check-quiet-hours,filter-recipients}.ts` |
| Compose UI | `src/components/compose/{compose-wizard,compose-step-1-group,compose-step-3-preview,compose-step-4-send,confirm-send-dialog,dedupe-count-note}.tsx` |
| 미리보기 | `src/components/messaging/phone-preview-card.tsx` |
| 그룹 빌더 | `src/components/groups/{group-builder,group-kind-badge,group-detail-view,groups-table}.tsx` |
| 디자인 토큰 | `src/app/globals.css` |
| 마이그 | `supabase/migrations/0001~0079_*.sql` |
| CLAUDE 룰 | `CLAUDE.md`, `.claude/agents/*.md`, `.claude/commands/*.md` |
