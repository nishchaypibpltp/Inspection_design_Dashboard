// Case explorer + full case file.
import { q } from './db.mjs';
import { BUCKET_CASE_SQL } from './buckets.mjs';
import { activeStage, isActiveStage, ADDED_STAGES } from './stages.mjs';
import { dropOff } from './drop-off.mjs';

export async function listCases({ qtext, buckets, from, to, limit = 100, offset = 0 }) {
  const params = [];
  const w = [];
  if (from) { params.push(from); w.push(`(s.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $${params.length}`); }
  if (to)   { params.push(to);   w.push(`(s.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $${params.length}`); }
  if (qtext) {
    params.push(`%${qtext}%`);
    const p = `$${params.length}`;
    w.push(`(s.vehicle_reg ILIKE ${p} OR s.customer_id ILIKE ${p} OR s.policy_id ILIKE ${p} OR s.id::text ILIKE ${p})`);
  }
  if (buckets?.length) {
    // 'rejected' rides on the submission row, not the session status.
    const plain = buckets.filter(b => b !== 'rejected');
    const parts = [];
    if (plain.length) { params.push(plain); parts.push(`${BUCKET_CASE_SQL} = ANY($${params.length})`); }
    if (buckets.includes('rejected')) parts.push(`sub.vendor_remarks = 'REJECTED'`);
    w.push(`(${parts.join(' OR ')})`);
  }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';

  const rows = await q(`
    SELECT s.id, s.vehicle_reg, s.customer_id, s.policy_id, s.insurer_id, s.status,
           ${BUCKET_CASE_SQL} AS bucket,
           to_char(s.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI') AS created,
           to_char(s.deadline_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS deadline,
           v.upload_status AS video_status,
           (SELECT count(*)::int FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(v.stage_timestamps) = 'array' THEN v.stage_timestamps ELSE '[]'::jsonb END
            ) AS m(e) WHERE ${activeStage("m.e->>'stage_type'")}) AS stage_marks,
           (SELECT count(*)::int FROM captured_assets a
             WHERE a.session_id = s.id AND ${activeStage('a.stage_type')}) AS photos,
           (SELECT count(*)::int FROM inspection_findings f
             WHERE f.session_id = s.id AND f.severity = 'BLOCKING'
               AND ${activeStage('f.stage_type')}) AS blocking_findings,
           sub.vendor_case_id, sub.vendor_status, sub.vendor_remarks,
           s.updated_at, s.permissions_state, s.checklist_state,
           (SELECT COALESCE(json_agg(m.e->>'stage_type' ORDER BY m.ord), '[]'::json) FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(v.stage_timestamps) = 'array' THEN v.stage_timestamps ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS m(e, ord)) AS marks,
           (SELECT json_agg(json_build_object('stage_type', st.stage_type, 'condition_key', st.condition_key)
                   ORDER BY st.sequence_number)
              FROM inspection_stages st WHERE st.session_id = s.id) AS stage_flow,
           (v.id IS NOT NULL OR EXISTS (SELECT 1 FROM inspection_audit_events e
              WHERE e.session_id = s.id AND e.event_type = 'recording_started')) AS recording_started,
           EXISTS (SELECT 1 FROM inspection_audit_events e
              WHERE e.session_id = s.id AND e.event_type = 'recording_complete') AS recording_complete,
           count(*) OVER()::int AS total
    FROM inspection_sessions s
    LEFT JOIN inspection_videos v ON v.session_id = s.id
    LEFT JOIN inspection_submissions sub ON sub.session_id = s.id
    ${where}
    ORDER BY s.created_at DESC
    LIMIT ${Number(limit) || 100} OFFSET ${Number(offset) || 0}`, params);

  const total = rows[0]?.total ?? 0;
  for (const r of rows) {
    r.drop_off = dropOff({ ...r, upload_status: r.video_status, stages: r.stage_flow });
    for (const k of ['total', 'updated_at', 'permissions_state', 'checklist_state', 'marks', 'stage_flow',
      'recording_started', 'recording_complete']) delete r[k];
  }
  return { total, rows };
}

export async function caseFile(id) {
  const [session] = await q(`
    SELECT s.*, ${BUCKET_CASE_SQL} AS bucket FROM inspection_sessions s WHERE s.id = $1`, [id]);
  if (!session) return null;

  const stages = await q(`
    SELECT stage_type, sequence_number, phase, capture_mode, is_required, condition_key,
           status, retry_count, video_timestamp_ms
    FROM inspection_stages WHERE session_id = $1 AND ${activeStage('stage_type')}
    ORDER BY sequence_number`, [id]);
  for (const stage_type of ADDED_STAGES) {
    if (!stages.some(st => st.stage_type === stage_type)) {
      stages.push({ stage_type, status: 'NOT_CAPTURED', retry_count: 0 });
    }
  }

  const assets = await q(`
    SELECT id, stage_type, asset_type, capture_method, storage_key, mime_type,
           file_size_bytes, status, qc_result,
           to_char(captured_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') AS captured_at
    FROM captured_assets WHERE session_id = $1 AND ${activeStage('stage_type')}
    ORDER BY created_at`, [id]);

  const [video] = await q(`
    SELECT storage_key, upload_status, duration_sec, file_size_bytes, motion_score,
           stage_timestamps,
           to_char(created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') AS created_at
    FROM inspection_videos WHERE session_id = $1`, [id]);
  if (Array.isArray(video?.stage_timestamps)) {
    video.stage_timestamps = video.stage_timestamps.filter(m => isActiveStage(m.stage_type));
  }

  const findings = await q(`
    SELECT stage_type, finding_type, severity, source, confidence, message, status,
           to_char(created_at AT TIME ZONE 'Asia/Kolkata','HH24:MI:SS') AS at
    FROM inspection_findings WHERE session_id = $1 AND ${activeStage('stage_type')}
    ORDER BY created_at`, [id]);

  const processing = await q(`
    SELECT stage_type, processor_name, processor_version, confidence,
           to_char(created_at AT TIME ZONE 'Asia/Kolkata','HH24:MI:SS') AS at
    FROM inspection_processing_results WHERE session_id = $1 AND ${activeStage('stage_type')}
    ORDER BY created_at`, [id]);

  const events = await q(`
    SELECT event_type, from_state, to_state, actor,
           to_char(created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') AS at,
           created_at AS ts
    FROM inspection_audit_events WHERE session_id = $1 ORDER BY created_at`, [id]);

  const [submission] = await q(`
    SELECT client_submit_id, manifest_key, status, vendor_case_id, download_key,
           vendor_status, vendor_remarks,
           to_char(submitted_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') AS submitted_at
    FROM inspection_submissions WHERE session_id = $1`, [id]);

  // Timeline: session lifecycle + audit events + client stage marks, one sorted list.
  const timeline = [];
  timeline.push({ at: session.created_at, label: 'Session created', kind: 'lifecycle' });
  for (const e of events) timeline.push({ at: e.ts, label: e.event_type.replace(/_/g, ' '), kind: 'event' });
  if (video?.stage_timestamps) {
    for (const m of video.stage_timestamps) {
      timeline.push({ at: m.captured_at, label: `${m.stage_type} marked`, kind: 'stage',
                      detail: `${(m.video_timestamp_ms / 1000).toFixed(1)}s into video` });
    }
  }
  if (submission) timeline.push({ at: submission.submitted_at, label: 'Submitted to vendor', kind: 'lifecycle' });

  // Stages appended from ADDED_STAGES were never part of this session's flow.
  const drop_off = dropOff({
    ...session,
    stages: stages.filter(st => st.status !== 'NOT_CAPTURED'),
    marks: (video?.stage_timestamps || []).map(m => m.stage_type),
    upload_status: video?.upload_status,
    recording_started: !!video || events.some(e => e.event_type === 'recording_started'),
    recording_complete: events.some(e => e.event_type === 'recording_complete'),
  });
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
  const fmt = d => { try { return new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }); } catch { return String(d); } };
  timeline.forEach(t => { t.time = fmt(t.at); delete t.at; });

  events.forEach(e => delete e.ts);
  return { session, stages, assets, video, findings, processing, events, submission, timeline, drop_off };
}
