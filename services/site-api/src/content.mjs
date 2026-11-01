import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import fallback from './content-seed.json' with { type: 'json' };

const fields = ['title','date','excerpt','venue','article_type','topics','paperurl','pubmed','citation','intro'];
const pageNames = new Set(['about.md','interests.md','awards.md','publications.html','talks.html','media.html','contact.html']);
export const editable = path => typeof path === 'string' && !path.includes('..') && (path.startsWith('_pages/') && pageNames.has(path.slice(7)) || /^_(publications|talks|media)\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.md$/.test(path));
export const bodyLocked = path => /^_pages\/(publications|talks|media|contact)\.html$/.test(path);
function fail(status,message) { throw Object.assign(new Error(message),{status,publicMessage:true}); }
const clean = html => sanitizeHtml(html, {
  allowedTags: [...sanitizeHtml.defaults.allowedTags,'section','article','header','main','figure','figcaption','img','iframe','time','details','summary','span'],
  allowedAttributes: { '*':['class','id','aria-label','aria-labelledby','aria-hidden','role'], a:['href','target','rel'],img:['src','alt','loading','decoding','width','height'],iframe:['src','title','loading','allowfullscreen','allow','referrerpolicy'],time:['datetime'] },
  allowedSchemes:['https','mailto'], allowProtocolRelative:false,
  allowedIframeHostnames:['www.youtube-nocookie.com','www.youtube.com'],
  transformTags: { a:(tagName,attribs) => ({tagName,attribs:{...attribs,...(attribs.target === '_blank' ? {rel:'noopener noreferrer'} : {})}}) }
});
export function renderInline(source = '') {
  // Be forgiving of spaces included in a toolbar selection: ** Lebanese University **.
  return clean(marked.parseInline(String(source).replace(/\*\*\s*([^*\n]+?)\s*\*\*/g,(_m,text) => `**${text.trim()}**`)));
}
export function renderBody(source = '') {
  source = source.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g,(_m,text) => `**${text.trim()}**`);
  source = source.replace(/<([a-z][\w-]*)\b([^>]*?)\smarkdown="1"([^>]*)>([\s\S]*?)<\/\1>/gi,(_m,tag,before,after,inner) => `<${tag}${before}${after}>\n${marked.parse(inner.replace(/<\/header>\s*/g,'</header>\n\n'))}</${tag}>`);
  // Markdown within existing HTML paragraphs needs inline parsing too.
  source = source.replace(/<(p|h[1-6]|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi,(_m,tag,attrs,inner) => `<${tag}${attrs}>${renderInline(inner)}</${tag}>`);
  return clean(marked.parse(source));
}
const plain = text => sanitizeHtml(renderInline(text),{allowedTags:[],allowedAttributes:{}}).replace(/&amp;/g,'&');
let cache = {origin:'',expires:0,entries:[]};
export async function seeds(env) {
  if (cache.origin === env.SITE_ORIGIN && cache.expires > Date.now()) return cache.entries;
  let entries = fallback;
  try {
    const response = await fetch(`${env.SITE_ORIGIN}/assets/data/editor-index.json`,{cf:{cacheTtl:60},signal:AbortSignal.timeout(5000)});
    const live = response.ok ? await response.json() : null;
    if (Array.isArray(live) && live.length < 10000) {
      const merged = new Map(fallback.map(doc => [doc.path,doc]));
      for (const doc of live) if (editable(doc.path) && typeof doc.body === 'string' && doc.fields && typeof doc.url === 'string' && doc.url.startsWith('/') && !doc.url.startsWith('//')) merged.set(doc.path,{...doc,media:{private_pdf:merged.get(doc.path)?.media.private_pdf || null,gallery:doc.media?.gallery || []}});
      entries = [...merged.values()];
    }
  } catch { /* Bundled baseline keeps the editor available during a Pages outage. */ }
  cache = {origin:env.SITE_ORIGIN,expires:Date.now()+60000,entries:entries.filter(doc => editable(doc.path))};
  return cache.entries;
}
export async function document(env,path) {
  if (!editable(path)) fail(400,'This content cannot be edited here.');
  const seed = (await seeds(env)).find(doc => doc.path === path);
  if (!seed) fail(404,'This page could not be found.');
  const row = await env.DB.prepare('SELECT * FROM content_documents WHERE path = ?').bind(path).first();
  const draft = row ? JSON.parse(row.draft_json) : seed;
  return {...draft,path,url:seed.url,revision:row?.revision || 0,published_revision:row?.published_revision || 0,published_at:row?.published_at || null,body_locked:bodyLocked(path),html:bodyLocked(path) ? '' : renderBody(draft.body)};
}
export async function files(env) {
  const baseline = await seeds(env);
  const {results} = await env.DB.prepare('SELECT path, draft_json FROM content_documents').all();
  const titles = new Map(results.map(row => [row.path,JSON.parse(row.draft_json).fields.title]));
  return baseline.map(doc => ({path:doc.path,title:plain(titles.get(doc.path) || doc.fields.title)}));
}
export async function save(env,data,validatedMedia) {
  const current = await document(env,data.path);
  if (!Number.isSafeInteger(data.revision) || data.revision !== current.revision) fail(409,'This page changed in another session. Reopen it before saving.');
  if (!data.fields || Array.isArray(data.fields) || typeof data.fields !== 'object' || typeof data.body !== 'string' || data.body.length > 100000) fail(400,'Invalid page content.');
  for (const [key,value] of Object.entries(data.fields)) {
    if (!fields.includes(key) || typeof value !== 'string' || value.length > 12000) fail(400,'Invalid content field.');
    if (key === 'date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) fail(400,'Use a valid date in YYYY-MM-DD format.');
    if (['paperurl','pubmed'].includes(key) && value) { try { if (new URL(value).protocol !== 'https:') throw 0; } catch { fail(400,'Links must use HTTPS.'); } }
  }
  const updated = {path:current.path,url:current.url,fields:{...current.fields,...data.fields},body:bodyLocked(current.path) ? current.body : data.body,media:validatedMedia};
  if (!updated.fields.title.trim()) fail(400,'A title is required.');
  const next = current.revision + 1;
  const result = await env.DB.prepare(`INSERT INTO content_documents (path,revision,draft_json) VALUES (?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET revision = excluded.revision, draft_json = excluded.draft_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_documents.revision = ?`)
    .bind(current.path,next,JSON.stringify(updated),current.revision).run();
  if (result.meta.changes !== 1) fail(409,'This page changed in another session. Reopen it before saving.');
  return {revision:next,url:current.url,published_revision:current.published_revision};
}
export async function publish(env,data) {
  if (!editable(data.path) || !Number.isSafeInteger(data.revision) || data.revision < 1) fail(400,'Save a draft before publishing.');
  const result = await env.DB.prepare(`UPDATE content_documents SET previous_json = published_json, published_json = draft_json, published_revision = revision,
    published_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE path = ? AND revision = ?`).bind(data.path,data.revision).run();
  if (result.meta.changes !== 1) fail(409,'The saved draft changed. Reopen it before publishing.');
  return {published_revision:data.revision};
}
export function publicDocument(doc,full=false) {
  const inline = Object.fromEntries(Object.entries(doc.fields).map(([name,value]) => [name,renderInline(value)]));
  const text = Object.fromEntries(Object.entries(doc.fields).map(([name,value]) => [name,plain(value)]));
  return {path:doc.path,url:doc.url,fields:text,inline,...(full ? {html:bodyLocked(doc.path) ? null : renderBody(doc.body),gallery:doc.media.gallery || []} : {})};
}
export async function published(env,path) {
  const {results} = await env.DB.prepare('SELECT published_json FROM content_documents WHERE published_json IS NOT NULL').all();
  const docs = results.map(row => JSON.parse(row.published_json));
  return {page:docs.some(doc => doc.path === path) ? publicDocument(docs.find(doc => doc.path === path),true) : null,records:docs.filter(doc => /^_(publications|talks|media)\//.test(doc.path)).map(doc => publicDocument(doc))};
}
export async function photoPublished(env,id) {
  const {results} = await env.DB.prepare('SELECT path, published_json FROM content_documents WHERE published_json IS NOT NULL').all();
  const docs = results.map(row => JSON.parse(row.published_json));
  if (docs.some(doc => doc.media.gallery?.some(photo => photo.id === id))) return true;
  return (await seeds(env)).some(doc => !docs.some(override => override.path === doc.path) && doc.media.gallery?.some(photo => photo.id === id));
}
