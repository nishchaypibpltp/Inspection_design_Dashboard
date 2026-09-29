#!/usr/bin/env bash
# Inspection Tracker — start the dashboard on this machine.
#
#   ./start.sh          start everything, print the URL
#   ./start.sh status   report only, change nothing
#
# What it does: brings up a private PostgreSQL container loaded with the
# inspection snapshot in ./data, then runs the dashboard against it. Nothing
# here writes to any shared or production system — the database is a local
# copy and the dashboard only ever reads.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_CONTAINER="insp-dash-db"
DB_IMAGE="postgres:16-alpine"
DB_PORT="${DB_PORT:-55432}"          # deliberately not 5432, so it cannot clash
APP_PORT="${PORT:-8787}"
PID_FILE="$HERE/.dashboard.pid"
LOG_FILE="$HERE/dashboard.log"

say() { printf '  %-22s %s\n' "$1" "$2"; }
fail() { printf '\n  %s\n\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- engine ----
# Docker Desktop and Podman both work and take the same arguments. Prefer
# whichever is actually running; start the Podman VM if that is the only one.
find_engine() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ENGINE=docker; return 0
  fi
  if command -v podman >/dev/null 2>&1; then
    podman info >/dev/null 2>&1 || { echo "  starting the Podman VM (first run takes a minute)"; podman machine start >/dev/null 2>&1; }
    if podman info >/dev/null 2>&1; then ENGINE=podman; return 0; fi
  fi
  if command -v docker >/dev/null 2>&1; then
    fail "Docker is installed but not running. Open Docker Desktop, wait for it to say Running, then re-run ./start.sh"
  fi
  fail "No container tool found. Install Docker Desktop (https://docker.com/products/docker-desktop) or Podman, then re-run ./start.sh"
}

# ---------------------------------------------------------------- status ----
if [ "${1:-}" = "status" ]; then
  command -v node >/dev/null 2>&1 && say "node" "$(node -v)" || say "node" "NOT INSTALLED"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then E=docker
  elif command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then E=podman
  else E=""; fi
  say "container engine" "${E:-none running}"
  if [ -n "$E" ]; then
    DB_STATE="$($E ps -a --filter "name=$DB_CONTAINER" --format '{{.Status}}' 2>/dev/null | head -1)"
    say "database" "${DB_STATE:-not created yet}"
  fi
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$APP_PORT/" 2>/dev/null)"
  [ "$CODE" = "200" ] && say "dashboard" "running — http://127.0.0.1:$APP_PORT" \
                      || say "dashboard" "not running"
  exit 0
fi

echo
echo "Inspection Tracker — starting"
echo

# ------------------------------------------------------------------ node ----
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Get it from https://nodejs.org (any version 20 or newer), then re-run ./start.sh"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || fail "Node.js $(node -v) is too old. Install version 20 or newer from https://nodejs.org"
say "node" "$(node -v)"

find_engine
say "container engine" "$ENGINE"

# -------------------------------------------------------------- database ----
if $ENGINE ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
  say "database" "already running on port $DB_PORT"
elif $ENGINE ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
  $ENGINE start "$DB_CONTAINER" >/dev/null 2>&1
  say "database" "restarted on port $DB_PORT"
else
  echo "  creating the database (first run — it loads the snapshot, ~30s)"
  $ENGINE pull "$DB_IMAGE" >/dev/null 2>&1
  $ENGINE run -d --name "$DB_CONTAINER" \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=vehicle_inspection \
    -p "$DB_PORT:5432" \
    -v "$HERE/data:/docker-entrypoint-initdb.d:ro" \
    "$DB_IMAGE" >/dev/null || fail "Could not start the database container. Run '$ENGINE logs $DB_CONTAINER' to see why."
  say "database" "created on port $DB_PORT"
fi

# Wait until the snapshot is actually queryable — the image runs the .sql in
# ./data during first boot, so 'accepting connections' alone is not enough.
printf '  %-22s ' "loading snapshot"
ROWS=""
for i in $(seq 1 90); do
  ROWS="$($ENGINE exec "$DB_CONTAINER" psql -U postgres -d vehicle_inspection -tAc \
        'select count(*) from inspection_sessions' 2>/dev/null | tr -d '[:space:]')"
  case "$ROWS" in ''|*[!0-9]*) printf '.'; sleep 1;; *) break;; esac
done
echo
case "$ROWS" in ''|*[!0-9]*) fail "The database did not finish loading. Run '$ENGINE logs $DB_CONTAINER' to see why.";; esac
say "inspection cases" "$ROWS"

# ------------------------------------------------------------- dashboard ----
# Free the port if a previous run left something on it.
if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")" 2>/dev/null; sleep 1
  fi
  while lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; do
    APP_PORT=$((APP_PORT + 1))
    [ "$APP_PORT" -gt 8800 ] && fail "No free port between 8787 and 8800."
  done
fi

cd "$HERE/app" || fail "The app folder is missing — re-copy the whole shared folder."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$DB_PORT/vehicle_inspection" \
PORT="$APP_PORT" \
nohup node server.mjs > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

for i in $(seq 1 20); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$APP_PORT/" 2>/dev/null)" = "200" ] && break
  sleep 1
done

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$APP_PORT/" 2>/dev/null)" != "200" ]; then
  echo; cat "$LOG_FILE"; fail "The dashboard did not come up. The log above says why."
fi

say "dashboard" "http://127.0.0.1:$APP_PORT"
echo
echo "  Open  →  http://127.0.0.1:$APP_PORT"
echo "  Stop  →  ./stop.sh"
echo
command -v open >/dev/null 2>&1 && open "http://127.0.0.1:$APP_PORT" >/dev/null 2>&1
exit 0
