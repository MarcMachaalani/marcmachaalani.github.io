import { createHash } from 'node:crypto';

// Cloudflare's streaming digest API, backed by Node's incremental hash for local tests.
if (!crypto.DigestStream) crypto.DigestStream = class DigestStream extends WritableStream {
  constructor(algorithm) {
    const hash = createHash(algorithm.toLowerCase().replace('-', ''));
    let resolve, reject;
    const digest = new Promise((yes, no) => { resolve = yes; reject = no; });
    super({ write(chunk) { hash.update(chunk); }, close() { const bytes = hash.digest(); resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }, abort(reason) { reject(reason); } });
    this.digest = digest;
  }
};
