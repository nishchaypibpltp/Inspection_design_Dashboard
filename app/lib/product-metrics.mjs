// Product metrics derived from the existing inspection snapshot.
//
// Storage model:
// - lifecycle: inspection_sessions + inspection_audit_events
// - stage timing: inspection_videos.stage_timestamps
// - attempts / verdicts: inspection_stages + captured_assets
// - reasons: inspection_findings
//
// No aggregate is persisted. The API calculates every value from source rows so
// the date filter and future data corrections are reflected immediately.
import { q } from './db.mjs';
import { activeStage, QC_CHART_STAGES } from './stages.mjs';

function dateWhere(from, to, params, alias = 's') {
  const parts = [];
  if (from) {
    params.push(from);
    parts.push(`(${alias}.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    parts.push(`(${alias}.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $${params.length}`);
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

export const metricPercent = (numerator, denominator) =>
  denominator ? Math.round((1000 * Number(numerator)) / Number(denominator)) / 10 : null;

export function buildJourneyFunnel(counts) {
  return counts.map(([key, label, users], index) => ({
    key,
    label,
    users,
    conversion_from_previous_pct: index
      ? metricPercent(users, counts[index - 1][2])
      : 100,
    cumulative_reach_pct: metricPercent(users, counts[0][2]),
  }));
}

// Whole journey, one row per step. Stage steps come in capture order; a conditional
// stage (e.g. bi-fuel only) is measured against its eligible sessions, so it is kept
// out of the step-to-step chain and never flagged as a drop.
export function buildJourneySteps(journey, stages) {
  const steps = [];
  let prev = null;
  const push = (phase, key, label, users, extra = {}) => {
    const step = { phase, key, label, users, ...extra };
    if (!step.conditional) {
      step.pct_of_created = metricPercent(users, journey.created);
      step.pct_from_previous = prev ? metricPercent(users, prev.users) : 100;
      step.drop_users = prev ? prev.users - users : 0;
      prev = step;
    } else {
      step.pct_of_eligible = metricPercent(users, step.eligible);
    }
    steps.push(step);
  };
  push('Setup', 'created', 'Sessions created', journey.created);
  push('Setup', 'permission_granted', 'All permissions granted', journey.permission_granted);
  push('Recording', 'started', 'Recording started', journey.started);
  for (const s of stages) {
    push('Recording', `stage:${s.stage}`, s.stage, s.reached,
      s.conditional ? { conditional: true, condition_key: s.condition_key, eligible: s.eligible, stage: s.stage }
        : { stage: s.stage });
  }
  push('Recording', 'recording_complete', 'Recording finished', journey.recording_complete);
  push('Processing', 'completed', 'Photos extracted and checked', journey.completed,
    { clean: journey.clean_completed, clean_pct: metricPercent(journey.clean_completed, journey.completed) });
  push('Delivery', 'submitted', 'Sent to vendor', journey.submitted);
  push('Delivery', 'approved', 'Approved by vendor', journey.approved);
  // Only customer-driven steps; later steps wait on processing, review or the vendor.
  const worst = steps.filter(s => !s.conditional && s.drop_users > 0 && ['Setup', 'Recording'].includes(s.phase))
    .sort((a, b) => b.drop_users - a.drop_users)[0];
  if (worst) worst.biggest_drop = true;
  return steps;
}

export function platformOf(ua) {
  if (!ua) return 'Unknown';
  if (/iphone|ipad|ipod|ios/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  return 'Other';
}

// rows: one per distinct user-agent with its counts; summed per platform.
export function buildPlatformBreakdown(rows) {
  const by = {};
  for (const r of rows) {
    const p = (by[platformOf(r.ua)] ??= { platform: platformOf(r.ua), sessions: 0, permission_granted: 0, started: 0, completed: 0, clean_completed: 0 });
    for (const k of ['sessions', 'permission_granted', 'started', 'completed', 'clean_completed']) p[k] += Number(r[k]);
  }
  return Object.values(by).map(p => ({
    ...p,
    permission_pct: metricPercent(p.permission_granted, p.sessions),
    started_pct: metricPercent(p.started, p.sessions),
    completed_pct: metricPercent(p.completed, p.sessions),
    clean_pct: metricPercent(p.clean_completed, p.sessions),
  })).sort((a, b) => b.sessions - a.sessions);
}

export const PRODUCT_METRIC_DEFINITIONS = {
  stage_conversion: {
    formula: 'users completing stage n ÷ users completing stage n−1',
    source: 'inspection_videos.stage_timestamps',
  },
  stage_exit: {
    formula: 'users starting stage n but not completing it ÷ users starting stage n',
    source: 'future stage_started / stage_completed events',
  },
  cumulative_reach: {
    formula: 'users completing stage n ÷ users starting the inspection',
    source: 'inspection_audit_events + stage events',
  },
  qc_rejection: {
    formula: '(Warning + Failed photos) ÷ all photos at that stage',
    source: 'captured_assets',
  },
  confirmed_technical_exit: {
    formula: 'started sessions with terminal extraction/submission/upload failure ÷ started sessions',
    source: 'inspection_sessions + inspection_videos + inspection_audit_events',
  },
  stalled_upload: {
    formula: 'uploads IN_PROGRESS for more than 24 hours ÷ started sessions',
    source: 'inspection_videos + inspection_audit_events',
  },
};

export async function productMetrics(from, to) {
  const params = [];
  const where = dateWhere(from, to, params);

  const [journey] = await q(`
    WITH scoped AS (
      SELECT * FROM inspection_sessions s ${where}
    ), started AS (
      SELECT DISTINCT e.session_id
      FROM inspection_audit_events e JOIN scoped s ON s.id = e.session_id
      WHERE e.event_type = 'recording_started'
    ), completed AS (
      SELECT id FROM scoped WHERE status IN ('REVIEW_READY','SUBMITTED')
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS created,
      (SELECT count(*)::int FROM scoped
        WHERE COALESCE((permissions_state->>'camera_granted')::boolean, false)
          AND COALESCE((permissions_state->>'microphone_granted')::boolean, false)
          AND COALESCE((permissions_state->>'location_granted')::boolean, false)
      ) AS permission_granted,
      (SELECT count(*)::int FROM started) AS started,
      (SELECT count(*)::int FROM completed) AS completed,
      (SELECT count(*)::int FROM completed c
        WHERE NOT EXISTS (
          SELECT 1 FROM inspection_findings f
          WHERE f.session_id = c.id AND f.severity = 'BLOCKING'
            AND ${activeStage('f.stage_type')}
        )
      ) AS clean_completed,
      (SELECT count(DISTINCT e.session_id)::int
         FROM inspection_audit_events e JOIN scoped s ON s.id = e.session_id
        WHERE e.event_type = 'recording_complete') AS recording_complete,
      (SELECT count(*)::int FROM inspection_submissions sub JOIN completed c ON c.id = sub.session_id
        WHERE sub.status = 'DISPATCHED') AS submitted,
      (SELECT count(*)::int FROM inspection_submissions sub JOIN completed c ON c.id = sub.session_id
        WHERE sub.status = 'DISPATCHED' AND sub.vendor_remarks = 'APPROVED') AS approved,
      (SELECT count(*)::int FROM scoped
        WHERE vehicle_reg = 'MH12AB1234'
          OR customer_id ~* '^(dev-|smoke|e2e|cust-e2e|night-e2e|codex|tunnel|replay|refresh|test)'
      ) AS test_like
  `, params);

  const funnelCounts = [
    ['created', 'Sessions created', journey.created],
    ['permission_granted', 'All permissions granted', journey.permission_granted],
    ['started', 'Started recording', journey.started],
    ['completed', 'Inspection completed', journey.completed],
    ['clean_completed', 'Clean completion', journey.clean_completed],
  ];
  journey.funnel = buildJourneyFunnel(funnelCounts);

  // A stage counts as reached when the recording carries a mark for it.
  const stageReach = await q(`
    WITH scoped AS (
      SELECT * FROM inspection_sessions s ${where}
    ), started AS (
      SELECT DISTINCT e.session_id
      FROM inspection_audit_events e JOIN scoped s ON s.id = e.session_id
      WHERE e.event_type = 'recording_started'
    ), stage_order AS (
      SELECT st.stage_type AS stage, avg(st.sequence_number) AS ord,
        bool_or(st.is_conditional) AS conditional, max(st.condition_key) AS condition_key
      FROM inspection_stages st JOIN scoped s ON s.id = st.session_id
      WHERE ${activeStage('st.stage_type')}
      GROUP BY 1
    ), marks AS (
      SELECT DISTINCT v.session_id, a.e->>'stage_type' AS stage
      FROM inspection_videos v JOIN started x ON x.session_id = v.session_id,
        LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(v.stage_timestamps) = 'array' THEN v.stage_timestamps ELSE '[]'::jsonb END
        ) AS a(e)
    )
    SELECT o.stage, o.conditional, o.condition_key,
      (SELECT count(*)::int FROM started x JOIN scoped s ON s.id = x.session_id
        WHERE NOT o.conditional
           OR (o.condition_key = 'BI_FUEL_ONLY' AND COALESCE((s.checklist_state->>'is_bi_fuel')::boolean, false))
           OR (o.condition_key = 'HAS_PREVIOUS_POLICY' AND COALESCE((s.checklist_state->>'has_previous_policy')::boolean, false))
      ) AS eligible,
      (SELECT count(*)::int FROM marks m WHERE m.stage = o.stage) AS reached
    FROM stage_order o
    ORDER BY o.ord, o.stage
  `, params);
  journey.steps = buildJourneySteps(journey, stageReach);

  const platformRows = await q(`
    WITH scoped AS (
      SELECT * FROM inspection_sessions s ${where}
    ), started AS (
      SELECT DISTINCT e.session_id
      FROM inspection_audit_events e JOIN scoped s ON s.id = e.session_id
      WHERE e.event_type = 'recording_started'
    )
    SELECT s.device_metadata->>'ua' AS ua,
      count(*)::int AS sessions,
      count(*) FILTER (WHERE COALESCE((s.permissions_state->>'camera_granted')::boolean, false)
        AND COALESCE((s.permissions_state->>'microphone_granted')::boolean, false)
        AND COALESCE((s.permissions_state->>'location_granted')::boolean, false))::int AS permission_granted,
      count(x.session_id)::int AS started,
      count(*) FILTER (WHERE s.status IN ('REVIEW_READY','SUBMITTED'))::int AS completed,
      count(*) FILTER (WHERE s.status IN ('REVIEW_READY','SUBMITTED') AND NOT EXISTS (
        SELECT 1 FROM inspection_findings f
        WHERE f.session_id = s.id AND f.severity = 'BLOCKING' AND ${activeStage('f.stage_type')}
      ))::int AS clean_completed
    FROM scoped s LEFT JOIN started x ON x.session_id = s.id
    GROUP BY 1
  `, params);
  const platforms = buildPlatformBreakdown(platformRows);

  const qcByStage = await q(`
    WITH scoped AS (
      SELECT * FROM inspection_sessions s ${where}
    )
    SELECT a.stage_type AS stage,
      count(*)::int AS assets,
      count(DISTINCT a.session_id)::int AS users,
      count(*) FILTER (WHERE a.status = 'PASSED')::int AS passed,
      count(*) FILTER (WHERE a.status = 'WARNING')::int AS warning,
      count(*) FILTER (WHERE a.status = 'FAILED')::int AS failed
    FROM captured_assets a JOIN scoped s ON s.id = a.session_id
    WHERE ${activeStage('a.stage_type')}
    GROUP BY a.stage_type
    ORDER BY (count(*) FILTER (WHERE a.status IN ('WARNING','FAILED'))) DESC,
             count(*) DESC
  `, params);
  for (const stage of QC_CHART_STAGES) {
    if (!qcByStage.some(r => r.stage === stage)) {
      qcByStage.push({ stage, assets: 0, users: 0, passed: 0, warning: 0, failed: 0 });
    }
  }
  for (const row of qcByStage) {
    row.rejected = row.warning + row.failed;
    row.rejection_pct = metricPercent(row.rejected, row.assets);
  }

  const qcReasons = await q(`
    WITH scoped AS (
      SELECT * FROM inspection_sessions s ${where}
    )
    SELECT f.stage_type AS stage, f.finding_type AS reason, f.severity,
      count(*)::int AS findings,
      count(DISTINCT f.session_id)::int AS users
    FROM inspection_findings f JOIN scoped s ON s.id = f.session_id
    WHERE f.finding_type <> 'MISSING_STAGE' AND ${activeStage('f.stage_type')}
    GROUP BY 1,2,3
    ORDER BY findings DESC, stage
  `, params);

  const timing = await q(`
    WITH scoped AS (
      SELECT * FROM inspection_sessions s ${where}
    ), marks AS (
      SELECT v.session_id, a.e->>'stage_type' AS stage,
        (a.e->>'video_timestamp_ms')::bigint AS ms, a.ord
      FROM inspection_videos v
      JOIN scoped s ON s.id = v.session_id,
      LATERAL jsonb_array_elements(v.stage_timestamps) WITH ORDINALITY AS a(e, ord)
      WHERE v.stage_timestamps IS NOT NULL
    ), deltas AS (
      SELECT stage, ms - lag(ms) OVER (PARTITION BY session_id ORDER BY ord) AS d
      FROM marks
    )
    SELECT stage, count(*)::int AS observations,
      round(((percentile_cont(0.5) WITHIN GROUP (ORDER BY d)) / 1000.0)::numeric, 1) AS median_s,
      round(((percentile_cont(0.9) WITHIN GROUP (ORDER BY d)) / 1000.0)::numeric, 1) AS p90_s
    FROM deltas
    WHERE d IS NOT NULL AND d >= 0 AND ${activeStage('stage')}
    GROUP BY stage
    ORDER BY median_s DESC
  `, params);

  const [technical] = await q(`
    WITH scoped AS (
      SELECT * FROM inspection_sessions s ${where}
    ), started AS (
      SELECT DISTINCT e.session_id
      FROM inspection_audit_events e JOIN scoped s ON s.id = e.session_id
      WHERE e.event_type = 'recording_started'
    ), confirmed AS (
      SELECT id AS session_id FROM scoped
      WHERE status IN ('EXTRACTION_FAILED','SUBMISSION_FAILED')
      UNION
      SELECT v.session_id FROM inspection_videos v JOIN scoped s ON s.id = v.session_id
      WHERE v.upload_status = 'FAILED'
    ), stalled AS (
      SELECT DISTINCT v.session_id
      FROM inspection_videos v JOIN scoped s ON s.id = v.session_id
      WHERE v.upload_status = 'IN_PROGRESS'
        AND v.updated_at < now() - interval '24 hours'
    )
    SELECT
      (SELECT count(*)::int FROM started) AS started,
      (SELECT count(*)::int FROM confirmed) AS confirmed_exits,
      (SELECT count(*)::int FROM confirmed c JOIN started x USING (session_id))
        AS confirmed_exits_started,
      (SELECT count(*)::int FROM stalled) AS stalled_uploads,
      (SELECT count(*)::int FROM stalled s JOIN started x USING (session_id))
        AS stalled_uploads_started
  `, params);
  technical.confirmed_exit_pct = metricPercent(technical.confirmed_exits_started, technical.started);
  technical.stalled_upload_pct = metricPercent(technical.stalled_uploads_started, technical.started);

  const [quality] = await q(`
    WITH scoped AS (
      SELECT * FROM inspection_sessions s ${where}
    )
    SELECT
      (SELECT count(*)::int FROM inspection_videos v JOIN scoped s ON s.id = v.session_id)
        AS videos,
      (SELECT count(*)::int FROM inspection_videos v JOIN scoped s ON s.id = v.session_id
        WHERE v.stage_timestamps IS NOT NULL
          AND jsonb_array_length(v.stage_timestamps) > 0
      ) AS videos_with_marks,
      (SELECT count(*)::int FROM scoped WHERE status IN ('ABORTED','RECORDING'))
        AS abandoned_or_recording,
      (SELECT count(*)::int FROM scoped s
        WHERE s.status IN ('ABORTED','RECORDING')
          AND EXISTS (
            SELECT 1 FROM inspection_videos v
            WHERE v.session_id = s.id
              AND v.stage_timestamps IS NOT NULL
              AND jsonb_array_length(v.stage_timestamps) > 0
          )
      ) AS abandoned_or_recording_with_marks,
      (SELECT count(*)::int FROM inspection_stages st JOIN scoped s ON s.id = st.session_id
        WHERE ${activeStage('st.stage_type')}
      ) AS stage_rows,
      (SELECT count(*)::int FROM inspection_stages st JOIN scoped s ON s.id = st.session_id
        WHERE st.status = 'PENDING' AND ${activeStage('st.stage_type')}
      ) AS pending_stage_rows
  `, params);
  quality.stage_mark_coverage_pct = metricPercent(quality.videos_with_marks, quality.videos);
  quality.pending_stage_pct = metricPercent(quality.pending_stage_rows, quality.stage_rows);

  return {
    definitions: PRODUCT_METRIC_DEFINITIONS,
    journey,
    platforms,
    qc_by_stage: qcByStage,
    qc_reasons: qcReasons,
    stage_timing: timing,
    technical,
    data_quality: quality,
    pending: {
      stage_exit: 'Needs stage_started and stage_completed events on abandoned journeys.',
      contact_process: 'Needs contact eligibility, attempt, connect, disposition and resume events.',
    },
  };
}
