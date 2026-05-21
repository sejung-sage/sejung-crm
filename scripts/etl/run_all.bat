@echo off
REM ============================================================
REM 세정-CRM ETL · 매일 1회 실행 wrapper
REM ------------------------------------------------------------
REM Aca2000 MSSQL → Supabase 동기화 11개 스크립트를 FK 의존 순서대로 실행.
REM 작업 스케줄러가 본 파일을 매일 11:00 KST 에 호출.
REM
REM 종료 코드:
REM   0  : 모든 단계 성공
REM   1  : 한 단계 이상 실패 (로그 확인)
REM
REM 로그:
REM   scripts\etl\logs\YYYY-MM-DD.log
REM ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion

REM 1) 리포지토리 루트로 이동
cd /d "%~dp0\..\.."

REM 2) 로그 디렉토리 + 파일 (KST 날짜)
if not exist scripts\etl\logs mkdir scripts\etl\logs
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value ^| find "="') do set DT=%%I
set LOG=scripts\etl\logs\%DT:~0,4%-%DT:~4,2%-%DT:~6,2%.log

REM 3) venv 활성화 (없으면 에러)
if not exist .venv\Scripts\activate.bat (
  echo [ERROR] .venv 가 없습니다. 먼저 setup.bat 을 실행하세요. >> "%LOG%"
  echo [ERROR] .venv 가 없습니다. 먼저 setup.bat 을 실행하세요.
  exit /b 1
)
call .venv\Scripts\activate.bat

echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
echo [START] %DATE% %TIME%  KST >> "%LOG%"
echo ============================================================ >> "%LOG%"

set FAIL_COUNT=0

REM 4) FK 의존 순서대로 실행
REM    teachers → students → class_types → classes → class_accounts →
REM    teacher_subjects → payments → tickets → unpaid → enrollments → attendances
call :RUN migrate_teachers
call :RUN migrate_students
call :RUN migrate_class_types
call :RUN migrate_classes
call :RUN migrate_class_accounts
call :RUN migrate_teacher_subjects
call :RUN migrate_payments
call :RUN migrate_tickets
call :RUN migrate_unpaid
call :RUN migrate_enrollments
call :RUN migrate_attendances

echo. >> "%LOG%"
if %FAIL_COUNT% gtr 0 (
  echo [END] %DATE% %TIME%  ▲ %FAIL_COUNT% 건 실패 — 로그 확인 필요 >> "%LOG%"
  echo [END] ▲ %FAIL_COUNT% 건 실패 — %LOG%
  exit /b 1
) else (
  echo [END] %DATE% %TIME%  ✔ 모두 성공 >> "%LOG%"
  echo [END] ✔ 모두 성공 — %LOG%
  exit /b 0
)

REM ─── 서브루틴: 1개 스크립트 실행 + 로그 ─────────────────────
:RUN
set NAME=%1
echo. >> "%LOG%"
echo [%TIME%] %NAME% start >> "%LOG%"
python scripts\etl\%NAME%.py >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%TIME%] %NAME% FAIL ✗ >> "%LOG%"
  set /a FAIL_COUNT+=1
) else (
  echo [%TIME%] %NAME% ok ✔ >> "%LOG%"
)
goto :eof
