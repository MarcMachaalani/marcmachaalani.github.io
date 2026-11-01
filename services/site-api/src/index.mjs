import { parseDocument } from 'yaml';
import * as contentStore from './content.mjs';
import { library, upload, assetResponse, publicPhoto, validateMedia, checkMediaAssets } from './media.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION = '__Host-marc-session';
const OAUTH = '__Host-marc-oauth';
const EDITABLE_PAGES = new Set(['about.md', 'interests.md', 'awards.md', 'publications.html', 'talks.html', 'media.html', 'contact.html']);
const FIELDS = ['title', 'date', 'excerpt', 'venue', 'article_type', 'topics', 'paperurl', 'pubmed', 'citation', 'intro'];
let pathCache = { expires: 0, origin: '', paths: new Set() };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(status, message) { throw new HttpError(status, message); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function bytes64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function unbase64(value) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0)); }
function cookie(request, name) { return request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1); }
function setCookie(name, value, seconds) { return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`; }
function required(env, names) { if (names.some(name => !env[name])) fail(503, 'This service is not configured yet.'); }
function signingKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) fail(503, 'Sign-in is not configured yet.');
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function sign(value, env) {
  const payload = bytes64(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload));
  return `${payload}.${bytes64(new Uint8Array(signature))}`;
}
export async function verify(value, env) {
  if (!value) return null;
  try {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) return null;
    if (!await crypto.subtle.verify('HMAC', await signingKey(env), unbase64(signature), encoder.encode(payload))) return null;
    const data = JSON.parse(decoder.decode(unbase64(payload)));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
async function session(request, env, mutation = false) {
  const value = await verify(cookie(request, SESSION), env);
  if (!value || value.kind !== 'session' || String(value.id) !== env.OWNER_ID) fail(401, 'Please sign in.');
  if (mutation && (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-CSRF-Token') !== value.csrf)) fail(403, 'Invalid request origin or security token. Reload and try again.');
  return value;
}
export async function readJson(request, maxBytes = 24000) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Please send JSON.');
  if (Number(request.headers.get('Content-Length')) > maxBytes) fail(413, 'Message is too large.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'A request body is required.');
  let length = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) { await reader.cancel(); fail(413, 'Message is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const data = JSON.parse(decoder.decode(bytes));
    if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Invalid message.');
    return data;
  } catch { fail(400, 'Invalid JSON.'); }
}
function textField(value, name, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(400, `Please check ${name}.`);
  return value.trim();
}
async function limited(request, limiter) {
  if (!limiter) fail(503, 'Spam protection is not configured yet.');
  const { success } = await limiter.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
  if (!success) fail(429, 'Too many requests. Please try again in a minute.');
}
async function contact(request, env) {
  required(env, ['TURNSTILE_SECRET', 'RESEND_API_KEY', 'CONTACT_TO', 'CONTACT_FROM']);
  await limited(request, env.CONTACT_LIMITER);
  const data = await readJson(request);
  if (data.website) return json({ ok: true });
  const name = textField(data.name, 'your name', 1, 100);
  const email = textField(data.email, 'your email', 3, 254);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail(400, 'Please check your email address.');
  const subject = textField(data.subject, 'the subject', 1, 160);
  if (/[\r\n]/.test(subject + name)) fail(400, 'Please check the name and subject.');
  const message = textField(data.message, 'your message', 10, 5000);
  const token = textField(data['cf-turnstile-response'], 'the spam check', 1, 2048);
  const validation = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }), signal: AbortSignal.timeout(10000)
  });
  if (!validation.ok) fail(502, 'Spam protection is temporarily unavailable.');
  const check = await validation.json();
  if (!check.success || check.hostname !== new URL(env.SITE_ORIGIN).hostname || check.action !== 'contact') fail(400, 'Please complete the spam check and try again.');
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.CONTACT_FROM, to: [env.CONTACT_TO], reply_to: email,
      subject: `[Website] ${subject}`, text: `From: ${name} <${email}>\n\n${message}` }), signal: AbortSignal.timeout(10000)
  });
  if (!sent.ok) fail(502, 'Your message could not be delivered. Please try again later.');
  return json({ ok: true });
}
async function allowedPaths(env) {
  if (pathCache.origin === env.SITE_ORIGIN && pathCache.expires > Date.now()) return pathCache.paths;
  const result = await fetch(`${env.SITE_ORIGIN}/assets/data/usage-paths.json`, { cf: { cacheTtl: 3600 }, signal: AbortSignal.timeout(5000) });
  if (!result.ok) fail(503, 'Page counts are temporarily unavailable.');
  const paths = await result.json();
  if (!Array.isArray(paths) || paths.length > 10000) fail(503, 'Invalid page list.');
  pathCache = { origin: env.SITE_ORIGIN, expires: Date.now() + 3600000, paths: new Set(paths) };
  return pathCache.paths;
}
async function usage(request, env) {
  required(env, ['DB']);
  if (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1') return new Response(null, { status: 204 });
  await limited(request, env.USAGE_LIMITER);
  const data = await readJson(request, 2048);
  if (typeof data.path !== 'string' || data.path.length > 300 || !data.path.startsWith('/') || /[?#\x00-\x20]/.test(data.path) || !(await allowedPaths(env)).has(data.path)) fail(400, 'Unknown page.');
  await env.DB.prepare('INSERT INTO page_views (day, path, views) VALUES (?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET views = views + 1')
    .bind(new Date().toISOString().slice(0, 10), data.path).run();
  return new Response(null, { status: 204 });
}
async function github(env, path, method = 'GET', data, token) {
  required({ token }, ['token']);
  const result = await fetch(`https://api.github.com${path}`, { method,
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MarcSiteEditor', 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000)
  });
  if (!result.ok) fail(result.status === 404 ? 404 : 502, result.status === 404 ? 'Content was not found.' : 'GitHub could not complete the request. Check the service credentials and try again.');
  return result.status === 204 ? null : result.json();
}
async function login(request, env) {
  required(env, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']);
  const state = crypto.randomUUID();
  const verifier = bytes64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = bytes64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
  const payload = await sign({ kind: 'oauth', state, verifier, exp: Date.now() + 600000 }, env);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: new URL('/auth/callback', request.url).href,
    state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  // GitHub verifies identity only. Content is saved and published in D1.
  return new Response(null, { status: 302, headers: { Location: url.href, 'Set-Cookie': setCookie(OAUTH, payload, 600) } });
}
async function callback(request, env) {
  required(env, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OWNER_ID']);
  const params = new URL(request.url).searchParams;
  const pending = await verify(cookie(request, OAUTH), env);
  if (!pending || pending.kind !== 'oauth' || params.get('state') !== pending.state || !params.get('code')) fail(403, 'The sign-in request expired. Please try again.');
  const result = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
      code: params.get('code'), code_verifier: pending.verifier, redirect_uri: new URL('/auth/callback', request.url).href }), signal: AbortSignal.timeout(15000)
  });
  const auth = await result.json();
  if (!result.ok || !auth.access_token) fail(403, 'GitHub sign-in failed.');
  const user = await github(env, '/user', 'GET', undefined, auth.access_token);
  if (String(user.id) !== env.OWNER_ID) fail(403, 'This editor is private to the site owner.');
  const value = await sign({ kind: 'session', id: String(user.id), login: user.login, csrf: crypto.randomUUID(), exp: Date.now() + 28800000 }, env);
  const headers = new Headers({ Location: '/admin/' });
  headers.append('Set-Cookie', setCookie(SESSION, value, 28800));
  headers.append('Set-Cookie', setCookie(OAUTH, '', 0));
  return new Response(null, { status: 302, headers });
}
export function editablePath(path) {
  return typeof path === 'string' && (EDITABLE_PAGES.has(path.replace(/^_pages\//, '')) && path.startsWith('_pages/') || /^_(publications|talks|media)\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.md$/.test(path)) && !path.includes('..');
}
export function splitContent(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) fail(400, 'Content needs YAML front matter.');
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length || !doc.contents || !doc.contents.items) fail(400, 'The content metadata is invalid.');
  const fields = {};
  for (const name of FIELDS) {
    const value = doc.get(name, true)?.toJSON();
    fields[name] = name === 'topics' ? (Array.isArray(value) ? value.join(', ') : '') : (value == null ? '' : String(value));
  }
  const media = { private_pdf: doc.get('private_pdf') || null, gallery: doc.get('gallery', true)?.toJSON() || [] };
  return { doc, fields, body: match[2], media };
}
export function mergeContent(original, fields, body, media) {
  const { doc } = splitContent(original);
  if (typeof body !== 'string' || body.length > 100000 || !fields || typeof fields !== 'object') fail(400, 'Invalid content.');
  for (const [key, value] of Object.entries(fields)) {
    if (!FIELDS.includes(key) || typeof value !== 'string' || value.length > 12000) fail(400, 'Invalid content field.');
    if (key === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Use a date in YYYY-MM-DD format.');
    if ((key === 'paperurl' || key === 'pubmed') && value && !/^https:\/\//.test(value)) fail(400, 'Links must use HTTPS.');
    if (value === '') { doc.delete(key); continue; }
    doc.set(key, key === 'topics' ? value.split(',').map(s => s.trim()).filter(Boolean) : value);
  }
  if (!doc.get('title')) fail(400, 'A title is required.');
  if (media !== undefined) {
    const validated = validateMedia(media);
    for (const [key, value] of Object.entries(validated)) {
      if (value === null || Array.isArray(value) && !value.length) doc.delete(key);
      else doc.set(key, value);
    }
  }
  return `---\n${doc.toString({ lineWidth: 0 })}---\n${body}`;
}
async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/content' && request.method === 'GET') return json(await contentStore.published(env, url.searchParams.get('path')));
  if (url.pathname.startsWith('/photos/') && request.method === 'GET') return publicPhoto(request, env);
  const publicRoute = ['/contact', '/usage'].includes(url.pathname);
  if (publicRoute) {
    if (request.headers.get('Origin') !== env.SITE_ORIGIN) fail(403, 'Invalid request origin.');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (request.method !== 'POST') fail(405, 'Use POST.');
    return url.pathname === '/contact' ? contact(request, env) : usage(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/auth/login') return login(request, env);
  if (request.method === 'GET' && url.pathname === '/auth/callback') return callback(request, env);
  if (url.pathname.startsWith('/api/')) {
    const owner = await session(request, env, request.method !== 'GET');
    if (url.pathname === '/api/assets' && request.method === 'GET') return json(await library(env));
    if (url.pathname === '/api/assets' && request.method === 'POST') return json(await upload(request, env), 201);
    if (/^\/api\/assets\/[0-9a-f-]+$/.test(url.pathname) && request.method === 'GET') return assetResponse(env, url.pathname.split('/').pop());
    if (url.pathname === '/api/session' && request.method === 'GET') return json({ login: owner.login, csrf: owner.csrf });
    if (url.pathname === '/api/logout' && request.method === 'POST') return new Response(null, { status: 204, headers: { 'Set-Cookie': setCookie(SESSION, '', 0) } });
    if (url.pathname === '/api/files' && request.method === 'GET') return json(await contentStore.files(env));
    if (url.pathname === '/api/content' && request.method === 'GET') return json(await contentStore.document(env,url.searchParams.get('path')));
    if (url.pathname === '/api/drafts' && request.method === 'POST') {
      const data = await readJson(request,200000);
      if (!contentStore.editable(data.path)) fail(400,'This content cannot be edited here.');
      const media = await checkMediaAssets(env,data.path,data.media);
      return json(await contentStore.save(env,data,media),201);
    }
    if (url.pathname === '/api/publish' && request.method === 'POST') return json(await contentStore.publish(env,await readJson(request,2048)));
    if (url.pathname === '/api/preview' && request.method === 'POST') {
      const data = await readJson(request,150000);
      if (typeof data.body !== 'string' || data.body.length > 100000) fail(400,'Invalid content.');
      return json({html:contentStore.renderBody(data.body)});
    }
    if (url.pathname === '/api/analytics' && request.method === 'GET') {
      required(env, ['DB']);
      const [pages, days] = await env.DB.batch([
        env.DB.prepare("SELECT path, SUM(views) AS views FROM page_views WHERE day >= date('now', '-29 days') GROUP BY path ORDER BY views DESC"),
        env.DB.prepare("SELECT day, SUM(views) AS views FROM page_views WHERE day >= date('now', '-29 days') GROUP BY day ORDER BY day")
      ]);
      return json({ pages: pages.results, days: days.results });
    }
    fail(404, 'Not found.');
  }
  if (request.method === 'GET' && (url.pathname.startsWith('/admin/') || url.pathname === '/')) {
    if (url.pathname === '/') return Response.redirect(new URL('/admin/', request.url), 302);
    // Public login shell only; all content, counts and write operations require owner authentication.
    return env.ASSETS.fetch(request);
  }
  fail(404, 'Not found.');
}
export default {
  async fetch(request, env) {
    let response;
    try { response = await route(request, env); }
    catch (error) { response = json({ error: error instanceof HttpError || error.publicMessage ? error.message : 'The service is temporarily unavailable. Please try again later.' }, error.status || 500); }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (new URL(request.url).pathname === '/content') headers.set('Access-Control-Allow-Origin',env.SITE_ORIGIN);
    if (['/contact', '/usage'].includes(new URL(request.url).pathname)) {
      headers.set('Vary', 'Origin');
      if (request.headers.get('Origin') === env.SITE_ORIGIN) {
        headers.set('Access-Control-Allow-Origin', env.SITE_ORIGIN);
        headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type');
        headers.set('Access-Control-Max-Age', '3600');
      }
    }
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM page_views WHERE day < date('now', '-89 days')").run();
    await env.DB.prepare("DELETE FROM media_assets WHERE complete = 0 AND created_at < datetime('now', '-1 day')").run();
  }
};
