@echo off
REM ============================================================
REM 세정-CRM ETL · Windows 초기 셋업 (1회 실행)
REM ------------------------------------------------------------
REM - Python venv 생성 (.venv\)
REM - pip install -r requirements.txt
REM - .env 없으면 .env.example 복사 후 안내
REM ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0\..\.."

echo [1/4] Python 확인...
python --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python 이 PATH 에 없습니다. python.org 에서 설치 시 "Add to PATH" 체크하세요.
  pause
  exit /b 1
)

echo [2/4] 가상환경 생성 (.venv)...
if not exist .venv (
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] venv 생성 실패
    pause
    exit /b 1
  )
) else (
  echo     이미 존재 — 스킵
)

echo [3/4] 의존성 설치 (pymssql, supabase, python-dotenv)...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r scripts\etl\requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install 실패
  pause
  exit /b 1
)

echo [4/4] .env 확인...
if not exist scripts\etl\.env (
  copy scripts\etl\.env.example scripts\etl\.env >nul
  echo.
  echo     ┌────────────────────────────────────────────────────────────┐
  echo     │  scripts\etl\.env 파일을 메모장으로 열어                   │
  echo     │  ACA_MSSQL_PASSWORD / SUPABASE_SECRET_KEY 입력 필요         │
  echo     │  편집 후 run_all.bat 으로 동작 확인하세요.                  │
  echo     └────────────────────────────────────────────────────────────┘
  notepad scripts\etl\.env
) else (
  echo     이미 존재 — 스킵
)

echo.
echo [DONE] 셋업 완료. 다음 단계:
echo   1. scripts\etl\.env 비밀번호 채우기
echo   2. run_all.bat 더블클릭으로 1회 시험 실행
echo   3. 정상 동작 확인 후 작업 스케줄러 등록 (README-windows.md 참조)
echo.
pause
