# STATUS · 진행 결과

최종 업데이트: 2026-04-27 · F3 Part B(Compose·실 발송) + 솔라피 1순위 + **본인 번호 1건 live 발송 검증** 완료.

## 한 줄 요약

Next.js 16 + Supabase 마이그레이션 7개 + **F1(학생) + F2(그룹) + F3 전체(템플릿·캠페인·어댑터·가드·Compose) + F4(계정·권한)** 동작. 솔라피 1순위 어댑터 + 가드 + SDK 실 호출 → **본인 번호 1건 SMS 도착 검증 완료** (vendorMessageId G4V20260427..., cost 8원). `npm test` 510/510 통과.

## 완료 체크리스트

### Phase 1a · Next.js 스캐폴딩 & 디자인 토큰 ✓
- Next.js 16.2.4 + React 19.2.4 + Tailwind v4 + TypeScript strict
- Pretendard Variable + Cormorant Garamond
- `src/app/globals.css` PRD 2.2 디자인 토큰
- shadcn/ui (neutral) + button/input/table/checkbox/dropdown-menu/select/dialog
- 사이드바 셸 (240px 고정)
- `.env.example`

### Phase 1b · Supabase 마이그레이션 ✓
- `supabase/config.toml`
- `0001_initial_schema.sql` · 9개 테이블 · 전 컬럼 한글 COMMENT
- `0002_student_profiles_view.sql` · 학생 프로필 집계 뷰
- `0003_rls_policies.sql` · RLS 4단계 + 헬퍼 함수
- `0004_student_key_rework.sql` · **신규**. `students.parent_phone` NOT NULL / `aca2000_id` NOT NULL 해제 / `(parent_phone, name)` 복합 UNIQUE 추가. 코드만 준비, 적용은 Supabase 연결 후 `supabase db push`.
- `supabase/seed.sql` · 대치 5명 + 송도 5명, 그룹 2, 템플릿 2

### Phase 2 · 타입 & Zod & Supabase 클라이언트 ✓
- `src/types/database.ts` · 수동 타입. `StudentDetail`, `StudentMessageRow` 추가.
- `src/types/import.ts` · **신규**. `ImportKind`, `RowError`, `ImportValidationReport`, `ImportCombinedReport`, `ImportApplyResult`.
- `src/lib/schemas/common.ts` · 공통 enum Zod
- `src/lib/schemas/student.ts` · 학생 목록 입력 + searchParams 파서
- `src/lib/schemas/import.ts` · **신규**. Import 용 Zod 3종 + 헬퍼 5개 (`normalizeKoreanPhone` 은 하이픈 없는 11자리 DB 표준형 반환).
- `src/lib/supabase/server.ts` / `client.ts`
- `src/lib/phone.ts`

### Phase 3 · F1-01 학생 목록 ✓
- `src/lib/profile/list-students.ts` · Supabase + **dev-seed fallback** (env 미설정 시 인메모리 10명)
- `src/lib/profile/students-dev-seed.ts` · dev 시드 + **수강 11건 / 출석 31건 / 발송 3건 + 헬퍼 4종 추가** (F1-02)
- `src/app/(features)/students/page.tsx` · Server Component
- `src/components/students/students-table.tsx` / `students-filters.tsx` / `pagination.tsx`
- `src/components/students/status-badge.tsx` · F1-01/02 공용

### Phase 4 · F1-02 학생 상세 ✓
- `src/lib/profile/get-student-detail.ts` · dev-seed / Supabase 4쿼리 병렬
- `src/app/(features)/students/[id]/page.tsx` · async params + notFound
- `src/components/students/student-detail-view.tsx` · 브레드크럼 컨테이너
- `src/components/students/student-profile-header.tsx` · 이름·배지·메타·학부모번호
- `src/components/students/student-kpi-cards.tsx` · 4블록 (수강/출석률/결석/결제)
- `src/components/students/student-detail-tabs.tsx` · URL ?tab= 상태
- `src/components/students/student-enrollments-panel.tsx` · 수업내용·선생님·과목·기간·금액·결제일
- `src/components/students/student-attendances-panel.tsx` · 월별 요약 + 최근 50건
- `src/components/students/student-messages-panel.tsx` · 캠페인·수신번호·상태·발송시각
- `src/components/students/phone-reveal.tsx` · 클릭해서 번호 노출 + 복사
- 학생 목록 이름 셀 → `/students/[id]` Link

### Phase 5 · F1-03 Aca2000 CSV Import ✓
- **의존성 추가**: `papaparse`, `xlsx`, `@types/papaparse` (xlsx 자체 audit 경고는 이슈 트래킹만)
- `src/lib/import/parse-file.ts` · CSV(papaparse) + XLSX(SheetJS), 한/영 헤더 40+ 매핑
- `src/lib/import/validate.ts` · `validateStudents/Enrollments/Attendances` + `crossValidate` (학부모번호+이름 매칭·중복 검사)
- `src/lib/import/apply.ts` · upsert/insert_only, 3중 가드 (권한·canCommit·prepared 재검증). Supabase JS 트랜잭션 한계로 순차 호출 + 실패 시 뒤 단계 중단 (향후 RPC 로 원자성 보강 예정)
- `src/app/(features)/admin/import/actions.ts` · `dryRunImportAction` + `commitImportAction` Server Actions. 권한 게이트(master/admin) + dev-seed 스킵
- `src/app/(features)/admin/import/page.tsx` · 권한 체크 + 클라이언트 호출
- `src/components/admin/import-page-client.tsx` · 3 드롭존 + 업서트 체크박스 + KPI 리포트 + 실패행 CSV 다운로드(BOM + 한글) + 확정 Dialog
- 사이드바 "데이터 관리 > 엑셀 가져오기" 메뉴 추가

### Phase 6 · F2 발송 그룹 ✓ **신규**
- `src/lib/schemas/group.ts` · `GroupFiltersSchema` / `CreateGroupInputSchema` / `UpdateGroupInputSchema` / `GroupListQuerySchema`. (기존 student.ts 의 중복 GroupFilters 제거)
- `src/types/database.ts` · `GroupRow`, `GroupListItem` 추가.
- `src/lib/profile/students-dev-seed.ts` · `DEV_GROUPS` 4건 (대치 고2 / 대치 수학 / 송도 고3 탐구 / 대치 휘문고 국어) + `findDevGroupById` / `listDevGroups`.
- `src/lib/groups/apply-filters.ts` · 공통 dev 필터 `applyGroupFiltersDev` (branch · 비활성(`탈퇴`) · 수신거부 · grades · schools · subjects(수강 기반))
- `src/lib/groups/list-groups.ts` · 리스트(50/페이지, `last_sent_at DESC NULLS LAST`)
- `src/lib/groups/get-group.ts`
- `src/lib/groups/count-recipients.ts` · 카운트 + 상위 5명 sample. 자동 제외 적용.
- `src/lib/groups/list-group-students.ts` · 그룹 필터로 학생 페이지네이션
- `src/lib/groups/school-options.ts` · 학교 후보 추출
- `src/app/(features)/groups/actions.ts` · `createGroupAction` / `updateGroupAction` / `deleteGroupAction` / `deleteGroupsAction` / `countRecipientsAction`. 권한 가드(master/admin) + dev-seed 모드 쓰기 차단.
- `src/app/(features)/groups/page.tsx` (리스트) + `/new/page.tsx` (빌더 래퍼) + `/[id]/page.tsx` (상세) + `/[id]/edit/page.tsx` (수정)
- `src/components/groups/*` · `groups-toolbar`, `groups-table`(체크박스·일괄삭제·메뉴), `group-builder`(3필터·디바운스 300ms 실시간 카운트·샘플), `group-detail-view`, `group-detail-actions`, `group-students-table`, `branch-badge`.
- 사이드바는 기존 "문자 발송 > 발송 그룹" → `/groups` 연결 그대로.

### Phase 7 · F3 Part A 문자 발송 (스텁) ✓ **신규**
- 마이그레이션 0005 · `templates.is_ad`, `templates.byte_count` 추가
- `src/types/messaging.ts` · `SmsAdapter`, `SmsSendRequest/Result`, `AdapterMode`
- `src/lib/messaging/sms-bytes.ts` · EUC-KR 바이트 카운터(이모지 4byte 보수적)
- `src/lib/messaging/adapters/{munjanara,sk-togo,sendwise,index}.ts` · 팩토리 + 문자나라 mock + 스텁 2종. `SMS_PROVIDER`/`SMS_ADAPTER_MODE` env 분기. live 모드는 Part B.
- `src/lib/messaging/guards/{insert-ad-tag,insert-unsubscribe-footer,check-quiet-hours,filter-recipients,index}.ts` · 안전 가드 5종 (광고 prefix·080 footer·야간 차단 21~08·수신거부·비활성 제외) + `applyAllGuards` 통합
- `src/lib/templates/`, `src/app/(features)/templates/` · 템플릿 CRUD (UI: 리스트·생성·수정 + 실시간 바이트 카운터)
- `src/lib/campaigns/`, `src/app/(features)/campaigns/` · 캠페인 리스트·상세 (재발송 비활성)
- DEV_TEMPLATES 5건 + DEV_CAMPAIGNS 6건 + DEV_CAMPAIGN_MESSAGES 17건

### Phase 8 · F4 계정·권한 ✓ **신규**
- 마이그레이션 0006 · `users_profile.must_change_password`, `users_profile.email`(auth.users 트리거 sync)
- `src/lib/schemas/auth.ts` · Login/CreateAccount/UpdateAccount/ChangePassword/AccountListQuery
- `src/lib/auth/current-user.ts` · `getCurrentUser()` (dev-seed → DEV_VIRTUAL_MASTER)
- `src/lib/auth/can.ts` · `can(user, action, resource, branch?)` 매트릭스
- `src/lib/accounts/{list-accounts,get-account}.ts`
- `middleware.ts` · 비로그인 → /login, must_change_password → /me?forced=1, active=false 차단. dev-seed 모드는 통과
- `src/app/(features)/(auth)/actions.ts` · loginAction/logoutAction/changePasswordAction
- `src/app/(features)/accounts/actions.ts` · createAccount(inviteUserByEmail)/update/deactivate/reactivate
- `src/app/(auth)/login/page.tsx` · 풀스크린 로그인
- `src/app/(features)/me/page.tsx` · 내 계정 + 비밀번호 변경(forced 모드)
- `src/app/(features)/accounts/{page,new,[id]/edit}/` · 계정 관리 3페이지
- `src/components/auth/{login-form,change-password-form,role-badge}.tsx`
- `src/components/accounts/{accounts-toolbar,accounts-table,account-create-form,account-edit-form}.tsx`
- `src/components/shell/sidebar-profile-menu.tsx` · 사이드바 하단 프로필 + 로그아웃 (dev-seed 시 DEV 배지)
- DEV_ACCOUNTS 6건 (master 1·admin 2·manager 1·viewer 2, 비활성 1)

### Phase 9 · 테스트 & 타입체크 ✓
- Vitest 설정
- `tests/unit/list-students.test.ts` · 10
- `tests/unit/phone.test.ts` · 11
- `tests/unit/schemas.test.ts` · 14
- `tests/unit/get-student-detail.test.ts` · 17
- `tests/unit/import-helpers.test.ts` · 47 (F1-03)
- `tests/unit/import-schemas.test.ts` · 37 (F1-03)
- `tests/unit/import-cross-validate.test.ts` · 12 (F1-03)
- `tests/unit/import-apply-guards.test.ts` · 8 (F1-03)
- `tests/unit/group-schemas.test.ts` · 20 (F2)
- `tests/unit/apply-group-filters.test.ts` · 15 (F2)
- `tests/unit/count-recipients.test.ts` · 9 (F2)
- `tests/unit/list-groups.test.ts` · 12 (F2)
- `tests/unit/group-actions-guards.test.ts` · 9 (F2)
- F3-A: `sms-bytes`(14) · `insert-ad-tag`(10) · `insert-unsubscribe-footer`(8) · `check-quiet-hours`(10) · `filter-recipients`(9) · `apply-all-guards`(5) · `sms-adapter-factory`(15) · `template-schemas`(21) · `campaign-schemas-and-listing`(17) · `template-actions-guards`(5) = 122
- F4: `auth-schemas`(21) · `can`(16) · `list-accounts`(8) · `account-actions-guards`(5) · `auth-actions-guards`(3) · `current-user`(2) = 55
- **`npm test`** 29파일 / **397 테스트 모두 통과**
- **`npx tsc --noEmit`** 통과

## 판단한 트레이드오프

1. **Next 16 + Tailwind v4 채택** — searchParams/params 모두 Promise (async/await).
2. **Supabase 로컬 미기동 → dev-seed fallback** — Docker 미설치. `isDevSeedMode()` 분기. Import 의 `applyImport` 는 dev-seed 모드에서 `dev_seed_mode` 반환으로 실수 방지.
3. **Supabase JS 트랜잭션 한계** — Import 는 students → enrollments → attendances 순차 호출 + 중단. 완전 원자성은 향후 RPC 로.
4. **학생 매칭키를 `(parent_phone, name)` 복합 UNIQUE 로 전환** — 사용자 결정. Aca2000 탈출 후에도 자연스러운 식별. `aca2000_id` 는 보조키로 NULL 허용.
5. **normalize 정책 일원화** — `normalizeKoreanPhone` 은 DB 저장 표준형(하이픈 없는 11자리) 반환. 복합 UNIQUE 일치성 보장.

## 알려진 제약 / 운영상 엣지

- **학년 오타**(예: "고4") 는 조용히 null 로 통과 — UI 피드백 강화 고려.
- **엑셀 셀 서식이 숫자** 일 때 선행 0 소실로 학부모 번호 normalize 실패 가능. 사용자 안내 문구 필요할 수도.
- **학부모 번호 변경 시** 다음 import 에서 새 학생으로 등록됨 (Phase 1+ 관리 UI).
- **솔라피 어댑터** 미구현 (PRD 11.2 Week 3-4). 문자나라는 Phase 1+ 백업 스텁만 유지.
- **supabase gen types** 미실행 (Docker 미설치). `src/types/database.ts` 는 수동.
- **Git 저장소 아님** — 커밋 단위 정리 필요.
- **Playwright E2E** 미작성.

## 바로 해볼 것

```bash
cd /Users/iamsage/Desktop/sejung-crm
npm run dev
# http://localhost:3000/login                  → 로그인 폼 (dev-seed 모드는 자동 master)
# http://localhost:3000/me                     → 내 계정 / 비밀번호 변경
# http://localhost:3000/accounts               → 계정 6건 (master/admin 만 접근)
# http://localhost:3000/students               → 시드 10명 + 필터
# http://localhost:3000/students/dev-DC0001    → 상세 3탭
# http://localhost:3000/admin/import           → CSV/XLSX 드롭 → 드라이런
# http://localhost:3000/groups                 → 발송 그룹 4건
# http://localhost:3000/groups/new             → 세그먼트 빌더 (실시간 카운트)
# http://localhost:3000/groups/dev-group-1     → 그룹 상세
# http://localhost:3000/templates              → 템플릿 5건 (바이트/한도)
# http://localhost:3000/templates/new          → 실시간 바이트 카운터 + [광고] 배너
# http://localhost:3000/campaigns              → 캠페인 6건 (상태 색상)
# http://localhost:3000/campaigns/dev-cmp-1    → 메시지 건별 상태
```

## 다음 세션 추천 순서

1. **솔라피(SOLAPI) API Key·Secret·발신번호·080 번호 확보** (운영팀 작업)
2. **F3 Part B Compose 플로우** · 4단계 (그룹→템플릿→미리보기+비용→발송) + 솔라피 live HTTP 호출 + 테스트 발송
3. **F3 재발송** 활성화
4. **Supabase 연결 + 마이그레이션 적용** (`supabase db push` for 0001~0006)
5. **Playwright E2E** · 로그인/학생/그룹/발송 스모크
6. **첫 운영 리허설** (소규모 본인 번호 발송)

## F3 Part B 진입 전 환경변수 체크리스트

`.env.example` 참조. `.env.local` 에 채워야 할 값:

```
SMS_PROVIDER=solapi
SMS_ADAPTER_MODE=live              # mock → live 전환
SMS_OPT_OUT_NUMBER=080-XXX-XXXX    # 080 번호 신청 후 (솔라피 공용 가능)
SOLAPI_API_KEY=NCS...              # 솔라피 콘솔 → 개발 → API Key
SOLAPI_API_SECRET=...              # 발급 시 1회만 표시. 즉시 저장.
SOLAPI_FROM_NUMBER=01012345678     # 사전등록된 발신번호 (하이픈 없는 11자리)
SOLAPI_KAKAO_PFID=PXXX...          # 알림톡 쓸 경우만
```

솔라피에서 받아야 할 것:
- API Key + Secret (콘솔 발급, IP 화이트리스트 필수)
- 발신번호 사전등록 (통신사 검증 1~3 영업일)
- 잔액 충전 (선불, MVP 1만원 권장)
- 080 수신거부 번호 (콘솔 신청, 솔라피 공용 가능)
- 도달 webhook URL (선택, MVP 는 폴링 OK)
- 알림톡 쓰면: 카카오 비즈채널 + PFID + 템플릿 사전 검수 1~2주

## Terminal 글자 깨짐 건

파일·코드·디스크 멀쩡. 터미널 렌더링 이슈. 해결: (1) 화면 비우기 → (2) 터미널 재시작 → (3) D2Coding/Sarasa Mono K/Menlo 등 한글 지원 모노스페이스 폰트 → (4) macOS 폰트 캐시 리셋.
