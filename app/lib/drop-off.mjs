// Where a journey stopped, derived from what a session already records: status,
// permissions, recording events, client stage marks and video upload state.
// A stage mark is written when that stage is captured, so a user who stopped
// mid-recording was on the first applicable stage after their last mark.
import { isActiveStage } from './stages.mjs';

// Same inactivity rule as the Overview abandonment chart.
const STALE_MS = 24 * 3600e3;
const PERMISSIONS = ['camera', 'microphone', 'location'];
// A conditional stage counts only when the checklist confirms it applies.
const CONDITIONS = { BI_FUEL_ONLY: checklist => checklist?.is_bi_fuel === true };

// kind: completed | permissions | before_recording | stage | stage_unknown | after_last_stage
//       | upload | processing | after_recording | upload_failed | extraction_failed | submission_failed
// how:  active (still within 24h) | inactive | cancelled | expired — only for journeys that stopped
export function dropOff(s, now = Date.now()) {
  if (s.status === 'REVIEW_READY' || s.status === 'SUBMITTED') return { kind: 'completed' };
  if (s.status === 'EXTRACTION_FAILED') return { kind: 'extraction_failed' };
  if (s.status === 'SUBMISSION_FAILED') return { kind: 'submission_failed' };
  if (s.upload_status === 'FAILED') return { kind: 'upload_failed' };

  const how = s.status === 'ABORTED' ? 'cancelled'
    : s.status === 'EXPIRED' ? 'expired'
    : now - new Date(s.updated_at).getTime() > STALE_MS ? 'inactive' : 'active';

  if (s.recording_complete) {
    if (s.upload_status !== 'COMPLETE') return { kind: 'upload', how };
    return { kind: s.status === 'RECORDING' ? 'processing' : 'after_recording', how };
  }
  if (!s.recording_started) {
    const missing = PERMISSIONS.filter(p => s.permissions_state?.[`${p}_granted`] !== true);
    return missing.length ? { kind: 'permissions', how, missing } : { kind: 'before_recording', how };
  }

  const marked = new Set((s.marks || []).filter(isActiveStage));
  if (!marked.size) return { kind: 'stage_unknown', how };
  const flow = (s.stages || []).filter(st => isActiveStage(st.stage_type));
  let last = -1;
  flow.forEach((st, i) => { if (marked.has(st.stage_type)) last = i; });
  const next = flow.slice(last + 1).find(st =>
    !marked.has(st.stage_type) && (!st.condition_key || CONDITIONS[st.condition_key]?.(s.checklist_state)));
  return next ? { kind: 'stage', how, stage: next.stage_type } : { kind: 'after_last_stage', how };
}
