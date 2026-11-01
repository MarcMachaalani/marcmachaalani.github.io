(() => {
  let template, blocks = [], target, changed, renderedSource = '';
  const el = (tag,text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  function sync() {
    blocks.forEach(({source,input}) => { source.innerHTML = input.innerHTML; });
    target.value = template.body.innerHTML;
    renderedSource = target.value; changed();
  }
  function format(input,tag) {
    input.focus();
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed || !input.contains(selection.anchorNode) || !input.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0);
    const container = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const existing = container(range.startContainer).closest(tag), end = container(range.endContainer).closest(tag);
    if (existing && existing === end && input.contains(existing) && tag !== 'a') { existing.replaceWith(...existing.childNodes); sync(); return; }
    if (tag !== 'a') {
      const fragment = range.cloneContents(), texts = document.createTreeWalker(fragment,NodeFilter.SHOW_TEXT);
      let text, allFormatted = Boolean(fragment.textContent.trim());
      while ((text = texts.nextNode())) if (text.textContent.trim() && !text.parentElement?.closest(tag)) allFormatted = false;
      if (allFormatted) {
        const contents = range.extractContents();
        contents.querySelectorAll(tag).forEach(node => node.replaceWith(...node.childNodes)); range.insertNode(contents);
        input.querySelectorAll(tag).forEach(node => { if (!node.textContent) node.remove(); }); sync(); return;
      }
    }
    let wrapper;
    if (tag === 'a') {
      const url = prompt('Link address (https://… or mailto:…)'); if (!url) return;
      try { if (!['https:','mailto:'].includes(new URL(url).protocol)) throw 0; } catch { alert('Use an HTTPS web address or mailto: email link.'); return; }
      if (existing && existing === end && input.contains(existing)) { existing.href = url; sync(); return; }
      wrapper = el('a'); wrapper.href = url;
    } else wrapper = el(tag);
    wrapper.append(range.extractContents()); range.insertNode(wrapper);
    selection.removeAllRanges(); const next = document.createRange(); next.selectNodeContents(wrapper); selection.addRange(next); sync();
  }
  window.richEditor = {
    matchesSource() { return !target || target.value === renderedSource; },
    load(current,area,onChange) {
      target = area; changed = onChange; blocks = []; renderedSource = area.value;
      const panel = document.querySelector('#visual-content'); panel.replaceChildren();
      template = new DOMParser().parseFromString(current.html || '', 'text/html');
      const home = current.path === '_pages/about.md';
      let sources;
      if (home) sources = template.querySelectorAll('.home-hero__summary,.home-bio h2,.home-bio p:not(.home-eyebrow),.research-card__meta,.research-card h3 a,.research-card > p:last-child');
      else if (current.path === '_pages/awards.md') sources = template.querySelectorAll('.award-item time,.award-item h2,.award-item p');
      else sources = template.querySelectorAll('h1,h2,h3,p,li');
      if (!sources.length && !current.body_locked) { const p = el('p'); template.body.append(p); sources = [p]; }
      Array.from(sources).filter(source => !source.querySelector('p,li,h1,h2,h3')).forEach((source,index) => {
        const group = el('div'); group.className = 'rich-block';
        const label = el('label',home ? index === 0 ? 'Home introduction' : index === 1 ? 'About heading' : index < 5 ? `Biography · paragraph ${index-1}` : 'Selected contribution' : `Text block ${index+1}`);
        const toolbar = el('div'); toolbar.className = 'toolbar'; toolbar.setAttribute('aria-label','Text formatting');
        const input = el('div'); input.className = 'rich-input'; input.contentEditable = 'true'; input.role = 'textbox'; input.setAttribute('aria-multiline','true'); input.id = `rich-block-${index}`; label.htmlFor = input.id; input.setAttribute('aria-label',label.textContent); input.innerHTML = source.innerHTML;
        for (const [name,tag] of [['Bold','strong'],['Italic','em'],['Link','a']]) { const button = el('button',name); button.type = 'button'; button.addEventListener('mousedown',event => event.preventDefault()); button.addEventListener('click',() => format(input,tag)); toolbar.append(button); }
        input.addEventListener('input',sync);
        input.addEventListener('paste',event => { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); const selection = getSelection(); if (!selection.rangeCount) return; const range = selection.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); sync(); });
        blocks.push({source,input}); group.append(label,toolbar,input); panel.append(group);
      });
      document.querySelector('#content-section').hidden = current.body_locked;
      document.querySelector('#source-mode').open = false;
      document.querySelector('#visual-content').hidden = false;
    }
  };
})();
