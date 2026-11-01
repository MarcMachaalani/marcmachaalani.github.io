import { photoPublished } from './content.mjs';
export const MEDIA_CAPACITY = 200 * 1024 * 1024;
export const LIMITS = { pdf: 30 * 1024 * 1024, photo: 6 * 1024 * 1024 };
const CHUNK_SIZE = 128 * 1024;
const CHUNKS_PER_BATCH = 8;
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
  const storage = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS used FROM media_assets').first();
  const digestStream = new crypto.DigestStream('SHA-256');
  digestStream.digest.catch(() => {});
  const digestWriter = digestStream.getWriter();
  let id, size = 0, mime, offset = 0, part = 0, storedBytes = 0;
  let buffer = new Uint8Array(CHUNK_SIZE), pending = [];
  const prefix = new Uint8Array(12); let prefixSize = 0;
  async function begin() {
    mime = detectFile(prefix.slice(0, prefixSize), kind);
    id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO media_assets (id, kind, filename, mime, bytes, sha256) VALUES (?, ?, ?, ?, ?, ?)').bind(id, kind, filename, mime, 0, '').run();
  }
  function queueChunk(bytes) {
    storedBytes += bytes.length;
    pending.push(env.DB.prepare('INSERT INTO media_chunks (asset_id, part, data) VALUES (?, ?, ?)').bind(id, part++, bytes.buffer));
  }
  async function flush() {
    if (!pending.length) return;
    pending.push(env.DB.prepare('UPDATE media_assets SET bytes = ? WHERE id = ?').bind(storedBytes, id));
    await env.DB.batch(pending); pending = [];
  }
  try {
    // Hash and store the incoming stream in bounded batches; never buffer the whole PDF.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) fail(413, 'Keep PDFs at or below 30 MB and photos at or below 6 MB.');
      if (storage.used + size > MEDIA_CAPACITY) fail(413, 'Your media library is full. Contact the site maintainer to increase its storage.');
      await digestWriter.write(value);
      if (prefixSize < prefix.length) {
        const count = Math.min(prefix.length - prefixSize, value.length);
        prefix.set(value.subarray(0, count), prefixSize); prefixSize += count;
        if (prefixSize === prefix.length) await begin();
      }
      for (let position = 0; position < value.length;) {
        const count = Math.min(CHUNK_SIZE - offset, value.length - position);
        buffer.set(value.subarray(position, position + count), offset); offset += count; position += count;
        if (offset === CHUNK_SIZE) {
          queueChunk(buffer); buffer = new Uint8Array(CHUNK_SIZE); offset = 0;
          if (pending.length === CHUNKS_PER_BATCH) await flush();
        }
      }
    }
    if (!size) fail(400, 'This file is empty.');
    if (!id) await begin();
    if (offset) queueChunk(buffer.slice(0, offset));
    await flush();
    await digestWriter.close();
    const digest = Array.from(new Uint8Array(await digestStream.digest), n => n.toString(16).padStart(2, '0')).join('');
    const existing = await env.DB.prepare(`SELECT ${selectFields} FROM media_assets WHERE kind = ? AND sha256 = ? AND complete = 1 LIMIT 1`).bind(kind, digest).first();
    if (existing) {
      await env.DB.prepare('DELETE FROM media_assets WHERE id = ? AND complete = 0').bind(id).run();
      return { ...existing, reused: true };
    }
    await env.DB.prepare('UPDATE media_assets SET sha256 = ?, complete = 1 WHERE id = ?').bind(digest, id).run();
    return assetInfo(env, id);
  } catch (error) {
    await reader.cancel().catch(() => {});
    await digestWriter.abort(error).catch(() => {});
    if (id) await env.DB.prepare('DELETE FROM media_assets WHERE id = ? AND complete = 0').bind(id).run();
    throw error;
  }
}
export async function assetResponse(env, id, photoOnly = false) {
  const asset = await assetInfo(env, id);
  if (photoOnly && asset.kind !== 'photo') fail(404, 'Photo not found.');
  let nextPart = 0, sent = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      const { results } = await env.DB.prepare('SELECT part, data FROM media_chunks WHERE asset_id = ? AND part >= ? ORDER BY part LIMIT 8').bind(id, nextPart).all();
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
export async function publicPhoto(request, env) {
  const id = new URL(request.url).pathname.slice('/photos/'.length);
  if (!validAssetId(id) || !await photoPublished(env,id)) fail(404,'Photo not found.');
  return assetResponse(env,id,true);
}
