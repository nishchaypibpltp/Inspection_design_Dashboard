// Test doubles: a @google-cloud/storage-shaped client and an http.ServerResponse
// -shaped sink. No network, no credentials — the live GCS path is verified by
// deploy, the semantics are verified here.
import { Readable, Writable } from 'node:stream';

// objects: { '<key>': { body: Buffer, contentType, updated, etag,
//                       metaError, streamError } }
export function fakeStorage(objects, expectBucket) {
  const calls = [];
  return {
    calls,
    bucket(name) {
      if (expectBucket && name !== expectBucket) throw new Error(`wrong bucket ${name}`);
      return {
        file(key) {
          const o = objects[key];
          return {
            async getMetadata() {
              calls.push({ op: 'getMetadata', key });
              if (o?.metaError) throw o.metaError;
              if (!o) throw notFound();
              return [{ size: String(o.body.length), contentType: o.contentType, updated: o.updated, etag: o.etag }];
            },
            createReadStream(opts) {
              calls.push({ op: 'createReadStream', key, opts });
              if (o?.streamError) {
                const s = new Readable({ read() {} });
                setImmediate(() => s.emit('error', o.streamError));
                return s;
              }
              const body = opts && opts.start !== undefined
                ? o.body.subarray(opts.start, opts.end + 1)
                : o.body;
              return Readable.from([body]);
            },
            async download() {
              calls.push({ op: 'download', key });
              if (!o) throw notFound();
              return [o.body];
            },
          };
        },
      };
    },
  };
}

export function notFound() {
  const e = new Error('No such object');
  e.code = 404;
  return e;
}

export class FakeRes extends Writable {
  constructor() {
    super();
    this.status = null;
    this.headers = null;
    this.headersSent = false;
    this.chunks = [];
  }
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers || {};
    this.headersSent = true;
    return this;
  }
  _write(chunk, _enc, cb) { this.chunks.push(Buffer.from(chunk)); cb(); }
  get body() { return Buffer.concat(this.chunks); }
  // Resolves when the response is finished or torn down.
  settled() {
    return new Promise(resolve => {
      this.on('finish', resolve);
      this.on('close', resolve);
      this.on('error', resolve);
    });
  }
}
