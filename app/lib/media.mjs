// Media access: read-only object reads for the photo grid, the Range-streamed
// video and the evidence ZIP. Two interchangeable backends sit behind one
// interface — S3 (the local Floci emulator, default) and GCS (Cloud Run, where
// media lives in a bucket and S3-interop signing does not work) — picked by
// MEDIA_BACKEND. Nothing here can write to either store.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { s3Backend } from './media-s3.mjs';
import { gcsBackend } from './media-gcs.mjs';

const BACKEND = (process.env.MEDIA_BACKEND || 's3').toLowerCase();
if (BACKEND !== 's3' && BACKEND !== 'gcs')
  throw new Error(`MEDIA_BACKEND must be "s3" or "gcs" (got "${BACKEND}")`);
if (BACKEND === 'gcs' && !process.env.GCS_BUCKET)
  throw new Error('MEDIA_BACKEND=gcs requires GCS_BUCKET');

const KEY_OK = /^[A-Za-z0-9_\-./]+$/; // storage keys only; no traversal, no queries

export const mediaBackendName = () => BACKEND;

let pending = null;
// Resolved once per process; the promise itself is cached so concurrent first
// requests share one client.
function backend() {
  if (!pending) pending = BACKEND === 'gcs' ? gcsBackend() : Promise.resolve(s3Backend());
  return pending;
}

// Streams one object to the client. Same contract on both backends: 200 with
// content-length for a plain GET, 206 + content-range for a Range request,
// 416 for an unsatisfiable range, 404 for a missing key, 502 on a store error —
// always with accept-ranges: bytes so the player knows it can seek.
export async function proxyMedia(key, rangeHeader, res) {
  if (!KEY_OK.test(key) || key.includes('..')) { res.writeHead(400); res.end('bad key'); return; }
  try {
    await (await backend()).proxyObject(key, rangeHeader, res);
  } catch (err) {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502); res.end(`media fetch failed: ${err.message}`);
  }
}

// Evidence bundle: stage photos + the recorded video + a manifest, zipped with
// the system zip binary (no extra npm deps). Returns {path, cleanup} or null.
// `media` is injectable for tests; production passes nothing and gets the
// MEDIA_BACKEND-selected backend.
export async function buildEvidenceZip(caseData, media) {
  const { session, assets, video } = caseData;
  const store = media || await backend();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'evidence-'));
  const files = [];
  try {
    for (const a of assets) {
      if (!a.storage_key || a.asset_type !== 'PHOTO') continue;
      const buf = await store.fetchObject(a.storage_key);
      if (!buf) continue;
      const name = `stages/${a.stage_type}${a.capture_method === 'RETAKE' ? '-retake' : ''}.jpg`;
      await writeFile(path.join(dir, name.replace('stages/', '')), buf); // flat; zip -j anyway
      files.push({ disk: path.join(dir, name.replace('stages/', '')), name });
    }
    if (video?.storage_key) {
      const buf = await store.fetchObject(video.storage_key);
      if (buf) {
        const p = path.join(dir, 'video.mp4');
        await writeFile(p, buf);
        files.push({ disk: p, name: 'video.mp4' });
      }
    }
    const manifest = {
      session_id: session.id,
      vehicle_reg: session.vehicle_reg,
      customer_id: session.customer_id,
      insurer_id: session.insurer_id,
      status: session.status,
      created_at: session.created_at,
      photos: assets.filter(a => a.asset_type === 'PHOTO').map(a => ({
        stage: a.stage_type, method: a.capture_method, qc: a.qc_result,
        status: a.status, captured_at: a.captured_at, size_bytes: Number(a.file_size_bytes) || null,
      })),
      video: video ? { status: video.upload_status, marks: video.stage_timestamps?.length ?? 0 } : null,
      generated_by: 'inspection-dashboard phase-1',
      generated_at: new Date().toISOString(),
    };
    const mp = path.join(dir, 'manifest.json');
    await writeFile(mp, JSON.stringify(manifest, null, 2));
    files.push({ disk: mp, name: 'manifest.json' });

    if (files.length === 1) { await rm(dir, { recursive: true, force: true }); return null; } // manifest only → no media

    const zipPath = path.join(dir, 'evidence.zip');
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/zip', ['-j', '-q', zipPath, ...files.map(f => f.disk)],
        err => err ? reject(err) : resolve());
    });
    return {
      path: zipPath,
      stream: () => createReadStream(zipPath),
      size: (await readFile(zipPath)).length,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}
