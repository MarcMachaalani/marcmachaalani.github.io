(() => {
  'use strict';
  const script = document.currentScript, endpoint = script.dataset.endpoint, path = script.dataset.path;
  if (!endpoint || !path) return;
  const set = (root,selector,html) => { const node = root.querySelector(selector); if (node) node.innerHTML = html || ''; };
  function citation(root,html,detail=false) {
    let node = root.querySelector('.publication-citation');
    if (!html) { node?.remove(); return; }
    if (!node) { node = document.createElement('details'); node.className = 'publication-citation' + (detail ? ' work-detail__citation' : ''); node.innerHTML = '<summary><span class="citation-toggle-text">Citation</span></summary><p></p>'; const anchor = root.querySelector('.publication-links'); if (anchor) anchor.before(node); else root.append(node); }
    set(node,'p',html);
  }
  function links(root,fields) {
    const parent = root.querySelector('.publication-links'); if (!parent) return;
    for (const [field,key,label] of [['paperurl','paper','Paper'],['pubmed','pubmed','PubMed']]) {
      let anchor = parent.querySelector(key === 'paper' ? '.pub-link-paper, .pub-link-link' : '.pub-link-' + key);
      if (!fields[field]) { anchor?.remove(); continue; }
      if (!/^https:\/\//i.test(fields[field])) continue;
      if (!anchor) { anchor = document.createElement('a'); anchor.className = 'pub-link pub-link-' + key; anchor.textContent = label; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; parent.append(anchor); }
      anchor.href = fields[field];
    }
  }
  function gallery(page) {
    document.querySelector('.site-gallery')?.remove(); if (!page.gallery?.length) return;
    const section = document.createElement('section'); section.className = 'site-gallery'; section.setAttribute('aria-label','Photo gallery');
    section.innerHTML = '<div class="section-heading"><div><p class="home-eyebrow">In pictures</p><h2>A few moments</h2></div></div><div class="site-gallery__grid"></div>';
    for (const photo of page.gallery) {
      const figure = document.createElement('figure'), image = document.createElement('img'); image.src = endpoint + '/photos/' + encodeURIComponent(photo.id); image.alt = photo.alt; image.loading = 'lazy'; image.decoding = 'async'; figure.append(image);
      if (photo.caption) { const caption = document.createElement('figcaption'); caption.textContent = photo.caption; figure.append(caption); }
      section.querySelector('.site-gallery__grid').append(figure);
    }
    document.querySelector('.page__footer').before(section);
  }
  function apply(page) {
    const fields = page.fields, inline = page.inline;
    if (path === '_pages/about.md') set(document,'.splash .page__content',page.html);
    else if (path === '_pages/interests.md') { const main = new DOMParser().parseFromString(page.html,'text/html').querySelector('main'); if (main) document.querySelector('#main').replaceWith(main); }
    else if (path === '_pages/awards.md') set(document,'[data-content-body]',page.html);
    else if (/^_(publications|talks)\//.test(path)) {
      set(document,'.work-detail__title',inline.title); set(document,'.work-detail__body',inline.excerpt ? '<p>' + inline.excerpt + '</p>' : page.html);
      const metadata = document.querySelector('.work-detail__metadata'); if (metadata) { const spans = metadata.querySelectorAll('span'), location = path.startsWith('_talks/') && spans.length > 2 ? spans[2].cloneNode(true) : null; metadata.replaceChildren(); for (const text of [fields.venue,fields.date?.slice(0,4)]) if (text) { const span = document.createElement('span'); span.textContent = text; metadata.append(span); } if (location) metadata.append(location); }
      const detail = document.querySelector('.work-detail'); citation(detail,inline.citation,true); links(detail,fields);
    } else if (path.startsWith('_media/')) { set(document,'.page__title',inline.title); set(document,'.page__content',page.html); }
    if (path.startsWith('_pages/') && !['_pages/about.md','_pages/interests.md'].includes(path)) { set(document,'.catalog-title h1',inline.title); set(document,'.catalog-title > p:last-child',inline.intro); }
    document.title = fields.title + ' · Marc Machaalani';
    const description = document.querySelector('meta[name="description"]'); if (description && (fields.excerpt || fields.intro)) description.content = fields.excerpt || fields.intro;
    gallery(page);
  }
  fetch(endpoint + '/content?path=' + encodeURIComponent(path),{credentials:'omit',signal:AbortSignal.timeout(8000)})
    .then(response => { if (!response.ok) throw new Error('Content unavailable'); return response.json(); })
    .then(result => {
      if (result.page) apply(result.page);
      for (const record of result.records || []) for (const node of document.querySelectorAll('[data-source-path]')) {
        if (node.dataset.sourcePath !== record.path) continue;
        set(node,'.archive__item-title a, .media-card__title a',record.inline.title);
        let excerpt = node.querySelector('.archive__item-excerpt, .media-card__excerpt');
        if (!excerpt && record.inline.excerpt) { excerpt = document.createElement('p'); excerpt.className = node.classList.contains('media-card') ? 'media-card__excerpt' : 'archive__item-excerpt'; (node.querySelector('article') || node).append(excerpt); }
        if (excerpt) excerpt.innerHTML = record.inline.excerpt;
        set(node,'.media-card__source',record.inline.venue);
        if (node.classList.contains('media-card')) { const action = node.querySelector('.media-card__action'); if (action && record.fields.paperurl) action.href = record.fields.paperurl; else if (action) action.remove(); }
        const presented = node.querySelector('.presentation-meta'); if (presented && record.fields.venue) presented.textContent = 'Presented at ' + record.fields.venue;
        const time = node.querySelector('time'); if (time && record.fields.date) { time.dateTime = record.fields.date; time.textContent = new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(record.fields.date)); }
        const venue = node.querySelector('.publication-venue'); if (venue) venue.textContent = [record.fields.venue,record.fields.date?.slice(0,4)].filter(Boolean).join(', ');
        if (node.hasAttribute('data-publication')) { node.dataset.year = record.fields.date?.slice(0,4) || ''; node.dataset.articleType = record.fields.article_type || 'Journal Article'; node.dataset.topics = JSON.stringify((record.fields.topics || '').split(',').map(value => value.trim()).filter(Boolean)); }
        citation(node,record.inline.citation); links(node,record.fields);
      }
      document.dispatchEvent(new Event('site-content-updated'));
    }).catch(() => { /* Keep the complete static baseline available if the content service is offline. */ });
})();
