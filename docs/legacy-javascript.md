# Legacy JavaScript audit

The homepage, Publications, Presentations, Awards, Media, Interests, Contact, and individual publication, talk, and media entries use the journal layout. That layout already skips the Academic Pages bundle. The legacy layout loads a 4,623,344-byte bundle plus its chart theme module.

- The masthead uses ordinary links and a native appearance button. It has no Greedy Nav markup or `#theme-toggle`. The early appearance script and the legacy bundle both read `localStorage.theme` and write `data-theme`.
- Legacy archive and single layouts still render the author sidebar when requested. The mobile Follow button depends on the bundle, and the desktop links are shown by CSS. The splash and catalog layouts do not render the sidebar.
- The legacy footer uses absolute positioning with a body margin calculated by JavaScript. The current stylesheet already provides smooth scrolling, reduced-motion support, and a 16:9 Interests video frame. The legacy talk map embeds a separate Leaflet map.
- The published Markdown demo contains four chart examples and instructions for the chart dependency. Marc approved removal of that section.
- The head includes reference local stylesheets, scripts, icons, and the feed. Academicons and Font Awesome use local font files. The legacy footer loads MathJax, a polyfill, and Mermaid from CDNs. The Contact page loads Turnstile, and the Interests page embeds YouTube. Those requests are outside the bundle removal.
- Baseline browser captures cover the seven main pages, the Markdown demo, and the talk map at widths of 375, 768, and 1280 pixels in light and dark. Script sizes are measured separately from the screenshots.
