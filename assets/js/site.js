(() => {
  const follow = document.querySelector('button[aria-controls="author-profile-links"]');
  follow?.addEventListener('click', () => {
    const expanded = follow.getAttribute('aria-expanded') === 'true';
    follow.setAttribute('aria-expanded', String(!expanded));
  });

  const masthead = document.querySelector('.masthead');
  if (masthead && 'ResizeObserver' in window) {
    const updateScrollOffset = () => {
      const height = masthead.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--masthead-height', height + 'px');
    };
    updateScrollOffset();
    new ResizeObserver(updateScrollOffset).observe(masthead);
  }
})();
