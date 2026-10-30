---
published: false
layout: catalog
folio: "05"
intro: "Education, clinical training, and academic work."
title: "CV"
permalink: /cv/
author_profile: true
redirect_from:
  - /resume
---

{% include base_path %}

Education
======
* M.D., Lebanese University, 2023
* Bachelor's Degree in Piano Studies, Lebanese National Higher Conservatory of Music, 2021

Clinical and research training
======
* Internal Medicine Resident, Yale Traditional Internal Medicine Residency Program
* 2023–2026 · Postdoctoral Fellow in Genitourinary Oncology, Dana-Farber Cancer Institute and Harvard Medical School

Publications
======
  <ul>{% for post in site.publications reversed %}
    {% include archive-single-cv.html %}
  {% endfor %}</ul>
  
Presentations
======
  <ul>{% for post in site.talks reversed %}
    {% include archive-single-talk-cv.html  %}
  {% endfor %}</ul>
  
