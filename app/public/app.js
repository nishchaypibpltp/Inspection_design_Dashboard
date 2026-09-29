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
  not_started:  { label: 'Not started',   dot: 'var(--muted)' },
  in_progress:  { label: 'In progress',   dot: 'var(--ord-2)' },
  review_ready: { label: 'Review ready',  dot: 'var(--ord-3)' },
  submitted:    { label: 'Submitted',     dot: 'var(--ord-4)' },
  failed:       { label: '⚠ Failed (technical)', dot: 'var(--critical)' },
  aborted:      { label: 'Aborted',       dot: 'var(--neutral-seg)' },
  expired:      { label: 'Expired',       dot: 'var(--serious)' },
  rejected:     { label: '✕ Vendor rejected', dot: 'var(--critical)' },
  other:        { label: 'Other',         dot: 'var(--muted)' },
};
const DAILY_SERIES = [
  { key: 'not_started',  label: 'Not started',  color: 'var(--ord-1)' },
  { key: 'in_progress',  label: 'In progress',  color: 'var(--ord-2)' },
  { key: 'review_ready', label: 'Review ready', color: 'var(--ord-3)' },
  { key: 'submitted',    label: 'Submitted',    color: 'var(--ord-4)' },
  { key: 'aborted',      label: 'Aborted',      color: 'var(--neutral-seg)' },
  { key: 'failed',       label: '⚠ Failed (technical)', color: 'var(--critical)' },
];
// ---------- stage presentation ----------
const STAGE_LABELS = {
  RC_DOCUMENT: 'RC Document',
  WINDSHIELD_INSIDE: 'Windshield Inside',
  INTERIOR_DASHBOARD: 'Odometer',
  VRN: 'VIN',
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

function metricExplainer(card, { formula, source, why, how }) {
  const details = document.createElement('details');
  details.className = 'metric-info';
  details.style.right = card.querySelector('.tablebtn') ? '68px' : '16px';
  details.innerHTML = `<summary aria-label="About this metric" title="About this metric">i</summary>
    <div class="metric-info-popover">
    <div><b>Formula</b><code>${escf(formula)}</code></div>
    <div><b>Why</b><span>${escf(why)}</span></div>
    <div><b>How to read it</b><span>${escf(how)}</span></div>
    <div><b>Source</b><span>${escf(source)}</span></div>
    </div>`;
  card.appendChild(details);
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

  // Alert — technical failures are a rollback trigger, not a metric to trend.
  const al = document.createElement('div');
  al.className = 'alert' + (s.failures.length ? '' : ' ok');
  al.innerHTML = s.failures.length
    ? `<span class="icon">⚠</span><div><b>${s.failures.length} technical failure${s.failures.length > 1 ? 's' : ''}</b> — rollback trigger, must be zero.
       <ul>${s.failures.slice(0, 8).map(f => `<li>${escf(f.kind)} · ${escf(f.vehicle_reg)} · ${escf(f.customer_id)} · ${escf(f.at)} — <a href="#case/${f.id}">open case</a></li>`).join('')}
       ${s.failures.length > 8 ? `<li>… ${s.failures.length - 8} more (filter “Failed” in the explorer)</li>` : ''}</ul></div>`
    : `<span class="icon">✓</span><div><b>Zero technical failures</b> in this window — failed submissions, lost uploads, crashes.</div>`;
  body.appendChild(al);

  const startedPct = s.started_recording ? Math.round(100 * s.captures_completed / s.started_recording) : null;
  const day1Pct = s.captures_completed ? Math.round(100 * s.completed_day1 / s.captures_completed) : null;
  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  tiles.innerHTML = [
    ['Sessions created', s.sessions, ''],
    ['Started recording', s.started_recording, 'distinct sessions with a recording_started event'],
    ['Captures completed', s.captures_completed, 'reached review-ready or later'],
    ['Completion rate', startedPct === null ? '—' : startedPct + '%', 'completed ÷ started recording'],
    ['Finished on day one', day1Pct === null ? '—' : day1Pct + '%', 'of completed captures (PM baseline ≈ half)'],
    ['Retakes', `${s.retake_photos}`, `${s.stages_retried} stage retries · retake photos stored`],
    ['Submitted to WIMWIsure', s.submissions, s.submissions ? '' : 'none yet — Mode-B not live'],
  ].map(([l, v, n]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="note">${n}</div></div>`).join('');
  body.appendChild(tiles);

  // daily stacked
  const byDay = {};
  for (const r of days) { (byDay[r.day] ??= {}); byDay[r.day][r.bucket] = r.n; }
  const dayRows = Object.entries(byDay).map(([day, segs]) => ({ day, segs }));
  if (dayRows.length) C.stackedBars(body, {
    title: 'Daily inspection sessions', sub: 'per IST day, by pipeline state · hover a column for the split',
    days: dayRows, series: DAILY_SERIES,
  });

  const g = document.createElement('div'); g.className = 'grid2'; body.appendChild(g);
  if (sm.dwell.length) C.hbars(g, {
    title: 'Time spent per stage (median)', sub: `gap between consecutive stage marks · n=${sm.dwell[0]?.n ?? 0} recordings with marks · first stage excluded (no arrival anchor)`,
    rows: sm.dwell.map(r => ({ label: stageLabel(r.stage), value: r.median_s, note: `p90 ${r.p90_s}s · n=${r.n}` })), unit: 's',
  });
  if (sm.retakes.length) {
    const retakeCard = C.hbars(g, {
      title: 'Retakes by stage', sub: 'total retry presses per stage · (%) = share of users at that stage who retried',
      rows: sm.retakes.map(r => ({
        label: stageLabel(r.stage),
        value: r.total_retries,
        extra: r.incidence_pct == null ? '' : pct(r.incidence_pct),
        note: `${r.stages_retried} of ${r.reached_users} users with a photo at this stage retried`,
      })),
    });
    metricExplainer(retakeCard, {
      formula: 'bar = sum(retry_count) · (%) = users with retry_count > 0 ÷ users with a captured photo at that stage',
      source: 'inspection_stages + captured_assets',
      why: 'The count shows where retry effort goes; the percentage shows whether that effort is spread across many users or comes from a few.',
      how: 'A high count with a low percentage means a few users retried many times; a high percentage means the stage is hard for most users.',
    });
  }
  if (sm.abandonment.length) C.hbars(g, {
    title: 'Where journeys were abandoned', sub: 'aborted or stalled >24h · last stage the recording reached',
    rows: sm.abandonment.map(r => ({ label: stageLabel(r.stage), value: r.n })),
  });
  const fAgg = {};
  for (const f of sm.findings) fAgg[f.finding_type] = (fAgg[f.finding_type] || 0) + f.n;
  const fRows = Object.entries(fAgg).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (fRows.length) C.hbars(g, {
    title: 'QC findings by type', sub: 'our own QC worker · blocking + warning',
    rows: fRows,
  });

  // Phase-2 placeholders — honest pending states, never fake numbers.
  const p2 = document.createElement('div'); p2.className = 'grid2'; body.appendChild(p2);
  for (const [t, sub] of [
    ['Vendor QC rejections & reasons', 'arrives with Mode-B callbacks (PhotosOnHold per photo) — persistence lands in Phase 2'],
    ['GPS compliance', 'photos with / without a location fix — instrumentation landing with the GPS build'],
    ['Traffic share to WIMWIsure', 'dial + kill switch + audit trail — control plane, Phase 2'],
    ['Home → submission event funnel', 'per-screen events not instrumented yet — the Phase-2 event spine'],
  ]) {
    const c = document.createElement('div');
    c.className = 'card placeholder';
    c.innerHTML = `<h3>${escf(t)}<span class="badge-p2">PHASE 2</span></h3><div class="sub">${escf(sub)}</div><div class="empty">instrumentation pending</div>`;
    p2.appendChild(c);
  }
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

  const intro = document.createElement('div');
  intro.className = 'metric-banner warning';
  intro.innerHTML = `<b>Test-data workspace</b>
    <span>${d.journey.test_like.toLocaleString()} of ${d.journey.created.toLocaleString()} sessions match the test-data signature.
    These panels validate the formulas and UI; they are not production customer benchmarks.</span>`;
  body.appendChild(intro);

  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  tiles.innerHTML = [
    ['Clean completions', d.journey.clean_completed, `${d.journey.completed} completed · no blocking QC finding`],
    ['Confirmed technical exits', pct(d.technical.confirmed_exit_pct), `${d.technical.confirmed_exits_started} of ${d.technical.started} started sessions`],
    ['Stalled uploads', pct(d.technical.stalled_upload_pct), `${d.technical.stalled_uploads_started} uploads in progress >24h`],
    ['Stage-mark coverage', pct(d.data_quality.stage_mark_coverage_pct), `${d.data_quality.videos_with_marks} of ${d.data_quality.videos} videos`],
  ].map(([l, v, n]) => `<div class="tile"><div class="label">${escf(l)}</div><div class="value">${escf(v)}</div><div class="note">${escf(n)}</div></div>`).join('');
  body.appendChild(tiles);
  const tileInfo = [
    {
      formula: 'completed sessions with no BLOCKING finding',
      source: 'inspection_sessions + inspection_findings',
      why: 'A completed journey is only useful if its evidence can proceed.',
      how: 'Compare clean with total completion to see how many users finish but still require intervention.',
    },
    {
      ...d.definitions.confirmed_technical_exit,
      why: 'Separates product failure from a user deciding to leave.',
      how: 'Counts only terminal extraction, submission, or upload failures.',
    },
    {
      ...d.definitions.stalled_upload,
      why: 'Finds uploads that never transition to FAILED but are no longer progressing.',
      how: 'Treat as technical-associated until an error or heartbeat confirms the cause.',
    },
    {
      formula: 'videos containing at least one stage mark ÷ all videos',
      source: 'inspection_videos.stage_timestamps',
      why: 'Shows whether stage-level funnel metrics have enough telemetry.',
      how: 'Low coverage means stage conversion and exit location would be biased.',
    },
  ];
  [...tiles.children].forEach((tile, i) => metricExplainer(tile, tileInfo[i]));

  const title1 = document.createElement('div');
  title1.className = 'section-title';
  title1.innerHTML = '<h2>Journey funnel</h2><p>Counts are calculated from source rows on every request; no aggregate counter is stored.</p>';
  body.appendChild(title1);

  const funnelCard = C.hbars(body, {
    title: 'Inspection reach',
    sub: 'users at each milestone · note shows conversion from the preceding milestone',
    rows: d.journey.funnel.map(r => ({
      label: r.label,
      value: r.users,
      note: `${pct(r.conversion_from_previous_pct)} from previous · ${pct(r.cumulative_reach_pct)} of created`,
    })),
  });
  metricExplainer(funnelCard, {
    formula: 'users reaching milestone n ÷ users reaching milestone n−1',
    source: 'inspection_sessions + inspection_audit_events + inspection_findings',
    why: 'Shows the exact transition where the journey loses the largest number of users.',
    how: 'Permission is a separate step, and clean completion prevents a blocked case from being counted as a successful output.',
  });

  const title2 = document.createElement('div');
  title2.className = 'section-title';
  title2.innerHTML = '<h2>Capture and AI diagnostics</h2><p>Which stages the AI/QC pipeline rejects most, and why. Retake rates are on the Overview.</p>';
  body.appendChild(title2);

  if (d.qc_by_stage.length) {
    const qcCard = C.hbars(body, {
      title: 'AI/QC rejection rate by stage',
      sub: 'Warning ("Something appears to be blocking the view") + Failed ("The text in this image is not clear enough to read") ÷ all photos',
      rows: d.qc_by_stage.map(r => ({
        label: stageLabel(r.stage),
        value: r.rejection_pct ?? 0,
        note: r.assets ? `${r.warning} warning + ${r.failed} failed / ${r.assets} photos · ${r.users} users` : 'no photos yet',
      })),
      unit: '%',
    });
    metricExplainer(qcCard, {
      ...d.definitions.qc_rejection,
      why: 'Ranks the documents and views that are hardest for the current QC pipeline.',
      how: 'Warning: "Something appears to be blocking the view. Clear the frame and retake." or "The image is blurry. Hold the camera steady and retake." Failed: "The text in this image is not clear enough to read. Please retake."',
    });
  }

  const reasonCard = document.createElement('div');
  reasonCard.className = 'card';
  reasonCard.innerHTML = `<h3>AI/QC reasons by stage</h3>
    <div class="sub">MISSING_STAGE excluded here so capture-quality reasons remain visible</div>
    <div class="table-scroll"><table class="data"><thead><tr>
      <th>Stage</th><th>Reason</th><th>Severity</th><th>Findings</th><th>Users</th>
    </tr></thead><tbody>${d.qc_reasons.map(r => `<tr>
      <td>${escf(stageLabel(r.stage))}</td><td>${escf(r.reason)}</td><td>${escf(r.severity)}</td>
      <td>${r.findings}</td><td>${r.users}</td>
    </tr>`).join('')}</tbody></table></div>`;
  body.appendChild(reasonCard);
  metricExplainer(reasonCard, {
    formula: 'findings grouped by stage, reason and severity',
    source: 'inspection_findings',
    why: 'A rejection rate alone says a stage is hard; the reason says which team should investigate it.',
    how: 'BLOCKING OCR reasons point to extraction; WARNING obstruction or blur reasons point to capture conditions or guidance.',
  });

  if (d.stage_timing.length) {
    const timingCard = C.hbars(body, {
      title: 'Time spent per observable stage',
      sub: 'median gap between consecutive marks · successful marked journeys only',
      rows: d.stage_timing.map(r => ({
        label: stageLabel(r.stage),
        value: r.median_s,
        note: `p90 ${r.p90_s}s · n=${r.observations}`,
      })),
      unit: 's',
    });
    metricExplainer(timingCard, {
      formula: 'median(current stage mark − preceding stage mark)',
      source: 'inspection_videos.stage_timestamps',
      why: 'Long stages can indicate extra effort, but time becomes diagnostic only when exiters and completers can be compared.',
      how: 'This snapshot only contains marks for successful journeys, so the panel is labelled observable rather than claiming exit behaviour.',
    });
  }

  const title3 = document.createElement('div');
  title3.className = 'section-title';
  title3.innerHTML = '<h2>Technical exits</h2><p>Confirmed failures are kept separate from inferred failures.</p>';
  body.appendChild(title3);

  const technicalGrid = document.createElement('div');
  technicalGrid.className = 'grid2';
  technicalGrid.innerHTML = `
    <div class="card"><h3>Confirmed technical exits</h3>
      <div class="metric-big">${pct(d.technical.confirmed_exit_pct)}</div>
      <div class="sub">${d.technical.confirmed_exits_started} started sessions ended in extraction, submission, or upload failure</div>
    </div>
    <div class="card"><h3>Stalled upload rate</h3>
      <div class="metric-big">${pct(d.technical.stalled_upload_pct)}</div>
      <div class="sub">${d.technical.stalled_uploads_started} started sessions have an upload in progress for more than 24 hours</div>
    </div>`;
  body.appendChild(technicalGrid);
  const [confirmedCard, stalledCard] = technicalGrid.children;
  metricExplainer(confirmedCard, {
    ...d.definitions.confirmed_technical_exit,
    why: 'Separates product failure from a user choosing to stop.',
    how: 'This strict measure includes terminal extraction, submission, or upload failure only.',
  });
  metricExplainer(stalledCard, {
    ...d.definitions.stalled_upload,
    why: 'Finds uploads that never move to a terminal FAILED state.',
    how: 'Treat these as technical-associated until a client error or heartbeat proves the cause.',
  });

  const quality = document.createElement('div');
  quality.className = 'metric-banner';
  quality.innerHTML = `<b>Telemetry health</b><span>
    ${pct(d.data_quality.stage_mark_coverage_pct)} of videos have stage marks;
    ${pct(d.data_quality.pending_stage_pct)} of stage rows are still PENDING;
    ${d.data_quality.abandoned_or_recording_with_marks} of ${d.data_quality.abandoned_or_recording}
    abandoned or recording sessions have marks. The metrics below therefore use clearly marked synthetic demonstration values.
  </span>`;
  body.appendChild(quality);

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
    sub: 'users starting a stage but not completing it ÷ users starting it',
    rows: DEMO_FUNNEL_METRICS.stageExits.map(r => ({
      label: stageLabel(r.stage),
      value: Math.round((1000 * (r.started - r.completed)) / r.started) / 10,
      note: `${r.started - r.completed}/${r.started} users exited`,
    })),
    unit: '%',
  });
  stageExitCard.classList.add('demo-card');
  metricExplainer(stageExitCard, {
    formula: 'users starting stage n but not completing it ÷ users starting stage n',
    source: 'Synthetic demo; future stage_started + stage_completed events',
    why: 'Names the stage where users are lost instead of reporting one overall abandonment total.',
    how: 'Rank the stages by rate, then use time, reason and message panels to diagnose why the highest stage loses users.',
  });

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
  metricExplainer(timeCard, {
    formula: 'median(stage end or exit − stage start), split by outcome',
    source: 'Synthetic demo; future stage lifecycle events',
    why: 'Shows whether users leave immediately or spend much longer trying than successful users.',
    how: 'Very short exits suggest confusion or loading failure; long exits suggest repeated effort and a blocker.',
  });

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
  metricExplainer(messageCard, {
    formula: 'users exiting after message m ÷ users shown message m',
    source: 'Synthetic demo; future guidance_message_shown event',
    why: 'The final instruction is a strong clue about what the user could not resolve.',
    how: 'A high exit rate after one message indicates wording, requested action, or the underlying AI rule needs investigation.',
  });

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
  metricExplainer(contactFunnelCard, {
    formula: 'eligible → attempted → connected → resumed → stage recovered → clean completion',
    source: 'Synthetic demo; future contact and session-resume events',
    why: 'Prevents a connected call or reopened app from being counted as final success.',
    how: 'The largest step-down shows whether the problem is coverage, connection, persuasion, stage recovery, or capture quality.',
  });

  const contactCard = document.createElement('div');
  contactCard.className = 'card demo-card';
  contactCard.innerHTML = `<h3>Call-centre diagnostics · demo</h3>
    <div class="sub">operational and incremental recovery measures</div>
    <div class="demo-stat-grid">${DEMO_FUNNEL_METRICS.contactDiagnostics.map(([label, value, formula]) => `
      <div><span>${escf(label)}</span><b>${escf(value)}</b><small>${escf(formula)}</small></div>`).join('')}</div>`;
  body.appendChild(contactCard);
  metricExplainer(contactCard, {
    formula: 'each rate uses distinct eligible or connected users; all times use the median',
    source: 'Synthetic demo; future contact_attempt, contact_connected, session_resumed and holdout events',
    why: 'Shows whether contact is timely, reaches users, changes behaviour, and produces incremental recovery.',
    how: 'Read coverage and connect rate first, then resume/recovery, re-exit and uplift against an uncontacted holdout.',
  });
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
    <tbody>${d.findings.map(f => `<tr><td>${escf(f.at)}</td><td>${escf(stageLabel(f.stage_type))}</td><td>${escf(f.finding_type)}</td><td>${escf(f.severity)}</td><td>${escf(stageText(f.message || ''))}</td></tr>`).join('')}</tbody></table></div>` : ''}
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
