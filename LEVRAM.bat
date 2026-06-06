@echo off
REM ─────────────────────────────────────────────────────────────────
REM  LEVRAM STUDIOS — Windows Launcher
REM  Double-click this file, or add to Startup folder / Task Scheduler
REM
REM  Requirements: WSL2 installed, Ubuntu (or any distro) with the
REM  LEVRAM venv set up at ~/thok_Apps/LEVRAM_STUDIOS/venv
REM
REM  To set ComfyUI path — edit the line below (optional):
REM    set COMFY_DIR=/mnt/d/ComfyUI
REM ─────────────────────────────────────────────────────────────────

title LEVRAM STUDIOS

REM Optional: set your ComfyUI path here (WSL path)
REM set COMFY_DIR=/mnt/d/ComfyUI

echo.
echo  ██╗     ███████╗██╗   ██╗██████╗  █████╗ ███╗   ███╗
echo  ██║     ██╔════╝██║   ██║██╔══██╗██╔══██╗████╗ ████║
echo  ██║     █████╗  ██║   ██║██████╔╝███████║██╔████╔██║
echo  ██║     ██╔══╝  ╚██╗ ██╔╝██╔══██╗██╔══██║██║╚██╔╝██║
echo  ███████╗███████╗ ╚████╔╝ ██║  ██║██║  ██║██║ ╚═╝ ██║
echo  ╚══════╝╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
echo  STUDIOS — Launching via WSL...
echo.

IF DEFINED COMFY_DIR (
  wsl bash -c "export COMFY_DIR='%COMFY_DIR%'; cd ~/thok_Apps/LEVRAM_STUDIOS && bash start_levram.sh"
) ELSE (
  wsl bash -c "cd ~/thok_Apps/LEVRAM_STUDIOS && bash start_levram.sh"
)

REM Open the app in the default browser after a short delay
timeout /t 4 /nobreak > nul
start "" "http://127.0.0.1:8000/frontend/index.html"

pause
