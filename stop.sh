#!/usr/bin/env bash
# Stop the dashboard. Add --all to also stop its database container.
#
#   ./stop.sh           stop the dashboard, leave the database running
#   ./stop.sh --all     stop both
#
# Neither form deletes anything: the snapshot stays in the container, so the
# next ./start.sh comes straight back up without reloading it.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_CONTAINER="insp-dash-db"
PID_FILE="$HERE/.dashboard.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")" 2>/dev/null
  rm -f "$PID_FILE"
  echo "  dashboard stopped"
else
  pkill -f "$HERE/app/server.mjs" 2>/dev/null && echo "  dashboard stopped" || echo "  dashboard was not running"
  rm -f "$PID_FILE"
fi

if [ "${1:-}" = "--all" ]; then
  for E in docker podman; do
    command -v "$E" >/dev/null 2>&1 || continue
    "$E" info >/dev/null 2>&1 || continue
    if "$E" ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
      "$E" stop "$DB_CONTAINER" >/dev/null 2>&1 && echo "  database stopped"
      break
    fi
  done
fi
