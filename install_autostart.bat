@echo off
REM ─────────────────────────────────────────────────────────────────
REM  LEVRAM STUDIOS — Install Windows Autostart (Task Scheduler)
REM
REM  Run this ONCE (right-click → Run as Administrator).
REM  After that, LEVRAM backend starts automatically at every login
REM  with NO terminal window.
REM ─────────────────────────────────────────────────────────────────

title LEVRAM — Install Autostart

REM Get the path to levram_silent.vbs (same folder as this .bat)
SET "SCRIPT_DIR=%~dp0"
SET "VBS_PATH=%SCRIPT_DIR%levram_silent.vbs"

REM Verify the VBS exists
IF NOT EXIST "%VBS_PATH%" (
  echo ERROR: levram_silent.vbs not found at: %VBS_PATH%
  echo Make sure install_autostart.bat is in the LEVRAM_STUDIOS folder.
  pause
  exit /b 1
)

echo.
echo  Installing LEVRAM STUDIOS autostart...
echo  VBS: %VBS_PATH%
echo.

REM Delete old task if it exists (ignore errors)
schtasks /Delete /TN "LEVRAM_STUDIOS" /F >nul 2>&1

REM Create Task Scheduler task:
REM  - Trigger: At user logon
REM  - Action:  wscript.exe levram_silent.vbs (runs WSL silently)
REM  - Delay:   30 seconds after login (lets WSL fully init)
REM  - Run as:  current user (no elevation needed for WSL)
schtasks /Create ^
  /TN "LEVRAM_STUDIOS" ^
  /TR "wscript.exe \"%VBS_PATH%\"" ^
  /SC ONLOGON ^
  /DELAY 0000:30 ^
  /RL LIMITED ^
  /F

IF %ERRORLEVEL% EQU 0 (
  echo.
  echo  ✓ LEVRAM STUDIOS will now auto-start at every Windows login.
  echo  ✓ Backend starts silently — no terminal window.
  echo  ✓ Open browser to: http://127.0.0.1:8000/frontend/index.html
  echo.
  echo  To remove autostart, run: uninstall_autostart.bat
  echo.
) ELSE (
  echo.
  echo  ERROR: Task creation failed.
  echo  Try right-clicking install_autostart.bat and selecting
  echo  "Run as Administrator".
  echo.
)

pause
