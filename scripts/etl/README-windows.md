# 학원 노트북(Windows) ETL 자동 셋업 가이드

**매 시간** Aca2000 → Supabase 자동 동기화 + 수동 즉시 동기화 지원.
학원 노트북 1대에서 끝까지 운영.

## 1. 사전 준비 (한 번만)

학원 노트북에 아래 2개 + 선택 1개 설치:

| 설치 | 다운로드 | 옵션 |
|---|---|---|
| **Python 3.12** | https://www.python.org/downloads/ | ★ "Add python.exe to PATH" 반드시 체크 |
| **Git for Windows** | https://git-scm.com/download/win | 기본값 그대로 Next 연타 |
| (선택) **VSCode** | https://code.visualstudio.com/ | `.env` 편집·로그 보기에 편함 |

설치 끝나고 PowerShell 열어서 버전 확인:

```powershell
python --version    # Python 3.12.x
git --version       # git version 2.xx.x
```

## 2. 코드 받기

학원 노트북에서 PowerShell 또는 cmd:

```powershell
cd C:\
git clone https://github.com/sejung-sage/sejung-crm.git
cd sejung-crm
```

> Git 안 깔았다면 GitHub 의 `Code → Download ZIP` 으로 받아 `C:\sejung-crm` 에 풀어도 됩니다.

## 3. ETL 초기 셋업 (한 번만)

탐색기에서 **`scripts\etl\setup.bat` 더블클릭**. 자동으로:

- `.venv\` 가상환경 생성 (Python 3.12 기반)
- `pymssql`, `supabase`, `python-dotenv` 설치
- `.env.example` → `.env` 복사 후 메모장으로 열림

메모장이 뜨면 두 값만 채우고 저장:

```
ACA_MSSQL_PASSWORD=<아카2000 sa 비밀번호>
SUPABASE_SECRET_KEY=<Vercel env 의 SUPABASE_SECRET_KEY 동일 값>
```

> **`.env` 는 GitHub 에 안 올라갑니다 (`.gitignore` 등록).** 비밀번호는 이 파일에만.

## 4. 동작 시험 (한 번)

**`scripts\etl\sync_now.bat` 더블클릭** — 콘솔 창에 진행 상황이 보이고 끝나면 결과가 표시됩니다 (창 자동으로 안 닫힘).

- ✔ 모두 성공 → 다음 단계
- ✗ 실패 → 콘솔 메시지 + `scripts\etl\logs\YYYY-MM-DD.log` 확인

> `sync_now.bat` 은 평소에도 운영자가 **수동 동기화** 가 필요할 때 더블클릭으로 쓰는 진입점입니다. 자동 스케줄과 별개로 언제든 실행 가능.

## 5. 작업 스케줄러 등록 (매 시간 자동 실행)

### 방법 A. XML import (1분)

1. **시작 → 작업 스케줄러** 검색해서 실행
2. 우측 "작업 가져오기" 클릭
3. `C:\sejung-crm\scripts\etl\sejung-etl.xml` 선택
4. 열린 창에서 **Actions 탭** 더블클릭 → 수정:
   - Arguments: `/c "C:\sejung-crm\scripts\etl\run_all.bat"`
   - Start in: `C:\sejung-crm`
5. **Triggers 탭**: 매일 00:00 시작 + 매 1시간 반복 (XML 에 이미 설정됨)
6. **General 탭** → "사용자가 로그온 여부와 관계없이 실행" 체크 (선택)
7. 확인 → Windows 계정 비밀번호 입력 → 등록 완료

### 방법 B. PowerShell 한 줄 (전문가용)

```powershell
$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument '/c "C:\sejung-crm\scripts\etl\run_all.bat"' `
  -WorkingDirectory "C:\sejung-crm"

$trigger = New-ScheduledTaskTrigger `
  -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Hours 1)

Register-ScheduledTask `
  -TaskName "Sejung\CRM-ETL-Hourly" `
  -Action $action -Trigger $trigger `
  -Description "세정학원 ETL 매시간 자동 동기화"
```

### 매 시간 정책 메모

- ETL 1회 평균 5~15분. 매 시간 실행해도 다음 시간 전에 충분히 끝남.
- 작업 스케줄러 정책 `IgnoreNew` — 이전 실행이 안 끝나면 새 실행 무시 (중복 발사 차단).
- 실행 시간 제한 55분 — 다음 정각 직전에 강제 종료.

## 6. 일상 운영

### 수동 동기화 (지금 당장 동기화하고 싶을 때)

`scripts\etl\sync_now.bat` 더블클릭.

> 예) 행정팀이 학생 정보를 Aca 에서 막 수정한 직후 CRM 에 바로 반영하고 싶을 때.

### 자동 동기화 확인

| 확인 항목 | 위치 |
|---|---|
| 최근 ETL 결과 | `scripts\etl\logs\오늘날짜.log` |
| 매 시간 잘 돌고 있나? | 작업 스케줄러 → Sejung\CRM-ETL-Hourly → "지난 실행 결과" |
| 실패 단계 | 로그에서 `FAIL ✗` 검색 |

### 절전·덮개 설정 (필수)

매 시간 실행되려면 노트북이 깨어 있어야 합니다.

1. **설정 → 시스템 → 전원 및 절전**
   - "절전 모드 진입": **사용 안 함**
   - "화면 끄기": 사용자 취향 (꺼져도 ETL 동작)
2. **제어판 → 전원 옵션 → 덮개를 닫으면 수행할 작업**
   - 전원/배터리 모두 **"아무 작업도 안 함"**
3. **Windows 업데이트 → 활성 시간 변경**
   - 활성 시간에 학원 운영 시간 포함 → 자동 재시작 방지

## 7. 코드 업데이트 (가끔)

```powershell
cd C:\sejung-crm
git pull
```

스크립트만 바뀌면 `setup.bat` 다시 안 돌려도 됨. `requirements.txt` 가 바뀐 경우만:

```powershell
.venv\Scripts\activate
pip install -r scripts\etl\requirements.txt
```

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `python` 명령 안 됨 | PATH 등록 누락. Python 재설치 시 "Add to PATH" 체크 |
| `pymssql` 설치 실패 | Python 3.12 64bit 권장. 32bit/64bit 일치 확인 |
| `Login failed for user` | `.env` 의 `ACA_MSSQL_PASSWORD` 오타 / MSSQL 서버 접근 차단 |
| `Supabase 403` | `SUPABASE_SECRET_KEY` 가 anon key 가 아닌 **service_role** 인지 확인 |
| 정각인데 안 돌았음 | 노트북 절전 / 네트워크 끊김 / 작업 스케줄러 마지막 실행 결과 |
| 수동 동기화 창이 바로 닫힘 | `sync_now.bat` 더블클릭 (아닌 `run_all.bat`) — 콘솔 자동 종료 안 됨 |

## 파일 역할 요약

| 파일 | 언제 쓰나 |
|---|---|
| `setup.bat` | 처음 1번 (venv + pip + .env) |
| `sync_now.bat` | **운영자 수동 동기화** (더블클릭) |
| `run_all.bat` | 작업 스케줄러가 자동 호출 (수동 X) |
| `sejung-etl.xml` | 작업 스케줄러 import 한 번 |
| `logs\YYYY-MM-DD.log` | 매 시간 결과 기록 |
