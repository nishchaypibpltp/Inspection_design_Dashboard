# Inspection Dashboard — Master Metrics Reference

**Date:** 25 September 2026

This document lists every metric on the inspection dashboard: the metrics that already existed on the Overview tab, the metrics added on the new Funnel analysis tab, the synthetic demo metrics waiting for instrumentation, and the metrics defined in the specification but not yet built.

48 metrics in total: 28 live, 11 synthetic demo, 8 planned, 1 merged into another metric.

## Stage names

Every chart and table on the dashboard shows stages under the names below. Hidden stages still exist in the database but are excluded from every metric.

| Stage in the database | Shown on the dashboard as | Change |
|---|---|---|
| RC_DOCUMENT | RC Document | — |
| WINDSHIELD_INSIDE | Windshield Inside | — |
| INTERIOR_DASHBOARD | Odometer | Renamed from Interior Dashboard |
| ODOMETER | — | Hidden; replaced by the Odometer stage above |
| PREVIOUS_DAMAGE | — | Removed |
| VRN | VIN | Renamed from VRN |
| CHASSIS_NUMBER | Chassis Number | — |
| ENGINE_BAY | Engine Bay | — |
| FRONT_VIEW | Front View | — |
| RIGHT_SIDE | Right Side | — |
| REAR_VIEW | Rear View (Back) | Renamed from Rear View |
| LEFT_SIDE | Left Side | — |
| DICKY_BOOT | Open Boot | Renamed from Dicky Boot |
| BI_FUEL_TANK | Open Boot with Cylinder | Renamed from Bi-Fuel Tank |
| UNDER_FRONT | Under the Front | New stage; no photos captured yet |
| GAS_KIT_NUMBER | Gas Kit Number | New stage; no photos captured yet, listed in the AI/QC rejection chart at 0% |
| FRONT_LEFT_DIAGONAL, FRONT_RIGHT_DIAGONAL, REAR_LEFT_DIAGONAL, REAR_RIGHT_DIAGONAL | — | Removed |

## AI/QC result definitions

| Result | Meaning | Example message the user sees |
|---|---|---|
| Warning | Photo kept, retake advised | "Something appears to be blocking the view. Clear the frame and retake." / "The image is blurry. Hold the camera steady and retake." |
| Failed | Photo rejected, blocks the case | "The text in this image is not clear enough to read. Please retake." |
| Photo not available | No usable frame for the stage; not counted in the rejection rate because no photo exists | "No confident frame for required stage Front View" |

## Status legend

- Live — calculated from PostgreSQL on every request.
- Demo — hard-coded synthetic value, labelled SYNTHETIC DEMO on the dashboard.
- Planned — defined but not yet on the dashboard; needs new data.
- Merged — no longer a separate card; shown as part of the metric named in its row.

## A. Overview tab — existing metrics

Shipped before this work. Values are live from PostgreSQL.

| # | Metric | Status | Formula / data points | How it helps visibility | Current value |
|---|---|---|---|---|---|
| 1 | Technical failures alert | Live | Sessions with status EXTRACTION_FAILED or SUBMISSION_FAILED, plus videos with upload_status = FAILED. Data: inspection_sessions.status, inspection_videos.upload_status. | Flags product breakages that stop a user regardless of intent. It is the rollback trigger, and each failure is listed so the case can be opened. | 7 (2 extraction, 5 upload). Misses 54 uploads stalled over 24h. |
| 2 | Sessions created | Live | Count of inspection_sessions created in the selected IST date range. | Volume baseline and the denominator for every downstream rate. | 276 |
| 3 | Started recording | Live | Distinct session_id in inspection_audit_events where event_type = recording_started. | Shows how many users got past setup and permissions into the actual inspection. | 121 |
| 4 | Captures completed | Live | Sessions with status REVIEW_READY or SUBMITTED. | Output volume of finished inspections. | 60 (all 60 carry blocking findings) |
| 5 | Completion rate | Live | Captures completed ÷ started recording. | Shows whether users who begin capturing manage to finish. | 50% (60 ÷ 121) |
| 6 | Finished on day one | Live | Completed sessions where IST date(last_active_at) = date(created_at) ÷ completed sessions. | Shows whether the 72-hour window and reminders are needed or users finish immediately. | 100%. Uses last_active_at, which is set before recording; should use the recording_complete time. |
| 7 | Retakes | Live | Photos with capture_method = RETAKE in captured_assets; stages with retry_count > 0 in inspection_stages. | Rough signal of how often the AI/QC asked users to capture again. | 5 retake photos · 13 stages retried |
| 8 | Submitted to WIMWIsure | Live | Count of inspection_submissions rows. | Confirms completed inspections actually reach the insurer's vendor. | 0 (Mode-B not live) |
| 9 | Daily inspection sessions | Live | Sessions per IST created day, split by pipeline state: not started, in progress, review ready, aborted, failed. | Shows daily volume and what happened to each day's cohort. | Aug 19: 95 · Aug 20: 135 · Aug 21: 43 |
| 10 | Time spent per stage (median) | Live | Median and 90th percentile of (stage mark − previous stage mark) from inspection_videos.stage_timestamps. First mark excluded. | Highlights stages that take users the most effort. | Odometer 13.8s, Windshield Inside 10.0s, Rear View (Back) 6.3s (28 recordings) |
| 11 | Retakes by stage | Live | Bar: sum of retry_count per stage_type in inspection_stages. In brackets: retake incidence = users with retry_count > 0 ÷ users with a captured asset at that stage (captured_assets). | Points to stages where guidance or QC may be failing, and separates stage-wide friction from one user retrying many times. | RC Document 13 (50%, 5 ÷ 10), Front View 9 (16.7%), Right Side 5 (18.8%) |
| 12 | Where journeys were abandoned | Live | Sessions ABORTED, or RECORDING with no update for 24h, grouped by the last stage mark in the video. No mark = before first stage. | Intended to locate the stage at which users give up. | 63, all "before first stage", because abandoned sessions emit no marks |
| 13 | QC findings by type | Live | Count of inspection_findings grouped by finding_type (BLOCKING and WARNING). | Shows what the AI/QC pipeline complains about most. | Missing stage 284 · Not readable 25 · Obstructed 22 · Blurry 1 |
| 14 | Case explorer | Live | One row per session: status, stage marks, photo count, video status, count of BLOCKING findings, vendor fields, deadline. | Lets a reviewer move from an aggregate number to the exact cases behind it. | 276 cases |
| 15 | Case file | Live | Per session: video, event timeline with stage marks, stage grid with AI confidence, QC findings, vendor verdict. | Root-cause view of a single customer journey. | Per session |
| 16 | Phase 2 placeholders | Planned | Vendor QC rejections (Mode-B callbacks), GPS compliance (GPS build), traffic share to WIMWIsure (control plane), home-to-submission event funnel (event spine). | Reserves space for vendor quality, location compliance, traffic control and a screen-level funnel. | No data yet |

## B. Funnel analysis tab — new live metrics

Added in this work. Calculated from PostgreSQL on every request via GET /api/product-metrics.

| # | Metric | Status | Formula / data points | How it helps visibility | Current value |
|---|---|---|---|---|---|
| 17 | Test-data share | Live | Sessions matching the test signature (vehicle_reg MH12AB1234 or test customer_id prefixes such as dev-, e2e, codex, tunnel) ÷ sessions. | Stops internal test runs from being read as customer behaviour. | 276 of 276 |
| 18 | Clean completions | Live | Completed sessions with no BLOCKING row in inspection_findings. | Counts only inspections whose evidence can actually proceed. | 0 of 60 |
| 19 | Permission grant rate | Live | Sessions with camera, microphone and location all granted in permissions_state ÷ sessions created. | Reveals the consent gate, the largest single loss before any stage begins. | 50.4% (139 ÷ 276). Sessions without permission produced 0 assets. |
| 20 | Milestone conversion (journey funnel) | Live | Users at milestone n ÷ users at milestone n−1. Milestones: created → permissions granted → recording started → completed → clean completion. | Pinpoints which transition loses the most users. | 50.4% → 87.1% → 49.6% → 0% |
| 21 | Cumulative reach | Live | Users at milestone n ÷ sessions created. | Shows the total loss accumulated by each point, so fixes are sized by users affected. | Completed 21.7% of created; clean 0% |
| 22 | Behaviour by platform | Live | Permission, start, completion and clean rates grouped by platform parsed from device_metadata.ua (iOS, Android, Other, Unknown). | Exposes OS or device-specific breakage hidden inside averages. | iOS 231: 42.4% permission, 13.4% complete · Other 29: 96.6%, 69.0% · Android n=2 |
| 23 | Retake incidence by stage | Merged | Users with retry_count > 0 ÷ users with a captured asset at that stage. | Separates stage-wide friction from one user retrying many times. | Removed from this tab — now shown in brackets on #11 Retakes by stage (Overview) |
| 24 | AI/QC rejection rate by stage | Live | (Warning + Failed photos) ÷ all photos at that stage, from captured_assets. Warning = "Something appears to be blocking the view" or "The image is blurry"; Failed = "The text in this image is not clear enough to read". Gas Kit Number is listed at 0% until photos arrive. | Ranks the documents and views that are hardest for the AI pipeline. | Not Relevant 64.7%, RC Document 60.0%, Chassis Number 55.3%; overall 32.9% (48 ÷ 146) |
| 25 | AI/QC reasons by stage | Live | inspection_findings grouped by stage_type, finding_type and severity, excluding MISSING_STAGE. | Tells which team should act: OCR/extraction versus capture conditions. | Chassis Number not readable 19 · Not Relevant obstructed 10 · RC Document not readable 6 |
| 26 | Observable stage time | Live | Median and 90th percentile gap between consecutive stage marks, successful marked journeys only. | Effort per stage among successful users; the baseline for comparing exiters later. | Odometer 13.8s, Windshield Inside 10.0s, Rear View (Back) 6.3s |
| 27 | Confirmed technical-exit rate | Live | Started sessions with EXTRACTION_FAILED, SUBMISSION_FAILED or a FAILED video upload ÷ started sessions. | Separates product failure from users choosing to leave. | 5.8% (7 ÷ 121) |
| 28 | Stalled upload rate | Live | Started sessions with a video upload IN_PROGRESS and no update for 24h ÷ started sessions. | Surfaces failures that never reach a FAILED state. | 44.6% (54 ÷ 121) |
| 29 | Stage-mark coverage | Live | Videos with at least one stage_timestamps mark ÷ all videos. | Tells whether stage-level metrics can be trusted. | 23.1% (28 ÷ 121) |
| 30 | Telemetry health | Live | Share of inspection_stages rows still PENDING; abandoned or stalled sessions with stage marks ÷ abandoned or stalled sessions. | Explains why stage-exit metrics cannot yet be computed from real data. | 99.6% of stage rows PENDING; 0 of 63 abandoned sessions have marks |

## C. Funnel analysis tab — synthetic demo metrics

Shown with hard-coded values (DEMO_FUNNEL_METRICS in app.js) and a SYNTHETIC DEMO label until the required events are stored.

| # | Metric | Status | Formula / data points | How it helps visibility | Current value |
|---|---|---|---|---|---|
| 31 | Stage exit rate | Demo | Users starting stage n but not completing it ÷ users starting stage n. Needs stage_started and stage_completed events. | Names the stage where users are lost instead of one overall abandonment total. | Demo: Chassis Number 23.1%, RC Document 22.0%, Front View 15.0% |
| 32 | Exiters vs completers time | Demo | Median(stage end or exit − stage start), split by outcome. Needs stage lifecycle events with an exit timestamp. | Very short exits suggest confusion or loading failure; long exits suggest users stuck trying. | Demo: Chassis Number 164s exiters vs 55s completers |
| 33 | Exit reason mix | Planned | Exits assigned to reason r ÷ all classified exits. Data: technical error events and fixed agent disposition codes. | Assigns an owner to each exit: engineering, product/design, AI/QC or the contact strategy. | Removed from the dashboard — no stored field records why a user exited |
| 34 | Last QC message before exit | Demo | Users exiting after message m ÷ users shown message m. Needs a guidance_message_shown event with message_id and version. | Identifies instructions that users cannot act on. | Demo: "Text not readable" 27.3% exit rate |
| 35 | Call-centre recovery funnel | Demo | Eligible exits → contact attempted → connected → session resumed → exit stage recovered → clean completion; count and conversion at each step. | Shows where recovery breaks: coverage, reachability, persuasion, stage recovery or capture quality. | Demo: 100 → 82 → 55 → 38 → 27 → 19 |
| 36 | Contact coverage | Demo | Eligible exited users contacted at least once ÷ eligible exited users. | Checks whether call-centre capacity matches drop-off volume. | Demo: 82% |
| 37 | Median time exit → first attempt | Demo | Median(first contact attempt − exit timestamp). | Finds the contact window in which recovery still works. | Demo: 34 min |
| 38 | Call connect rate | Demo | Calls answered ÷ calls attempted. | Separates a reachability problem from a persuasion problem. | Demo: 67.1% |
| 39 | Median time call → resume | Demo | Median(first session resume after contact − connected call time). | Shows whether users act during or right after the call, or delay. | Demo: 18 min |
| 40 | Post-contact session time | Demo | Median(completion or re-exit − post-contact resume), compared with users who returned on their own. | Shows whether the call actually removed the blocker. | Demo: 22 min |
| 41 | Re-exit after contact | Demo | Contacted users who resume and exit again ÷ contacted users who resume; also same-stage re-exit. | Same-stage re-exit means the root cause was not solved by the call. | Demo: 28.9% |
| 42 | Assisted conversion uplift | Demo | Stage conversion with call support − conversion of a comparable uncontacted holdout. | Measures the true incremental value of the call centre, excluding users who would have returned anyway. | Demo: +14 percentage points |

## D. Planned metrics — in the specification, not yet on the dashboard

Defined in Dashboard-Metrics-Product-Spec. Each needs new events before it can be built.

| # | Metric | Status | Formula / data points | How it helps visibility | Current value |
|---|---|---|---|---|---|
| 43 | Stage-to-stage conversion (per stage) | Planned | Users completing stage n ÷ users completing stage n−1. | Shows the exact stage transition where the journey starts losing users. | Needs stage_completed events |
| 44 | Cumulative exit rate at stage n | Planned | 1 − (users completing stage n ÷ users starting the inspection). | Shows whether losses happen before a difficult stage or within it. | Needs stage_completed events |
| 45 | Retakes before exit | Planned | Retake attempts at stage n before exit ÷ users exiting at stage n; share of exiters with at least one retake. | Separates users who gave up after repeated rejection from those who never tried. | Needs attempt events linked to the exit |
| 46 | Technical exit by stage and error category | Planned | Users exiting after a technical error at stage n ÷ users starting stage n, split by error code, platform, OS, app version and network. | Locates compatibility and network defects at the stage where they occur. | Needs technical_error events with stage and error code |
| 47 | Post-contact resume, stage recovery, completion and clean completion rates | Planned | Each ÷ connected users within the attribution window (shown as steps of the demo funnel). | Separates "reopened the app" from "solved the stage" and "finished cleanly". | Needs contact and session_resumed events |
| 48 | Agent-level recovery rate | Planned | Clean completions ÷ connected users per agent, compared within the same stage mix. | Identifies scripts and coaching that recover users best. | Needs agent_id on contact events |

## Known limitations in the current data and logic

- All 276 sessions are internal test traffic (one vehicle number, test customer IDs); values validate formulas and UI, not customer behaviour.
- Finished on day one uses last_active_at, which is set before recording starts; it should use the recording_complete time.
- The technical failures alert excludes 54 uploads stalled for about 21 days.
- The daily chart shows 51 stale recordings as "in progress" while the abandonment chart counts them as abandoned.
- Where journeys were abandoned always shows one bar because abandoned sessions emit no stage marks.
- QC findings by type merges all stages; the stage breakdown is available in the API.
- Retakes by stage still ranks by total retries; the share of users who retried is shown alongside but does not set the order.

## Events required to move Demo and Planned metrics to Live

- Journey: stage_started, stage_completed, stage_exited (with reason), capture_attempted, guidance_message_shown, technical_error, session_resumed.
- Contact: contact_eligible, contact_attempted, contact_connected, contact_disposition, holdout_assigned.
- Shared fields: session_id, stage_type, attempt_number, platform, os_version, app_version, error_code, message_id, contact_id, agent_id, timestamp.
