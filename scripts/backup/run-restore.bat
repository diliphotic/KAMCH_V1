@echo off
REM ==============================================================================
REM KAMCH ERP — Run Safe Database Restore (Windows Batch Launcher)
REM Restores to separate test database (kamch_erp_test) by default.
REM ==============================================================================

setlocal
cd /d "%~dp0..\.."
set PROJECT_ROOT=%CD%
set PS_SCRIPT=%PROJECT_ROOT%\scripts\backup\restore-database.ps1
set ENV_FILE=%PROJECT_ROOT%\.env

if not exist "%PS_SCRIPT%" (
    echo [ERROR] Restore script not found at %PS_SCRIPT%
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -ConfigPath "%ENV_FILE%" %*
exit /b %ERRORLEVEL%
