// Dummy data for UI work. Every case that has no captured photos is rebuilt as a
// complete, internally consistent journey so that each chart, stage, status
// bucket, vendor verdict and case-file panel has something to render. Cases that
// already carry real captures are left untouched.
//
//   node seed-demo.mjs          seed (re-runnable; replaces the previous seed)
//   node seed-demo.mjs --reset  drop the database and reload the ../data snapshot
//
// Seeded sessions carry client_request_id = 'demo-seed-<session id>'.
// Dates are relative to the moment the seed runs (last 30 days, IST daytime).
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.resolve(HERE, '..', 'data', '01-vehicle_inspection.sql');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/vehicle_inspection';
const PG_BIN = process.env.PG_BIN || 'C:\\insp-pg-bin\\pgsql\\bin';
const MARK = 'demo-seed-';

// ---------- deterministic randomness ----------
let state = 20260925;
function rnd() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + rnd() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const chance = p => rnd() < p;
const round = (v, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;
function normal() {
  const u = 1 - rnd(), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- time ----------
const NOW = Date.now();
const S = 1e3, MIN = 60e3, H = 3600e3;
const IST = 5.5 * H;
const iso = t => new Date(Math.round(t)).toISOString();
const istHour = t => { const d = new Date(t + IST); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const HOURS_SINCE_NINE_IST = istHour(NOW) - 9;

// Creation time between minAgeH and maxAgeH hours ago, during IST working hours,
// biased towards recent days.
function pickCreated(minAgeH, maxAgeH) {
  for (let i = 0; i < 500; i++) {
    const t = NOW - (minAgeH + Math.pow(rnd(), 1.25) * (maxAgeH - minAgeH)) * H;
    const h = istHour(t);
    if (h >= 9 && h <= 21.5) return t;
  }
  return NOW - minAgeH * H;
}

// ---------- capture flow (current stage set, in capture order) ----------
// kind: 'text' → OCR stage (can fail as NOT_READABLE); 'plate'/'view' → photo stage (warnings only).
const STAGES = [
  { code: 'RC_DOCUMENT',        phase: 'A', required: true,  dwell: 28, retake: 0.30, issue: 0.24, kind: 'text' },
  { code: 'WINDSHIELD_INSIDE',  phase: 'A', required: false, dwell: 12, retake: 0.08, issue: 0.10, kind: 'view' },
  { code: 'INTERIOR_DASHBOARD', phase: 'A', required: true,  dwell: 16, retake: 0.18, issue: 0.16, kind: 'text' },
  { code: 'VRN',                phase: 'A', required: false, dwell: 11, retake: 0.15, issue: 0.14, kind: 'text' },
  { code: 'CHASSIS_NUMBER',     phase: 'B', required: true,  dwell: 38, retake: 0.34, issue: 0.30, kind: 'text' },
  { code: 'ENGINE_BAY',         phase: 'B', required: false, dwell: 20, retake: 0.10, issue: 0.12, kind: 'view' },
  { code: 'FRONT_VIEW',         phase: 'B', required: true,  dwell: 13, retake: 0.14, issue: 0.16, kind: 'plate' },
  { code: 'UNDER_FRONT',        phase: 'B', required: false, dwell: 22, retake: 0.22, issue: 0.22, kind: 'view' },
  { code: 'RIGHT_SIDE',         phase: 'B', required: true,  dwell: 15, retake: 0.12, issue: 0.13, kind: 'view' },
  { code: 'REAR_VIEW',          phase: 'B', required: true,  dwell: 13, retake: 0.11, issue: 0.12, kind: 'plate' },
  { code: 'LEFT_SIDE',          phase: 'B', required: true,  dwell: 15, retake: 0.12, issue: 0.13, kind: 'view' },
  { code: 'DICKY_BOOT',         phase: 'B', required: false, dwell: 17, retake: 0.07, issue: 0.09, kind: 'view' },
  { code: 'BI_FUEL_TANK',       phase: 'B', required: false, dwell: 19, retake: 0.14, issue: 0.15, kind: 'view', condition: 'BI_FUEL_ONLY' },
  { code: 'GAS_KIT_NUMBER',     phase: 'B', required: false, dwell: 26, retake: 0.28, issue: 0.26, kind: 'text', condition: 'BI_FUEL_ONLY' },
];
const FIRST_CONDITIONAL = STAGES.findIndex(st => st.condition);

const PROCESSORS = {
  RC_DOCUMENT: 'ocr_rc',
  INTERIOR_DASHBOARD: 'ocr_odometer',
  VRN: 'ocr_plate',
  FRONT_VIEW: 'ocr_plate',
  REAR_VIEW: 'ocr_plate',
  CHASSIS_NUMBER: 'ocr_chassis',
  GAS_KIT_NUMBER: 'ocr_gas_kit',
};

const MESSAGES = {
  OBSTRUCTED: 'Something appears to be blocking the view. Clear the frame and retake.',
  BLURRY: 'The image is blurry. Hold the camera steady and retake.',
  NOT_READABLE: 'The text in this image is not clear enough to read. Please retake.',
};

// ---------- scenario mix ----------
// weight → share of the seeded cases; age → allowed creation age in hours.
const SCENARIOS = {
  setup:             { weight: 18, age: [0.3, 720], status: 'SETUP' },
  permission_denied: { weight: 6,  age: [0.5, 720], status: 'SETUP' },
  ready:             { weight: 10, age: [0.5, 720], status: 'READY' },
  in_progress:       { weight: 14, age: [0.5, 18],  status: 'RECORDING' },
  stalled:           { weight: 26, age: [30, 720],  status: 'RECORDING' },
  aborted:           { weight: 24, age: [1, 720],   status: 'ABORTED' },
  upload_failed:     { weight: 3,  age: [30, 720],  status: 'RECORDING' },
  upload_stalled:    { weight: 4,  age: [30, 720],  status: 'RECORDING' },
  review_ready:      { weight: 50, age: [1, 720],   status: 'REVIEW_READY' },
  submitted:         { weight: 45, age: [4, 720],   status: 'SUBMITTED' },
  extraction_failed: { weight: 3,  age: [2, 720],   status: 'EXTRACTION_FAILED' },
  submission_failed: { weight: 3,  age: [3, 720],   status: 'SUBMISSION_FAILED' },
  expired:           { weight: 8,  age: [100, 720], status: 'EXPIRED' },
};
// The first two cases of these scenarios are created today so the "Today" preset has data.
const TODAY_SCENARIOS = new Set(['setup', 'ready', 'in_progress', 'aborted', 'review_ready', 'submitted']);
const ABANDONED = new Set(['stalled', 'aborted']);
const EXTRACTED = new Set(['review_ready', 'submitted', 'submission_failed']);
const RECORDING_DONE = new Set([...EXTRACTED, 'extraction_failed', 'upload_failed', 'upload_stalled']);

const VERDICTS = ['IN_REVIEW', 'APPROVED', 'REJECTED', 'APPROVED', 'PHOTOS_ON_HOLD', 'APPROVED', 'REJECTED', 'IN_REVIEW', 'APPROVED'];
const VENDOR = {
  APPROVED:       { status: 'QC_APPROVED',    remarks: 'APPROVED' },
  REJECTED:       { status: 'QC_REJECTED',    remarks: 'REJECTED' },
  PHOTOS_ON_HOLD: { status: 'PHOTOS_ON_HOLD', remarks: 'PHOTOS_ON_HOLD' },
  IN_REVIEW:      { status: 'IN_REVIEW',      remarks: null },
};
// Share of completed cases without any BLOCKING finding.
const CLEAN_SHARE = { review_ready: 0.55, submission_failed: 0.6, APPROVED: 0.9, REJECTED: 0.3, IN_REVIEW: 0.6, PHOTOS_ON_HOLD: 0.4 };

function allocate(n) {
  const entries = Object.entries(SCENARIOS);
  const total = entries.reduce((a, [, s]) => a + s.weight, 0);
  const counts = Object.fromEntries(entries.map(([k, s]) => [k, Math.max(1, Math.floor((s.weight * n) / total))]));
  let left = n - Object.values(counts).reduce((a, c) => a + c, 0);
  for (let i = 0; left > 0; i++, left--) counts[i % 2 ? 'submitted' : 'review_ready']++;
  while (left < 0) {
    const [k] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    counts[k]--; left++;
  }
  return shuffle(Object.entries(counts).flatMap(([k, c]) => Array(c).fill(k)));
}

// ---------- identity pools ----------
const REGIONS = [['MH', 12], ['MH', 14], ['MH', 2], ['DL', 8], ['DL', 3], ['KA', 3], ['KA', 51], ['UP', 16], ['HR', 26], ['RJ', 14], ['TN', 9], ['GJ', 1], ['TS', 9], ['WB', 20]];
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const INSURERS = ['united_india', 'united_india', 'united_india', 'united_india', 'united_india', 'new_india', 'oriental', 'national'];
const CITIES = [[28.5355, 77.391], [28.6139, 77.209], [19.076, 72.8777], [12.9716, 77.5946], [18.5204, 73.8567], [26.9124, 75.7873], [17.385, 78.4867], [13.0827, 80.2707], [22.5726, 88.3639]];
const DEVICES = [
  { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1', screen: '402x874' },
  { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', screen: '390x844' },
  { ua: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36', screen: '412x915' },
  { ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', screen: '412x915' },
  { ua: 'Mozilla/5.0 (Linux; Android 13; RMX3761) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36', screen: '393x873' },
];
const ABORT_REASONS = ['user_cancelled', 'app_backgrounded', 'vehicle_unavailable', 'poor_network', 'user_cancelled'];

function vrn() {
  const [st, d] = pick(REGIONS);
  return `${st}${String(d).padStart(2, '0')}${pick(LETTERS)}${pick(LETTERS)}${int(1000, 9999)}`;
}
const randomString = (chars, n) => Array.from({ length: n }, () => pick(chars)).join('');
function retryCount(p) {
  if (!chance(p)) return 0;
  let n = 1;
  while (n < 4 && chance(0.35)) n++;
  return n;
}

// ---------- case builder ----------
const rows = { sessions: [], stages: [], videos: [], assets: [], findings: [], processing: [], events: [], submissions: [], jobs: [] };

function buildCase(id, i, scenario, nth) {
  const sc = SCENARIOS[scenario];
  let [minAge, maxAge] = sc.age;
  const verdict = scenario === 'submitted' ? VERDICTS[nth % VERDICTS.length] : null;
  if (verdict && verdict !== 'IN_REVIEW') minAge = Math.max(minAge, 30);
  const lateFinish = EXTRACTED.has(scenario) && nth % 3 === 2; // finishes a day or two after creation
  if (lateFinish) minAge = Math.max(minAge, 75);
  if (TODAY_SCENARIOS.has(scenario) && nth < 2 && !lateFinish && HOURS_SINCE_NINE_IST > minAge + 0.5) {
    maxAge = HOURS_SINCE_NINE_IST;
  }

  const created = pickCreated(minAge, maxAge);
  const deadline = created + 72 * H;
  const customer = `CUST${String(480100 + i * 17).padStart(6, '0')}`;
  const policy = `UIIC/MTR/2026/${String(310000 + i * 29).padStart(6, '0')}`;
  const vehicle = vrn();
  const chassis = `MA${pick(['1', '3', 'L', 'T'])}${randomString(VIN_CHARS, 14)}`;
  const device = pick(DEVICES);
  const [lat, lng] = pick(CITIES);
  const ip = `${pick([49, 103, 106, 117, 157, 182])}.${int(1, 254)}.${int(1, 254)}.${int(1, 254)}`;

  // How far the recording got: index into STAGES of the last marked stage (-1 = none).
  let reach;
  if (ABANDONED.has(scenario)) reach = (nth % (STAGES.length + 1)) - 1;
  else if (scenario === 'in_progress') reach = int(0, FIRST_CONDITIONAL);
  else if (scenario === 'expired') reach = nth % 2 ? int(0, 10) : null;
  else if (RECORDING_DONE.has(scenario)) reach = STAGES.length - 1;
  else reach = null;
  const biFuel = ((ABANDONED.has(scenario) || scenario === 'in_progress') && reach >= FIRST_CONDITIONAL) || chance(0.45);

  const permsGranted = !['setup', 'permission_denied'].includes(scenario) && !(scenario === 'expired' && reach === null && nth % 4 === 0);
  const recorded = reach !== null && !(scenario === 'aborted' && reach === -1 && nth % 2 === 0);

  const tPerm = created + between(20, 180) * S;
  const tRec = lateFinish ? tPerm + between(20, 44) * H : tPerm + between(30, 240) * S;

  const ev = (event_type, at, actor = 'customer', from_state = null, to_state = null, metadata = {}) => {
    if (at > NOW) return;
    rows.events.push({
      id: randomUUID(), session_id: id, customer_id: customer, event_type, from_state, to_state, actor,
      metadata, ip_address: actor === 'customer' ? ip : null, hmac_sig: '', created_at: iso(at),
    });
  };

  // --- stage marks ---
  const applicable = STAGES.filter(st => !st.condition || biFuel);
  const info = new Map(STAGES.map(st => [st.code, { stageId: randomUUID(), retries: 0, ms: null, status: 'PENDING' }]));
  const marks = [];
  let ms = between(4, 12) * S;
  if (recorded) {
    for (const st of applicable) {
      const idx = STAGES.indexOf(st);
      const retries = retryCount(st.retake);
      if (idx > reach) continue;
      ms += (st.dwell * Math.exp(0.35 * normal()) + retries * between(6, 14)) * S;
      Object.assign(info.get(st.code), { retries, ms: Math.round(ms) });
      marks.push({ stage_type: st.code, captured_at: iso(tRec + ms), video_timestamp_ms: Math.round(ms) });
    }
    // The stage the user was on when they stopped often shows retakes.
    const exitStage = applicable.find(st => STAGES.indexOf(st) > reach);
    if (exitStage && !RECORDING_DONE.has(scenario) && chance(0.5)) info.get(exitStage.code).retries = int(1, 3);
  }
  const lastMarkAt = marks.length ? tRec + marks[marks.length - 1].video_timestamp_ms : tRec;
  const recEnd = tRec + ms + between(3, 15) * S;
  const tExtStart = recEnd + between(20, 90) * S;
  const tExtEnd = tExtStart + between(2, 6) * MIN;

  // --- AI/QC on extracted photos ---
  let photoCount = 0, findingCount = 0;
  const finding = (st, type, severity, source, confidence, message, assetId, status = 'OPEN') => {
    findingCount++;
    const resolved = status === 'RESOLVED';
    rows.findings.push({
      id: randomUUID(), session_id: id, asset_id: assetId, stage_type: st.code, finding_type: type, severity, source,
      confidence: confidence == null ? null : round(confidence), message, status,
      created_at: iso(tExtEnd - between(5, 40) * S), resolved_at: resolved ? iso(tExtEnd + between(10, 90) * MIN) : null,
    });
  };
  if (EXTRACTED.has(scenario)) {
    const marked = applicable.filter(st => info.get(st.code).ms != null);
    const clean = chance(CLEAN_SHARE[verdict || scenario]);
    let forced = null;
    if (!clean) {
      forced = chance(0.55)
        ? { type: 'NOT_READABLE', code: pick(marked.filter(st => st.kind === 'text')).code }
        : { type: 'MISSING_STAGE', code: pick(marked.filter(st => st.required)).code };
    }
    const acknowledged = verdict === 'APPROVED';
    for (const st of marked) {
      const s = info.get(st.code);
      const frameAt = tRec + s.ms;
      const missing = (forced?.type === 'MISSING_STAGE' && forced.code === st.code) || (!clean && st.required && chance(0.04));
      if (missing) {
        s.status = 'QC_FAIL';
        finding(st, 'MISSING_STAGE', 'BLOCKING', 'QC_WORKER', null, `no confident frame for required stage ${st.code}`, null);
        continue;
      }
      let status = 'PASSED', reason = null;
      if (forced?.type === 'NOT_READABLE' && forced.code === st.code) { status = 'FAILED'; reason = 'NOT_READABLE'; }
      else if (chance(st.issue)) {
        if (st.kind === 'text' && !clean && chance(0.7)) { status = 'FAILED'; reason = 'NOT_READABLE'; }
        else { status = 'WARNING'; reason = chance(st.kind === 'text' ? 0.5 : 0.3) ? 'BLURRY' : 'OBSTRUCTED'; }
      }
      s.status = status === 'FAILED' ? 'QC_FAIL' : 'QC_PASS';
      const confidence = status === 'PASSED' ? between(0.82, 0.99) : status === 'WARNING' ? between(0.52, 0.8) : between(0.25, 0.55);
      const asset = (method, key, assetStatus, conf, capturedAt) => {
        const portrait = chance(0.5);
        const assetId = randomUUID();
        photoCount++;
        rows.assets.push({
          id: assetId, session_id: id, stage_id: s.stageId, stage_type: st.code, asset_type: 'PHOTO', capture_method: method,
          storage_key: key, checksum_sha256: createHash('sha256').update(key).digest('hex'), mime_type: 'image/jpeg',
          file_size_bytes: int(180_000, 650_000), width_px: portrait ? 1080 : 1920, height_px: portrait ? 1920 : 1080,
          is_portrait: portrait, overlay_applied: chance(0.7), metadata: { source: method === 'RETAKE' ? 'camera' : 'video', frame_ms: s.ms },
          qc_result: { confidence: round(conf), laplacian_score: round(reason === 'BLURRY' && method !== 'RETAKE' ? between(25, 95) : between(180, 720), 2) },
          qc_result_version: 1, status: assetStatus, captured_at: iso(capturedAt), uploaded_at: iso(tExtStart + between(5, 60) * S),
          created_at: iso(tExtStart + between(1, 20) * S), updated_at: iso(tExtEnd - between(1, 20) * S),
        });
        return assetId;
      };
      const assetId = asset('EXTRACTED', `inspections/${id}/stages/${st.code}/frame.jpg`, status, confidence, frameAt);
      for (let r = 1; r <= Math.min(s.retries, 2); r++) {
        const ok = chance(0.8);
        asset('RETAKE', `inspections/${id}/stages/${st.code}/retake-${r}.jpg`, ok ? 'PASSED' : 'WARNING',
          ok ? between(0.8, 0.98) : between(0.55, 0.78), frameAt - (3 - r) * between(4, 9) * S);
      }
      if (reason === 'NOT_READABLE') {
        finding(st, reason, 'BLOCKING', 'OCR', confidence, MESSAGES[reason], assetId, acknowledged ? 'ACKNOWLEDGED' : 'OPEN');
      } else if (reason) {
        finding(st, reason, 'WARNING', 'QC_WORKER', confidence, MESSAGES[reason], assetId,
          acknowledged ? 'ACKNOWLEDGED' : chance(0.15) ? 'RESOLVED' : 'OPEN');
      }
      const processor = PROCESSORS[st.code];
      if (processor) {
        const readable = status !== 'FAILED';
        const conf = readable ? between(0.84, 0.99) : between(0.2, 0.5);
        const out = {
          ocr_rc: { vrn: vehicle, chassis, fuel_type: biFuel ? 'PETROL/CNG' : 'PETROL', registration_date: `20${int(15, 24)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`, raw_text: readable ? `REGISTRATION CERTIFICATE ${vehicle} ${chassis}` : 'REG1STRAT... CERT.. ###', confidence: round(conf) },
          ocr_odometer: { reading_km: readable ? int(4_000, 140_000) : null, unit: 'km', confidence: round(conf) },
          ocr_plate: { vrn: readable ? vehicle : `${vehicle.slice(0, 4)}??${vehicle.slice(-3)}`, raw_text: readable ? `IND ${vehicle}` : 'IND ....', confidence: round(conf) },
          ocr_chassis: { chassis: readable ? chassis : chassis.slice(0, 9), raw_text: readable ? chassis : `${chassis.slice(0, 9)}########`, is_full_vin: readable, confidence: round(conf) },
          ocr_gas_kit: { kit_number: readable ? `${pick(['LOVATO', 'BRC', 'TOMASETTO'])}-${int(10, 24)}-${int(100000, 999999)}` : null, confidence: round(conf) },
        }[processor];
        rows.processing.push({
          id: randomUUID(), session_id: id, asset_id: assetId, stage_type: st.code, processor_name: processor,
          processor_version: 'v1', confidence: round(conf), output_json: out, created_at: iso(tExtEnd - between(10, 60) * S),
        });
      }
    }
  }

  // --- lifecycle, events, video, submission ---
  let lastActive = null, updated = created + between(50, 150), videoStatus = null, videoUpdated = null;
  if (scenario === 'permission_denied') {
    const denied = pick([['microphone'], ['location'], ['microphone', 'location']]);
    ev('permission_denied', tPerm, 'customer', null, null, { denied });
    lastActive = tPerm; updated = tPerm;
  }
  if (permsGranted) {
    ev('permission_granted', tPerm, 'customer', 'SETUP', 'READY');
    lastActive = tPerm; updated = tPerm;
  }
  if (recorded) {
    ev('recording_started', tRec, 'customer', 'READY', 'RECORDING');
    lastActive = lastMarkAt; updated = lastMarkAt;
    videoStatus = 'IN_PROGRESS'; videoUpdated = lastMarkAt;
  }
  if (RECORDING_DONE.has(scenario)) {
    ev('recording_complete', recEnd, 'customer');
    lastActive = recEnd; updated = recEnd;
    videoStatus = 'COMPLETE'; videoUpdated = recEnd + between(20, 80) * S;
  }
  if (scenario === 'upload_stalled') {
    videoStatus = 'IN_PROGRESS'; videoUpdated = recEnd + between(1, 6) * MIN;
  }
  if (scenario === 'upload_failed') {
    const tFail = recEnd + between(1, 10) * MIN;
    ev('upload_failed', tFail, 'system', null, null, { error: 'multipart upload expired before the final part arrived', parts_received: int(3, 9) });
    videoStatus = 'FAILED'; videoUpdated = tFail; updated = tFail;
  }
  if (scenario === 'aborted') {
    const tAbort = (recorded ? lastMarkAt : tPerm) + between(10, 120) * S;
    ev('session_aborted', tAbort, 'customer', recorded ? 'RECORDING' : 'READY', 'ABORTED', { reason: pick(ABORT_REASONS) });
    if (recorded) { videoStatus = 'COMPLETE'; videoUpdated = tAbort + between(10, 60) * S; }
    lastActive = tAbort; updated = tAbort;
  }

  let job = null;
  if (EXTRACTED.has(scenario)) {
    ev('extraction_started', tExtStart, 'worker');
    ev('extraction_completed', tExtEnd, 'worker', 'RECORDING', 'REVIEW_READY', { photos: photoCount, findings: findingCount });
    updated = tExtEnd;
    job = { status: 'COMPLETED', attempt_count: 1, completed_at: tExtEnd, error_reason: null };
  }
  if (scenario === 'extraction_failed') {
    const tFail = tExtStart + between(10, 20) * MIN;
    const error = pick(['frame extraction timed out after 3 attempts', 'stage classifier returned no frames above threshold', 'video container is corrupt (moov atom missing)']);
    ev('extraction_started', tExtStart, 'worker');
    ev('extraction_failed', tFail, 'worker', 'RECORDING', 'EXTRACTION_FAILED', { error, attempts: 3 });
    updated = tFail;
    job = { status: 'FAILED', attempt_count: 3, completed_at: tFail, error_reason: error };
  }
  if (job) {
    rows.jobs.push({
      id: randomUUID(), session_id: id, status: job.status, attempt_count: job.attempt_count, max_attempts: 3,
      next_attempt_at: iso(tExtStart), started_at: iso(tExtStart), completed_at: iso(job.completed_at),
      error_reason: job.error_reason, worker_id: `qc-worker-${int(1, 3)}`, created_at: iso(recEnd + between(2, 15) * S), updated_at: iso(job.completed_at),
    });
  }

  if (scenario === 'submitted' || scenario === 'submission_failed') {
    const tDispatch = tExtEnd + between(2, 30) * MIN;
    const failed = scenario === 'submission_failed';
    const vendorCaseId = failed ? null : 7_400_000 + i * 7;
    const tVerdict = tDispatch + between(1, 26) * H;
    const v = failed ? null : VENDOR[verdict];
    rows.submissions.push({
      id: randomUUID(), session_id: id, client_submit_id: `demo-sub-${id}`, manifest_key: `inspections/${id}/manifest.json`,
      status: failed ? 'FAILED' : 'DISPATCHED', submitted_at: iso(tDispatch), packaged_at: iso(tDispatch - between(20, 90) * S),
      vendor_case_id: vendorCaseId, download_key: failed ? null : `inspections/${id}/evidence.zip`,
      vendor_status: v?.status ?? null, vendor_remarks: v?.remarks ?? null, dispatched_at: failed ? null : iso(tDispatch + between(5, 60) * S),
    });
    if (failed) {
      ev('submission_failed', tDispatch, 'system', 'REVIEW_READY', 'SUBMISSION_FAILED', { error: 'vendor API returned 503 after 3 attempts' });
      updated = tDispatch;
    } else {
      ev('submission_dispatched', tDispatch, 'system', 'REVIEW_READY', 'SUBMITTED', { vendor_case_id: vendorCaseId });
      updated = tDispatch;
      if (verdict !== 'IN_REVIEW') {
        ev('vendor_verdict_received', tVerdict, 'system', null, null, { verdict, vendor_status: v.status });
        updated = tVerdict;
      }
    }
  }

  // Reminders go out to customers who have not finished a day after their last activity.
  if (['setup', 'permission_denied', 'ready', 'stalled', 'expired'].includes(scenario)) {
    const from = lastActive ?? created;
    for (let r = 1; r <= 2; r++) {
      const t = from + r * 24 * H + between(0, 2) * H;
      if (t < deadline) ev('reminder_sent', t, 'system', null, null, { channel: pick(['sms', 'whatsapp', 'push']), attempt: r });
    }
  }
  if (scenario === 'expired') {
    ev('session_expired', deadline, 'system', recorded ? 'RECORDING' : permsGranted ? 'READY' : 'SETUP', 'EXPIRED');
    updated = deadline;
  }

  if (recorded) {
    const done = videoStatus === 'COMPLETE';
    const durationSec = Math.round((recEnd - tRec) / S);
    rows.videos.push({
      id: randomUUID(), session_id: id, storage_key: `inspections/${id}/video.mp4`, upload_id: randomUUID(), mime_type: 'video/mp4',
      upload_status: videoStatus, duration_sec: done ? durationSec : null, file_size_bytes: done ? durationSec * int(700_000, 1_100_000) : null,
      stage_timestamps: marks, motion_score: done ? round(between(0.25, 0.9)) : null,
      created_at: iso(tRec + between(1, 5) * S), updated_at: iso(videoUpdated),
    });
  }

  STAGES.forEach((st, k) => {
    const s = info.get(st.code);
    const qcDone = s.status !== 'PENDING';
    rows.stages.push({
      id: s.stageId, session_id: id, sequence_number: k + 1, stage_type: st.code, phase: st.phase, capture_mode: 'EXTRACTED',
      is_required: st.required, is_conditional: !!st.condition, condition_key: st.condition || null, status: s.status,
      retry_count: s.retries, video_timestamp_ms: s.ms,
      created_at: iso(created + 5 + k), updated_at: iso(qcDone ? tExtEnd : s.ms != null ? tRec + s.ms : created + 5 + k),
    });
  });

  const perms = scenario === 'permission_denied'
    ? { camera_granted: true, microphone_granted: chance(0.5), location_granted: false }
    : permsGranted ? { camera_granted: true, location_granted: true, microphone_granted: true } : {};
  rows.sessions.push({
    id, policy_id: policy, customer_id: customer, vehicle_reg: vehicle, insurer_id: pick(INSURERS), status: sc.status,
    checklist_state: { fuel_type: biFuel ? 'PETROL_CNG' : pick(['PETROL', 'PETROL', 'DIESEL']), is_bi_fuel: biFuel, has_previous_policy: chance(0.6) },
    permissions_state: perms, device_metadata: device,
    model_versions: recorded ? { qc_model: 'qc-yolo-1.4.2', ocr_model: 'ocr-2.3.0', stage_classifier: 'stagecls-0.9.1' } : {},
    language: pick(['en', 'en', 'en', 'hi', 'hi', 'mr']),
    deadline_at: iso(deadline), grace_deadline_at: iso(deadline - 10 * MIN),
    location_lat: permsGranted ? round(lat + between(-0.08, 0.08), 6) : null,
    location_lng: permsGranted ? round(lng + between(-0.08, 0.08), 6) : null,
    location_locked_at: permsGranted ? iso(tPerm + between(1, 8) * S) : null,
    last_active_at: lastActive == null ? null : iso(lastActive),
    is_portrait_mode: recorded && chance(0.3), microphone_granted: !!perms.microphone_granted,
    orion_instance_id: randomUUID(), created_at: iso(created), updated_at: iso(Math.min(updated, NOW)), client_request_id: MARK + id,
  });
}

// ---------- database ----------
const INSERT_ORDER = [
  ['inspection_sessions', 'sessions'],
  ['inspection_stages', 'stages'],
  ['inspection_videos', 'videos'],
  ['captured_assets', 'assets'],
  ['inspection_findings', 'findings'],
  ['inspection_processing_results', 'processing'],
  ['inspection_audit_events', 'events'],
  ['inspection_submissions', 'submissions'],
  ['extraction_jobs', 'jobs'],
];

async function seed() {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const { rows: targets } = await db.query(`
      SELECT s.id FROM inspection_sessions s
      WHERE s.client_request_id LIKE $1
         OR NOT EXISTS (SELECT 1 FROM captured_assets a WHERE a.session_id = s.id)
      ORDER BY s.id`, [`${MARK}%`]);
    const ids = targets.map(r => r.id);
    if (!ids.length) { console.log('  nothing to seed — every case already has captures'); return; }

    const plan = allocate(ids.length);
    const seen = {};
    ids.forEach((id, i) => {
      const scenario = plan[i];
      seen[scenario] = (seen[scenario] ?? -1) + 1;
      buildCase(id, i, scenario, seen[scenario]);
    });

    await db.query('BEGIN');
    try {
      // Children first where the FK has no cascade (findings/processing → captured_assets).
      await db.query('DELETE FROM inspection_processing_results WHERE session_id = ANY($1::uuid[])', [ids]);
      await db.query('DELETE FROM inspection_findings WHERE session_id = ANY($1::uuid[])', [ids]);
      await db.query('DELETE FROM inspection_sessions WHERE id = ANY($1::uuid[])', [ids]);
      for (const [table, key] of INSERT_ORDER) {
        if (!rows[key].length) continue;
        await db.query(
          `INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table}, $1::jsonb)`,
          [JSON.stringify(rows[key])]);
      }
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    console.log(`  seeded ${ids.length} cases (untouched: cases that already had captures)`);
    for (const [table, key] of INSERT_ORDER) console.log(`    ${table.padEnd(32)} ${rows[key].length}`);
    const { rows: mix } = await db.query('SELECT status, count(*)::int AS n FROM inspection_sessions GROUP BY 1 ORDER BY 2 DESC');
    console.log('  sessions by status (all cases):');
    for (const r of mix) console.log(`    ${r.status.padEnd(32)} ${r.n}`);
  } finally {
    await db.end();
  }
}

function reset() {
  const u = new URL(DATABASE_URL);
  const dbName = decodeURIComponent(u.pathname.slice(1)) || 'vehicle_inspection';
  const bundled = path.join(PG_BIN, process.platform === 'win32' ? 'psql.exe' : 'psql');
  const psql = existsSync(bundled) ? bundled : 'psql';
  const base = ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username) || 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'];
  const env = { ...process.env, ...(u.password ? { PGPASSWORD: decodeURIComponent(u.password) } : {}) };
  const run = args => {
    const r = spawnSync(psql, [...base, ...args], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`could not run psql (${r.error.message}); set PG_BIN to the folder that contains psql`);
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  };
  console.log(`  dropping and recreating ${dbName}…`);
  run(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`]);
  run(['-d', 'postgres', '-c', `CREATE DATABASE "${dbName}"`]);
  console.log('  loading the original snapshot…');
  run(['-d', dbName, '-f', SNAPSHOT]);
  console.log('  done — the database matches ../data/01-vehicle_inspection.sql again');
}

(process.argv.includes('--reset') ? Promise.resolve().then(reset) : seed()).catch(err => {
  console.error('\n  Failed:', err.message || err);
  process.exit(1);
});
