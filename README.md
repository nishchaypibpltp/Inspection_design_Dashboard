# Inspection Tracker — shared copy

The read-only dashboard over the vehicle-inspection pilot. This folder is
self-contained: it carries the dashboard, a snapshot of the pilot's inspection
database, and a script that starts both. You do not need the inspection stack,
a VPN, a company login, or any credentials.

---

## What you need first

| | |
|---|---|
| **Node.js** | Version 20 or newer — https://nodejs.org (take the "LTS" download) |
| **Docker Desktop** | https://docker.com/products/docker-desktop — open it once and wait until it says **Running**. (Podman also works if you already have it.) |

Nothing else. Both are free and install with the normal Mac installer.

---

## Start it

Open Terminal, then:

```bash
cd ~/Downloads/inspection-dashboard-share
./start.sh
```

It prints the address and opens your browser. The first run takes about a
minute — it creates a small private database and loads the snapshot into it.
Every run after that takes a few seconds.

**Stop it:**

```bash
./stop.sh          # stops the dashboard
./stop.sh --all    # stops the dashboard and its database
```

**Check what is running:**

```bash
./start.sh status
```

---

## What is in the snapshot

Pilot inspections from **18–22 August 2026**, exactly as the pilot recorded them.

| | Count |
|---|---|
| Inspection cases | 276 |
| Not started | 151 |
| In progress | 51 |
| Ready for review | 60 |
| Aborted | 12 |
| Technical failures | 2 |
| Started recording | 121 |
| Finished all captures | 60 |
| Stages retried | 14 |
| Videos marked complete | 62 |
| Submitted to the vendor | 0 |
| Individual stage rows | 4,968 |
| Quality-check findings | 614 |
| Audit-trail events | 322 |

The numbers are frozen at the moment of the snapshot. They will not change and
they will not refresh — this is a copy, not a live connection.

---

## What works, and the one thing that does not

**Works — the whole dashboard:**

- **Overview** — the technical-failure alert, all stat tiles, daily sessions by
  pipeline state, median time per stage, retakes by stage, where people
  abandoned, quality findings by type. Date presets and custom ranges all work.
- **Case explorer** — all 276 cases as rows, with status, stages marked, photo
  counts, blocking findings and deadlines. Search by vehicle number, customer,
  policy or case id; combine with status chips and a date range.
- **Case file** — click any row for the header, the minute-level timeline, the
  per-stage list with quality confidence and retake marks, and the findings
  table.
- Light and dark mode, chart tooltips, and the table view behind every chart.

**Does not work — photos, video, and the evidence ZIP.**

The pictures and recordings were never in the database; they lived in a
separate media store on the pilot machine, and that store was cleared when its
container stopped on 3 September 2026. The files are gone at the source, so
they cannot be shared. Everything the database holds *about* them is still
here — how many photos each stage has, when each was captured, what the
quality check said — but the images themselves will show as broken and the
video player and the ZIP download will report "not found".

This is not a fault in your copy. It behaves the same way on the machine this
was packaged from. When the pilot stack records again, a fresh package can
carry the media.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Node.js is not installed` | Install it from https://nodejs.org, close Terminal, open it again, re-run |
| `Docker is installed but not running` | Open Docker Desktop, wait for **Running**, re-run |
| `No container tool found` | Install Docker Desktop, open it once, re-run |
| The page does not open by itself | Go to http://127.0.0.1:8787 yourself |
| Port already in use | The script moves to the next free port and prints it — use the address it prints |
| Anything else | `cat dashboard.log` shows the error, and `docker logs insp-dash-db` shows the database's |

To start completely fresh, stop everything and delete the database container,
then run `./start.sh` again — the snapshot reloads from `./data`:

```bash
./stop.sh --all
docker rm insp-dash-db      # or: podman rm insp-dash-db
./start.sh
```

---

## What this touches on your machine

- One container named `insp-dash-db`, holding a copy of the snapshot.
- Port **55432** for that database (chosen so it cannot collide with any
  PostgreSQL you already run on the standard port) and port **8787** for the
  dashboard.
- Two files written inside this folder while it runs: `dashboard.log` and
  `.dashboard.pid`.

That is the whole footprint. The dashboard only ever reads — there is no code
path in it that writes to a database or a media store — and it connects to
nothing outside your own machine.

---

## What is in this folder

```
start.sh      starts the database and the dashboard
stop.sh       stops them
data/         the inspection snapshot (loaded on first start)
app/          the dashboard itself — server, pages, charts, and its libraries
              (app/README.md describes how the dashboard is built)
```
