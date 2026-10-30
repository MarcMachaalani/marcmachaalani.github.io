# Marc Machaalani

Personal academic website for **Marc Machaalani, MD**: [marcmachaalani.github.io](https://marcmachaalani.github.io).

The site is built with [Jekyll](https://jekyllrb.com/) and the [Academic Pages](https://academicpages.github.io/) theme. It brings together clinical and research interests, selected publications, presentations, awards, and media coverage.

## Site content

- Homepage and selected research: `_pages/about.md`
- Site identity, profile links, and author details: `_config.yml`
- Header navigation: `_data/navigation.yml`
- Publications: `_publications/`
- Presentations: `_talks/`
- Awards and media: `_pages/awards.md` and `_pages/media.html`
- Custom visual styles: `_sass/_custom.scss`
- Images and downloadable files: `images/` and `files/`

Collection entries use YAML front matter. Add a new item by creating a file in the relevant collection and following the format of a neighboring entry.

## Preview locally

Install Ruby and Bundler, then run:

```sh
bundle install
bundle exec jekyll serve --livereload
```

Open [http://localhost:4000](http://localhost:4000). Jekyll rebuilds content changes automatically; restart the server after changing `_config.yml`.

The optional JavaScript build scripts are in `package.json`. They are only needed when changing the bundled JavaScript.

## Template and license

This site began with the [Academic Pages](https://github.com/academicpages/academicpages.github.io) project, built on the [Minimal Mistakes](https://mmistakes.github.io/minimal-mistakes/) Jekyll theme. Template and theme credits are retained in [LICENSE](LICENSE).
