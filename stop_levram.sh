#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  LEVRAM STUDIOS — Stop Script
# ─────────────────────────────────────────────────────────────────
LEVRAM_DIR="$(cd "$(dirname "$0")" && pwd)"
GOLD="\033[38;5;220m"
GREEN="\033[32m"
DIM="\033[2m"
RED="\033[31m"
RESET="\033[0m"

stop_pid_file() {
  local pidfile="$1"
  local label="$2"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo -e "  ${GREEN}✓ Stopped $label (PID $pid)${RESET}"
    else
      echo -e "  ${DIM}$label was not running (PID $pid)${RESET}"
    fi
    rm -f "$pidfile"
  else
    echo -e "  ${DIM}No PID file for $label${RESET}"
  fi
}

echo -e "${GOLD}LEVRAM STUDIOS — Stopping services…${RESET}"
echo ""
stop_pid_file "$LEVRAM_DIR/data/logs/backend.pid"  "FastAPI backend"
stop_pid_file "$LEVRAM_DIR/data/logs/comfyui.pid"  "ComfyUI"

# Fallback: kill by process name
pkill -f "uvicorn backend.main:app" 2>/dev/null && echo -e "  ${DIM}(killed stray uvicorn)${RESET}"
pkill -f "python main.py --listen 0.0.0.0 --port 8188" 2>/dev/null && echo -e "  ${DIM}(killed stray ComfyUI)${RESET}"

echo ""
echo -e "${GREEN}All LEVRAM services stopped.${RESET}"
