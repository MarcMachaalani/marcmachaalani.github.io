---
layout: catalog
title: "Privacy"
permalink: /privacy/
intro: "A small site, with minimal data collection."
section_label: "About this site"
description: "Read how Marc Machaalani’s personal website handles visitor information and contact form submissions."
---

{% if site.data.services.analytics_enabled %}
This site counts page views. It stores a page path, a UTC date, and a count, kept for up to 90 days. It does not use cookies or visitor IDs, and it does not store IP addresses, search terms, or referring pages. Counts are page views, not people. The script respects Do Not Track and Global Privacy Control.
{% else %}
Site usage analytics are currently disabled.
{% endif %}

The contact form sends your name, email address, subject, and message to me by email through Cloudflare and Resend. Messages are not saved on this website. Cloudflare Turnstile checks submissions for spam, and network addresses are used only briefly to deliver the message and limit abuse.

GitHub Pages hosts the site. GitHub and Cloudflare may keep their own connection logs. Embedded videos and links to other sites follow those sites’ practices. Questions about a message you sent can go through the [contact page](/contact/).
