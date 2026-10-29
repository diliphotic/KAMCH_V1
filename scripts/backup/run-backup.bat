@echo off
REM ==============================================================================
REM KAMCH ERP — Run Database Backup (Windows Batch Launcher)
REM Invokes PowerShell backup script with bypass execution policy
REM ==============================================================================

setlocal
cd /d "%~dp0..\.."
set PROJECT_ROOT=%CD%
set PS_SCRIPT=%PROJECT_ROOT%\scripts\backup\backup-database.ps1
set ENV_FILE=%PROJECT_ROOT%\.env

if not exist "%PS_SCRIPT%" (
    echo [ERROR] Backup script not found at %PS_SCRIPT%
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -ConfigPath "%ENV_FILE%"
exit /b %ERRORLEVEL%
