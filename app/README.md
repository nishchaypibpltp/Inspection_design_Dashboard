# Inspection Tracker — Phase 1

Read-only dashboard over the vehicle-inspection POC stack. It reads the stack's
Postgres directly and streams media from object storage — the local S3 emulator
(Floci) by default, a GCS bucket when hosted. It never writes to the inspection
database or bucket, and it changes nothing in the `paytm-vehicle-inspection` /
sidecar / UI repos.

## Run

```bash
npm start          # → http://127.0.0.1:8787
```

Prereqs: the POC stack's `vi-postgres` and `vi-floci` containers running
(they are what `start-local.sh` brings up). Defaults match the local stack;
override with env vars:

| Env | Default | Applies |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/vehicle_inspection` | always |
| `MEDIA_BACKEND` | `s3` (`s3` \| `gcs`) | always |
| `S3_ENDPOINT`  | `http://127.0.0.1:4566` | `MEDIA_BACKEND=s3` |
| `S3_BUCKET`    | `vehicle-inspection-local` | `MEDIA_BACKEND=s3` |
| `GCS_BUCKET`   | *(none — required)* | `MEDIA_BACKEND=gcs` |
| `PORT` / `HOST` | `8787` / `127.0.0.1` (`HOST=0.0.0.0` in the container) | always |

The startup line prints the selected backend (`… · media: s3`). An unknown
`MEDIA_BACKEND`, or `gcs` without `GCS_BUCKET`, fails at boot rather than at the
first video request.

`npm install` note: this machine's corporate proxy MITMs the npm registry;
`npm install --strict-ssl=false` was required (also for
`@google-cloud/storage`). `package-lock.json` is committed.

## Demo data for UI work

```bash
npm run seed:demo    # fill every case that has no photos with a full dummy journey
npm run seed:reset   # drop the database and reload ../data/01-vehicle_inspection.sql
```

`seed-demo.mjs` rebuilds only the cases without captured photos (seeded rows carry
`client_request_id = 'demo-seed-<id>'`); cases with real captures are untouched.
It covers every status bucket, every current stage, every QC result and every
vendor verdict, dated across the last 30 days. Re-run it to refresh the dates.
Media keys point at the object store, so photos and video still show as missing.

## Media backends

Both backends expose the same two operations to the routes — a Range-capable
object stream for `/api/media` and a whole-object read for the evidence ZIP —
and answer identically: `200` + `content-length` for a plain GET, `206` +
`content-range` for a Range request, `416` for an unsatisfiable range, `404` for
a missing key, `502` on a store error, always with `accept-ranges: bytes`.

| | `s3` (default, local) | `gcs` (hosted) |
|---|---|---|
| Store | Floci emulator on `S3_ENDPOINT` | `GCS_BUCKET` |
| Read | unsigned HTTP GET, `Range` forwarded, upstream status/headers passed through | `@google-cloud/storage` `file.createReadStream({start, end})`, headers built from object metadata |
| Auth | none (emulator) | ADC — on Cloud Run the runtime service account, no key file |

No signed URLs and no S3-interop signing on the GCS path: every byte is read by
this server and piped to the client, so nothing about the store leaks into the
browser and the Range contract stays in one place.

## Tests

```bash
npm test           # node:test, 49 tests, no network and no credentials needed
```

Covers Range parsing (open-ended, closed, suffix, clamped, multi-range,
unsatisfiable, garbage), the exact response headers per case, evidence-ZIP
assembly (entry names, manifest contents, missing objects skipped, tmp-dir
cleanup), backend selection and key validation — plus an S3-vs-GCS parity suite
that asserts the two backends are indistinguishable from the route. The GCS
client is mocked; **the live GCS read path is verified by deploy** (this machine
has no GCS credentials and its proxy MITMs TLS to `storage.googleapis.com`).

## What Phase 1 ships

- **Overview** — technical-failure alert (rollback trigger, listed individually,
  never trended), stat tiles (sessions, started recording, captures completed,
  completion rate, day-1 finish %, retakes, submissions), daily stacked sessions
  by pipeline state, median time-per-stage (from client stage marks), retakes by
  stage, abandonment last-stage, QC findings by type. Date presets + custom range
  scope everything (IST days).
- **Case explorer** — every session a row: status, stages marked, photos, video,
  blocking findings, vendor case/verdict columns (schema-ready, empty until
  Mode-B), deadline. Search (VRN / customer / policy / session id) combines with
  status chips and date range. Paged.
- **Case file** — click a row: header, evidence-ZIP download (stage photos +
  recorded video + manifest.json, built server-side), playable video (HTTP Range
  proxied), minute-level timeline (audit events + client stage marks), per-stage
  photo grid with QC confidence and retake marks, QC findings table, vendor
  verdict panel (Phase-2 placeholder).
- **Charts** follow the dataviz method: validated ordinal ramp (both modes),
  status colors only for status, 2px surface gaps, 4px rounded data ends, hover
  tooltips, legend + per-chart table view, light/dark with a toggle.

## Phase 2 hooks (visible placeholders, no fake numbers)

Vendor QC rejections & reasons (Mode-B callbacks) · GPS compliance ·
traffic-share dial + kill switch + audit trail · home→submission event funnel
(the event spine). Each shows an "instrumentation pending" state.

## Layout

```
server.mjs        http server: API + static + media proxy + evidence zip
lib/db.mjs        pg pool (read-only usage), IST helpers
lib/buckets.mjs   session status → explorer bucket (single source of truth)
lib/queries.mjs   summary / daily / stage metrics
lib/cases.mjs     explorer + full case file + timeline assembly
lib/media.mjs     backend selection (MEDIA_BACKEND), key validation, evidence-zip builder
lib/media-s3.mjs  S3/Floci backend — GET proxy, Range forwarded
lib/media-gcs.mjs GCS backend — server-side createReadStream, Range built here
public/           index.html · style.css (palette tokens) · charts.js · app.js
tests/            node:test — Range math, response headers, ZIP, s3/gcs parity
```
