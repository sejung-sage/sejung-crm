@echo off
REM ============================================================
REM Sejung CRM ETL - manual sync (operator double-click)
REM ------------------------------------------------------------
REM Calls run_all.bat but keeps the console open at the end so
REM the operator can see the result before closing.
REM ============================================================
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title Sejung CRM - Manual Sync

cd /d "%~dp0\..\.."

echo.
echo ============================================================
echo   Sejung CRM - Manual ETL Sync
echo   Aca2000 -^> Supabase (about 5-15 minutes)
echo ============================================================
echo.
echo Start: %DATE% %TIME%
echo.

call scripts\etl\run_all.bat

echo.
echo ============================================================
echo   Manual sync finished. Review the log above, then press any key.
echo ============================================================
pause >nul
