@echo off
REM 2026-10-24：本次修改原因：双击即可调用一键启动脚本，并保留结果窗口供查看。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-project.ps1"
set "START_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %START_EXIT_CODE%
