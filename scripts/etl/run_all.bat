@echo off
REM ============================================================
REM Sejung CRM ETL - daily/hourly runner (called by Task Scheduler)
REM ------------------------------------------------------------
REM Runs 11 migrate_*.py scripts in FK-dependency order against
REM Aca2000 MSSQL -> Supabase. Appends to logs\YYYY-MM-DD.log.
REM
REM Exit codes:
REM   0  all stages succeeded
REM   1  one or more stages failed (see log)
REM ============================================================
setlocal enabledelayedexpansion

REM Force UTF-8 for both the console and the Python child process so
REM the ETL scripts can print Korean labels / emoji without crashing
REM on the cp949 default on Korean Windows.
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

REM 1) cd to repo root
cd /d "%~dp0\..\.."

REM 2) Log dir + filename (KST date via WMIC)
if not exist scripts\etl\logs mkdir scripts\etl\logs
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value ^| find "="') do set DT=%%I
set LOG=scripts\etl\logs\%DT:~0,4%-%DT:~4,2%-%DT:~6,2%.log

REM 3) Activate venv (must exist)
if not exist .venv\Scripts\activate.bat (
  echo [ERROR] .venv missing. Run setup.bat first. >> "%LOG%"
  echo [ERROR] .venv missing. Run setup.bat first.
  exit /b 1
)
call .venv\Scripts\activate.bat

echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
echo [START] %DATE% %TIME%  KST >> "%LOG%"
echo ============================================================ >> "%LOG%"

set FAIL_COUNT=0

REM 4) Execute in FK-dependency order.
REM    teachers -> students -> class_types -> classes -> class_accounts ->
REM    teacher_subjects -> payments -> tickets -> unpaid -> enrollments -> attendances
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

REM Final step - sync aca_* (raw) to crm_* (curated).
REM Without this, the CRM web UI (sejung-crm.vercel.app) still shows
REM the stale data because it reads from crm_students, not aca_students.
call :RUN apply_to_crm

echo. >> "%LOG%"
if %FAIL_COUNT% gtr 0 (
  echo [END] %DATE% %TIME%  %FAIL_COUNT% step(s) failed - check log >> "%LOG%"
  echo [END] %FAIL_COUNT% step(s) failed - %LOG%
  exit /b 1
) else (
  echo [END] %DATE% %TIME%  all OK >> "%LOG%"
  echo [END] all OK - %LOG%
  exit /b 0
)

REM ---- Subroutine: run one migrate script + log ----
:RUN
set NAME=%1
echo. >> "%LOG%"
echo [%TIME%] %NAME% start >> "%LOG%"
echo [%TIME%] %NAME% start
python scripts\etl\%NAME%.py >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%TIME%] %NAME% FAIL >> "%LOG%"
  echo [%TIME%] %NAME% FAIL
  set /a FAIL_COUNT+=1
) else (
  echo [%TIME%] %NAME% ok >> "%LOG%"
  echo [%TIME%] %NAME% ok
)
goto :eof
