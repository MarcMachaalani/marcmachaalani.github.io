(() => {
  'use strict';
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches || !('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll('.home-section, .research-card, .portal-card, .media-card, .award-item, .publication-record, .presentation-record, .site-gallery figure');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.remove('reveal-pending');
      entry.target.classList.add('reveal-arrived');
      entry.target.addEventListener('animationend', () => entry.target.classList.remove('reveal-arrived'), { once: true });
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.04, rootMargin: '0px 0px 32px 0px' });
  targets.forEach(target => {
    // Animate only below-the-fold entrances, leaving the first screen immediately usable.
    if (target.getBoundingClientRect().top < innerHeight) return;
    target.classList.add('reveal-pending'); observer.observe(target);
  });
  preference.addEventListener('change', () => {
    if (preference.matches) {
      observer.disconnect();
      targets.forEach(target => target.classList.remove('reveal-pending'));
    }
  });
})();
