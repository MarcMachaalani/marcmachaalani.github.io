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
  const controls = { q: form.elements.q, year: form.elements.year, type: form.elements.type, topic: form.elements.topic };
  const fill = (select, values, descending = false) => {
    const sorted = Array.from(new Set(values)).sort((a, b) => descending ? b.localeCompare(a) : a.localeCompare(b));
    sorted.forEach(value => select.add(new Option(value, value)));
  };
  function refresh() {
    entries = collect();
    for (const select of [controls.year,controls.type,controls.topic]) while (select.options.length > 1) select.remove(1);
    fill(controls.year,entries.map(entry => entry.year),true); fill(controls.type,entries.map(entry => entry.type)); fill(controls.topic,entries.flatMap(entry => entry.topics));
    readLocation(); apply(false);
  }
  document.addEventListener('site-content-updated',refresh);
  function readLocation() {
    const params = new URLSearchParams(location.search);
    Object.entries(controls).forEach(([key, input]) => { input.value = params.get(key) || ''; });
  }
  function apply(updateUrl = true) {
    const words = normalize(controls.q.value.trim()).split(/\s+/).filter(Boolean);
    let count = 0;
    entries.forEach(entry => {
      const match = words.every(word => entry.text.includes(word)) &&
        (!controls.year.value || entry.year === controls.year.value) &&
        (!controls.type.value || entry.type === controls.type.value) &&
        (!controls.topic.value || entry.topics.includes(controls.topic.value));
      entry.element.hidden = !match;
      if (match) count++;
    });
    document.querySelectorAll('.publication-category').forEach(section => {
      section.hidden = !Array.from(section.querySelectorAll('[data-publication]')).some(el => !el.hidden);
    });
    document.querySelector('#publication-count').textContent = `${count} of ${entries.length} publications`;
    document.querySelector('#publication-empty').hidden = count !== 0;
    if (updateUrl) {
      const url = new URL(location.href);
      Object.entries(controls).forEach(([key, input]) => input.value ? url.searchParams.set(key, input.value) : url.searchParams.delete(key));
      history.replaceState(null, '', url);
    }
  }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', () => apply());
  form.addEventListener('reset', () => setTimeout(apply, 0));
  window.addEventListener('popstate', () => { readLocation(); apply(false); });
  refresh();
  form.hidden = false;
})();
