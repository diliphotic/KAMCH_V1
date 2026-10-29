@echo off
REM ==============================================================================
REM KAMCH ERP — Supervised Windows Application Startup Launcher
REM Suitable for Windows Startup Folder or Windows Task Scheduler
REM ==============================================================================

setlocal
cd /d "%~dp0..\.."
set PROJECT_ROOT=%CD%
set PS_SCRIPT=%PROJECT_ROOT%\scripts\startup\start-erp.ps1

if not exist "%PS_SCRIPT%" (
    echo [ERROR] Startup script not found at %PS_SCRIPT%
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -ProjectRoot "%PROJECT_ROOT%"
exit /b %ERRORLEVEL%
