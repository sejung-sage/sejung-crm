# 학원 노트북(Windows) ETL 자동 셋업 가이드

매일 11:00 KST 에 Aca2000 → Supabase 자동 동기화. 학원 노트북 1대에서 끝까지 운영.

## 1. 사전 준비 (한 번만)

학원 노트북에 아래 2개 + 선택 1개 설치:

| 설치 | 다운로드 | 옵션 |
|---|---|---|
| **Python 3.11** | https://www.python.org/downloads/ | ★ "Add python.exe to PATH" 반드시 체크 |
| **Git for Windows** | https://git-scm.com/download/win | 기본값 그대로 Next 연타 |
| (선택) **VSCode** | https://code.visualstudio.com/ | `.env` 편집·로그 보기에 편함 |

설치 끝나고 PowerShell 열어서 버전 확인:

```powershell
python --version    # Python 3.11.x
git --version       # git version 2.xx.x
```

## 2. 코드 받기

학원 노트북에서 PowerShell 또는 cmd 열기:

```powershell
cd C:\
git clone https://github.com/sejung-sage/sejung-crm.git
cd sejung-crm
```

> Git 안 깔았다면 GitHub 의 `Code → Download ZIP` 으로 받아 `C:\sejung-crm` 에 풀어도 됩니다.

## 3. ETL 초기 셋업 (한 번만)

탐색기에서 `scripts\etl\setup.bat` 더블클릭. 자동으로:

- `.venv\` 가상환경 생성
- `pymssql`, `supabase`, `python-dotenv` 설치
- `.env.example` → `.env` 복사 후 메모장으로 열림

메모장이 뜨면 두 값만 채우고 저장:

```
ACA_MSSQL_PASSWORD=<아카2000 sa 비밀번호>
SUPABASE_SECRET_KEY=<Vercel env 의 SUPABASE_SECRET_KEY 동일 값>
```

> **이 파일은 절대 GitHub 에 올라가지 않습니다 (`.gitignore` 등록됨).** 비밀번호는 본 파일에만.

## 4. 동작 시험 (한 번)

`scripts\etl\run_all.bat` 더블클릭. 11개 단계가 순서대로 콘솔에 찍히고, 끝나면 `scripts\etl\logs\YYYY-MM-DD.log` 에 기록됨.

- ✔ 모두 성공 → 다음 단계
- ✗ 실패 → 로그 열어서 어느 스크립트 / 어느 메시지 인지 확인

## 5. 작업 스케줄러 등록 (매일 11:00 자동 실행)

### 방법 A. XML import (1분)

1. **시작 → 작업 스케줄러** 검색해서 실행
2. 우측 "작업 가져오기" 클릭
3. `C:\sejung-crm\scripts\etl\sejung-etl.xml` 선택
4. 열린 창에서 **Actions 탭**:
   - Arguments: `/c "C:\sejung-crm\scripts\etl\run_all.bat"` 으로 수정
   - Start in: `C:\sejung-crm`
5. **General 탭** → "사용자가 로그온 여부와 관계없이 실행" 체크 (선택)
6. 확인 → 비밀번호 입력 (Windows 계정) → 등록 완료

### 방법 B. PowerShell 한 줄 (전문가용)

```powershell
schtasks /create /tn "Sejung\CRM-ETL-Daily" `
  /tr "C:\sejung-crm\scripts\etl\run_all.bat" `
  /sc daily /st 11:00 /f
```

## 6. 운영 점검

| 확인 항목 | 위치 |
|---|---|
| 어제 ETL 잘 돌았나? | `scripts\etl\logs\어제날짜.log` |
| 스크립트 1개 실패 | 로그에서 `FAIL ✗` 검색 |
| 노트북이 11시에 켜져 있나? | 절전 / 덮개 닫기 / 자동 종료 모두 OFF |

### 절전·덮개 설정 (필수)

1. **설정 → 시스템 → 전원 및 절전**
   - "화면 끄기": 사용자 취향 (꺼져도 ETL 동작)
   - "절전 모드 진입": **사용 안 함**
2. **제어판 → 전원 옵션 → 덮개를 닫으면 수행할 작업**
   - 전원/배터리 모두 **"아무 작업도 안 함"**
3. **Windows 업데이트 → 활성 시간 변경**
   - 활성 시간에 11:00 포함 → 자동 재시작 방지

## 7. 코드 업데이트 (가끔)

```powershell
cd C:\sejung-crm
git pull
```

스크립트 코드만 바뀌면 `setup.bat` 다시 안 돌려도 됨. 의존성(requirements.txt) 바뀐 경우만 다시.

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `python` 명령 안 됨 | PATH 등록 누락. Python 재설치 시 "Add to PATH" 체크 |
| `pymssql` 설치 실패 | Windows 는 wheel 자동 — Python 3.11 (32/64bit) 일치 확인 |
| `Login failed for user` | `.env` 의 `ACA_MSSQL_PASSWORD` 오타 / MSSQL 서버 IP 접근 차단 |
| `Supabase 403` | `SUPABASE_SECRET_KEY` 가 anon key 가 아닌 **service_role** 인지 확인 |
| 11시인데 안 돌았음 | 작업 스케줄러 → 마지막 실행 결과 / 노트북 절전 / 네트워크 끊김 |

## 비상 수동 실행

언제든 `run_all.bat` 더블클릭하면 즉시 1회 실행. 로그는 같은 위치에 누적.
