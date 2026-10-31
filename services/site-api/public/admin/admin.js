(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  let csrf, files = [], current, dirty = false;
  const labels = { title: 'Title', date: 'Publication date', excerpt: 'Summary', venue: 'Journal or venue', article_type: 'Article type', topics: 'Topics (separate with commas)', paperurl: 'Paper link', pubmed: 'PubMed link', citation: 'Citation', intro: 'Page introduction' };
  const status = message => { $('#status').textContent = message; };
  async function api(path, data) {
    const response = await fetch(path, data ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(data) } : {});
    if (response.status === 204) return null;
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { $('#workspace').hidden = true; $('#login').hidden = false; }
      throw new Error(result.error || 'Unable to complete the request.');
    }
    return result;
  }
  function fileList() {
    $('#file-list').replaceChildren();
    const query = $('#file-search').value.toLowerCase();
    files.filter(path => path.toLowerCase().includes(query)).forEach(path => {
      const button = document.createElement('button');
      button.textContent = path.replace(/^_/, '').replace('/', ' · ').replace(/\.md$/, '').replaceAll('-', ' ');
      if (current?.path === path) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => load(path));
      $('#file-list').append(button);
    });
  }
  async function load(path) {
    if (dirty && !confirm('Discard your unsaved changes and open another page?')) return;
    status('Loading…');
    try {
      current = await api('/api/content?path=' + encodeURIComponent(path));
      dirty = false;
      $('#file-path').textContent = current.path;
      $('#fields').replaceChildren();
      const names = path.startsWith('_pages/') ? ['title', 'intro'] : ['title', 'date', 'excerpt', 'venue', 'article_type', 'topics', 'paperurl', 'pubmed', 'citation'];
      names.forEach(name => {
        const label = document.createElement('label');
        label.textContent = labels[name];
        const input = document.createElement(['excerpt', 'citation'].includes(name) ? 'textarea' : 'input');
        input.name = name; input.value = current.fields[name];
        if (name === 'date') input.type = 'date';
        if (name === 'title') input.required = true;
        if (input.tagName === 'TEXTAREA') input.rows = 3;
        label.append(input); $('#fields').append(label);
      });
      $('#body').value = current.body;
      $('#editor').hidden = false; $('#editor-placeholder').hidden = true; $('#draft-link').hidden = true;
      fileList(); status('');
    } catch (error) { status(error.message); }
  }
  $('#file-search').addEventListener('input', fileList);
  $('#editor').addEventListener('input', () => { dirty = true; });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  $('#editor').addEventListener('submit', async event => {
    event.preventDefault();
    $('#save').disabled = true; status('Saving draft…');
    const fields = {};
    $('#fields').querySelectorAll('input, textarea').forEach(input => {
      if (input.value !== current.fields[input.name]) fields[input.name] = input.value;
    });
    try {
      const result = await api('/api/drafts', { path: current.path, sha: current.sha, fields, body: $('#body').value });
      dirty = false;
      $('#draft-link').href = result.url; $('#draft-link').hidden = false;
      status(`Draft #${result.number} saved. Open it to review the changes and publish when ready.`);
    } catch (error) { status(error.message); }
    finally { $('#save').disabled = false; }
  });
  document.querySelectorAll('[data-insert]').forEach(button => button.addEventListener('click', () => {
    const area = $('#body'); const selected = area.value.slice(area.selectionStart, area.selectionEnd) || 'text';
    const samples = { bold: `**${selected}**`, italic: `*${selected}*`, link: `[${selected}](https://example.com)`, heading: `\n## ${selected}\n` };
    area.setRangeText(samples[button.dataset.insert], area.selectionStart, area.selectionEnd, 'select');
    area.focus(); dirty = true;
  }));
  async function tab(usage) {
    $('#usage-panel').hidden = !usage; $('#content-panel').hidden = usage;
    $('#edit-tab').setAttribute('aria-pressed', String(!usage)); $('#usage-tab').setAttribute('aria-pressed', String(usage)); status('');
    if (!usage) return;
    status('Loading page counts…');
    try {
      const result = await api('/api/analytics');
      $('#usage-total').textContent = `${result.pages.reduce((sum, row) => sum + row.views, 0)} page views in the last 30 days.`;
      for (const [selector, rows, field] of [['#usage-pages', result.pages, 'path'], ['#usage-days', result.days, 'day']]) {
        const target = $(selector); target.replaceChildren();
        rows.forEach(row => {
          const tr = document.createElement('tr');
          [row[field], row.views].forEach(value => { const cell = document.createElement('td'); cell.textContent = String(value); tr.append(cell); });
          target.append(tr);
        });
      }
      status(result.pages.length ? '' : 'No page views have been recorded yet.');
    } catch (error) { status(error.message); }
  }
  $('#usage-tab').addEventListener('click', () => tab(true)); $('#edit-tab').addEventListener('click', () => tab(false));
  $('#logout').addEventListener('click', async () => {
    if (dirty && !confirm('Sign out and discard unsaved changes?')) return;
    try { await api('/api/logout', {}); dirty = false; location.reload(); } catch (error) { status(error.message); }
  });
  (async () => {
    try {
      const owner = await api('/api/session'); csrf = owner.csrf;
      $('#owner').textContent = owner.login; $('#login').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false;
      files = await api('/api/files'); fileList();
    } catch (error) { if (error.message !== 'Please sign in.') status(error.message); }
  })();
})();
