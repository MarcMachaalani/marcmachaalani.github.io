(() => {
  'use strict';
  const script = document.currentScript;
  if (!script || navigator.doNotTrack === '1' || navigator.globalPrivacyControl || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
  // Only a canonical path is sent: no query, fragment, referrer, or visitor ID.
  const canonical = document.querySelector('link[rel="canonical"]');
  const path = canonical ? new URL(canonical.href).pathname : location.pathname;
  if (path.startsWith('/admin')) return;
  let sent = false;
  function record() {
    if (sent || document.visibilityState !== 'visible') return;
    sent = true;
    fetch(script.dataset.endpoint, { method: 'POST', mode: 'cors', credentials: 'omit',
      referrerPolicy: 'no-referrer', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }) }).catch(() => {});
    document.removeEventListener('visibilitychange', record);
  }
  document.addEventListener('visibilitychange', record);
  record();
})();
