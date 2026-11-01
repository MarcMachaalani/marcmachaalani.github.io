// Snapshot fallback for initial content. Routine editor saves and publishing use D1 only.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
const root = new URL('../../../', import.meta.url);
const names = ['title','date','excerpt','venue','article_type','topics','paperurl','pubmed','citation','intro'];
const entries = [];
for (const dir of ['_pages','_publications','_talks','_media']) {
  for (const name of await readdir(new URL(dir + '/',root))) {
    const path = `${dir}/${name}`;
    if (!/\.(md|html)$/.test(name)) continue;
    const source = await readFile(new URL(path,root),'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    if (!match) continue;
    const data = parse(match[1]);
    if (!data.permalink) continue;
    const fields = Object.fromEntries(names.map(key => [key,key === 'topics' ? (data[key] || []).join(', ') : data[key] == null ? '' : String(data[key])]));
    entries.push({ path, url:data.permalink, title:fields.title, fields, body:match[2], media:{private_pdf:data.private_pdf || null,gallery:data.gallery || []} });
  }
}
await writeFile(new URL('../src/content-seed.json',import.meta.url),JSON.stringify(entries));
