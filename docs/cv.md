# CV

`/cv/` is generated. There is no separate CV to edit by hand.

| Section | Source |
| --- | --- |
| Education, research, reviewing, leadership, languages | `_data/cv_content.yml` |
| Honors and awards | `_data/awards.yml` (also renders `/awards/`) |
| Published papers | `_publications/` |
| Oral and poster presentations | `_talks/`, with author lines in `_data/cv_talks.yml` |

Dates in the YAML are `YYYY` or `YYYY-MM` or `YYYY-MM-DD`, quoted. An open range is `end: present`. The CV prints `Feb 2026` and `2026–Present`. The awards page still prints `February 2026`.

A talk stays on the site but off the CV when its entry in `_data/cv_talks.yml` has `include: false`, or the talk file has `cv: false`.

The PDF at `/assets/cv.pdf` is the print view of `/cv/`. `.github/workflows/cv-pdf.yml` rebuilds it on `master` when CV source files change, and commits `assets/cv.pdf` only if the extracted text changed. Regenerate locally with:

```sh
bundle exec jekyll build
python3 scripts/build_cv_pdf.py
```

Do not put an email address in the CV data, the page, or the PDF.
