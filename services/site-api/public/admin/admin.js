(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  let csrf, files = [], assets = [], current, media, dirty = false, saving = false, savedSnapshot = '', loading = 0, uploading = false;
  const labels = { title:'Title', date:'Publication date', excerpt:'Summary', venue:'Journal or venue', article_type:'Article type', topics:'Topics (separate with commas)', paperurl:'Publisher or DOI link', pubmed:'PubMed link', citation:'Citation', intro:'Page introduction' };
  const pageNames = { 'about.md':'Home page', 'interests.md':'Beyond medicine', 'awards.md':'Honors & awards', 'publications.html':'Publications page', 'talks.html':'Presentations page', 'media.html':'Media page', 'contact.html':'Contact page' };
  const status = message => { $('#status').textContent = message; };
  const bytesLabel = size => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
  function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function button(text, action, className = 'quiet') { const el = element('button', className, text); el.type = 'button'; el.addEventListener('click', action); return el; }
  async function api(path, data) {
    const response = await fetch(path, data ? { method:'POST', headers:{ 'Content-Type':'application/json', 'X-CSRF-Token':csrf }, body:JSON.stringify(data) } : {});
    if (response.status === 204) return null;
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { $('#workspace').hidden = true; $('#login').hidden = false; }
      throw new Error(result.error || 'Unable to complete the request.');
    }
    return result;
  }
  function nameFor(path) { return pageNames[path.split('/').pop()] || path.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.(md|html)$/, '').replaceAll('-', ' ').replace(/^./, c => c.toUpperCase()); }
  function fileList() {
    const list = $('#file-list'); list.replaceChildren(); const query = $('#file-search').value.toLowerCase();
    for (const [prefix, heading] of [['_pages/','Pages'],['_publications/','Publications'],['_talks/','Presentations'],['_media/','Media']]) {
      const matches = files.filter(item => item.path.startsWith(prefix) && (item.path + item.title + nameFor(item.path)).toLowerCase().includes(query));
      if (!matches.length) continue;
      list.append(element('h3','',heading));
      matches.forEach(file => { const item = button(pageNames[file.path.split('/').pop()] || file.title || nameFor(file.path), () => load(file.path)); if (current?.path === file.path) item.setAttribute('aria-current','true'); list.append(item); });
    }
    if (!list.childElementCount) list.append(element('p','hint','No matching pages or papers.'));
  }
  function snapshot() { return JSON.stringify({ fields:Object.fromEntries(Array.from($('#fields').querySelectorAll('input, textarea'), input => [input.name,input.value])), body:$('#body').value, media }); }
  function checkDirty() {
    dirty = Boolean(current) && snapshot() !== savedSnapshot;
    $('#save-state').textContent = dirty ? 'Unsaved changes' : 'No unsaved changes';
    $('#save-state').classList.toggle('dirty',dirty); $('#save').disabled = !dirty || saving || uploading;
  }
  async function load(path) {
    if (uploading) { status('Please wait for your upload to finish.'); return; }
    if (dirty && !confirm('Discard your unsaved changes and open another page?')) return;
    const sequence = ++loading; status('Opening your content…');
    try {
      const loaded = await api('/api/content?path=' + encodeURIComponent(path)); if (sequence !== loading) return;
      current = loaded; media = structuredClone(current.media || { private_pdf:null, gallery:[] });
      $('#file-path').textContent = current.path;
      $('#file-kind').textContent = path.startsWith('_publications/') ? 'Publication' : path.startsWith('_pages/') ? 'Page' : 'Academic record';
      $('#editor-title').textContent = path.startsWith('_pages/') ? nameFor(path) : new DOMParser().parseFromString(current.fields.title,'text/html').body.textContent; $('#fields').replaceChildren();
      const advanced = element('details','advanced-fields wide'); advanced.append(element('summary','','Publisher links and citation'));
      const advancedFields = element('div','field-grid'); advanced.append(advancedFields);
      const names = path.startsWith('_pages/') ? ['title','intro'] : ['title','date','excerpt','venue','article_type','topics','paperurl','pubmed','citation'];
      names.forEach(name => {
        const label = element('label', ['date','article_type'].includes(name) ? '' : 'wide', labels[name]);
        const input = document.createElement(['excerpt','citation'].includes(name) ? 'textarea' : 'input');
        input.name = name; input.value = current.fields[name] || ''; if (name === 'date') input.type = 'date'; if (name === 'title') input.required = true;
        if (input.tagName === 'TEXTAREA') input.rows = 3; label.append(input);
        if (['paperurl','pubmed','citation'].includes(name)) advancedFields.append(label); else $('#fields').append(label);
      });
      if (advancedFields.childElementCount) $('#fields').append(advanced);
      $('#body').value = current.body; $('#paper-upload').hidden = !path.startsWith('_publications/');
      $('#editor').hidden = false; $('#editor-placeholder').hidden = true; $('#draft-link').hidden = true;
      renderPdf(); renderGallery(); savedSnapshot = snapshot(); checkDirty(); fileList(); renderAssets(); status('');
    } catch (error) { status(error.message); }
  }
  function renderPdf() {
    const target = $('#pdf-current'); target.replaceChildren(); if (!media?.private_pdf) return;
    const asset = assets.find(item => item.id === media.private_pdf);
    const row = element('div','attachment'); const copy = element('div');
    copy.append(element('strong','',asset?.filename || 'Saved paper PDF'));
    const link = element('a','','View private PDF ↗'); link.href = '/api/assets/' + media.private_pdf; link.target = '_blank'; link.rel = 'noopener'; copy.append(link);
    row.append(copy, button('Remove attachment', () => { media.private_pdf = null; renderPdf(); checkDirty(); renderAssets(); }, 'text-button')); target.append(row);
  }
  function renderGallery() {
    const target = $('#gallery-items'); target.replaceChildren();
    if (!media?.gallery.length) { target.append(element('p','hint','No photos on this page yet. Your page looks complete without them.')); return; }
    media.gallery.forEach((photo,index) => {
      const row = element('div','gallery-row'); const image = element('img'); image.src = '/api/assets/' + photo.id; image.alt = photo.alt || 'Selected photo'; row.append(image);
      const fields = element('div');
      for (const [key,labelText] of [['alt','Image description (required)'],['caption','Caption (optional)']]) {
        const label = element('label','',labelText); const input = document.createElement(key === 'caption' ? 'textarea' : 'input'); input.value = photo[key]; input.maxLength = key === 'alt' ? 180 : 500;
        if (key === 'alt') { input.required = true; input.placeholder = 'Describe the photo for someone who cannot see it'; } else input.rows = 2;
        input.addEventListener('input', () => { photo[key] = input.value; if (key === 'alt') image.alt = input.value; checkDirty(); }); label.append(input); fields.append(label);
      }
      const actions = element('div','button-row');
      const up = button('Move up', () => { [media.gallery[index-1],media.gallery[index]] = [media.gallery[index],media.gallery[index-1]]; renderGallery(); checkDirty(); }); up.disabled = index === 0;
      const down = button('Move down', () => { [media.gallery[index+1],media.gallery[index]] = [media.gallery[index],media.gallery[index+1]]; renderGallery(); checkDirty(); }); down.disabled = index === media.gallery.length-1;
      actions.append(up,down,button('Remove from page', () => { media.gallery.splice(index,1); renderGallery(); checkDirty(); renderAssets(); },'text-button'));
      row.append(fields,actions); target.append(row);
    });
  }
  function useAsset(asset) {
    if (!current) { status('Open a page or paper in Content first, then choose this file from the library.'); return; }
    if (asset.kind === 'pdf') {
      if (!current.path.startsWith('_publications/')) { status('Choose a publication first to attach this paper PDF.'); return; }
      media.private_pdf = asset.id; renderPdf();
    } else {
      if (media.gallery.some(photo => photo.id === asset.id)) return;
      if (media.gallery.length >= 24) { status('Keep each page gallery to 24 photos.'); return; }
      media.gallery.push({ id:asset.id, alt:'', caption:'' }); renderGallery();
    }
    checkDirty(); tab('content'); renderAssets();
    status(asset.kind === 'pdf' ? 'PDF attached privately. Save the draft to keep it with this publication.' : 'Photo added. Write a short image description, then save your draft.');
  }
  async function refreshAssets() {
    const result = await api('/api/assets'); assets = result.assets;
    $('#storage-used').textContent = `${assets.length} files · ${bytesLabel(result.used)} of ${bytesLabel(result.capacity)}`;
    renderAssets(); renderPdf();
  }
  function renderAssets() {
    const target = $('#asset-grid'); if (!target) return; target.replaceChildren();
    const filtered = assets.filter(asset => !$('#asset-filter').value || asset.kind === $('#asset-filter').value);
    if (!filtered.length) { const empty = element('div','empty-state'); empty.append(element('h3','','A home for your files'),element('p','','Upload a paper PDF or a photo to get started.')); target.append(empty); return; }
    filtered.forEach(asset => {
      const card = element('article','asset-card');
      if (asset.kind === 'photo') { const image = element('img'); image.src = '/api/assets/' + asset.id; image.alt = ''; image.loading = 'lazy'; card.append(image); }
      else card.append(element('div','asset-card__file','PDF'));
      const copy = element('div','asset-card__info'); copy.append(element('strong','',asset.filename),element('p','hint',`${bytesLabel(asset.bytes)} · ${asset.kind === 'pdf' ? 'Private paper PDF' : 'Photo'}`));
      const selected = asset.kind === 'pdf' ? media?.private_pdf === asset.id : media?.gallery.some(photo => photo.id === asset.id);
      const attach = button(selected ? 'Added to selected content' : asset.kind === 'pdf' ? 'Attach to selected paper' : 'Add to selected page', () => useAsset(asset)); attach.disabled = Boolean(selected); copy.append(attach);
      if (asset.kind === 'pdf') { const link = element('a','text-link','View private PDF ↗'); link.href = '/api/assets/' + asset.id; link.target = '_blank'; link.rel = 'noopener'; copy.append(link); }
      card.append(copy); target.append(card);
    });
  }
  async function preparePhoto(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('For photos, choose a JPEG, PNG, or WebP file. Export HEIC photos as JPEG first.');
    const image = await createImageBitmap(file); const scale = Math.min(1,2200 / Math.max(image.width,image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(image.width * scale)); canvas.height = Math.max(1,Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height); image.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/webp',.86)); if (!blob) throw new Error('This photo could not be prepared. Try a JPEG or PNG.');
    return new File([blob],file.name.replace(/\.[^.]+$/, '') + '.webp',{ type:blob.type });
  }
  function sendFile(file,kind) {
    return new Promise((resolve,reject) => {
      const xhr = new XMLHttpRequest(); xhr.open('POST','/api/assets?kind=' + kind); xhr.timeout = 90000;
      xhr.setRequestHeader('X-CSRF-Token',csrf); xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name)); xhr.setRequestHeader('Content-Type',file.type || 'application/octet-stream');
      xhr.upload.onprogress = event => { if (event.lengthComputable) $('#upload-meter').value = Math.round(event.loaded / event.total * 95); };
      xhr.onerror = () => reject(new Error('The upload did not finish. Check your connection and try again.'));
      xhr.ontimeout = () => reject(new Error('The upload timed out. Please try a smaller file.'));
      xhr.onload = () => { let value; try { value = JSON.parse(xhr.responseText); } catch { reject(new Error('The upload could not be saved.')); return; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(value); else reject(new Error(value.error || 'The upload could not be saved.')); };
      xhr.send(file);
    });
  }
  async function uploadFiles(fileList,attachKind) {
    if (uploading) { status('One upload is already in progress.'); return; }
    const incoming = Array.from(fileList); if (!incoming.length) return;
    uploading = true; $('#upload-progress').hidden = false; checkDirty(); let successes = 0;
    try {
      for (const original of incoming) {
        const kind = original.type === 'application/pdf' || /\.pdf$/i.test(original.name) ? 'pdf' : 'photo';
        if (attachKind && kind !== attachKind) throw new Error(attachKind === 'pdf' ? 'Choose a PDF for this publication.' : 'Choose a JPEG, PNG, or WebP photo.');
        if (kind === 'pdf' && original.size > 10 * 1024 * 1024) throw new Error('Please keep each paper PDF below 10 MB.');
        if (kind === 'photo' && original.size > 40 * 1024 * 1024) throw new Error('Please choose a photo below 40 MB before resizing.');
        $('#upload-label').textContent = `Preparing ${original.name}…`; $('#upload-meter').value = 0;
        const file = kind === 'photo' ? await preparePhoto(original) : original;
        $('#upload-label').textContent = `Uploading ${file.name}…`;
        const asset = await sendFile(file,kind); successes++; if (!assets.some(item => item.id === asset.id)) assets.unshift(asset);
        if (attachKind) useAsset(asset); $('#upload-meter').value = 100;
      }
      await refreshAssets(); status(attachKind ? `${successes} file${successes === 1 ? '' : 's'} added. Complete the details and save your draft.` : `${successes} file${successes === 1 ? '' : 's'} saved privately in your media library.`);
    } catch (error) { status((successes ? `${successes} file(s) saved. ` : '') + error.message); }
    finally { uploading = false; $('#upload-progress').hidden = true; checkDirty(); }
  }
  function wireUpload(zoneId,inputId,buttonId,kind) {
    const input = $(inputId); $(buttonId).addEventListener('click', () => input.click());
    input.addEventListener('change', async () => { await uploadFiles(input.files,kind); input.value = ''; });
    const zone = $(zoneId); if (!zone) return;
    zone.addEventListener('dragover',event => { event.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave',() => zone.classList.remove('drag-over'));
    zone.addEventListener('drop',event => { event.preventDefault(); zone.classList.remove('drag-over'); uploadFiles(event.dataTransfer.files,kind); });
  }
  wireUpload('#library-drop','#library-file','#library-choose'); wireUpload('#pdf-drop','#pdf-file','#pdf-choose','pdf');
  wireUpload('#gallery-items','#gallery-file','#gallery-choose','photo');
  $('#asset-filter').addEventListener('change',renderAssets); $('#file-search').addEventListener('input',fileList);
  $('#editor').addEventListener('input',checkDirty);
  window.addEventListener('beforeunload',event => { if (dirty || uploading) { event.preventDefault(); event.returnValue = ''; } });
  $('#editor').addEventListener('submit',async event => {
    event.preventDefault(); if (!dirty || saving || uploading) return; saving = true; checkDirty(); status('Saving your draft…');
    const fields = {}; $('#fields').querySelectorAll('input,textarea').forEach(input => { if (input.value !== (current.fields[input.name] || '')) fields[input.name] = input.value; });
    const request = { path:current.path, sha:current.sha, fields, body:$('#body').value, media };
    const submittedSnapshot = snapshot();
    try {
      const result = await api('/api/drafts',request); savedSnapshot = submittedSnapshot;
      $('#draft-link').href = result.url; $('#draft-link').hidden = false;
      status(`Draft #${result.number} is ready to review. Your page and photos publish after approval; its paper PDF stays private.`);
    } catch (error) { status(error.message); }
    finally { saving = false; checkDirty(); }
  });
  document.querySelectorAll('[data-insert]').forEach(control => control.addEventListener('click',() => {
    const area = $('#body'); const selected = area.value.slice(area.selectionStart,area.selectionEnd) || 'text';
    const samples = { bold:`**${selected}**`, italic:`*${selected}*`, link:`[${selected}](https://example.com)`, heading:`\n## ${selected}\n` };
    area.setRangeText(samples[control.dataset.insert],area.selectionStart,area.selectionEnd,'select'); area.focus(); checkDirty();
  }));
  async function tab(name) {
    for (const item of ['edit','media','usage']) { const panel = item === 'edit' ? 'content' : item; $('#' + panel + '-panel').hidden = panel !== name; $('#' + item + '-tab').setAttribute('aria-pressed',String(panel === name)); }
    if (name !== 'usage') return;
    status('Loading page counts…');
    try {
      const result = await api('/api/analytics'); $('#usage-total').textContent = `${result.pages.reduce((sum,row) => sum + row.views,0)} views`;
      for (const [selector,rows,field] of [['#usage-pages',result.pages,'path'],['#usage-days',result.days,'day']]) {
        const target = $(selector); target.replaceChildren(); rows.forEach(row => { const tr = element('tr'); [row[field],row.views].forEach(value => tr.append(element('td','',String(value)))); target.append(tr); });
      }
      status(result.pages.length ? '' : 'No page views have been recorded yet.');
    } catch (error) { status(error.message); }
  }
  function openLibrary(filter = '') { $('#asset-filter').value = filter; renderAssets(); tab('media'); }
  $('#edit-tab').addEventListener('click',() => tab('content')); $('#media-tab').addEventListener('click',() => openLibrary()); $('#usage-tab').addEventListener('click',() => tab('usage')); $('#start-media').addEventListener('click',() => openLibrary());
  $('#pdf-library').addEventListener('click',() => openLibrary('pdf')); $('#gallery-library').addEventListener('click',() => openLibrary('photo'));
  $('#logout').addEventListener('click',async () => {
    if (uploading) { status('Wait for the upload to finish before signing out.'); return; }
    if (dirty && !confirm('Sign out and discard unsaved changes?')) return;
    try { await api('/api/logout',{}); dirty = false; location.reload(); } catch (error) { status(error.message); }
  });
  (async () => {
    try {
      const owner = await api('/api/session'); csrf = owner.csrf; $('#owner').textContent = owner.login;
      $('#login').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false;
      files = (await api('/api/files')).map(item => typeof item === 'string' ? { path:item,title:'' } : item); fileList(); await refreshAssets();
    } catch (error) { if (error.message !== 'Please sign in.') status(error.message); }
  })();
})();
