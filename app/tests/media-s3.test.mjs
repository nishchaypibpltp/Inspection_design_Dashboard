// Regression cover for the default (S3) path after the backend split, and the
// proof that both backends look identical to the route: same statuses, same
// Range headers, same content-range format. Runs against a throwaway in-process
// stand-in for the Floci emulator — no container needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createGcsBackend } from '../lib/media-gcs.mjs';
import { fakeStorage, FakeRes } from './fakes.mjs';

const BODY = Buffer.from('0123456789'.repeat(10)); // 100 bytes
const BUCKET = 'vehicle-inspection-test';

// Minimal S3-shaped GET responder: whole object, or a single byte range.
const emulator = http.createServer((req, res) => {
  const key = decodeURIComponent(req.url.replace(`/${BUCKET}/`, ''));
  if (key !== 'video/abc.mp4') { res.writeHead(404); res.end('NoSuchKey'); return; }
  const common = { 'content-type': 'video/mp4', 'etag': '"d41d8cd9"', 'last-modified': 'Thu, 20 Aug 2026 10:00:00 GMT' };
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (!m) {
    res.writeHead(200, { ...common, 'content-length': BODY.length, 'accept-ranges': 'bytes' });
    res.end(BODY);
    return;
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? BODY.length - 1 : Math.min(Number(m[2]), BODY.length - 1);
  if (start >= BODY.length) {
    res.writeHead(416, { ...common, 'content-range': `bytes */${BODY.length}` });
    res.end();
    return;
  }
  const slice = BODY.subarray(start, end + 1);
  res.writeHead(206, {
    ...common, 'content-length': slice.length,
    'content-range': `bytes ${start}-${end}/${BODY.length}`, 'accept-ranges': 'bytes',
  });
  res.end(slice);
});

let media;   // lib/media.mjs bound to the emulator
test.before(async () => {
  emulator.listen(0, '127.0.0.1');
  await once(emulator, 'listening');
  process.env.S3_ENDPOINT = `http://127.0.0.1:${emulator.address().port}`;
  process.env.S3_BUCKET = BUCKET;
  media = await import('../lib/media.mjs?case=s3-live'); // env is read at module load
});
test.after(() => emulator.close());

async function viaS3(key, range) {
  const res = new FakeRes();
  const done = res.settled();
  await media.proxyMedia(key, range, res);
  await done;
  return res;
}

async function viaGcs(key, range) {
  const backend = createGcsBackend({
    storage: fakeStorage({
      'video/abc.mp4': {
        body: BODY, contentType: 'video/mp4',
        updated: '2026-08-20T10:00:00.000Z', etag: 'd41d8cd9',
      },
    }),
    bucket: 'poc-media',
  });
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject(key, range, res);
  await done;
  return res;
}

test('s3: plain GET → 200 with the seekable header set', async () => {
  const res = await viaS3('video/abc.mp4', undefined);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'video/mp4');
  assert.equal(String(res.headers['content-length']), '100');
  assert.equal(res.headers['accept-ranges'], 'bytes');
  assert.equal(res.headers['cache-control'], 'private, max-age=3600');
  assert.equal(res.body.length, 100);
});

test('s3: Range GET → 206 with content-range', async () => {
  const res = await viaS3('video/abc.mp4', 'bytes=10-19');
  assert.equal(res.status, 206);
  assert.equal(res.headers['content-range'], 'bytes 10-19/100');
  assert.equal(String(res.headers['content-length']), '10');
  assert.equal(res.body.toString(), BODY.subarray(10, 20).toString());
});

test('s3: missing key → 404', async () => {
  assert.equal((await viaS3('video/gone.mp4', undefined)).status, 404);
});

test('s3: bad key never reaches the store → 400', async () => {
  assert.equal((await viaS3('../secret', undefined)).status, 400);
});

// The point of the whole change: the route cannot tell the backends apart.
for (const [label, range] of [['plain GET', undefined], ['open-ended', 'bytes=0-'],
  ['closed', 'bytes=10-19'], ['tail', 'bytes=90-'], ['unsatisfiable', 'bytes=500-600']]) {
  test(`s3 and gcs agree on ${label}`, async () => {
    const [s3, gcs] = [await viaS3('video/abc.mp4', range), await viaGcs('video/abc.mp4', range)];
    assert.equal(gcs.status, s3.status);
    // 416 is the one place the bodies differ by nature — S3 answers with an XML
    // error document, GCS with nothing — so content-length is compared only
    // where a body is actually served.
    if (s3.status !== 416)
      assert.equal(String(gcs.headers['content-length'] ?? ''), String(s3.headers['content-length'] ?? ''));
    assert.equal(gcs.headers['content-range'], s3.headers['content-range']);
    assert.equal(gcs.headers['content-type'], s3.headers['content-type']);
    assert.equal(gcs.headers['accept-ranges'], s3.headers['accept-ranges']);
    assert.equal(gcs.headers['cache-control'], s3.headers['cache-control']);
    assert.equal(gcs.headers['last-modified'], s3.headers['last-modified']);
    assert.equal(gcs.headers.etag, s3.headers.etag);
    assert.equal(gcs.body.toString(), s3.body.toString());
  });
}

test('s3 and gcs agree on a missing key', async () => {
  assert.equal((await viaGcs('video/gone.mp4', 'bytes=0-')).status,
    (await viaS3('video/gone.mp4', 'bytes=0-')).status);
});
