---
title: "Honors & Awards"
permalink: /awards/
layout: catalog
folio: "03"
intro: "Research honors and recognition."
description: "View Marc Machaalani’s academic honors and awards in medicine and cancer research."
---

<ol class="award-list">
{% for award in site.data.awards %}
  <li class="award-item">
    <time datetime="{{ award.date | slice: 0, 7 }}">{% include cv-date.html date=award.date form="long" %}</time>
    <div><h2>{{ award.title }}</h2><p>{% if award.organization %}{{ award.organization }} · {% endif %}{{ award.location }}</p></div>
  </li>
{% endfor %}
</ol>
