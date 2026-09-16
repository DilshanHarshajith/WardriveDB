#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# ── Config ───────────────────────────────────────────────────────────────────
PORT="${PORT:-8765}"
export WARDRIVING_DB="${WARDRIVING_DB:-}"
export PORT

# ── Colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── Open browser ─────────────────────────────────────────────────────────────
open_browser() {
  local url="http://localhost:${PORT}"
  sleep 1.5
  if command -v xdg-open &>/dev/null; then
    xdg-open "$url" 2>/dev/null || true
  elif command -v open &>/dev/null; then
    open "$url" 2>/dev/null || true
  elif command -v wslview &>/dev/null; then
    wslview "$url" 2>/dev/null || true
  else
    echo -e "${CYAN}→ Open in your browser:${RESET} ${BOLD}${url}${RESET}"
  fi
}

open_browser &

echo -e "${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║${RESET}  ${BOLD}WardriveDB – Wardriving Dashboard${RESET}                 ${CYAN}║${RESET}"
echo -e "${CYAN}╠══════════════════════════════════════════════════╣${RESET}"
echo -e "${CYAN}║${RESET}  Port     : ${GREEN}${PORT}${RESET}"
if [ -n "$WARDRIVING_DB" ]; then
  echo -e "${CYAN}║${RESET}  Database : ${GREEN}${WARDRIVING_DB}${RESET}"
fi
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${GREEN}▶ Starting server on port ${PORT} …${RESET}"
if [ -z "$WARDRIVING_DB" ]; then
  echo -e "  ${CYAN}No dataset set — open the UI to upload a .db or .csv file${RESET}"
fi
echo -e "  Press ${BOLD}Ctrl+C${RESET} to stop."
echo ""

# ── Launch ───────────────────────────────────────────────────────────────────
python3 -u -m wardrivedb 2>/dev/null || python3 -u server.py 2>&1
