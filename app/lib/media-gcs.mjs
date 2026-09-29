// GCS media backend — server-side streaming with @google-cloud/storage.
// On Cloud Run credentials come from the runtime service account through ADC,
// so nothing here takes a key file. No signed URLs and no S3-interop signing
// (that signing is broken for this stack): every byte is read by this server
// with file.createReadStream({start, end}) and piped to the client, so the
// Range contract the video player relies on is built here, from object
// metadata, instead of being proxied from an upstream response.

let pending = null; // one lazily-built backend per process

// Parse an HTTP Range header against a known object size.
//   null                  → no usable range; serve the whole object (200)
//   { start, end }        → inclusive byte offsets; serve 206
//   { unsatisfiable:true } → serve 416
// An unparseable header or an unknown range unit is ignored (RFC 9110 §14.2).
// A multi-range request is served as its first range — a 206 is allowed to
// answer with a single part, and browsers only ever send one range for video.
export function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const unit = /^bytes\s*=\s*(.+)$/i.exec(String(rangeHeader).trim());
  if (!unit) return null;
  const spec = /^(\d*)-(\d*)$/.exec(unit[1].split(',')[0].trim());
  if (!spec || (spec[1] === '' && spec[2] === '')) return null;
  let start, end;
  if (spec[1] === '') {                       // suffix range: the last N bytes
    const n = Number(spec[2]);
    if (n === 0) return { unsatisfiable: true };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(spec[1]);
    end = spec[2] === '' ? size - 1 : Math.min(Number(spec[2]), size - 1);
  }
  if (!(size > 0) || start > end || start >= size) return { unsatisfiable: true };
  return { start, end };
}

const isNotFound = err => Number(err?.code) === 404 || Number(err?.status) === 404;
// GCS metadata etags are unquoted; an ETag header field has to be a quoted-string.
const quoteEtag = v => (/^(W\/)?".*"$/.test(v) ? v : `"${String(v).replace(/"/g, '')}"`);

// Backend over an injected storage client — the seam the unit tests mock.
export function createGcsBackend({ storage, bucket }) {
  if (!bucket) throw new Error('MEDIA_BACKEND=gcs requires GCS_BUCKET');
  const fileFor = key => storage.bucket(bucket).file(key);

  async function proxyObject(key, rangeHeader, res) {
    let md;
    try {
      [md] = await fileFor(key).getMetadata();
    } catch (err) {
      if (isNotFound(err)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(502); res.end(`media fetch failed: ${err.message}`); return;
    }
    const size = Number(md.size ?? 0);
    const range = parseRange(rangeHeader, size);
    const h = {
      'content-type': md.contentType || 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
    };
    if (md.updated) h['last-modified'] = new Date(md.updated).toUTCString();
    if (md.etag) h.etag = quoteEtag(md.etag);

    if (range?.unsatisfiable) {
      res.writeHead(416, { ...h, 'content-length': 0, 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
    if (range) {
      h['content-length'] = range.end - range.start + 1;
      h['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
    } else {
      h['content-length'] = size;
    }
    const up = fileFor(key).createReadStream(range ? { start: range.start, end: range.end } : {});
    up.on('error', err => {
      if (res.headersSent) { res.destroy(); return; }   // mid-body failure: cut the socket
      res.writeHead(502); res.end(`media fetch failed: ${err.message}`);
    });
    res.writeHead(range ? 206 : 200, h);
    up.pipe(res);
  }

  async function fetchObject(key) {
    try {
      const [buf] = await fileFor(key).download();
      return buf;
    } catch (err) {
      if (isNotFound(err)) return null;   // same as the S3 backend: skip the asset
      throw err;
    }
  }

  return { name: 'gcs', target: `gs://${bucket}`, proxyObject, fetchObject };
}

// Real backend: ADC credentials, bucket from GCS_BUCKET. The SDK is imported
// dynamically so the default S3 path never loads it.
export function gcsBackend() {
  if (!pending) {
    pending = import('@google-cloud/storage').then(({ Storage }) =>
      createGcsBackend({ storage: new Storage(), bucket: process.env.GCS_BUCKET }));
  }
  return pending;
}
