// All dashboard reads. Every function returns plain JSON-able rows.
// Date filters: [from, to] are inclusive IST calendar dates ('YYYY-MM-DD') or null.
import { q } from './db.mjs';
import { BUCKET_CASE_SQL } from './buckets.mjs';
import { activeStage } from './stages.mjs';
import { metricPercent } from './product-metrics.mjs';

function dateWhere(from, to, params, col = 's.created_at') {
  const w = [];
  if (from) { params.push(from); w.push(`(${col} AT TIME ZONE 'Asia/Kolkata')::date >= $${params.length}`); }
  if (to)   { params.push(to);   w.push(`(${col} AT TIME ZONE 'Asia/Kolkata')::date <= $${params.length}`); }
  return w;
}

// ---------- overview ----------

export async function summary(from, to) {
  const params = [];
  const w = dateWhere(from, to, params);
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';

  const [buckets] = [await q(`
    SELECT ${BUCKET_CASE_SQL} AS bucket, count(*)::int AS n
    FROM inspection_sessions s ${where}
    GROUP BY 1`, params)];

  const [row] = await q(`
    WITH scoped AS (SELECT * FROM inspection_sessions s ${where})
    SELECT
      (SELECT count(*)::int FROM scoped) AS sessions,
      (SELECT count(DISTINCT e.session_id)::int
         FROM inspection_audit_events e
         JOIN scoped s2 ON s2.id = e.session_id
        WHERE e.event_type = 'recording_started') AS started_recording,
      (SELECT count(*)::int FROM scoped WHERE status IN ('REVIEW_READY','SUBMITTED')) AS captures_completed,
      (SELECT count(*)::int FROM scoped
        WHERE status IN ('REVIEW_READY','SUBMITTED')
          AND (last_active_at AT TIME ZONE 'Asia/Kolkata')::date
            = (created_at    AT TIME ZONE 'Asia/Kolkata')::date) AS completed_day1,
      (SELECT count(*)::int FROM inspection_stages st JOIN scoped s2 ON s2.id = st.session_id
        WHERE st.retry_count > 0 AND ${activeStage('st.stage_type')}) AS stages_retried,
      (SELECT count(*)::int FROM captured_assets a JOIN scoped s2 ON s2.id = a.session_id
        WHERE a.capture_method = 'RETAKE' AND ${activeStage('a.stage_type')}) AS retake_photos,
      (SELECT count(*)::int FROM inspection_videos v JOIN scoped s2 ON s2.id = v.session_id
        WHERE v.upload_status = 'COMPLETE') AS videos_complete,
      (SELECT count(*)::int FROM inspection_submissions sub JOIN scoped s2 ON s2.id = sub.session_id) AS submissions,
      (SELECT count(*)::int FROM inspection_submissions sub JOIN scoped s2 ON s2.id = sub.session_id
        WHERE sub.vendor_remarks = 'REJECTED') AS vendor_rejected`, params);

  // Technical failures — the PM's rule: any occurrence is a rollback trigger,
  // listed individually, never trended.
  const failures = await q(`
    SELECT s.id, s.vehicle_reg, s.customer_id, s.status AS kind,
           to_char(s.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI') AS at
    FROM inspection_sessions s
    ${where ? where + ' AND' : 'WHERE'} s.status IN ('EXTRACTION_FAILED','SUBMISSION_FAILED')
    UNION ALL
    SELECT s.id, s.vehicle_reg, s.customer_id, 'VIDEO_UPLOAD_FAILED',
           to_char(v.updated_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI')
    FROM inspection_videos v JOIN inspection_sessions s ON s.id = v.session_id
    ${where ? where + ' AND' : 'WHERE'} v.upload_status = 'FAILED'
    ORDER BY at DESC`, params); // same $1/$2 placeholders appear in both UNION halves

  return { buckets, ...row, failures };
}

export async function daily(from, to) {
  const params = [];
  const w = dateWhere(from, to, params);
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  return q(`
    SELECT (s.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
           ${BUCKET_CASE_SQL} AS bucket, count(*)::int AS n
    FROM inspection_sessions s ${where}
    GROUP BY 1, 2 ORDER BY 1`, params);
}

// ---------- stage metrics ----------

export async function stageMetrics(from, to) {
  const params = [];
  const w = dateWhere(from, to, params, 'v.created_at');
  const whereV = w.length ? `AND ${w.join(' AND ')}` : '';

  // Dwell: gap between consecutive client stage marks inside one recording.
  // First mark has no arrival anchor, so it is excluded (delta IS NULL).
  const dwell = await q(`
    WITH marks AS (
      SELECT v.session_id, a.e->>'stage_type' AS stage,
             (a.e->>'video_timestamp_ms')::bigint AS ms, a.ord
      FROM inspection_videos v,
           LATERAL jsonb_array_elements(v.stage_timestamps) WITH ORDINALITY AS a(e, ord)
      WHERE v.stage_timestamps IS NOT NULL ${whereV}
    ), deltas AS (
      SELECT stage, ms - lag(ms) OVER (PARTITION BY session_id ORDER BY ord) AS d
      FROM marks
    )
    SELECT stage, count(*)::int AS n,
           round(((percentile_cont(0.5) WITHIN GROUP (ORDER BY d)) / 1000.0)::numeric, 1) AS median_s,
           round(((percentile_cont(0.9) WITHIN GROUP (ORDER BY d)) / 1000.0)::numeric, 1) AS p90_s
    FROM deltas WHERE d IS NOT NULL AND d >= 0 AND ${activeStage('stage')}
    GROUP BY stage ORDER BY median_s DESC`, params);

  const params2 = [];
  const w2 = dateWhere(from, to, params2);
  const whereS = w2.length ? `AND ${w2.join(' AND ')}` : '';

  const findings = await q(`
    SELECT f.stage_type AS stage, f.finding_type, f.severity, count(*)::int AS n
    FROM inspection_findings f JOIN inspection_sessions s ON s.id = f.session_id
    WHERE ${activeStage('f.stage_type')} ${whereS}
    GROUP BY 1,2,3 ORDER BY n DESC`, params2);

  // Incidence: sessions that retried a stage ÷ sessions with a captured photo at that stage.
  const retakes = await q(`
    WITH reached AS (
      SELECT a.stage_type AS stage, count(DISTINCT a.session_id)::int AS reached_users
      FROM captured_assets a JOIN inspection_sessions s ON s.id = a.session_id
      WHERE ${activeStage('a.stage_type')} ${whereS}
      GROUP BY 1
    )
    SELECT st.stage_type AS stage,
           count(*) FILTER (WHERE st.retry_count > 0)::int AS stages_retried,
           sum(st.retry_count)::int AS total_retries,
           COALESCE(max(r.reached_users), 0)::int AS reached_users
    FROM inspection_stages st JOIN inspection_sessions s ON s.id = st.session_id
    LEFT JOIN reached r ON r.stage = st.stage_type
    WHERE ${activeStage('st.stage_type')} ${whereS}
    GROUP BY 1 HAVING count(*) FILTER (WHERE st.retry_count > 0) > 0
    ORDER BY 3 DESC`, params2);
  for (const row of retakes) row.incidence_pct = metricPercent(row.stages_retried, row.reached_users);

  // Abandonment: for sessions that never completed capture, the LAST stage the
  // recording actually reached (from client stage marks); no marks → before first stage.
  const abandonment = await q(`
    WITH gone AS (
      SELECT s.id FROM inspection_sessions s
      WHERE s.status IN ('ABORTED','RECORDING') ${whereS}
        AND (s.status = 'ABORTED' OR s.updated_at < now() - interval '24 hours')
    ), last_mark AS (
      SELECT v.session_id,
             (SELECT a.e->>'stage_type' FROM jsonb_array_elements(v.stage_timestamps)
                WITH ORDINALITY AS a(e, ord)
                WHERE ${activeStage("a.e->>'stage_type'")}
                ORDER BY a.ord DESC LIMIT 1) AS stage
      FROM inspection_videos v JOIN gone g ON g.id = v.session_id
      WHERE v.stage_timestamps IS NOT NULL AND jsonb_array_length(v.stage_timestamps) > 0
    )
    SELECT COALESCE(lm.stage, 'BEFORE_FIRST_STAGE') AS stage, count(*)::int AS n
    FROM gone g LEFT JOIN last_mark lm ON lm.session_id = g.id
    GROUP BY 1 ORDER BY n DESC`, params2);

  return { dwell, findings, retakes, abandonment };
}
