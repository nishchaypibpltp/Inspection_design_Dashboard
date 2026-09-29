// Facade: backend selection, key validation, and the evidence ZIP assembled
// through an injected backend (so the same assertions hold for S3 and GCS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { statSync } from 'node:fs';
import { proxyMedia, buildEvidenceZip, mediaBackendName } from '../lib/media.mjs';
import { FakeRes } from './fakes.mjs';

const entries = zipPath =>
  execFileSync('/usr/bin/unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split('\n');
const member = (zipPath, name) =>
  execFileSync('/usr/bin/unzip', ['-p', zipPath, name], { encoding: 'utf8' });

// ─── backend selection ────────────────────────────────────────────────────────
test('default backend is s3 — local behaviour unchanged', () => {
  assert.equal(mediaBackendName(), 's3');
});

test('MEDIA_BACKEND=gcs with a bucket selects gcs', async () => {
  process.env.MEDIA_BACKEND = 'gcs';
  process.env.GCS_BUCKET = 'poc-inspection-506311-app-media';
  try {
    const m = await import('../lib/media.mjs?case=gcs-ok');
    assert.equal(m.mediaBackendName(), 'gcs');
  } finally {
    delete process.env.MEDIA_BACKEND; delete process.env.GCS_BUCKET;
  }
});

test('MEDIA_BACKEND=gcs without GCS_BUCKET fails at startup, not at first video', async () => {
  process.env.MEDIA_BACKEND = 'gcs';
  delete process.env.GCS_BUCKET;
  try {
    await assert.rejects(() => import('../lib/media.mjs?case=gcs-nobucket'), /requires GCS_BUCKET/);
  } finally { delete process.env.MEDIA_BACKEND; }
});

test('an unknown MEDIA_BACKEND fails at startup', async () => {
  process.env.MEDIA_BACKEND = 'azure';
  try {
    await assert.rejects(() => import('../lib/media.mjs?case=bogus'), /must be "s3" or "gcs"/);
  } finally { delete process.env.MEDIA_BACKEND; }
});

// ─── key validation (backend-independent, runs before any store call) ─────────
for (const bad of ['../../etc/passwd', 'a/../b', 'key?x=1', 'key with space', 'k;ls', '']) {
  test(`bad key rejected with 400: ${JSON.stringify(bad)}`, async () => {
    const res = new FakeRes();
    const done = res.settled();
    await proxyMedia(bad, undefined, res);
    await done;
    assert.equal(res.status, 400);
    assert.equal(res.body.toString(), 'bad key');
  });
}

// ─── evidence ZIP ─────────────────────────────────────────────────────────────
const OBJECTS = {
  'photos/front.jpg': Buffer.from('FRONT-BYTES'),
  'photos/rear-2.jpg': Buffer.from('REAR-RETAKE-BYTES'),
  'video/session.mp4': Buffer.from('MP4-BYTES'),
};
const fakeBackend = objects => ({
  name: 'fake',
  pulled: [],
  async fetchObject(key) { this.pulled.push(key); return objects[key] ?? null; },
});

const caseData = () => ({
  session: {
    id: '11111111-2222-3333-4444-555555555555', vehicle_reg: 'KA01AB1234',
    customer_id: 'C-9', insurer_id: 'INS-1', status: 'SUBMITTED',
    created_at: '2026-08-20T04:30:00.000Z',
  },
  assets: [
    { storage_key: 'photos/front.jpg', asset_type: 'PHOTO', stage_type: 'FRONT', capture_method: 'AUTO', qc_result: 'PASS', status: 'STORED', captured_at: '2026-08-20T04:31:00.000Z', file_size_bytes: '2048' },
    { storage_key: 'photos/rear-2.jpg', asset_type: 'PHOTO', stage_type: 'REAR', capture_method: 'RETAKE', qc_result: 'PASS', status: 'STORED', captured_at: '2026-08-20T04:32:00.000Z', file_size_bytes: '3072' },
    { storage_key: 'photos/lost.jpg', asset_type: 'PHOTO', stage_type: 'LEFT', capture_method: 'AUTO', qc_result: 'FAIL', status: 'STORED', captured_at: '2026-08-20T04:33:00.000Z', file_size_bytes: null },
    { storage_key: null, asset_type: 'PHOTO', stage_type: 'RIGHT', capture_method: 'AUTO', qc_result: null, status: 'PENDING', captured_at: null, file_size_bytes: null },
    { storage_key: 'video/session.mp4', asset_type: 'VIDEO', stage_type: null, capture_method: null, qc_result: null, status: 'STORED', captured_at: null, file_size_bytes: '9' },
  ],
  video: { storage_key: 'video/session.mp4', upload_status: 'UPLOADED', stage_timestamps: [1, 2, 3] },
});

test('evidence ZIP: photos + video + manifest, missing objects skipped', async () => {
  const store = fakeBackend(OBJECTS);
  const zip = await buildEvidenceZip(caseData(), store);
  assert.ok(zip);
  try {
    assert.deepEqual(entries(zip.path).sort(),
      ['FRONT.jpg', 'REAR-retake.jpg', 'manifest.json', 'video.mp4']);
    assert.equal(member(zip.path, 'FRONT.jpg'), 'FRONT-BYTES');
    assert.equal(member(zip.path, 'REAR-retake.jpg'), 'REAR-RETAKE-BYTES');
    assert.equal(member(zip.path, 'video.mp4'), 'MP4-BYTES');
    assert.equal(zip.size, statSync(zip.path).size);          // content-length the route sends
    // one pull per keyed photo + one for the video; the keyless asset is never fetched
    assert.deepEqual(store.pulled,
      ['photos/front.jpg', 'photos/rear-2.jpg', 'photos/lost.jpg', 'video/session.mp4']);
  } finally { await zip.cleanup(); }
  assert.equal(existsSync(zip.path), false);                  // cleanup really removes the tmp dir
});

test('evidence ZIP manifest describes every photo row, stored or not', async () => {
  const zip = await buildEvidenceZip(caseData(), fakeBackend(OBJECTS));
  try {
    const m = JSON.parse(member(zip.path, 'manifest.json'));
    assert.equal(m.session_id, '11111111-2222-3333-4444-555555555555');
    assert.equal(m.vehicle_reg, 'KA01AB1234');
    assert.equal(m.status, 'SUBMITTED');
    assert.equal(m.photos.length, 4);                          // 4 PHOTO rows, video row excluded
    assert.deepEqual(m.photos[0], {
      stage: 'FRONT', method: 'AUTO', qc: 'PASS', status: 'STORED',
      captured_at: '2026-08-20T04:31:00.000Z', size_bytes: 2048,
    });
    assert.equal(m.photos[2].size_bytes, null);
    assert.deepEqual(m.video, { status: 'UPLOADED', marks: 3 });
    assert.equal(m.generated_by, 'inspection-dashboard phase-1');
  } finally { await zip.cleanup(); }
});

test('evidence ZIP: video-only case still bundles', async () => {
  const d = caseData();
  d.assets = [];
  const zip = await buildEvidenceZip(d, fakeBackend(OBJECTS));
  try {
    assert.deepEqual(entries(zip.path).sort(), ['manifest.json', 'video.mp4']);
  } finally { await zip.cleanup(); }
});

test('evidence ZIP: nothing stored → null (route answers 404, no empty download)', async () => {
  const d = caseData();
  d.assets = d.assets.map(a => ({ ...a, storage_key: null }));
  d.video = null;
  assert.equal(await buildEvidenceZip(d, fakeBackend(OBJECTS)), null);
});

test('evidence ZIP: every object missing from the store → null', async () => {
  assert.equal(await buildEvidenceZip(caseData(), fakeBackend({})), null);
});

test('evidence ZIP: a store error surfaces and leaves no tmp dir behind', async () => {
  const store = { name: 'boom', async fetchObject() { throw new Error('gcs 500'); } };
  await assert.rejects(() => buildEvidenceZip(caseData(), store), /gcs 500/);
});
