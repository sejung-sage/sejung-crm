# 세정-CRM · ETL 운영 가이드

아카(Aca2000) MSSQL 4개 분원 → Supabase PostgreSQL 마이그레이션·동기화 스크립트.

## 디렉토리

```
scripts/etl/
├── .env.example         # 환경변수 샘플 (commit OK)
├── .env                 # 실제 값 (gitignore, 직접 채움)
├── explore.py           # 1단계: 테이블 schema 탐색
├── migrate_students.py  # 2단계: 학생 일회성 마이그레이션 (작성 예정)
├── sync_students.py     # 3단계: 매일 변경분만 sync (작성 예정)
├── explore_output/      # 탐색 결과 dump (gitignore)
└── README.md
```

## 셋업 (1회)

### 1. macOS 시스템 의존성

```bash
brew install freetds
```

`pymssql` 이 FreeTDS 위에서 MSSQL 통신.

### 2. Python 가상환경

```bash
cd /Users/iamsage/Desktop/sejung-crm
python3 -m venv .venv
source .venv/bin/activate
pip install pymssql python-dotenv supabase psycopg2-binary
```

> ⚠️ Python 3.9 환경 기본 OK. 3.10+ 권장.

### 3. `.env` 채우기

```bash
cp scripts/etl/.env.example scripts/etl/.env
# 편집기로 .env 열어서 ACA_MSSQL_PASSWORD, SUPABASE_SECRET_KEY 입력
# 비밀번호는 절대 채팅·git X
```

## 실행

### 탐색 (Phase 1)

```bash
source .venv/bin/activate
python scripts/etl/explore.py
```

결과:
- 콘솔: 4개 분원의 테이블 행 수 dump
- `explore_output/` : 분원별 markdown 파일 (테이블 + 컬럼 schema)

이 결과로:
- 학생/출석/결제/강사 테이블의 정확한 이름·컬럼 파악
- Supabase 와의 매핑 schema 결정
- 데이터 정제 정책 (NULL/타입/CHECK 제약)

### 마이그레이션 (Phase 2 · 작성 예정)

```bash
DRY_RUN=1 python scripts/etl/migrate_students.py   # 변환만, 저장 X
ONLY_BRANCH=80205 python scripts/etl/migrate_students.py  # 방배만 시범
DRY_RUN=0 python scripts/etl/migrate_students.py   # 전체 실 적용
```

### 매일 sync (Phase 3 · 작성 예정)

cron 또는 launchd 등록. 매일 오전 11:30 (아카 ETL 후).

## 보안 SOP

- **비밀번호·키는 항상 `.env` 에만**
- 채팅·이메일·티켓·코드 어디에도 평문 X
- 노출되면 즉시 폐기 + 재발급
- `.env` 는 `.gitignore` 로 보호 중 (확인됨)

## 트러블슈팅

### `pymssql.OperationalError: (20009)` 접속 실패
- 아카 측에 IP 화이트리스트 등록 요청 (본인 공인 IP)
- 본인 IP 확인: `curl ifconfig.me`

### `(20002) DB-Lib error message 20002, severity 9`
- TLS 버전 호환 문제. `freetds.conf` 설정 필요할 수 있음
- 또는 `pymssql.connect(..., tds_version='7.0')` 명시

### 한글 깨짐
- `pymssql.connect(..., charset='UTF-8')` 명시 (스크립트 이미 적용)
