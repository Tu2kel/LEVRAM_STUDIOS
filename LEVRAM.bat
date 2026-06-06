@echo off
REM ─────────────────────────────────────────────────────────────────
REM  LEVRAM STUDIOS — Manual Launch (when NOT using autostart)
REM
REM  For autostart at login: run install_autostart.bat once.
REM  This file is for manual / on-demand launching.
REM
REM  Optional: Set COMFY_DIR to your ComfyUI folder path (WSL path)
REM    set COMFY_DIR=/mnt/d/ComfyUI
REM ─────────────────────────────────────────────────────────────────

title LEVRAM STUDIOS

REM Optional ComfyUI path (WSL format)
REM set COMFY_DIR=/mnt/d/ComfyUI

echo.
echo  ██╗     ███████╗██╗   ██╗██████╗  █████╗ ███╗   ███╗
echo  ██║     ██╔════╝██║   ██║██╔══██╗██╔══██╗████╗ ████║
echo  ██║     █████╗  ██║   ██║██████╔╝███████║██╔████╔██║
echo  ██║     ██╔══╝  ╚██╗ ██╔╝██╔══██╗██╔══██║██║╚██╔╝██║
echo  ███████╗███████╗ ╚████╔╝ ██║  ██║██║  ██║██║ ╚═╝ ██║
echo  ╚══════╝╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
echo  STUDIOS  —  The House of Kel LLC
echo.
echo  Starting backend via WSL...

IF DEFINED COMFY_DIR (
  start /B "" wscript.exe "%~dp0levram_silent.vbs"
) ELSE (
  start /B "" wscript.exe "%~dp0levram_silent.vbs"
)

echo  Waiting for backend to initialize (10 seconds)...
timeout /t 10 /nobreak > nul

echo  Opening LEVRAM in your browser...
start "" "http://127.0.0.1:8000/frontend/launch.html"

echo.
echo  LEVRAM is running in the background.
echo  To stop: run stop_levram.sh in WSL, or close WSL.
echo.
timeout /t 5 /nobreak > nul
