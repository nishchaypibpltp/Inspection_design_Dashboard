// Inspection Tracker — Phase 1. Read-only dashboard over the vehicle-inspection
// POC stack: Postgres (sessions/stages/assets/findings) + object storage for
// media — Floci S3 locally, GCS on Cloud Run (MEDIA_BACKEND).
// It never writes to the inspection database or bucket.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summary, daily, stageMetrics } from './lib/queries.mjs';
import { listCases, caseFile } from './lib/cases.mjs';
import { proxyMedia, buildEvidenceZip, mediaBackendName } from './lib/media.mjs';
import { productMetrics } from './lib/product-metrics.mjs';

const PORT = Number(process.env.PORT) || 8787;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const g = k => url.searchParams.get(k) || null;
  try {
    if (p === '/api/summary') return json(res, await summary(g('from'), g('to')));
    if (p === '/api/daily') return json(res, await daily(g('from'), g('to')));
    if (p === '/api/stage-metrics') return json(res, await stageMetrics(g('from'), g('to')));
    if (p === '/api/product-metrics') return json(res, await productMetrics(g('from'), g('to')));
    if (p === '/api/cases') {
      return json(res, await listCases({
        qtext: g('q'), from: g('from'), to: g('to'),
        buckets: g('status') ? g('status').split(',').filter(Boolean) : null,
        limit: Math.min(Number(g('limit')) || 100, 500),
        offset: Number(g('offset')) || 0,
      }));
    }
    let m;
    if ((m = p.match(/^\/api\/case\/([0-9a-f-]{36})$/))) {
      const data = await caseFile(m[1]);
      return data ? json(res, data) : json(res, { error: 'not found' }, 404);
    }
    if ((m = p.match(/^\/api\/case\/([0-9a-f-]{36})\/evidence\.zip$/))) {
      const data = await caseFile(m[1]);
      if (!data) return json(res, { error: 'not found' }, 404);
      const zip = await buildEvidenceZip(data);
      if (!zip) return json(res, { error: 'no media stored for this case' }, 404);
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': zip.size,
        'content-disposition': `attachment; filename="evidence-${data.session.vehicle_reg}-${m[1].slice(0, 8)}.zip"`,
      });
      zip.stream().pipe(res).on('close', () => zip.cleanup());
      return;
    }
    if (p === '/api/media') {
      const key = g('key');
      if (!key) return json(res, { error: 'key required' }, 400);
      return proxyMedia(key, req.headers.range, res);
    }

    // static
    const file = p === '/' ? '/index.html' : p;
    if (/^\/[A-Za-z0-9._-]+$/.test(file)) {
      try {
        const buf = await readFile(path.join(PUB, file.slice(1)));
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'text/plain' });
        return res.end(buf);
      } catch { /* fall through */ }
    }
    res.writeHead(404); res.end('not found');
  } catch (err) {
    console.error(`[error] ${p}:`, err.message);
    json(res, { error: err.message }, 500);
  }
});

const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () =>
  console.log(`Inspection Tracker (phase 1) → http://${HOST}:${PORT} · media: ${mediaBackendName()}`));
