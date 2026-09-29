// S3 media backend — read-only HTTP GETs against an S3-compatible endpoint (the
// local Floci emulator by default). Unsigned requests are accepted by the
// emulator; nothing here can write. The Range header is forwarded untouched and
// the upstream status + headers are passed through, which is what gives the
// video player its 206s.
import http from 'node:http';

const S3 = process.env.S3_ENDPOINT || 'http://127.0.0.1:4566';
const BUCKET = process.env.S3_BUCKET || 'vehicle-inspection-local';

function proxyObject(key, rangeHeader, res) {
  const url = new URL(`${S3}/${BUCKET}/${key}`);
  const headers = {};
  if (rangeHeader) headers.Range = rangeHeader;
  http.get(url, { headers }, up => {
    const h = {
      'content-type': up.headers['content-type'] || 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
    };
    for (const k of ['content-length', 'content-range', 'last-modified', 'etag'])
      if (up.headers[k]) h[k] = up.headers[k];
    res.writeHead(up.statusCode, h);
    up.pipe(res);
  }).on('error', err => { res.writeHead(502); res.end(`media fetch failed: ${err.message}`); });
}

function fetchObject(key) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${S3}/${BUCKET}/${key}`);
    http.get(url, up => {
      if (up.statusCode !== 200) { up.resume(); return resolve(null); }
      const chunks = [];
      up.on('data', c => chunks.push(c));
      up.on('end', () => resolve(Buffer.concat(chunks)));
      up.on('error', reject);
    }).on('error', reject);
  });
}

export function s3Backend() {
  return { name: 's3', target: `${S3}/${BUCKET}`, proxyObject, fetchObject };
}
