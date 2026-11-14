(() => {
  'use strict';
  const form = document.querySelector('#publication-filters');
  if (!form) return;
  const normalize = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const collect = () => Array.from(document.querySelectorAll('[data-publication]'), element => {
    const topics = JSON.parse(element.dataset.topics || 'null') || [];
    return { element, year: element.dataset.year, type: element.dataset.articleType,
      topics, text: normalize(element.textContent + ' ' + topics.join(' ') + ' ' + element.dataset.articleType) };
  });
  let entries = collect();
  const controls = { q: form.elements.q, year: form.elements.year, type: form.elements.type, topic: form.elements.topic, abstracts: form.elements.abstracts };
  const fill = (select, values, descending = false) => {
    const sorted = Array.from(new Set(values.filter(Boolean))).sort((a, b) => descending ? b.localeCompare(a) : a.localeCompare(b));
    sorted.forEach(value => select.add(new Option(value, value)));
  };
  const eligible = () => entries.filter(entry => controls.abstracts.checked || entry.type !== 'Abstract');
  function rebuildOptions() {
    const saved = { year: controls.year.value, type: controls.type.value, topic: controls.topic.value };
    const pool = eligible();
    for (const select of [controls.year, controls.type, controls.topic]) while (select.options.length > 1) select.remove(1);
    fill(controls.year, pool.map(entry => entry.year), true);
    fill(controls.type, pool.map(entry => entry.type));
    fill(controls.topic, pool.flatMap(entry => entry.topics));
    for (const [key, select] of [['year', controls.year], ['type', controls.type], ['topic', controls.topic]]) {
      select.value = Array.from(select.options).some(option => option.value === saved[key]) ? saved[key] : '';
    }
  }
  function refresh() {
    entries = collect();
    readLocation();
    rebuildOptions();
    apply(false);
  }
  document.addEventListener('site-content-updated', refresh);
  function readLocation() {
    const params = new URLSearchParams(location.search);
    Object.entries(controls).forEach(([key, input]) => {
      if (input.type === 'checkbox') input.checked = params.get(key) === '1';
      else input.value = params.get(key) || '';
    });
  }
  function apply(updateUrl = true) {
    const words = normalize(controls.q.value.trim()).split(/\s+/).filter(Boolean);
    const showAbstracts = controls.abstracts.checked;
    let count = 0;
    entries.forEach(entry => {
      const match = (showAbstracts || entry.type !== 'Abstract') &&
        words.every(word => entry.text.includes(word)) &&
        (!controls.year.value || entry.year === controls.year.value) &&
        (!controls.type.value || entry.type === controls.type.value) &&
        (!controls.topic.value || entry.topics.includes(controls.topic.value));
      entry.element.hidden = !match;
      if (match) count++;
    });
    document.querySelectorAll('.publication-category').forEach(section => {
      section.hidden = !Array.from(section.querySelectorAll('[data-publication]')).some(el => !el.hidden);
    });
    document.querySelector('#publication-count').textContent = `${count} of ${eligible().length} publications`;
    document.querySelector('#publication-empty').hidden = count !== 0;
    if (updateUrl) {
      const url = new URL(location.href);
      Object.entries(controls).forEach(([key, input]) => {
        const value = input.type === 'checkbox' ? (input.checked ? '1' : '') : input.value;
        value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
      });
      history.replaceState(null, '', url);
    }
  }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => { if (event.target !== controls.abstracts) apply(); });
  controls.abstracts.addEventListener('change', () => { rebuildOptions(); apply(); });
  form.addEventListener('reset', () => setTimeout(() => { rebuildOptions(); apply(); }, 0));
  window.addEventListener('popstate', () => { readLocation(); rebuildOptions(); apply(false); });
  refresh();
  form.hidden = false;
})();
