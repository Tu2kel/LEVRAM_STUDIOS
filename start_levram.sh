#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  LEVRAM STUDIOS — Startup Script
#  Launches: FastAPI backend + (optional) ComfyUI
#
#  One-time setup:
#    chmod +x start_levram.sh stop_levram.sh
#    Set COMFY_DIR below to your ComfyUI folder, OR export it before calling:
#      export COMFY_DIR="/mnt/d/ComfyUI"
# ─────────────────────────────────────────────────────────────────

# ── Config ─────────────────────────────────────────────────────
LEVRAM_DIR="$(cd "$(dirname "$0")" && pwd)"     # this script's folder
BACKEND_PORT=8000
COMFY_PORT=8188

# Set COMFY_DIR to wherever ComfyUI is installed. Leave blank to skip.
COMFY_DIR="${COMFY_DIR:-}"

# Auto-detect ComfyUI if COMFY_DIR not set
if [ -z "$COMFY_DIR" ]; then
  for candidate in \
      /mnt/c/Users/$USER/ComfyUI \
      /mnt/c/ComfyUI \
      /mnt/d/ComfyUI \
      /mnt/e/ComfyUI \
      /mnt/f/ComfyUI \
      /mnt/g/ComfyUI \
      "$HOME/ComfyUI" \
      "$HOME/Desktop/ComfyUI"; do
    if [ -f "$candidate/main.py" ]; then
      COMFY_DIR="$candidate"
      break
    fi
  done
fi

# ── Colors ─────────────────────────────────────────────────────
GOLD="\033[38;5;220m"
GREEN="\033[32m"
DIM="\033[2m"
RED="\033[31m"
RESET="\033[0m"

print_banner() {
  echo -e "${GOLD}"
  echo "  ██╗     ███████╗██╗   ██╗██████╗  █████╗ ███╗   ███╗"
  echo "  ██║     ██╔════╝██║   ██║██╔══██╗██╔══██╗████╗ ████║"
  echo "  ██║     █████╗  ██║   ██║██████╔╝███████║██╔████╔██║"
  echo "  ██║     ██╔══╝  ╚██╗ ██╔╝██╔══██╗██╔══██║██║╚██╔╝██║"
  echo "  ███████╗███████╗ ╚████╔╝ ██║  ██║██║  ██║██║ ╚═╝ ██║"
  echo "  ╚══════╝╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝"
  echo -e "  ${DIM}STUDIOS — Full Multimedia Production${RESET}"
  echo ""
}

wait_for_port() {
  local port=$1
  local label=$2
  local max_tries=30
  local i=0
  while ! curl -s "http://127.0.0.1:$port" > /dev/null 2>&1; do
    i=$((i+1))
    if [ $i -ge $max_tries ]; then
      echo -e "  ${RED}✗ $label did not start in time (port $port)${RESET}"
      return 1
    fi
    sleep 1
  done
  echo -e "  ${GREEN}✓ $label ready on :$port${RESET}"
}

# ── Main ───────────────────────────────────────────────────────
print_banner

mkdir -p "$LEVRAM_DIR/data/logs"
BACKEND_LOG="$LEVRAM_DIR/data/logs/backend.log"
COMFY_LOG="$LEVRAM_DIR/data/logs/comfyui.log"

# ── 1. FastAPI Backend ─────────────────────────────────────────
echo -e "${GOLD}[1/2] Starting FastAPI backend on :${BACKEND_PORT}…${RESET}"

cd "$LEVRAM_DIR"

# Activate venv if present
if [ -f "$LEVRAM_DIR/venv/bin/activate" ]; then
  source "$LEVRAM_DIR/venv/bin/activate"
fi

nohup uvicorn backend.main:app --host 0.0.0.0 --port $BACKEND_PORT --reload \
  > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$LEVRAM_DIR/data/logs/backend.pid"
echo -e "  ${DIM}PID $BACKEND_PID — logs: data/logs/backend.log${RESET}"

wait_for_port $BACKEND_PORT "FastAPI backend"

# ── 2. ComfyUI (optional) ──────────────────────────────────────
if [ -n "$COMFY_DIR" ] && [ -f "$COMFY_DIR/main.py" ]; then
  echo ""
  echo -e "${GOLD}[2/2] Starting ComfyUI from $COMFY_DIR on :${COMFY_PORT}…${RESET}"
  cd "$COMFY_DIR"

  # Activate ComfyUI's own venv if present
  if [ -f "$COMFY_DIR/venv/bin/activate" ]; then
    source "$COMFY_DIR/venv/bin/activate"
  fi

  nohup python main.py --listen 0.0.0.0 --port $COMFY_PORT \
    > "$COMFY_LOG" 2>&1 &
  COMFY_PID=$!
  echo $COMFY_PID > "$LEVRAM_DIR/data/logs/comfyui.pid"
  echo -e "  ${DIM}PID $COMFY_PID — logs: data/logs/comfyui.log${RESET}"
  echo -e "  ${DIM}(ComfyUI takes ~30s to load models — check Settings page)${RESET}"
else
  echo ""
  echo -e "${GOLD}[2/2] ComfyUI${RESET} — ${DIM}not found. Set COMFY_DIR in start_levram.sh to enable T2V.${RESET}"
fi

# ── Done ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}  LEVRAM STUDIOS is live!${RESET}"
echo -e "${GREEN}  → Open:  http://127.0.0.1:${BACKEND_PORT}/frontend/launch.html${RESET}"
echo -e "${GREEN}  → Or:    file://$(realpath "$LEVRAM_DIR/frontend/launch.html")${RESET}"
echo -e "${GREEN}  → Stop:  bash stop_levram.sh${RESET}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
