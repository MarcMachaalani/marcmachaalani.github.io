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

## Import publications from PubMed

The helper below previews new records for the author query `Machaalani M[Author]`. It uses the Python standard library and creates publication pages with a summary from the PubMed abstract, a full citation with Marc's name emphasized, and DOI/PubMed links.

Run from the repository root:

```sh
python3 scripts/import_pubmed_publications.py
python3 scripts/import_pubmed_publications.py --write
```

The first command is a preview. Review the records before using `--write`; existing PMIDs and titles are skipped and existing files are never overwritten. To preview selected records, pass `--pmid 12345678 87654321`. PubMed data can be incomplete or matched to the wrong author, so check each preview before adding it.

## Template and license

This site began with the [Academic Pages](https://github.com/academicpages/academicpages.github.io) project, built on the [Minimal Mistakes](https://mmistakes.github.io/minimal-mistakes/) Jekyll theme. Template and theme credits are retained in [LICENSE](LICENSE).

## Site updates

Publication search and filters run entirely on GitHub Pages. A weekly PubMed action proposes new journal publications through pull requests. Contact delivery, private page counts, and the owner editor are implemented in `services/site-api` and require one-time service activation. See [site services and setup](docs/site-services.md).
