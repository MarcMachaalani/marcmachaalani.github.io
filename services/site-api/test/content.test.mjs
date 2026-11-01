import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/database.mjs';
import worker,{sign} from '../src/index.mjs';
import './helpers/digest-stream.mjs';
import {upload} from '../src/media.mjs';
import {renderBody,renderInline} from '../src/content.mjs';
const origin='https://editor.example.com';
const envBase={SITE_ORIGIN:'https://marcmachaalani.github.io',OWNER_ID:'103030028',SESSION_SECRET:'a-long-random-test-secret-32-characters'};
async function request(env,path,data,auth=true) {
  const token=await sign({kind:'session',id:env.OWNER_ID,csrf:'csrf',exp:Date.now()+60000},env);
  return worker.fetch(new Request(origin+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,...(auth?{Cookie:`__Host-marc-session=${token}`,'X-CSRF-Token':'csrf'}:{})},body:data?JSON.stringify(data):undefined}),env);
}
const mockSeed=t => t.mock.method(globalThis,'fetch',async url => { assert.ok(!String(url).includes('api.github.com'),'Content must never call GitHub');return Response.json([]); });
test('Markdown, spaced bold, and Markdown in HTML paragraphs render consistently',() => {
  for (const value of ['**Lebanese University**','** Lebanese University **','<p>** Lebanese University **</p>','<p><a href="https://example.com">**Lebanese University**</a></p>']) assert.match(renderBody(value),/<strong>Lebanese University<\/strong>/);
  assert.match(renderInline('*italics*'),/<em>italics<\/em>/);
});
test('rendering removes executable HTML and unsafe URLs while retaining layouts and video',() => {
  const result=renderBody('<section class="home-bio"><p onclick="bad()">Hi<script>alert(1)</script><img src=x onerror=bad()><a href="javascript:bad()">link</a></p><iframe src="https://evil.example/embed"></iframe><iframe src="https://www.youtube-nocookie.com/embed/123" allowfullscreen></iframe></section>');
  assert.ok(!/onclick|onerror|<script|javascript:|evil\.example/.test(result));
  assert.match(result,/class="home-bio"/); assert.match(result,/youtube-nocookie\.com/);
});
test('private drafts, immediate publishing, stable URLs, and stale tabs use real SQL without GitHub',async t => {
  mockSeed(t); const env={...envBase,DB:database()};
  const initial=await (await request(env,'/api/content?path=_pages/about.md')).json(); assert.equal(initial.revision,0);
  const data={path:initial.path,revision:0,fields:{title:'Updated home'},body:'<section class="home-bio"><p>** Lebanese University **</p></section>',media:{private_pdf:null,gallery:[]}};
  assert.equal((await request(env,'/api/drafts',data,false)).status,401);
  assert.equal((await request(env,'/api/publish',{path:data.path,revision:1},false)).status,401);
  const first=await request(env,'/api/drafts',data); assert.equal(first.status,201); assert.equal((await first.json()).revision,1);
  assert.equal((await (await request(env,'/content?path='+data.path,undefined,false)).json()).page,null,'Draft must not be public');
  assert.equal((await request(env,'/api/drafts',data)).status,409);
  assert.equal((await request(env,'/api/publish',{path:data.path,revision:0})).status,400);
  const publish=await request(env,'/api/publish',{path:data.path,revision:1}); assert.equal(publish.status,200);
  let publicData=await (await request(env,'/content?path='+data.path,undefined,false)).json(); assert.equal(publicData.page.url,'/'); assert.match(publicData.page.html,/<strong>Lebanese University<\/strong>/); assert.ok(!JSON.stringify(publicData).includes('private_pdf'));
  assert.equal((await request(env,'/api/drafts',{...data,revision:1,body:'Later private draft'})).status,201);
  publicData=await (await request(env,'/content?path='+data.path,undefined,false)).json(); assert.ok(!publicData.page.html.includes('Later'));
  assert.equal((await request(env,'/api/publish',{path:data.path,revision:1})).status,409);
  assert.equal((await request(env,'/api/publish',{path:data.path,revision:2})).status,200);
  const row=env.DB.sql.prepare('SELECT * FROM content_documents').get(); assert.match(row.previous_json,/Lebanese University/);
});
test('catalog templates remain protected; editor fields reject arbitrary metadata and insecure links',async t => {
  mockSeed(t); const env={...envBase,DB:database()};
  const current=await (await request(env,'/api/content?path=_pages/publications.html')).json(); assert.equal(current.body_locked,true);
  const data={path:current.path,revision:0,fields:{intro:'Updated intro'},body:'Break generated list',media:{private_pdf:null,gallery:[]}};
  assert.equal((await request(env,'/api/drafts',{...data,fields:{permalink:'/broken/'}})).status,400);
  assert.equal((await request(env,'/api/drafts',{...data,fields:{paperurl:'javascript:bad()'}})).status,400);
  assert.equal((await request(env,'/api/drafts',data)).status,201);
  const saved=await (await request(env,'/api/content?path='+current.path)).json(); assert.equal(saved.body,current.body); assert.equal(saved.fields.intro,'Updated intro');
});

test('photos follow published galleries and removal revokes public access',async t => {
  mockSeed(t); const env={...envBase,SITE_ORIGIN:'https://gallery-override-test.example',DB:database()};
  const photo=await upload(new Request(origin+'/api/assets?kind=photo',{method:'POST',headers:{'X-File-Name':'photo.png'},body:new Uint8Array([137,80,78,71,13,10,26,10,0,1,2,3])}),env);
  const draft={path:'_pages/about.md',revision:0,fields:{},body:'<p>Home</p>',media:{private_pdf:null,gallery:[{id:photo.id,alt:'Lab photo',caption:''}]}};
  const photoUrl='/photos/'+photo.id;
  assert.equal((await request(env,'/api/drafts',draft)).status,201);
  assert.equal((await request(env,photoUrl,undefined,false)).status,404);
  assert.equal((await request(env,'/api/publish',{path:draft.path,revision:1})).status,200);
  assert.equal((await request(env,photoUrl,undefined,false)).status,200);
  assert.equal((await request(env,'/api/drafts',{...draft,revision:1,media:{private_pdf:null,gallery:[]}})).status,201);
  assert.equal((await request(env,photoUrl,undefined,false)).status,200,'A private draft must not affect the live gallery');
  assert.equal((await request(env,'/api/publish',{path:draft.path,revision:2})).status,200);
  assert.equal((await request(env,photoUrl,undefined,false)).status,404);
});
