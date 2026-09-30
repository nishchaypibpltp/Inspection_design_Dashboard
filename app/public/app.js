'use strict';
const C = window.charts;
const { esc: escf } = C;
const main = document.getElementById('main');

// ---------- theme ----------
const themeBtn = document.getElementById('themeBtn');
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
themeBtn.onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
};

// ---------- bucket presentation ----------
const BUCKET_META = {
  not_started:  { label: 'Not started',   dot: 'var(--st-not-started)' },
  in_progress:  { label: 'In progress',   dot: 'var(--st-in-progress)' },
  review_ready: { label: 'Review ready',  dot: 'var(--st-review)' },
  submitted:    { label: 'Submitted',     dot: 'var(--st-submitted)' },
  failed:       { label: '⚠ Failed (technical)', dot: 'var(--critical)' },
  aborted:      { label: 'Aborted',       dot: 'var(--neutral-seg)' },
  expired:      { label: 'Expired',       dot: 'var(--serious)' },
  rejected:     { label: '✕ Vendor rejected', dot: 'var(--critical)' },
  other:        { label: 'Other',         dot: 'var(--muted)' },
};
const DAILY_SERIES = [
  { key: 'not_started',  label: 'Not started',  color: 'var(--st-not-started)' },
  { key: 'in_progress',  label: 'In progress',  color: 'var(--st-in-progress)' },
  { key: 'review_ready', label: 'Review ready', color: 'var(--st-review)' },
  { key: 'submitted',    label: 'Submitted',    color: 'var(--st-submitted)' },
  { key: 'aborted',      label: 'Aborted',      color: 'var(--neutral-seg)' },
  { key: 'failed',       label: '⚠ Failed (technical)', color: 'var(--critical)' },
];
// ---------- stage presentation ----------
const STAGE_LABELS = {
  RC_DOCUMENT: 'RC Document',
  WINDSHIELD_INSIDE: 'Windshield Inside',
  INTERIOR_DASHBOARD: 'Odometer',
  CHASSIS_NUMBER: 'Chassis Number',
  ENGINE_BAY: 'Engine Bay',
  FRONT_VIEW: 'Front View',
  RIGHT_SIDE: 'Right Side',
  REAR_VIEW: 'Rear View (Back)',
  LEFT_SIDE: 'Left Side',
  DICKY_BOOT: 'Open Boot',
  BI_FUEL_TANK: 'Open Boot with Cylinder',
  UNDER_FRONT: 'Under the Front',
  GAS_KIT_NUMBER: 'Gas Kit Number',
  NOT_RELEVANT: 'Not Relevant',
  BEFORE_FIRST_STAGE: 'Before first stage',
};
function stageLabel(code) {
  if (!code) return code;
  return STAGE_LABELS[code] || code.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
// Replaces stage codes embedded in free text, e.g. "required stage FRONT_VIEW".
const STAGE_CODE_RE = new RegExp(`\\b(${Object.keys(STAGE_LABELS).join('|')})\\b`, 'g');
function stageText(text) { return text ? text.replace(STAGE_CODE_RE, stageLabel) : text; }

// ---------- drop-off presentation ----------
// [stopped, still active within 24h]
const DROP_OFF_PLACE = {
  permissions:      ['Dropped at permissions screen', 'On permissions screen'],
  before_recording: ['Dropped before recording started', 'Ready, not recording yet'],
  stage:            [s => `Dropped at ${s} photo`, s => `Now at ${s} photo`],
  stage_unknown:    ['Dropped during recording (no stage marked)', 'Recording (no stage marked yet)'],
  after_last_stage: ['Dropped after the last photo, before finishing', 'Finishing the recording'],
  upload:           ['Dropped during upload', 'Uploading the video'],
  processing:       ['Stuck in processing after upload', 'Processing the upload'],
  after_recording:  ['Stopped after the recording finished', 'Stopped after the recording finished'],
};
const DROP_OFF_OUTCOME = {
  completed: 'Completed',
  upload_failed: 'Upload failed',
  extraction_failed: 'Photo extraction failed',
  submission_failed: 'Sending to the vendor failed',
};
const DROP_OFF_HOW = { cancelled: 'cancelled by the user', expired: 'link expired', inactive: 'no activity for over 24h' };
function dropOffText(d) {
  if (!d) return '—';
  if (DROP_OFF_OUTCOME[d.kind]) return DROP_OFF_OUTCOME[d.kind];
  const t = DROP_OFF_PLACE[d.kind][d.how === 'active' ? 1 : 0];
  const text = typeof t === 'function' ? t(stageLabel(d.stage)) : t;
  return d.kind === 'permissions' && d.missing.length < 3 ? `${text} · ${d.missing.join(', ')} not granted` : text;
}
function dropOffTone(d) {
  if (!d) return '';
  if (d.kind === 'completed') return 'done';
  if (d.kind.endsWith('_failed')) return 'failed';
  return d.how === 'active' ? 'active' : 'dropped';
}

function chip(bucket, extraText) {
  const m = BUCKET_META[bucket] || BUCKET_META.other;
  return `<span class="status-chip"><span class="dot" style="background:${m.dot}"></span>${escf(extraText || m.label)}</span>`;
}

// ---------- filters ----------
const state = { preset: 'all', from: null, to: null, q: '', buckets: new Set(), offset: 0 };
function istToday(deltaDays = 0) {
  const d = new Date(Date.now() + (5.5 * 3600e3) + deltaDays * 86400e3);
  return d.toISOString().slice(0, 10);
}
function applyPreset(p) {
  state.preset = p; state.offset = 0;
  if (p === 'all') { state.from = null; state.to = null; }
  if (p === 'today') { state.from = istToday(); state.to = istToday(); }
  if (p === '7d') { state.from = istToday(-6); state.to = istToday(); }
  if (p === '30d') { state.from = istToday(-29); state.to = istToday(); }
}
function filterRow(mount, { withStatus, withSearch, onChange }) {
  const div = document.createElement('div');
  div.className = 'filters';
  const presets = [['all', 'All time'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']];
  div.innerHTML =
    presets.map(([k, l]) => `<button class="preset ${state.preset === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('') +
    `<input type="date" id="fFrom" value="${state.from || ''}" title="from"> <input type="date" id="fTo" value="${state.to || ''}" title="to">` +
    (withSearch ? `<input type="search" id="fQ" placeholder="Search VRN / customer / policy / session id" value="${escf(state.q)}">` : '') +
    (withStatus ? Object.entries(BUCKET_META).filter(([k]) => k !== 'other')
      .map(([k, m]) => `<button class="chip ${state.buckets.has(k) ? 'on' : ''}" data-b="${k}">${m.label}</button>`).join('') : '');
  mount.appendChild(div);
  div.querySelectorAll('.preset').forEach(b => b.onclick = () => { applyPreset(b.dataset.p); onChange(); });
  div.querySelector('#fFrom').onchange = e => { state.preset = 'custom'; state.from = e.target.value || null; state.offset = 0; onChange(); };
  div.querySelector('#fTo').onchange = e => { state.preset = 'custom'; state.to = e.target.value || null; state.offset = 0; onChange(); };
  if (withSearch) {
    let t;
    div.querySelector('#fQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); state.offset = 0; onChange(); }, 300); };
  }
  if (withStatus) div.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const k = b.dataset.b;
    state.buckets.has(k) ? state.buckets.delete(k) : state.buckets.add(k);
    state.offset = 0; onChange();
  });
}
function qs() {
  const p = new URLSearchParams();
  if (state.from) p.set('from', state.from);
  if (state.to) p.set('to', state.to);
  return p;
}
async function api(path, params) {
  const u = params && [...params.keys()].length ? `${path}?${params}` : path;
  const r = await fetch(u);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ---------- metric definitions (numbered as in the Dashboard Metrics Master Reference) ----------
const METRIC_INFO = {
  1: { name: 'Technical failures alert', status: 'Live',
    what: 'Product breakages that stop a user regardless of intent. This is the rollback trigger and must be zero.',
    formula: 'sessions with status EXTRACTION_FAILED or SUBMISSION_FAILED + videos with upload_status = FAILED',
    source: 'inspection_sessions.status, inspection_videos.upload_status',
    read: 'Every failure is listed so the case can be opened directly.',
    caveat: 'Uploads stalled for more than 24h never reach FAILED, so they are not counted here. See Stalled uploads on the Funnel analysis tab.' },
  2: { name: 'Sessions created', status: 'Live',
    what: 'Inspection sessions created in the selected IST date range.',
    formula: 'count(inspection_sessions)', source: 'inspection_sessions.created_at',
    read: 'The volume baseline and the denominator for every downstream rate.' },
  3: { name: 'Started recording', status: 'Live',
    what: 'Users who got past setup and permissions into the actual inspection.',
    formula: 'distinct session_id with event_type = recording_started', source: 'inspection_audit_events',
    read: 'Compare with Sessions created to see how many users are lost before recording.' },
  4: { name: 'Captures completed', status: 'Live',
    what: 'Output volume of finished inspections.',
    formula: 'sessions with status REVIEW_READY or SUBMITTED', source: 'inspection_sessions.status',
    read: 'A completed capture may still carry blocking QC findings. Clean completions are on the Funnel analysis tab.' },
  5: { name: 'Completion rate', status: 'Live',
    what: 'Whether users who begin capturing manage to finish.',
    formula: 'captures completed ÷ started recording', source: 'inspection_sessions + inspection_audit_events',
    read: 'Low values point to friction inside the recording itself, not at setup.' },
  6: { name: 'Finished on day one', status: 'Live',
    what: 'Whether users finish immediately or need the 72-hour window and reminders.',
    formula: 'completed sessions where IST date(last_active_at) = date(created_at) ÷ completed sessions',
    source: 'inspection_sessions', read: 'PM baseline is about half.',
    caveat: 'Uses last_active_at, which is set before recording starts. It should use the recording_complete time.' },
  7: { name: 'Retakes', status: 'Live',
    what: 'A rough signal of how often the AI/QC asked users to capture again.',
    formula: 'photos with capture_method = RETAKE · stages with retry_count > 0',
    source: 'captured_assets, inspection_stages', read: 'See Retakes by stage for where the retakes happen.' },
  8: { name: 'Submitted to WIMWIsure', status: 'Live',
    what: 'Confirms completed inspections actually reach the insurer\'s vendor.',
    formula: 'count(inspection_submissions)', source: 'inspection_submissions',
    read: 'Should track Captures completed once Mode-B is live.' },
  9: { name: 'Daily inspection sessions', status: 'Live',
    what: 'Daily volume and what happened to each day\'s cohort.',
    formula: 'sessions per IST created day, split by pipeline state', source: 'inspection_sessions',
    read: 'Hover a column for the split by state.',
    caveat: 'Recordings with no activity for over 24h still show as "In progress" here, while Where journeys were abandoned counts them as abandoned.' },
  10: { name: 'Time spent per stage (median)', status: 'Live',
    what: 'Stages that take users the most effort.',
    formula: 'median and p90 of (stage mark − previous stage mark); first mark excluded',
    source: 'inspection_videos.stage_timestamps', read: 'Hover a bar for the p90 and the number of recordings.' },
  11: { name: 'Retakes by stage · retake incidence (#23)', status: 'Live',
    what: 'Where guidance or QC may be failing, and whether it affects many users or a few.',
    formula: 'bar = sum(retry_count) per stage · (%) = users with retry_count > 0 ÷ users with a captured photo at that stage',
    source: 'inspection_stages + captured_assets',
    read: 'A high count with a low percentage means a few users retried many times. A high percentage means the stage is hard for most users.',
    caveat: 'Bars are ranked by total retries, not by the share of users who retried.' },
  12: { name: 'Where journeys were abandoned', status: 'Live',
    what: 'Intended to locate the stage at which users give up.',
    formula: 'sessions ABORTED, or RECORDING with no update for 24h, grouped by last stage mark. No mark = before first stage.',
    source: 'inspection_sessions + inspection_videos.stage_timestamps', read: 'The longest bar is the stage where most users gave up.',
    caveat: 'Abandoned sessions emit no stage marks, so this currently always shows one bar ("Before first stage").' },
  13: { name: 'QC findings by type', status: 'Live',
    what: 'What the AI/QC pipeline complains about most.',
    formula: 'count(inspection_findings) grouped by finding_type (Blocking and Warning)', source: 'inspection_findings',
    read: 'Blocking findings stop the case; warnings ask for a retake.',
    caveat: 'Merges all stages. The per-stage breakdown is on the Funnel analysis tab (AI/QC reasons by stage).' },
  14: { name: 'Case explorer', status: 'Live',
    what: 'Moves from an aggregate number to the exact cases behind it.',
    formula: 'one row per session: status, stage marks, photos, video status, blocking findings, vendor fields, deadline',
    source: 'inspection_sessions and related tables', read: 'Click a row for the full case file.' },
  16: { name: 'Phase 2 metrics', status: 'Planned',
    what: 'Reserved for vendor quality, location compliance, traffic control and a screen-level funnel.',
    formula: 'Vendor QC rejections (Mode-B callbacks) · GPS compliance (GPS build) · traffic share (control plane) · home → submission funnel (event spine)',
    source: 'Not instrumented yet', read: 'No numbers are shown until the data exists.' },
  17: { name: 'Test-data share', status: 'Live',
    what: 'Stops internal test runs from being read as customer behaviour.',
    formula: 'sessions matching the test signature (vehicle_reg MH12AB1234 or test customer_id prefixes) ÷ sessions',
    source: 'inspection_sessions', read: 'When this is high, treat every panel as a formula and UI check, not a benchmark.' },
  18: { name: 'Clean completions', status: 'Live',
    what: 'Inspections whose evidence can actually proceed.',
    formula: 'completed sessions with no BLOCKING row in inspection_findings', source: 'inspection_sessions + inspection_findings',
    read: 'Compare with total completions to see how many users finish but still need intervention.' },
  19: { name: 'Inspection journey (#19 permission grant · #20 step conversion · #21 cumulative reach)', status: 'Live',
    what: 'The whole journey from session creation to vendor approval, with every recording stage in capture order.',
    formula: '% of created = users at step ÷ sessions created · % from previous = users at step ÷ users at the previous step · permission = camera, microphone and location all granted',
    source: 'inspection_sessions, inspection_audit_events, inspection_videos.stage_timestamps, inspection_findings, inspection_submissions',
    read: 'The highlighted row is the biggest customer drop-off. Bi-fuel stages only apply to some vehicles, so they show % of eligible sessions and are left out of the step-to-step chain. Delivery steps wait on review and the vendor, so they are not customer drop-offs.',
    caveat: 'A stage counts as reached when the video has a mark for it. Videos without marks (see Stage-mark coverage) make recording stages look lower than they are.' },
  22: { name: 'Behaviour by platform', status: 'Live',
    what: 'OS or device-specific breakage hidden inside averages.',
    formula: 'permission, start, completion and clean rates ÷ sessions, grouped by platform parsed from device_metadata.ua',
    source: 'inspection_sessions.device_metadata', read: 'Compare rows; a platform far below the others points to a compatibility defect.',
    caveat: 'Rates on small groups (n < 30) are unreliable.' },
  24: { name: 'AI/QC rejection rate by stage', status: 'Live',
    what: 'Ranks the documents and views that are hardest for the AI pipeline.',
    formula: '(WARNING + FAILED photos) ÷ all photos, per stage', source: 'captured_assets.qc_status',
    read: 'Warning: blocked view or blurry, retake requested. Failed: text not readable.' },
  25: { name: 'AI/QC reasons by stage', status: 'Live',
    what: 'Tells which team should act: OCR/extraction versus capture conditions.',
    formula: 'findings grouped by stage and reason, excluding Missing photo', source: 'inspection_findings',
    read: 'Darker cells have more findings. Blocking "Text not readable" points to extraction; warning "Blocked view" or "Blurry" points to capture conditions or guidance.' },
  26: { name: 'Observable stage time', status: 'Live',
    what: 'Effort per stage among successful users, and the baseline for comparing exiters later.',
    formula: 'median and p90 gap between consecutive stage marks, successful marked journeys only',
    source: 'inspection_videos.stage_timestamps', read: 'Hover a bar for the p90 and the number of observations.' },
  27: { name: 'Confirmed technical-exit rate', status: 'Live',
    what: 'Separates product failure from users choosing to leave.',
    formula: 'started sessions with EXTRACTION_FAILED, SUBMISSION_FAILED or a FAILED video upload ÷ started sessions',
    source: 'inspection_sessions + inspection_videos', read: 'Strict measure: only terminal failures count.' },
  28: { name: 'Stalled upload rate', status: 'Live',
    what: 'Failures that never reach a FAILED state.',
    formula: 'started sessions with a video upload IN_PROGRESS and no update for 24h ÷ started sessions',
    source: 'inspection_videos', read: 'Treat as technical-associated until an error or heartbeat confirms the cause.' },
  29: { name: 'Stage-mark coverage', status: 'Live',
    what: 'Whether stage-level metrics can be trusted.',
    formula: 'videos with at least one stage_timestamps mark ÷ all videos', source: 'inspection_videos.stage_timestamps',
    read: 'Low coverage biases stage reach, stage time and exit location.' },
  30: { name: 'Telemetry health', status: 'Live',
    what: 'Why stage-exit metrics cannot yet be computed from real data.',
    formula: 'share of inspection_stages rows still PENDING · abandoned or stalled sessions with stage marks ÷ abandoned or stalled sessions',
    source: 'inspection_stages, inspection_videos', read: 'Until these improve, the exit metrics below use synthetic values.' },
  31: { name: 'Stage exit rate', status: 'Demo',
    what: 'Names the stage where users are lost instead of one overall abandonment total.',
    formula: 'users starting stage n but not completing it ÷ users starting stage n',
    source: 'Synthetic. Needs stage_started and stage_completed events.', read: 'Rank stages by rate, then use time and message panels to diagnose why.' },
  32: { name: 'Exiters vs completers time', status: 'Demo',
    what: 'Whether users leave immediately or spend much longer trying than successful users.',
    formula: 'median(stage end or exit − stage start), split by outcome',
    source: 'Synthetic. Needs stage lifecycle events with an exit timestamp.',
    read: 'Very short exits suggest confusion or loading failure; long exits suggest users stuck trying.' },
  33: { name: 'Exit reason mix', status: 'Demo',
    what: 'Assigns an owner to each exit: engineering, product/design, AI/QC or the contact strategy.',
    formula: 'exits assigned to reason r ÷ all classified exits',
    source: 'Synthetic. Needs technical error events and fixed agent disposition codes.', read: 'The largest share names the team that should act first.' },
  34: { name: 'Last QC message before exit', status: 'Demo',
    what: 'Instructions that users cannot act on.',
    formula: 'users exiting after message m ÷ users shown message m',
    source: 'Synthetic. Needs a guidance_message_shown event with message_id and version.',
    read: 'A high exit rate after one message means the wording, the requested action or the AI rule needs investigation.' },
  35: { name: 'Call-centre recovery funnel', status: 'Demo',
    what: 'Where recovery breaks: coverage, reachability, persuasion, stage recovery or capture quality.',
    formula: 'eligible exits → attempted → connected → resumed → exit stage recovered → clean completion',
    source: 'Synthetic. Needs contact and session_resumed events.', read: 'The largest step-down shows which part of recovery fails.' },
  36: { name: 'Call-centre diagnostics (#36–#42)', status: 'Demo',
    what: 'Whether contact is timely, reaches users, changes behaviour and produces incremental recovery.',
    formula: 'each rate uses distinct eligible or connected users; all times use the median',
    source: 'Synthetic. Needs contact_attempted, contact_connected, session_resumed and holdout events.',
    read: 'Read coverage and connect rate first, then resume and recovery, re-exit, and uplift against an uncontacted holdout.' },
};

const FINDING_LABELS = { OBSTRUCTED: 'Blocked view', BLURRY: 'Blurry', NOT_READABLE: 'Text not readable', MISSING_STAGE: 'Missing photo' };
const SEVERITY_LABELS = { BLOCKING: 'Blocking', WARNING: 'Warning' };
function findingLabel(code) { return FINDING_LABELS[code] || stageLabel(code); }
function severityBadge(sev) { return `<span class="sev sev-${escf(String(sev).toLowerCase())}">${escf(SEVERITY_LABELS[sev] || sev)}</span>`; }

// Hover/focus ⓘ. ref = sheet number from METRIC_INFO or an inline definition object.
function metricExplainer(card, ref) {
  const m = typeof ref === 'number' ? { n: ref, ...METRIC_INFO[ref] } : ref;
  const wrap = document.createElement('span');
  wrap.className = 'metric-info';
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', `About ${m.name || 'this metric'}`);
  if (card.querySelector(':scope > .tablebtn')) wrap.style.right = '68px';
  const row = (label, text, tag = 'span') => text ? `<div><b>${label}</b><${tag}>${escf(text)}</${tag}></div>` : '';
  wrap.innerHTML = `<span class="metric-info-btn" aria-hidden="true">i</span>
    <div class="metric-info-popover" role="tooltip">
      ${m.name ? `<div class="mi-head">${m.n ? `<span class="mi-num">#${m.n}</span>` : ''}<strong>${escf(m.name)}</strong>${m.status ? `<span class="mi-status mi-${m.status.toLowerCase()}">${m.status}</span>` : ''}</div>` : ''}
      ${row('What it shows', m.what)}${row('Formula', m.formula, 'code')}${row('How to read it', m.read)}${row('Source', m.source)}
      ${m.caveat ? `<div class="mi-caveat"><b>Known limitation</b><span>${escf(m.caveat)}</span></div>` : ''}
    </div>`;
  const place = () => {
    wrap.classList.remove('align-left');
    if (wrap.querySelector('.metric-info-popover').getBoundingClientRect().left < 8) wrap.classList.add('align-left');
  };
  wrap.addEventListener('mouseenter', place);
  wrap.addEventListener('focus', place);
  card.appendChild(wrap);
}

function scopeLine(mount, sessions) {
  const range = state.from || state.to ? `${state.from || '…'} to ${state.to || 'today'}` : 'All time';
  const div = document.createElement('div');
  div.className = 'scope';
  div.innerHTML = `Showing <b>${escf(range)}</b> · <b>${Number(sessions).toLocaleString()}</b> sessions · IST dates`;
  mount.appendChild(div);
}

function pct(v) { return v == null ? '—' : `${Number(v).toFixed(1).replace('.0', '')}%`; }

// ---------- overview ----------
async function viewOverview() {
  main.innerHTML = '';
  filterRow(main, { withStatus: false, withSearch: false, onChange: viewOverview });
  const body = document.createElement('div');
  main.appendChild(body);
  body.className = 'loading';
  let s, days, sm;
  try {
    [s, days, sm] = await Promise.all([api('/api/summary', qs()), api('/api/daily', qs()), api('/api/stage-metrics', qs())]);
  } catch (e) { body.className = ''; body.innerHTML = `<div class="empty">Failed to load: ${escf(e.message)}</div>`; return; }
  body.className = '';
  scopeLine(body, s.sessions);

  // Alert — technical failures are a rollback trigger, not a metric to trend.
  const al = document.createElement('div');
  al.className = 'alert' + (s.failures.length ? '' : ' ok');
  al.innerHTML = s.failures.length
    ? `<span class="icon">⚠</span><div><b>${s.failures.length} technical failure${s.failures.length > 1 ? 's' : ''}</b> — rollback trigger, must be zero.
       <ul>${s.failures.slice(0, 8).map(f => `<li>${escf(f.kind)} · ${escf(f.vehicle_reg)} · ${escf(f.customer_id)} · ${escf(f.at)} — <a href="#case/${f.id}">open case</a></li>`).join('')}
       ${s.failures.length > 8 ? `<li>… ${s.failures.length - 8} more (filter “Failed” in the explorer)</li>` : ''}</ul></div>`
    : `<span class="icon">✓</span><div><b>Zero technical failures</b> in this window — failed submissions, lost uploads, crashes.</div>`;
  body.appendChild(al);
  metricExplainer(al, 1);

  const startedPct = s.started_recording ? Math.round(100 * s.captures_completed / s.started_recording) : null;
  const day1Pct = s.captures_completed ? Math.round(100 * s.completed_day1 / s.captures_completed) : null;
  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  const tileDefs = [
    [2, 'Sessions created', s.sessions, 'in this window'],
    [3, 'Started recording', s.started_recording, s.sessions ? `${pct(100 * s.started_recording / s.sessions)} of created` : ''],
    [4, 'Captures completed', s.captures_completed, 'review-ready or later'],
    [5, 'Completion rate', startedPct === null ? '—' : startedPct + '%', 'of those who started'],
    [6, 'Finished on day one', day1Pct === null ? '—' : day1Pct + '%', 'of completed captures'],
    [7, 'Retakes', `${s.retake_photos}`, `retake photos · ${s.stages_retried} stages retried`],
    [8, 'Submitted to WIMWIsure', s.submissions, s.submissions ? 'sent to the vendor' : 'none yet · Mode-B not live'],
  ];
  tiles.innerHTML = tileDefs.map(([, l, v, n]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="note">${n}</div></div>`).join('');
  body.appendChild(tiles);
  [...tiles.children].forEach((tile, i) => metricExplainer(tile, tileDefs[i][0]));

  // daily stacked
  const byDay = {};
  for (const r of days) { (byDay[r.day] ??= {}); byDay[r.day][r.bucket] = r.n; }
  // Continuous calendar (empty days kept), capped at the 30 most recent days of the range.
  const dayKeys = Object.keys(byDay).sort();
  const dayRows = [];
  if (dayKeys.length) {
    const last = new Date(`${dayKeys[dayKeys.length - 1]}T00:00:00Z`);
    const first = new Date(Math.max(new Date(`${dayKeys[0]}T00:00:00Z`), last - 29 * 86400e3));
    for (let t = first; t <= last; t = new Date(t.getTime() + 86400e3)) {
      const day = t.toISOString().slice(0, 10);
      dayRows.push({ day, segs: byDay[day] || {} });
    }
  }
  if (dayRows.length) metricExplainer(C.stackedBars(body, {
    title: 'Daily inspection sessions',
    sub: `per IST day, by pipeline state · ${dayRows.length > 10 ? `last ${dayRows.length} days · scroll left for earlier days` : `${dayRows.length} days`}`,
    days: dayRows, series: DAILY_SERIES, visibleDays: 10,
  }), 9);

  const byValue = (a, b) => b.value - a.value;
  const g = document.createElement('div'); g.className = 'grid2'; body.appendChild(g);
  if (sm.dwell.length) metricExplainer(C.hbars(g, {
    title: 'Time spent per stage (median)', sub: `seconds · ${sm.dwell[0]?.n ?? 0} recordings with stage marks`,
    rows: sm.dwell.map(r => ({ label: stageLabel(r.stage), value: r.median_s, note: `p90 ${r.p90_s}s · n=${r.n}` })).sort(byValue), unit: 's',
  }), 10);
  if (sm.retakes.length) {
    const retakeCard = C.hbars(g, {
      title: 'Retakes by stage', sub: 'retry presses · (%) of users at the stage who retried',
      rows: sm.retakes.map(r => ({
        label: stageLabel(r.stage),
        value: r.total_retries,
        extra: r.incidence_pct == null ? '' : pct(r.incidence_pct),
        note: `${r.stages_retried} of ${r.reached_users} users with a photo at this stage retried`,
      })).sort(byValue),
    });
    metricExplainer(retakeCard, 11);
  }
  if (sm.abandonment.length) metricExplainer(C.hbars(g, {
    title: 'Where journeys were abandoned', sub: 'aborted or stalled >24h · last stage reached',
    rows: sm.abandonment.map(r => ({ label: stageLabel(r.stage), value: r.n })).sort(byValue),
  }), 12);
  const fAgg = {};
  for (const f of sm.findings) fAgg[f.finding_type] = (fAgg[f.finding_type] || 0) + f.n;
  const fRows = Object.entries(fAgg).map(([code, value]) => ({ label: findingLabel(code), value })).sort(byValue);
  if (fRows.length) metricExplainer(C.hbars(g, {
    title: 'QC findings by type', sub: 'all stages · blocking and warning',
    rows: fRows,
  }), 13);

  // Phase-2 placeholders — honest pending states, never fake numbers.
  const p2 = document.createElement('div');
  p2.className = 'card placeholder';
  p2.innerHTML = `<h3>Coming next<span class="badge-p2">PHASE 2</span></h3><div class="sub">no numbers until the data exists</div>
    <ul class="coming">${[
      ['Vendor QC rejections and reasons', 'Mode-B callbacks'],
      ['GPS compliance', 'GPS build'],
      ['Traffic share to WIMWIsure', 'control plane'],
      ['Home → submission event funnel', 'event spine'],
    ].map(([t, needs]) => `<li><b>${escf(t)}</b><span>needs ${escf(needs)}</span></li>`).join('')}</ul>`;
  body.appendChild(p2);
  metricExplainer(p2, 16);
}

const DEMO_FUNNEL_METRICS = Object.freeze({
  stageExits: [
    { stage: 'RC_DOCUMENT', started: 100, completed: 78 },
    { stage: 'CHASSIS_NUMBER', started: 78, completed: 60 },
    { stage: 'FRONT_VIEW', started: 60, completed: 51 },
    { stage: 'RIGHT_SIDE', started: 51, completed: 45 },
    { stage: 'REAR_VIEW', started: 45, completed: 39 },
  ],
  stageTime: [
    { stage: 'RC_DOCUMENT', completer_s: 42, exiter_s: 118 },
    { stage: 'CHASSIS_NUMBER', completer_s: 55, exiter_s: 164 },
    { stage: 'FRONT_VIEW', completer_s: 24, exiter_s: 31 },
    { stage: 'RIGHT_SIDE', completer_s: 29, exiter_s: 74 },
  ],
  exitReasons: [
    ['Repeated AI rejection', 31, 'AI/QC'],
    ['Confusing instructions', 24, 'Product / design'],
    ['Technical error', 19, 'Engineering'],
    ['Other or unclassified', 26, 'Contact strategy'],
  ],
  lastMessages: [
    ['Text not readable', 'CHASSIS_NUMBER', 44, 27.3],
    ['Move closer and avoid glare', 'RC_DOCUMENT', 36, 19.4],
    ['Clear the frame and retake', 'RIGHT_SIDE', 25, 16.0],
  ],
  contactFunnel: [
    ['Eligible exits', 100],
    ['Contact attempted', 82],
    ['Connected', 55],
    ['Session resumed', 38],
    ['Exit stage recovered', 27],
    ['Clean completion', 19],
  ],
  contactDiagnostics: [
    ['Contact coverage', '82%', 'contacted ÷ eligible exits'],
    ['Median exit → first attempt', '34 min', 'first attempt − exit time'],
    ['Call connect rate', '67.1%', 'connected ÷ attempted'],
    ['Median call → resume', '18 min', 'session resume − connected call'],
    ['Post-contact session time', '22 min', 'median resume → finish or re-exit'],
    ['Re-exit after contact', '28.9%', 'resumed users exiting again ÷ resumed'],
    ['Assisted conversion uplift', '+14 pp', 'with-call conversion − holdout conversion'],
  ],
});

// ---------- funnel analysis ----------
async function viewFunnelAnalysis() {
  main.innerHTML = '';
  filterRow(main, { withStatus: false, withSearch: false, onChange: viewFunnelAnalysis });
  const body = document.createElement('div');
  main.appendChild(body);
  body.className = 'loading';

  let d;
  try { d = await api('/api/product-metrics', qs()); }
  catch (e) {
    body.className = '';
    body.innerHTML = `<div class="empty">Failed to load: ${escf(e.message)}</div>`;
    return;
  }
  body.className = '';
  scopeLine(body, d.journey.created);

  const intro = document.createElement('div');
  intro.className = 'metric-banner warning';
  intro.innerHTML = `<b>Test-data workspace</b>
    <span>${d.journey.test_like.toLocaleString()} of ${d.journey.created.toLocaleString()} sessions match the test-data signature.
    These panels validate the formulas and UI; they are not production customer benchmarks.</span>`;
  body.appendChild(intro);
  metricExplainer(intro, 17);

  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  const tileDefs = [
    [18, 'Clean completions', d.journey.clean_completed, `of ${d.journey.completed} completed`],
    [27, 'Confirmed technical exits', pct(d.technical.confirmed_exit_pct), `${d.technical.confirmed_exits_started} of ${d.technical.started} started`],
    [28, 'Stalled uploads', pct(d.technical.stalled_upload_pct), `${d.technical.stalled_uploads_started} stuck >24h`],
    [29, 'Stage-mark coverage', pct(d.data_quality.stage_mark_coverage_pct), `${d.data_quality.videos_with_marks} of ${d.data_quality.videos} videos`],
  ];
  tiles.innerHTML = tileDefs.map(([, l, v, n]) => `<div class="tile"><div class="label">${escf(l)}</div><div class="value">${escf(v)}</div><div class="note">${escf(n)}</div></div>`).join('');
  body.appendChild(tiles);
  [...tiles.children].forEach((tile, i) => metricExplainer(tile, tileDefs[i][0]));

  const title1 = document.createElement('div');
  title1.className = 'section-title';
  title1.innerHTML = '<h2>Inspection journey</h2><p>Every step from session creation to vendor approval, recording stages in capture order.</p>';
  body.appendChild(title1);
  journeyCard(body, d.journey);
  platformCard(body, d.platforms);

  const title2 = document.createElement('div');
  title2.className = 'section-title';
  title2.innerHTML = '<h2>Capture and AI diagnostics</h2><p>Which stages the AI/QC pipeline rejects most, and why. Retake rates and time per stage are on the Overview.</p>';
  body.appendChild(title2);

  if (d.qc_by_stage.length) {
    const qcCard = C.hbars(body, {
      title: 'AI/QC rejection rate by stage',
      sub: 'warning + failed photos ÷ all photos',
      rows: d.qc_by_stage.map(r => ({
        label: stageLabel(r.stage),
        value: r.rejection_pct ?? 0,
        note: r.assets ? `${r.warning} warning + ${r.failed} failed / ${r.assets} photos · ${r.users} users` : 'no photos yet',
      })).sort((a, b) => b.value - a.value),
      unit: '%',
    });
    metricExplainer(qcCard, 24);
  }

  reasonHeatmap(body, d.qc_reasons);

  const quality = document.createElement('div');
  quality.className = 'metric-banner';
  quality.innerHTML = `<b>Telemetry health</b><span>
    ${pct(d.data_quality.stage_mark_coverage_pct)} of videos have stage marks;
    ${pct(d.data_quality.pending_stage_pct)} of stage rows are still PENDING;
    ${d.data_quality.abandoned_or_recording_with_marks} of ${d.data_quality.abandoned_or_recording}
    abandoned or recording sessions have marks. The metrics below therefore use clearly marked synthetic demonstration values.
  </span>`;
  body.appendChild(quality);
  metricExplainer(quality, 30);

  const demoTitle = document.createElement('div');
  demoTitle.className = 'section-title';
  demoTitle.innerHTML = `<h2>Exit and call-centre prototype <span class="badge-demo">SYNTHETIC DEMO</span></h2>
    <p>Hard-coded values for UI development only. They do not come from PostgreSQL and must be replaced when instrumentation lands.</p>`;
  body.appendChild(demoTitle);

  const demoGrid = document.createElement('div');
  demoGrid.className = 'grid2';
  body.appendChild(demoGrid);

  const stageExitCard = C.hbars(demoGrid, {
    title: 'Stage exit rate · demo',
    sub: 'share of users who started a stage and left there',
    rows: DEMO_FUNNEL_METRICS.stageExits.map(r => ({
      label: stageLabel(r.stage),
      value: Math.round((1000 * (r.started - r.completed)) / r.started) / 10,
      note: `${r.started - r.completed}/${r.started} users exited`,
    })).sort((a, b) => b.value - a.value),
    unit: '%',
  });
  stageExitCard.classList.add('demo-card');
  metricExplainer(stageExitCard, 31);

  const timeCard = document.createElement('div');
  timeCard.className = 'card demo-card';
  timeCard.innerHTML = `<h3>Exiters vs completers time · demo</h3>
    <div class="sub">median seconds spent in each stage</div>
    <div class="table-scroll"><table class="data"><thead><tr>
      <th>Stage</th><th>Completed</th><th>Exited</th><th>Difference</th>
    </tr></thead><tbody>${DEMO_FUNNEL_METRICS.stageTime.map(r => `<tr>
      <td>${escf(stageLabel(r.stage))}</td><td>${r.completer_s}s</td><td>${r.exiter_s}s</td>
      <td>+${r.exiter_s - r.completer_s}s</td>
    </tr>`).join('')}</tbody></table></div>`;
  demoGrid.appendChild(timeCard);
  metricExplainer(timeCard, 32);

  const reasonMixCard = C.hbars(demoGrid, {
    title: 'Exit reason mix · demo',
    sub: 'share of classified exits · note shows the owning team',
    rows: DEMO_FUNNEL_METRICS.exitReasons.map(([label, value, owner]) => ({ label, value, note: `owner: ${owner}` })),
    unit: '%',
  });
  reasonMixCard.classList.add('demo-card');
  metricExplainer(reasonMixCard, 33);

  const messageCard = document.createElement('div');
  messageCard.className = 'card demo-card';
  messageCard.innerHTML = `<h3>Last QC message before exit · demo</h3>
    <div class="sub">which instruction immediately preceded an exit</div>
    <div class="table-scroll"><table class="data"><thead><tr>
      <th>Message</th><th>Stage</th><th>Shown</th><th>Exit rate</th>
    </tr></thead><tbody>${DEMO_FUNNEL_METRICS.lastMessages.map(([message, stage, shown, rate]) => `<tr>
      <td>${escf(message)}</td><td>${escf(stageLabel(stage))}</td><td>${shown}</td><td>${pct(rate)}</td>
    </tr>`).join('')}</tbody></table></div>`;
  demoGrid.appendChild(messageCard);
  metricExplainer(messageCard, 34);

  const contactFunnelCard = C.hbars(body, {
    title: 'Call-centre recovery funnel · demo',
    sub: 'count and conversion through each contact outcome',
    rows: DEMO_FUNNEL_METRICS.contactFunnel.map(([label, users], i, rows) => ({
      label,
      value: users,
      note: i ? `${pct((100 * users) / rows[i - 1][1])} from previous` : 'starting contact pool',
    })),
  });
  contactFunnelCard.classList.add('demo-card');
  metricExplainer(contactFunnelCard, 35);

  const contactCard = document.createElement('div');
  contactCard.className = 'card demo-card';
  contactCard.innerHTML = `<h3>Call-centre diagnostics · demo</h3>
    <div class="sub">operational and incremental recovery measures</div>
    <div class="demo-stat-grid">${DEMO_FUNNEL_METRICS.contactDiagnostics.map(([label, value, formula]) => `
      <div><span>${escf(label)}</span><b>${escf(value)}</b><small>${escf(formula)}</small></div>`).join('')}</div>`;
  body.appendChild(contactCard);
  metricExplainer(contactCard, 36);
}

// ---------- journey, platform and reason panels ----------
const CONDITION_LABELS = { BI_FUEL_ONLY: 'bi-fuel only', HAS_PREVIOUS_POLICY: 'previous policy only' };
function journeyCard(mount, j) {
  const steps = j.steps || [];
  const worst = steps.find(s => s.biggest_drop);
  const last = [...steps].reverse().find(s => !s.conditional && s.users > 0) || steps[0];
  const card = document.createElement('div');
  card.className = 'card journey';
  const phases = [...new Set(steps.map(s => s.phase))];
  const row = s => {
    const label = s.stage ? stageLabel(s.stage) : s.label;
    if (s.conditional) {
      return `<div class="jrow cond">
        <div class="jlabel">${escf(label)}<span class="jtag">${escf(CONDITION_LABELS[s.condition_key] || 'conditional')}</span></div>
        <div class="jbar"><span style="width:${s.pct_of_eligible ?? 0}%"></span></div>
        <div class="jnum">${s.users.toLocaleString()}</div>
        <div class="jpct">${pct(s.pct_of_eligible)}<small>of ${s.eligible} eligible</small></div>
        <div class="jpct muted">—</div><div class="jdrop muted">—</div></div>`;
    }
    const dropPct = s.drop_users && s.users + s.drop_users ? pct(100 * s.drop_users / (s.users + s.drop_users)) : '';
    return `<div class="jrow${s.biggest_drop ? ' worst' : ''}">
      <div class="jlabel">${escf(label)}${s.biggest_drop ? '<span class="jtag worst">biggest drop-off</span>' : ''}
        ${s.clean != null ? `<small>${s.clean.toLocaleString()} clean (${pct(s.clean_pct)}) · no blocking QC finding</small>` : ''}</div>
      <div class="jbar"><span style="width:${s.pct_of_created ?? 0}%"></span></div>
      <div class="jnum">${s.users.toLocaleString()}</div>
      <div class="jpct">${pct(s.pct_of_created)}</div>
      <div class="jpct">${s.key === 'created' ? '—' : pct(s.pct_from_previous)}</div>
      <div class="jdrop">${s.drop_users > 0 ? `−${s.drop_users.toLocaleString()} <small>(${dropPct})</small>` : '—'}</div></div>`;
  };
  card.innerHTML = `<h3>Where users drop out of the journey</h3>
    <div class="sub">Of <b>${(j.created || 0).toLocaleString()}</b> sessions created, <b>${pct(steps.find(s => s.key === 'recording_complete')?.pct_of_created)}</b> finished recording and
      <b>${pct(last?.pct_of_created)}</b> reached “${escf(last?.label || '')}”.${worst ? ` Biggest customer drop-off: <b>${escf(worst.stage ? stageLabel(worst.stage) : worst.label)}</b> (−${worst.drop_users} users).` : ''}</div>
    <div class="jgrid">
      <div class="jrow jhead"><div>Step</div><div></div><div>Users</div><div>% of created</div><div>% from previous</div><div>Drop</div></div>
      ${phases.map(p => `<div class="jphase">${escf(p)}${p === 'Delivery' ? '<small>waits on review and the vendor · not a customer drop-off</small>' : ''}</div>
        ${steps.filter(s => s.phase === p).map(row).join('')}`).join('')}
    </div>`;
  mount.appendChild(card);
  metricExplainer(card, 19);
}

function platformCard(mount, platforms) {
  if (!platforms?.length) return;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h3>Behaviour by platform</h3><div class="sub">rates ÷ sessions created on each platform</div>
    <div class="table-scroll"><table class="data"><thead><tr>
      <th>Platform</th><th>Sessions</th><th>Permissions granted</th><th>Started recording</th><th>Completed</th><th>Clean</th>
    </tr></thead><tbody>${platforms.map(p => `<tr>
      <td><b>${escf(p.platform)}</b>${p.sessions < 30 ? '<span class="sample-warning">small sample</span>' : ''}</td>
      <td>${p.sessions.toLocaleString()}</td><td>${pct(p.permission_pct)}</td><td>${pct(p.started_pct)}</td>
      <td>${pct(p.completed_pct)}</td><td>${pct(p.clean_pct)}</td>
    </tr>`).join('')}</tbody></table></div>`;
  mount.appendChild(card);
  metricExplainer(card, 22);
}

function reasonHeatmap(mount, reasons) {
  const card = document.createElement('div');
  card.className = 'card';
  const cols = [...new Map(reasons.map(r => [`${r.reason}|${r.severity}`, r])).values()]
    .sort((a, b) => (a.severity === 'BLOCKING' ? -1 : 1) - (b.severity === 'BLOCKING' ? -1 : 1) || a.reason.localeCompare(b.reason));
  const stageTotals = {};
  for (const r of reasons) stageTotals[r.stage] = (stageTotals[r.stage] || 0) + r.findings;
  const stages = Object.keys(stageTotals).sort((a, b) => stageTotals[b] - stageTotals[a]);
  const cell = (stage, c) => reasons.find(r => r.stage === stage && r.reason === c.reason && r.severity === c.severity);
  const max = Math.max(1, ...reasons.map(r => r.findings));
  card.innerHTML = `<h3>AI/QC reasons by stage</h3><div class="sub">findings per stage and reason · Missing photo excluded</div>
    ${reasons.length ? `<div class="table-scroll"><table class="data heat"><thead><tr><th>Stage</th>
      ${cols.map(c => `<th>${escf(findingLabel(c.reason))} ${severityBadge(c.severity)}</th>`).join('')}<th>Total</th>
    </tr></thead><tbody>${stages.map(st => `<tr><td>${escf(stageLabel(st))}</td>
      ${cols.map(c => {
        const r = cell(st, c);
        const a = 0.12 + 0.78 * r?.findings / max;
        return r ? `<td class="hc${a > 0.55 ? ' hi' : ''}" style="--a:${a.toFixed(2)}" title="${r.users} users">${r.findings}</td>` : '<td class="hc empty-cell">·</td>';
      }).join('')}<td><b>${stageTotals[st]}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No QC findings in this window.</div>'}`;
  mount.appendChild(card);
  metricExplainer(card, 25);
}

// ---------- case explorer ----------
async function viewCases() {
  main.innerHTML = '';
  filterRow(main, { withStatus: true, withSearch: true, onChange: viewCases });
  const body = document.createElement('div');
  main.appendChild(body); body.className = 'loading';
  const p = qs();
  if (state.q) p.set('q', state.q);
  if (state.buckets.size) p.set('status', [...state.buckets].join(','));
  p.set('limit', '50'); p.set('offset', String(state.offset));
  let d;
  try { d = await api('/api/cases', p); }
  catch (e) { body.className = ''; body.innerHTML = `<div class="empty">Failed to load: ${escf(e.message)}</div>`; return; }
  body.className = '';
  if (!d.rows.length) { body.innerHTML = '<div class="card"><div class="empty">No cases match these filters.</div></div>'; return; }

  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = `<h3>Cases</h3><div class="sub">${d.total.toLocaleString()} matching · newest first · click a row for the full case file</div>
  <div style="overflow-x:auto"><table class="data"><thead><tr>
    <th>Created</th><th>VRN</th><th>Customer</th><th>Insurer</th><th>Status</th><th>Drop-off</th>
    <th>Stages marked</th><th>Photos</th><th>Video</th><th>Blocking findings</th>
    <th>Vendor case</th><th>Vendor verdict</th><th>Deadline</th>
  </tr></thead><tbody>${d.rows.map(r => `
    <tr class="rowlink" data-id="${r.id}">
      <td>${escf(r.created)}</td><td>${escf(r.vehicle_reg)}</td>
      <td title="${escf(r.customer_id)}">${escf(r.customer_id.length > 22 ? r.customer_id.slice(0, 21) + '…' : r.customer_id)}</td>
      <td>${escf(r.insurer_id)}</td><td>${chip(r.bucket)}</td>
      <td class="dropoff-cell tone-${dropOffTone(r.drop_off)}" title="${escf(DROP_OFF_HOW[r.drop_off?.how] || '')}">${escf(dropOffText(r.drop_off))}</td>
      <td>${r.stage_marks}</td><td>${r.photos}</td>
      <td>${escf(r.video_status || '—')}</td>
      <td>${r.blocking_findings || ''}</td>
      <td>${r.vendor_case_id ? escf(String(r.vendor_case_id)) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${r.vendor_remarks ? chip(r.vendor_remarks === 'REJECTED' ? 'rejected' : 'submitted', r.vendor_remarks) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${escf(r.deadline || '—')}</td>
    </tr>`).join('')}</tbody></table></div>
  <div class="pager">
    <button id="pPrev" ${state.offset === 0 ? 'disabled' : ''}>‹ Prev</button>
    <span>${state.offset + 1}–${Math.min(state.offset + 50, d.total)} of ${d.total.toLocaleString()}</span>
    <button id="pNext" ${state.offset + 50 >= d.total ? 'disabled' : ''}>Next ›</button>
  </div>`;
  body.appendChild(card);
  metricExplainer(card, 14);
  card.querySelectorAll('tr.rowlink').forEach(tr => tr.onclick = () => { location.hash = `#case/${tr.dataset.id}`; });
  card.querySelector('#pPrev').onclick = () => { state.offset = Math.max(0, state.offset - 50); viewCases(); };
  card.querySelector('#pNext').onclick = () => { state.offset += 50; viewCases(); };
}

// ---------- case file ----------
async function viewCase(id) {
  main.innerHTML = '<div class="empty">Loading case…</div>';
  let d;
  try { d = await api(`/api/case/${id}`); }
  catch (e) { main.innerHTML = `<div class="empty">Failed: ${escf(e.message)}</div>`; return; }
  const s = d.session;
  const assetsByStage = {};
  for (const a of d.assets) (assetsByStage[a.stage_type] ??= []).push(a);
  const hasMedia = d.assets.some(a => a.storage_key) || d.video?.storage_key;

  main.innerHTML = `
  <div style="margin-bottom:10px"><a href="#cases" style="color:var(--muted);text-decoration:none">← Case explorer</a></div>
  <div class="casehead">
    <h2>${escf(s.vehicle_reg)}</h2>
    ${chip(s.bucket)}
    <span class="kv">customer <b>${escf(s.customer_id)}</b></span>
    <span class="kv">insurer <b>${escf(s.insurer_id)}</b></span>
    <span class="kv">policy <b>${escf(s.policy_id)}</b></span>
  </div>
  <div class="kv" style="margin-bottom:14px">session <b>${escf(s.id)}</b> · created <b>${new Date(s.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</b> · deadline <b>${s.deadline_at ? new Date(s.deadline_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</b>
    &nbsp; <a class="dlbtn" ${hasMedia ? `href="/api/case/${s.id}/evidence.zip"` : 'aria-disabled="true"'} download>⬇ Evidence bundle (photos + video ZIP)</a>
  </div>
  <div class="dropoff tone-${dropOffTone(d.drop_off)}"><span class="label">Drop-off</span><b>${escf(dropOffText(d.drop_off))}</b>${
    DROP_OFF_HOW[d.drop_off?.how] ? `<span class="how">${escf(DROP_OFF_HOW[d.drop_off.how])} · last activity ${new Date(s.updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>` : ''}</div>
  <div class="grid2">
    <div class="card"><h3>Recorded video</h3><div class="sub">${d.video ? escf(`${d.video.upload_status} · ${d.video.stage_timestamps?.length ?? 0} stage marks`) : 'no video row'}</div>
      ${d.video?.storage_key ? `<video controls preload="metadata" src="/api/media?key=${encodeURIComponent(d.video.storage_key)}"></video>` : '<div class="empty">no video stored</div>'}
    </div>
    <div class="card"><h3>Timeline</h3><div class="sub">session events + client stage marks, IST</div>
      <ul class="timeline" style="max-height:420px;overflow-y:auto">${d.timeline.map(t =>
        `<li><span class="t">${escf(t.time)}</span><span class="k-${escf(t.kind)}">${escf(stageText(t.label))}</span>${t.detail ? `<span class="detail">${escf(t.detail)}</span>` : ''}</li>`).join('')}
      </ul>
    </div>
  </div>
  <div class="card"><h3>Stages</h3><div class="sub">${d.stages.length} configured · photo shown where one is stored</div>
    <div class="stagegrid">${d.stages.map(st => {
      const assets = assetsByStage[st.stage_type] || [];
      const a = assets[assets.length - 1];
      const conf = a?.qc_result?.confidence;
      const stoppedHere = d.drop_off?.kind === 'stage' && d.drop_off.stage === st.stage_type;
      return `<div class="stagecard${stoppedHere ? ` stopped tone-${dropOffTone(d.drop_off)}` : ''}">
        ${a?.storage_key ? `<img loading="lazy" src="/api/media?key=${encodeURIComponent(a.storage_key)}" alt="${escf(stageLabel(st.stage_type))}">`
          : `<div class="noimg">no photo</div>`}
        <div class="meta"><b>${escf(stageLabel(st.stage_type))}</b>
          ${escf(st.status)}${st.retry_count ? ` · ${st.retry_count} retr${st.retry_count > 1 ? 'ies' : 'y'}` : ''}
          ${conf != null ? ` · conf ${Number(conf).toFixed(2)}` : ''}
          ${a?.capture_method === 'RETAKE' ? ' · retake' : ''}
          ${stoppedHere ? `<span class="stopped-tag">${d.drop_off.how === 'active' ? 'user is here now' : 'user stopped here'}</span>` : ''}
        </div></div>`;
    }).join('')}</div>
  </div>
  ${d.findings.length ? `<div class="card"><h3>QC findings</h3><div class="sub">our QC worker</div>
    <table class="data"><thead><tr><th>Time</th><th>Stage</th><th>Finding</th><th>Severity</th><th>Message</th></tr></thead>
    <tbody>${d.findings.map(f => `<tr><td>${escf(f.at)}</td><td>${escf(stageLabel(f.stage_type))}</td><td>${escf(findingLabel(f.finding_type))}</td><td>${severityBadge(f.severity)}</td><td>${escf(stageText(f.message || ''))}</td></tr>`).join('')}</tbody></table></div>` : ''}
  <div class="card placeholder"><h3>Vendor verdict<span class="badge-p2">PHASE 2</span></h3>
    <div class="sub">WIMWIsure case id, QC status, per-photo rejection reasons — populated from Mode-B callbacks once submissions go live</div>
    ${d.submission ? `<div class="kv">vendor case <b>${escf(String(d.submission.vendor_case_id ?? '—'))}</b> · status <b>${escf(d.submission.vendor_status ?? '—')}</b> · remarks <b>${escf(d.submission.vendor_remarks ?? '—')}</b></div>` : '<div class="empty">not submitted yet</div>'}
  </div>`;
}

// ---------- router ----------
function route() {
  const h = location.hash || '#overview';
  document.querySelectorAll('nav a').forEach(a =>
    a.classList.toggle('active', h.startsWith('#' + a.dataset.nav) || (h.startsWith('#case/') && a.dataset.nav === 'cases')));
  const m = h.match(/^#case\/([0-9a-f-]{36})$/);
  if (m) return viewCase(m[1]);
  if (h.startsWith('#metrics')) { location.replace('#funnel'); return; }
  if (h.startsWith('#funnel')) return viewFunnelAnalysis();
  if (h.startsWith('#cases')) return viewCases();
  return viewOverview();
}
addEventListener('hashchange', route);
route();
