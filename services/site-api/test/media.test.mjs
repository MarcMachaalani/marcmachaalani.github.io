import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import './helpers/digest-stream.mjs';
import worker, { sign, mergeContent, splitContent } from '../src/index.mjs';
import { upload, library, detectFile, assetResponse, checkMediaAssets, validateMedia } from '../src/media.mjs';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(readFileSync(new URL('../migrations/0002_private_media.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0003_content.sql',import.meta.url),'utf8'));
  let calls = 0, inBatch = false;
  return { sql, get calls() { return calls; }, resetCalls() { calls = 0; },
    prepare(query) {
      let values = [];
      const prepared = { bind(...args) { values = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return prepared; },
        async first() { if (!inBatch) calls++; return sql.prepare(query).get(...values) || null; },
        async all() { if (!inBatch) calls++; return { results:sql.prepare(query).all(...values) }; },
        async run() { if (!inBatch) calls++; return sql.prepare(query).run(...values); } };
      return prepared;
    },
    async batch(statements) { calls++; inBatch = true; try { return await Promise.all(statements.map(statement => statement.all())); } finally { inBatch = false; } }
  };
}
const base = { SITE_ORIGIN:'https://marcmachaalani.github.io', OWNER_ID:'103030028', SESSION_SECRET:'a-long-random-test-secret-32-characters' };
const pdf = new TextEncoder().encode('%PDF-1.4\nSample private PDF\n%%EOF');
const photo = new Uint8Array([137,80,78,71,13,10,26,10,0,1,2,3]);
function fileRequest(kind, data, name = kind === 'pdf' ? 'Paper.pdf' : 'Photo.png', extra = {}) {
  return new Request(`https://editor.example.com/api/assets?kind=${kind}`,{ method:'POST', headers:{ 'X-File-Name':encodeURIComponent(name), 'Content-Type':kind === 'pdf' ? 'application/pdf' : 'image/png', ...extra }, body:data });
}
async function ownerHeaders() {
  const token = await sign({ kind:'session', id:base.OWNER_ID, csrf:'csrf', exp:Date.now() + 60000 },base);
  return { Cookie:`__Host-marc-session=${token}`, Origin:'https://editor.example.com','X-CSRF-Token':'csrf' };
}
test('PDF binary round trip spans chunks, preserves exact bytes, and deduplicates',async () => {
  const DB = database(); const env = { ...base,DB };
  const bytes = new Uint8Array(1100000); bytes.set(pdf); bytes.fill(42,pdf.length);
  const saved = await upload(fileRequest('pdf',bytes),env);
  assert.equal(saved.kind,'pdf'); assert.equal(saved.bytes,bytes.length);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS count FROM media_chunks').get().count,9);
  const response = await assetResponse(env,saved.id);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  assert.match(response.headers.get('Content-Disposition'),/Paper.pdf/);
  assert.equal((await upload(fileRequest('pdf',bytes),env)).id,saved.id);
  assert.equal((await library(env)).assets.length,1);
});
test('owner upload and read require authentication and mutation CSRF',async () => {
  const env = { ...base,DB:database() };
  assert.equal((await worker.fetch(fileRequest('pdf',pdf),env)).status,401);
  assert.equal((await worker.fetch(fileRequest('pdf',pdf,'Paper.pdf',{ ...await ownerHeaders(),'X-CSRF-Token':'' }),env)).status,403);
  const saved = await upload(fileRequest('pdf',pdf),env);
  assert.equal((await worker.fetch(new Request(`https://editor.example.com/api/assets/${saved.id}`),env)).status,401);
  assert.equal((await worker.fetch(new Request('https://editor.example.com/api/assets'),env)).status,401);
});
test('upload route stores and returns private metadata for the owner',async () => {
  const env = { ...base,DB:database() };
  const response = await worker.fetch(fileRequest('pdf',pdf,'Paper.pdf',await ownerHeaders()),env);
  assert.equal(response.status,201); const saved = await response.json();
  const read = await worker.fetch(new Request(`https://editor.example.com/api/assets/${saved.id}`,{ headers:await ownerHeaders() }),env);
  assert.equal(read.status,200); assert.deepEqual(new Uint8Array(await read.arrayBuffer()),pdf);
  assert.equal(read.headers.get('Cache-Control'),'no-store');
});
test('rejects renamed HTML/SVG files, empty uploads, traversal names and oversized bodies',async () => {
  const env = { ...base,DB:database() };
  for (const req of [fileRequest('pdf','<html>fake PDF</html>'),fileRequest('photo','<svg>fake</svg>'),fileRequest('pdf',new Uint8Array()),fileRequest('pdf',pdf,'../secret.pdf')]) await assert.rejects(upload(req,env));
  await assert.rejects(upload(fileRequest('pdf',pdf,'Big.pdf',{ 'Content-Length':String(31 * 1024 * 1024) }),env),/too large/);
  assert.equal((await library(env)).assets.length,0);
});
test('PDFs cannot be served as public photos even with a malicious allowlist',async t => {
  const env = { ...base,DB:database() }; const saved = await upload(fileRequest('pdf',pdf),env);
  t.mock.method(globalThis,'fetch',async () => Response.json([saved.id]));
  const result = await worker.fetch(new Request(`https://editor.example.com/photos/${saved.id}`),env);
  assert.equal(result.status,404);
});
test('staged photos stay private, published allowlisted photos become visible',async t => {
  const env = { ...base,SITE_ORIGIN:'https://photo-test.example',DB:database() }; const saved = await upload(fileRequest('photo',photo),env);
  t.mock.method(globalThis,'fetch',async () => Response.json([]));
  assert.equal((await worker.fetch(new Request(`https://editor.example.com/photos/${saved.id}`),env)).status,404);
  const published = { ...env,SITE_ORIGIN:'https://published-photo.example' };
  t.mock.method(globalThis,'fetch',async () => Response.json([{path:'_pages/about.md',url:'/',fields:{title:'Home'},body:'',media:{gallery:[{id:saved.id,alt:'Photo',caption:''}]}}]));
  const response = await worker.fetch(new Request(`https://editor.example.com/photos/${saved.id}`),published);
  assert.equal(response.status,200); assert.equal(response.headers.get('Content-Type'),'image/png');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),photo);
});
test('gallery selections require real photo IDs and accessible image descriptions',async () => {
  const env = { ...base,DB:database() }; const savedPdf = await upload(fileRequest('pdf',pdf),env); const savedPhoto = await upload(fileRequest('photo',photo),env);
  await assert.rejects(checkMediaAssets(env,'_pages/about.md',{ private_pdf:savedPdf.id }),/publication records/);
  await assert.rejects(checkMediaAssets(env,'_publications/paper.md',{ private_pdf:savedPhoto.id }),/Choose a PDF/);
  await assert.rejects(checkMediaAssets(env,'_pages/about.md',{ gallery:[{ id:savedPdf.id,alt:'Example',caption:'' }] }),/Only photos/);
  assert.throws(() => validateMedia({ gallery:[{ id:savedPhoto.id,alt:'',caption:'' }] }),/image description/);
  assert.throws(() => validateMedia({ gallery:Array(25).fill({}) }),/24 photos/);
  const value = await checkMediaAssets(env,'_pages/about.md',{ gallery:[{ id:savedPhoto.id,alt:'Playing piano',caption:'At the conservatory' }] });
  assert.equal(value.gallery[0].alt,'Playing piano');
});
test('private PDF association and galleries preserve publisher links and existing metadata',async () => {
  const id = crypto.randomUUID();
  const original = '---\ntitle: My paper\npaperurl: https://doi.org/10.example/paper\npermalink: /publication/stable/\n---\nBody\n';
  const updated = mergeContent(original,{},'Body\n',{ private_pdf:id,gallery:[{ id:crypto.randomUUID(),alt:'A laboratory photo',caption:'' }] });
  const result = splitContent(updated);
  assert.equal(result.media.private_pdf,id); assert.equal(result.doc.get('paperurl'),'https://doi.org/10.example/paper');
  assert.equal(result.doc.get('permalink'),'/publication/stable/');
  assert.equal(result.media.gallery.length,1);
});
test('a failed chunk write cleans up incomplete private assets',async () => {
  const DB = database(); DB.batch = async () => { throw new Error('Simulated failed write'); };
  await assert.rejects(upload(fileRequest('pdf',pdf),{ ...base,DB }),/failed write/);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS count FROM media_assets').get().count,0);
});
test('file signatures determine the served type, never an arbitrary request type',() => {
  assert.equal(detectFile(pdf,'pdf'),'application/pdf'); assert.equal(detectFile(photo,'photo'),'image/png');
  assert.throws(() => detectFile(new TextEncoder().encode('<script>alert(1)</script>'),'photo'));
});
test('a full 30 MB streamed PDF uploads and opens within the free-plan query budget',async () => {
  const DB = database(), env = { ...base,DB }, size = 30 * 1024 * 1024;
  const expectedHash = createHash('sha256'); let produced = 0;
  const body = new ReadableStream({ pull(controller) {
    if (produced === size) { controller.close(); return; }
    const bytes = new Uint8Array(Math.min(64 * 1024,size - produced)).fill(65);
    if (!produced) bytes.set(pdf); produced += bytes.length; expectedHash.update(bytes); controller.enqueue(bytes);
  }});
  const request = new Request('https://editor.example.com/api/assets?kind=pdf',{ method:'POST',headers:{ 'X-File-Name':'Large.pdf','Content-Length':String(size) },body,duplex:'half' });
  const saved = await upload(request,env); assert.equal(saved.bytes,size); assert.ok(DB.calls < 50,`Upload used ${DB.calls} queries`);
  DB.resetCalls();
  const response = await assetResponse(env,saved.id); const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes.length,size); assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedHash.digest('hex'));
  assert.ok(DB.calls < 50,`Read used ${DB.calls} queries`);
});
test('streaming size violations remove every partial chunk',async () => {
  const DB = database(), env = { ...base,DB }; let produced = 0;
  const body = new ReadableStream({ pull(controller) {
    if (produced++ === 7) { controller.close(); return; }
    const bytes = new Uint8Array(1024 * 1024).fill(65); if (produced === 1) bytes.set(photo); controller.enqueue(bytes);
  }});
  const request = new Request('https://editor.example.com/api/assets?kind=photo',{ method:'POST',headers:{ 'X-File-Name':'Too-large.png' },body,duplex:'half' });
  await assert.rejects(upload(request,env),/6 MB/);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS count FROM media_assets').get().count,0);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS count FROM media_chunks').get().count,0);
});
