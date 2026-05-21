@echo off
REM ============================================================
REM Sejung CRM ETL - Windows initial setup (run once)
REM ------------------------------------------------------------
REM - Create Python venv (.venv\)
REM - pip install -r requirements.txt
REM - Copy .env.example to .env and open in notepad
REM ============================================================
setlocal enabledelayedexpansion

cd /d "%~dp0\..\.."

echo [1/4] Checking Python (3.12 recommended)...
python --version
if errorlevel 1 (
  echo [ERROR] Python not on PATH. Re-install from python.org and tick "Add to PATH".
  pause
  exit /b 1
)

echo [2/4] Creating virtualenv (.venv)...
if not exist .venv (
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] venv creation failed.
    pause
    exit /b 1
  )
) else (
  echo     already exists - skip
)

echo [3/4] Installing dependencies (pymssql, supabase, python-dotenv)...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r scripts\etl\requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install failed.
  pause
  exit /b 1
)

echo [4/4] Checking .env...
if not exist scripts\etl\.env (
  copy scripts\etl\.env.example scripts\etl\.env >nul
  echo.
  echo ----------------------------------------------------------------
  echo  Open scripts\etl\.env in notepad and fill in:
  echo    ACA_MSSQL_PASSWORD = (ask academy IT)
  echo    SUPABASE_SECRET_KEY = (copy from Vercel env settings)
  echo  Save and close notepad to continue.
  echo ----------------------------------------------------------------
  notepad scripts\etl\.env
) else (
  echo     already exists - skip
)

echo.
echo [DONE] Setup complete. Next steps:
echo   1. Verify scripts\etl\.env has both passwords filled
echo   2. Double-click sync_now.bat to run a manual test
echo   3. After test passes, register the Task Scheduler XML (see README-windows.md)
echo.
pause
