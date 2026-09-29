# Funnel Analysis: Formula → SQL → API → UI

This document explains the first implemented product-metrics slice.

## Data flow

1. PostgreSQL stores raw inspection rows. No calculated dashboard total is stored.
2. `app/lib/product-metrics.mjs` runs read-only SQL and calculates percentages.
3. `GET /api/product-metrics?from=YYYY-MM-DD&to=YYYY-MM-DD` returns JSON.
4. `app/public/app.js` fetches that endpoint when `#funnel` is opened.
5. `app/public/charts.js` renders charts; `style.css` renders formula/source explanations.

This approach avoids stale totals and makes date filtering apply to the source rows.

### Retired stages

The four diagonal stages (front-left, front-right, rear-left, rear-right), the old
`ODOMETER` stage and `PREVIOUS_DAMAGE` are no longer part of the capture flow. They
are listed once in `app/lib/stages.mjs` and excluded from every Overview, Funnel
analysis and Case explorer query. The rows remain in the database; to retire
another stage, add it to `RETIRED_STAGES`.

### Added stages

`UNDER_FRONT` and `GAS_KIT_NUMBER` are listed in `ADDED_STAGES`, so every case
file shows them even when the session has no row for them. `GAS_KIT_NUMBER` is
also in `QC_CHART_STAGES`, so the AI/QC rejection chart lists it at 0% until
photos arrive.

### Stage display names

Charts and tables show stages through `STAGE_LABELS` in `app/public/app.js`:

| Database stage | Shown as |
|---|---|
| `INTERIOR_DASHBOARD` | Odometer |
| `VRN` | VIN |
| `REAR_VIEW` | Rear View (Back) |
| `DICKY_BOOT` | Open Boot |
| `BI_FUEL_TANK` | Open Boot with Cylinder |
| `UNDER_FRONT` | Under the Front |
| `GAS_KIT_NUMBER` | Gas Kit Number |

Other stages are shown in title case, e.g. `CHASSIS_NUMBER` → Chassis Number.
Stage codes inside QC messages and timeline labels are replaced the same way.

## Implemented metrics

### Journey funnel

Formula:

`users reaching milestone n ÷ users reaching milestone n−1`

Milestones:

- Session created: `inspection_sessions`
- All permissions granted: `inspection_sessions.permissions_state`
- Recording started: distinct `inspection_audit_events.session_id` where `event_type = 'recording_started'`
- Inspection completed: session status `REVIEW_READY` or `SUBMITTED`
- Clean completion: completed session with no `inspection_findings.severity = 'BLOCKING'`

The API returns both conversion from the preceding milestone and cumulative reach from created sessions.

### Retake incidence

Formula:

`users with inspection_stages.retry_count > 0 ÷ users with a captured asset at the stage`

Shown in brackets next to the total retry count on the Overview "Retakes by stage"
chart (`GET /api/stage-metrics` → `retakes[].incidence_pct`, with `stages_retried`
and `reached_users`). It is no longer a separate Funnel analysis card, so a high
total driven by one user can be told apart from friction across many users on the
same chart.

### AI/QC rejection by stage

Formula:

`captured assets with WARNING or FAILED status ÷ all captured assets at the stage`

- Warning: "Something appears to be blocking the view. Clear the frame and retake." or "The image is blurry. Hold the camera steady and retake."
- Failed: "The text in this image is not clear enough to read. Please retake."

Storage:

- Verdict: `captured_assets.status`
- Stage: `captured_assets.stage_type`
- Diagnostic reason: `inspection_findings.finding_type`
- Severity: `inspection_findings.severity`

`MISSING_STAGE` is excluded from the capture-reason table because it is a session-level completeness issue rather than a photo rejection.

### Observable stage time

Formula:

`median(current stage mark − previous stage mark)`

Storage:

`inspection_videos.stage_timestamps`

The UI explicitly labels this as successful marked journeys only. It does not claim to represent exiters.

### Confirmed technical exit rate

Formula:

`started sessions with terminal extraction, submission or upload failure ÷ started sessions`

Confirmed sources:

- `inspection_sessions.status IN ('EXTRACTION_FAILED','SUBMISSION_FAILED')`
- `inspection_videos.upload_status = 'FAILED'`

### Stalled upload rate

Formula:

`started sessions with upload_status = 'IN_PROGRESS' for more than 24 hours ÷ started sessions`

This remains separate from confirmed failures and is labelled technical-associated, because no client error event proves the cause.

## Synthetic prototype metrics

The UI uses values from the explicitly labelled `DEMO_FUNNEL_METRICS` constant for:

- Stage exit rate
- Exiters versus completers time
- Last QC message before exit
- Call-centre recovery funnel
- Call-centre operational diagnostics

These values are hard-coded for UI development only, carry a `SYNTHETIC DEMO`
label, and are not returned by PostgreSQL or the API. Each card's `i` popover
shows its formula, why it helps, interpretation, and future source events.

They must be replaced when stage lifecycle, message-display, contact and resume
events are stored.

## API response groups

- `journey`
- `qc_by_stage`
- `qc_reasons`
- `stage_timing`
- `technical`
- `data_quality`
- `definitions`
- `pending`

## Files changed

- `app/lib/product-metrics.mjs`: formulas and SQL
- `app/server.mjs`: `/api/product-metrics` route
- `app/public/index.html`: Product metrics navigation item
- `app/public/app.js`: fetch and rendering logic
- `app/public/style.css`: product-metric layout and explanations
- `app/tests/product-metrics.test.mjs`: percentage and funnel tests

## Run

```powershell
cd "C:\Users\nishchay.kumar\Downloads\inspection-dashboard\inspection-dashboard-share\app"
node start-local.mjs
```

Open `http://127.0.0.1:8787/#funnel`.
