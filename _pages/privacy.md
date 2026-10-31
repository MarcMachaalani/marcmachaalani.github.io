---
layout: catalog
title: "Privacy"
permalink: /privacy/
intro: "A small site, with minimal data collection."
section_label: "About this site"
---

{% if site.data.services.analytics_enabled %}
This site counts page views to understand which pages are useful. It stores only a page path, a UTC calendar date, and an aggregate count, retained for up to 90 days. It does not use analytics cookies, visitor IDs, fingerprinting, or cross-site tracking. Search terms, URL query strings, referring pages, and IP addresses are not stored in the analytics database. Counts measure page views, not unique people, and may include automated traffic. The script respects Do Not Track and Global Privacy Control.
{% else %}
Site usage analytics are currently disabled.
{% endif %}

When enabled, the contact form sends your name, email address, subject, and message to me by email through Cloudflare and Resend. These services process the message to deliver it and prevent abuse. Messages are not saved in this website's database or repository. Cloudflare Turnstile checks submissions for spam. Network addresses are processed transiently for delivery and rate limiting.

GitHub Pages hosts the public site. GitHub, Cloudflare, and the email provider may process connection information and retain operational logs under their own policies. The application's analytics database contains no connection logs.

The private editor uses a short-lived, secure sign-in cookie and GitHub authentication. Its draft changes are saved in this public website repository as pull requests; drafts are therefore public. Do not put private information in site drafts.

Embedded videos and links to other websites have their own privacy practices. You may contact me about information you have sent through the [contact page](/contact/).

The owner editor stores uploaded PDFs and photos privately. Paper PDFs have no public download route. Photos become public only when added to a published page. Uploads used only in an unpublished draft stay private.
