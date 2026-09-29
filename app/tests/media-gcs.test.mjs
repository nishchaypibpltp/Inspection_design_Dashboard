// GCS backend semantics: Range math, the exact response the video player needs,
// and the failure modes. Mocked storage client — no live GCS call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange, createGcsBackend } from '../lib/media-gcs.mjs';
import { fakeStorage, notFound, FakeRes } from './fakes.mjs';

const BODY = Buffer.from('0123456789'.repeat(10)); // 100 bytes
const OBJECTS = () => ({
  'video/abc.mp4': {
    body: BODY, contentType: 'video/mp4',
    updated: '2026-08-20T10:00:00.000Z', etag: 'CKGf3O7Wu+ECEAE=',
  },
  'photo/front.jpg': { body: Buffer.from('jpegbytes'), contentType: 'image/jpeg' },
});

function backendFor(objects = OBJECTS()) {
  const storage = fakeStorage(objects, 'poc-media');
  return { backend: createGcsBackend({ storage, bucket: 'poc-media' }), storage };
}

// ─── Range math ────────────────────────────────────────────────────────────────
test('parseRange: no header serves the whole object', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.equal(parseRange('', 100), null);
});

test('parseRange: open-ended range (what Chrome opens a video with)', () => {
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
});

test('parseRange: closed range', () => {
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange('bytes=0-1', 100), { start: 0, end: 1 });
});

test('parseRange: end past EOF clamps to the last byte', () => {
  assert.deepEqual(parseRange('bytes=50-999', 100), { start: 50, end: 99 });
});

test('parseRange: suffix range takes the last N bytes, clamped at 0', () => {
  assert.deepEqual(parseRange('bytes=-20', 100), { start: 80, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
});

test('parseRange: multi-range is served as its first range', () => {
  assert.deepEqual(parseRange('bytes=0-9,20-29', 100), { start: 0, end: 9 });
});

test('parseRange: whitespace and case tolerated', () => {
  assert.deepEqual(parseRange('Bytes = 10-19 ', 100), { start: 10, end: 19 });
});

test('parseRange: start past EOF, empty suffix and empty object are unsatisfiable', () => {
  assert.deepEqual(parseRange('bytes=100-', 100), { unsatisfiable: true });
  assert.deepEqual(parseRange('bytes=120-140', 100), { unsatisfiable: true });
  assert.deepEqual(parseRange('bytes=-0', 100), { unsatisfiable: true });
  assert.deepEqual(parseRange('bytes=0-', 0), { unsatisfiable: true });
});

test('parseRange: unknown unit or garbage is ignored, not rejected', () => {
  assert.equal(parseRange('items=0-1', 100), null);
  assert.equal(parseRange('bytes=abc', 100), null);
  assert.equal(parseRange('bytes=-', 100), null);
  assert.equal(parseRange('0-10', 100), null);
});

// ─── proxyObject responses ─────────────────────────────────────────────────────
test('plain GET → 200, full body, seekable headers', async () => {
  const { backend, storage } = backendFor();
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('video/abc.mp4', undefined, res);
  await done;
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'video/mp4');
  assert.equal(res.headers['content-length'], 100);
  assert.equal(res.headers['accept-ranges'], 'bytes');
  assert.equal(res.headers['cache-control'], 'private, max-age=3600');
  assert.equal(res.headers['last-modified'], 'Thu, 20 Aug 2026 10:00:00 GMT');
  assert.equal(res.headers.etag, '"CKGf3O7Wu+ECEAE="');
  assert.equal(res.headers['content-range'], undefined);
  assert.equal(res.body.length, 100);
  // whole-object read: no start/end passed to the SDK
  const read = storage.calls.find(c => c.op === 'createReadStream');
  assert.deepEqual(read.opts, {});
});

test('Range GET → 206 with content-range, and only those bytes are read', async () => {
  const { backend, storage } = backendFor();
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('video/abc.mp4', 'bytes=10-19', res);
  await done;
  assert.equal(res.status, 206);
  assert.equal(res.headers['content-range'], 'bytes 10-19/100');
  assert.equal(res.headers['content-length'], 10);
  assert.equal(res.headers['accept-ranges'], 'bytes');
  assert.equal(res.body.toString(), BODY.subarray(10, 20).toString());
  const read = storage.calls.find(c => c.op === 'createReadStream');
  assert.deepEqual(read.opts, { start: 10, end: 19 }); // server-side range, inclusive
});

test('open-ended Range GET → 206 to EOF', async () => {
  const { backend, storage } = backendFor();
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('video/abc.mp4', 'bytes=0-', res);
  await done;
  assert.equal(res.status, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-99/100');
  assert.equal(res.headers['content-length'], 100);
  assert.equal(res.body.length, 100);
  assert.deepEqual(storage.calls.find(c => c.op === 'createReadStream').opts, { start: 0, end: 99 });
});

test('unsatisfiable Range → 416 with bytes *​/size, no body read', async () => {
  const { backend, storage } = backendFor();
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('video/abc.mp4', 'bytes=500-600', res);
  await done;
  assert.equal(res.status, 416);
  assert.equal(res.headers['content-range'], 'bytes */100');
  assert.equal(res.headers['content-length'], 0);
  assert.equal(res.body.length, 0);
  assert.equal(storage.calls.some(c => c.op === 'createReadStream'), false);
});

test('photo GET → 200 with its own content-type', async () => {
  const { backend } = backendFor();
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('photo/front.jpg', undefined, res);
  await done;
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.equal(res.body.toString(), 'jpegbytes');
});

test('object with no contentType falls back to octet-stream', async () => {
  const { backend } = backendFor({ 'blob/x': { body: Buffer.from('x') } });
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('blob/x', undefined, res);
  await done;
  assert.equal(res.headers['content-type'], 'application/octet-stream');
  assert.equal(res.headers['last-modified'], undefined);
  assert.equal(res.headers.etag, undefined);
});

test('missing key → 404', async () => {
  const { backend } = backendFor();
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('video/gone.mp4', 'bytes=0-', res);
  await done;
  assert.equal(res.status, 404);
});

test('store error → 502 with the reason', async () => {
  const boom = Object.assign(new Error('backend unavailable'), { code: 503 });
  const { backend } = backendFor({ 'video/abc.mp4': { body: BODY, metaError: boom } });
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('video/abc.mp4', undefined, res);
  await done;
  assert.equal(res.status, 502);
  assert.match(res.body.toString(), /media fetch failed: backend unavailable/);
});

test('mid-body stream failure tears the response down (headers already sent)', async () => {
  const { backend } = backendFor({
    'video/abc.mp4': { body: BODY, contentType: 'video/mp4', streamError: new Error('reset') },
  });
  const res = new FakeRes();
  const done = res.settled();
  await backend.proxyObject('video/abc.mp4', 'bytes=0-9', res);
  await done;
  assert.equal(res.status, 206);        // headers were already committed
  assert.equal(res.destroyed, true);    // and the socket is cut, not left hanging
});

// ─── fetchObject (what the evidence ZIP pulls) ─────────────────────────────────
test('fetchObject returns the whole object', async () => {
  const { backend } = backendFor();
  assert.equal((await backend.fetchObject('photo/front.jpg')).toString(), 'jpegbytes');
});

test('fetchObject returns null for a missing key (asset is skipped, ZIP still builds)', async () => {
  const { backend } = backendFor();
  assert.equal(await backend.fetchObject('photo/gone.jpg'), null);
});

test('fetchObject rethrows a non-404', async () => {
  const storage = fakeStorage({});
  const backend = createGcsBackend({ storage, bucket: 'poc-media' });
  storage.bucket = () => ({ file: () => ({ download: async () => { throw new Error('quota'); } }) });
  await assert.rejects(() => backend.fetchObject('k'), /quota/);
});

test('bucket is required', () => {
  assert.throws(() => createGcsBackend({ storage: fakeStorage({}), bucket: '' }), /requires GCS_BUCKET/);
});

test('reads go to the configured bucket only', async () => {
  const storage = fakeStorage(OBJECTS(), 'poc-media');
  const backend = createGcsBackend({ storage, bucket: 'poc-media' });
  assert.equal((await backend.fetchObject('photo/front.jpg')).length, 9);
  assert.equal(backend.target, 'gs://poc-media');
  assert.equal(notFound().code, 404);
});
