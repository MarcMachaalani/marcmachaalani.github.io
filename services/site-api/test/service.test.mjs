import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { sign, verify, editablePath, mergeContent, splitContent } from '../src/index.mjs';

const env = { SITE_ORIGIN: 'https://marcmachaalani.github.io', SESSION_SECRET: 'a-long-random-test-secret-32-characters', OWNER_ID: '103030028',
  GITHUB_REPO: 'MarcMachaalani/marcmachaalani.github.io', GITHUB_BRANCH: 'master', GITHUB_CONTENT_TOKEN: 'test-only-token',
  TURNSTILE_SECRET: 'test-secret', RESEND_API_KEY: 'test-resend-key', CONTACT_TO: 'owner@example.com', CONTACT_FROM: 'Site <site@example.com>',
  CONTACT_LIMITER: { limit: async () => ({ success: true }) }, USAGE_LIMITER: { limit: async () => ({ success: true }) } };
const origin = 'https://editor.example.com';
const message = { name: 'Visitor', email: 'visitor@example.com', subject: 'Research', message: 'Hello, I have a research question.', 'cf-turnstile-response': 'test-token', website: '' };
const sample = '---\ntitle: "Original"\npermalink: /publication/stable/\nredirect_from: /old.html\ncollection: publications\ntopics: ["Biomarkers"]\n---\nOriginal body.\n';
function request(path, data, headers = {}) {
  return new Request(origin + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: env.SITE_ORIGIN, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
}
async function ownerHeaders(overrides = {}) {
  const token = await sign({ kind: 'session', id: env.OWNER_ID, login: 'MarcMachaalani', csrf: 'csrf-token', exp: Date.now() + 60000, ...overrides }, env);
  return { Cookie: `__Host-marc-session=${token}`, Origin: origin, 'X-CSRF-Token': 'csrf-token' };
}
function mockFetch(t, handler) { t.mock.method(globalThis, 'fetch', handler); }

test('sessions reject tampering and expiration', async () => {
  const signed = await sign({ exp: Date.now() + 60000, id: env.OWNER_ID }, env);
  assert.equal((await verify(signed, env)).id, env.OWNER_ID);
  assert.equal(await verify('x' + signed, env), null);
  assert.equal(await verify(await sign({ exp: 1 }, env), env), null);
});
test('private routes require the owner, including analytics', async () => {
  for (const path of ['/api/files', '/api/content?path=_pages/about.md', '/api/analytics', '/api/publish']) {
    assert.equal((await worker.fetch(request(path), env)).status, 401);
    assert.equal((await worker.fetch(request(path, undefined, await ownerHeaders({ id: 'other' })), env)).status, 401);
  }
});
test('writes reject a missing CSRF token and cross-origin requests', async () => {
  const headers = await ownerHeaders();
  delete headers['X-CSRF-Token'];
  assert.equal((await worker.fetch(request('/api/drafts', {}, headers), env)).status, 403);
  const other = { ...await ownerHeaders(), Origin: 'https://evil.example' };
  assert.equal((await worker.fetch(request('/api/drafts', {}, other), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/publish', {}, headers), env)).status,403);
  assert.equal((await worker.fetch(request('/api/publish', {}, other), env)).status,403);
});
test('editor cannot edit workflows, secrets or path traversal', () => {
  for (const path of ['.github/workflows/x.yml', '_config.yml', '_pages/../about.md', '_publications/../../x.md', '_pages/not-listed.md']) assert.equal(editablePath(path), false);
  assert.equal(editablePath('_publications/2026-paper.md'), true);
  assert.equal(editablePath('_pages/interests.md'), true);
});
test('editing preserves URLs, collections, redirects, and unedited YAML values', () => {
  const updated = mergeContent(sample, { title: 'Updated', topics: 'Biomarkers, Immunotherapy' }, 'New body.\n');
  const { doc, body } = splitContent(updated);
  assert.equal(doc.get('permalink'), '/publication/stable/');
  assert.equal(doc.get('redirect_from'), '/old.html');
  assert.equal(doc.get('collection'), 'publications');
  assert.deepEqual(doc.get('topics').toJSON(), ['Biomarkers', 'Immunotherapy']);
  assert.equal(body, 'New body.\n');
  assert.throws(() => mergeContent(sample, { paperurl: 'javascript:alert(1)' }, ''), /HTTPS/);
  assert.throws(() => mergeContent(sample, { permalink: '/hijack/' }, ''), /Invalid content/);
});
test('contact rejects foreign origins and never enables credentialed CORS', async () => {
  const response = await worker.fetch(request('/contact', message, { Origin: 'https://evil.example' }), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  const allowed = await worker.fetch(new Request(origin + '/contact', { method: 'OPTIONS', headers: { Origin: env.SITE_ORIGIN } }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), env.SITE_ORIGIN);
  assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'), null);
});
test('contact fails closed without spam protection', async () => {
  assert.equal((await worker.fetch(request('/contact', message), { ...env, TURNSTILE_SECRET: '' })).status, 503);
  assert.equal((await worker.fetch(request('/contact', message), { ...env, CONTACT_LIMITER: null })).status, 503);
});
test('honeypot sends no email, and rate limits are enforced', async t => {
  mockFetch(t, () => { throw new Error('Must not call an external service'); });
  assert.equal((await worker.fetch(request('/contact', { ...message, website: 'spam' }), env)).status, 200);
  assert.equal((await worker.fetch(request('/contact', message), { ...env, CONTACT_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
});
test('oversized messages and email header injection are rejected', async () => {
  assert.equal((await worker.fetch(request('/contact', { ...message, message: 'a'.repeat(25000) }), env)).status, 413);
  assert.equal((await worker.fetch(request('/contact', { ...message, email: 'a@example.com\r\nBcc: b@example.com' }), env)).status, 400);
});
test('Turnstile must match the contact action and actual site hostname', async t => {
  let count = 0;
  mockFetch(t, async () => { count++; return Response.json({ success: true, hostname: 'other.example', action: 'contact' }); });
  assert.equal((await worker.fetch(request('/contact', message), env)).status, 400);
  assert.equal(count, 1);
});
test('a valid message forwards to a fixed recipient without logging it', async t => {
  const calls = [];
  mockFetch(t, async (url, options) => {
    calls.push({ url, data: JSON.parse(options.body) });
    return Response.json(url.includes('siteverify') ? { success: true, hostname: new URL(env.SITE_ORIGIN).hostname, action: 'contact' } : { id: 'sent' });
  });
  assert.equal((await worker.fetch(request('/contact', message), env)).status, 200);
  assert.deepEqual(calls[1].data.to, ['owner@example.com']);
  assert.equal(calls[1].data.reply_to, message.email);
  assert.equal(calls[0].data.remoteip, undefined);
});
test('email delivery failure does not claim success or expose provider details', async t => {
  mockFetch(t, async url => url.includes('siteverify') ? Response.json({ success: true, hostname: new URL(env.SITE_ORIGIN).hostname, action: 'contact' }) : new Response('secret provider error', { status: 500 }));
  const response = await worker.fetch(request('/contact', message), env);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('secret provider'));
});
test('analytics stores only known canonical paths and UTC aggregate counts', async t => {
  const saved = [];
  const DB = { prepare: sql => ({ bind: (...values) => ({ run: async () => saved.push({ sql, values }) }) }) };
  mockFetch(t, async () => Response.json(['/', '/publications/']));
  assert.equal((await worker.fetch(request('/usage', { path: '/publications/' }, { 'CF-Connecting-IP': '192.0.2.10' }), { ...env, DB })).status, 204);
  assert.deepEqual(saved[0].values, [new Date().toISOString().slice(0, 10), '/publications/']);
  for (const path of ['/private-unknown/', '/publications/?q=private', '/publications/#email']) assert.equal((await worker.fetch(request('/usage', { path }), { ...env, DB })).status, 400);
  assert.equal(saved.length, 1);
});
test('analytics respects privacy preference headers', async () => {
  assert.equal((await worker.fetch(request('/usage', { path: '/' }, { DNT: '1' }), { ...env, DB: {} })).status, 204);
  assert.equal((await worker.fetch(request('/usage', { path: '/' }, { 'Sec-GPC': '1' }), { ...env, DB: {} })).status, 204);
});
test('daily retention deletes aggregates older than the 90-day window', async () => {
  const statements = [];
  await worker.scheduled({}, { DB: { prepare: value => { statements.push(value); return { run: async () => {} }; } } });
  assert.match(statements[0], /DELETE.*-89 days/);
  assert.match(statements[1], /DELETE.*complete = 0.*-1 day/);
});
test('OAuth callback rejects an account other than the owner', async t => {
  const pending = await sign({ kind: 'oauth', state: 'state', verifier: 'verifier', exp: Date.now() + 60000 }, env);
  mockFetch(t, async url => Response.json(url.includes('access_token') ? { access_token: 'identity-only' } : { id: 999, login: 'other' }));
  const response = await worker.fetch(request('/auth/callback?state=state&code=code', undefined, { Cookie: `__Host-marc-oauth=${pending}` }), { ...env, GITHUB_CLIENT_ID: 'client', GITHUB_CLIENT_SECRET: 'secret' });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Set-Cookie'), null);
});
