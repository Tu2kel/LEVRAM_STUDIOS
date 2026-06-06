@echo off
REM ─────────────────────────────────────────────────────────────────
REM  LEVRAM STUDIOS — Remove Autostart
REM ─────────────────────────────────────────────────────────────────
title LEVRAM — Remove Autostart
echo.
echo  Removing LEVRAM STUDIOS autostart task...
schtasks /Delete /TN "LEVRAM_STUDIOS" /F
IF %ERRORLEVEL% EQU 0 (
  echo  ✓ Autostart removed. LEVRAM will no longer start at login.
) ELSE (
  echo  Task not found (may already be removed).
)
echo.
pause
