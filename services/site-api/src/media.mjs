export const MEDIA_CAPACITY = 200 * 1024 * 1024;
export const LIMITS = { pdf: 10 * 1024 * 1024, photo: 6 * 1024 * 1024 };
const CHUNK_SIZE = 128 * 1024;
const assetPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validAssetId = id => typeof id === 'string' && assetPattern.test(id);
function fail(status, message) { const error = new Error(message); error.status = status; error.publicMessage = true; throw error; }
const selectFields = 'id, kind, filename, mime, bytes, created_at';
export async function assetInfo(env, id) {
  if (!validAssetId(id)) fail(400, 'Invalid media selection.');
  const asset = await env.DB.prepare(`SELECT ${selectFields} FROM media_assets WHERE id = ? AND complete = 1`).bind(id).first();
  if (!asset) fail(404, 'This upload could not be found.');
  return asset;
}
export async function library(env) {
  const [assets, storage] = await env.DB.batch([
    env.DB.prepare(`SELECT ${selectFields} FROM media_assets WHERE complete = 1 ORDER BY created_at DESC, id DESC LIMIT 500`),
    env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS used FROM media_assets')
  ]);
  return { assets: assets.results, used: storage.results[0].used, capacity: MEDIA_CAPACITY };
}
export function detectFile(bytes, kind) {
  if (kind === 'pdf' && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  if (kind !== 'photo') fail(400, 'Please choose a valid PDF file.');
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return 'image/png';
  const ascii = new TextDecoder().decode(bytes.slice(0, 12));
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  fail(400, 'Please choose a JPEG, PNG, or WebP photo.');
}
export async function upload(request, env) {
  const kind = new URL(request.url).searchParams.get('kind');
  if (!LIMITS[kind]) fail(400, 'Choose a paper PDF or a photo.');
  let filename;
  try { filename = decodeURIComponent(request.headers.get('X-File-Name') || ''); } catch { fail(400, 'Invalid file name.'); }
  if (!filename || filename.length > 200 || /[\x00-\x1f\x7f/\\]/.test(filename)) fail(400, 'Please use a shorter, plain file name.');
  const limit = LIMITS[kind];
  if (Number(request.headers.get('Content-Length')) > limit) fail(413, `This ${kind === 'pdf' ? 'PDF' : 'photo'} is too large.`);
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Choose a file first.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); fail(413, `Keep PDFs below 10 MB and photos below 6 MB.`); }
    chunks.push(value);
  }
  if (!size) fail(400, 'This file is empty.');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const mime = detectFile(bytes, kind);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  const existing = await env.DB.prepare(`SELECT ${selectFields} FROM media_assets WHERE kind = ? AND sha256 = ? AND complete = 1 LIMIT 1`).bind(kind, digest).first();
  if (existing) return { ...existing, reused: true };
  const storage = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS used FROM media_assets').first();
  if (storage.used + size > MEDIA_CAPACITY) fail(413, 'Your media library is full. Contact the site maintainer to increase its storage.');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO media_assets (id, kind, filename, mime, bytes, sha256) VALUES (?, ?, ?, ?, ?, ?)').bind(id, kind, filename, mime, size, digest).run();
  try {
    // Small batches stay within request and row limits; an upload is visible only when complete.
    for (let start = 0; start < size; start += CHUNK_SIZE * 4) {
      const statements = [];
      for (let pos = start; pos < Math.min(start + CHUNK_SIZE * 4, size); pos += CHUNK_SIZE) {
        statements.push(env.DB.prepare('INSERT INTO media_chunks (asset_id, part, data) VALUES (?, ?, ?)').bind(id, pos / CHUNK_SIZE, bytes.slice(pos, pos + CHUNK_SIZE).buffer));
      }
      await env.DB.batch(statements);
    }
    await env.DB.prepare('UPDATE media_assets SET complete = 1 WHERE id = ?').bind(id).run();
    return assetInfo(env, id);
  } catch (error) {
    await env.DB.prepare('DELETE FROM media_assets WHERE id = ? AND complete = 0').bind(id).run();
    throw error;
  }
}
export async function assetResponse(env, id, photoOnly = false) {
  const asset = await assetInfo(env, id);
  if (photoOnly && asset.kind !== 'photo') fail(404, 'Photo not found.');
  let nextPart = 0, sent = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      const { results } = await env.DB.prepare('SELECT part, data FROM media_chunks WHERE asset_id = ? AND part >= ? ORDER BY part LIMIT 4').bind(id, nextPart).all();
      if (!results.length) { controller.error(new Error('Upload data is incomplete.')); return; }
      for (const chunk of results) {
        if (chunk.part !== nextPart++) { controller.error(new Error('Upload data is incomplete.')); return; }
        const bytes = new Uint8Array(chunk.data); sent += bytes.length; controller.enqueue(bytes);
      }
      if (sent === asset.bytes) controller.close();
      else if (sent > asset.bytes) controller.error(new Error('Upload data is invalid.'));
    }
  });
  return new Response(stream, { headers: { 'Content-Type': asset.mime, 'Content-Length': String(asset.bytes),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}` } });
}
export function validateMedia(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Invalid media selections.');
  if (Object.keys(value).some(key => !['private_pdf', 'gallery'].includes(key))) fail(400, 'Invalid media selection.');
  const media = {};
  if ('private_pdf' in value) {
    if (value.private_pdf !== null && !validAssetId(value.private_pdf)) fail(400, 'Choose an uploaded paper PDF.');
    media.private_pdf = value.private_pdf;
  }
  if ('gallery' in value) {
    if (!Array.isArray(value.gallery) || value.gallery.length > 24) fail(400, 'Keep each gallery to 24 photos.');
    const seen = new Set();
    media.gallery = value.gallery.map(photo => {
      if (!photo || !validAssetId(photo.id) || seen.has(photo.id) || typeof photo.alt !== 'string' || !photo.alt.trim() || photo.alt.length > 180 || typeof photo.caption !== 'string' || photo.caption.length > 500) fail(400, 'Add a short image description to every photo and avoid duplicate photos.');
      seen.add(photo.id);
      return { id: photo.id, alt: photo.alt.trim(), caption: photo.caption.trim() };
    });
  }
  return media;
}
export async function checkMediaAssets(env, path, media) {
  const value = validateMedia(media);
  if (value.private_pdf) {
    if (!path.startsWith('_publications/')) fail(400, 'Paper PDFs belong to publication records.');
    if ((await assetInfo(env, value.private_pdf)).kind !== 'pdf') fail(400, 'Choose a PDF for this paper.');
  }
  for (const photo of value.gallery || []) {
    if ((await assetInfo(env, photo.id)).kind !== 'photo') fail(400, 'Only photos can be added to a gallery.');
  }
  return value;
}
let publishedPhotos = { origin: '', expires: 0, ids: new Set() };
export async function publicPhoto(request, env) {
  const id = new URL(request.url).pathname.slice('/photos/'.length);
  if (!validAssetId(id)) fail(404, 'Photo not found.');
  if (publishedPhotos.origin !== env.SITE_ORIGIN || publishedPhotos.expires < Date.now()) {
    const result = await fetch(`${env.SITE_ORIGIN}/assets/data/published-photos.json`, { cf: { cacheTtl: 30 }, signal: AbortSignal.timeout(5000) });
    if (!result.ok) fail(404, 'Photo not found.');
    const ids = await result.json();
    if (!Array.isArray(ids) || ids.length > 10000) fail(404, 'Photo not found.');
    publishedPhotos = { origin: env.SITE_ORIGIN, expires: Date.now() + 30000, ids: new Set(ids) };
  }
  if (!publishedPhotos.ids.has(id)) fail(404, 'Photo not found.');
  return assetResponse(env, id, true);
}
