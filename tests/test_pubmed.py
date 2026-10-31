import importlib.util
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pubmed', Path(__file__).resolve().parents[1] / 'scripts/import_pubmed_publications.py')
pubmed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pubmed)

XML = '''<PubmedArticle><MedlineCitation><PMID>12345</PMID><Article>
<ArticleTitle>Renal cell cancer: a &lt;new&gt; biomarker</ArticleTitle>
<Journal><Title>Example Journal</Title><ISOAbbreviation>Ex J</ISOAbbreviation><JournalIssue><PubDate><MedlineDate>2025 Dec</MedlineDate></PubDate></JournalIssue></Journal>
<AuthorList><Author><LastName>Machaalani</LastName><Initials>M</Initials></Author></AuthorList>
<PublicationTypeList><PublicationType>Review</PublicationType></PublicationTypeList>
<ELocationID EIdType="doi">10.1234/example</ELocationID>
</Article></MedlineCitation></PubmedArticle>'''


class ImportTests(unittest.TestCase):
    def test_generates_citation_identifiers_and_metadata(self):
        filename, title, content = pubmed.record_markdown(ET.fromstring(XML))
        self.assertTrue(filename.startswith('2025-12-01-'))
        self.assertIn('pmid: "12345"', content)
        self.assertIn('article_type: "Review"', content)
        self.assertIn('Renal cell carcinoma', content)
        self.assertIn('Biomarkers', content)
        self.assertIn('&lt;new&gt;', content)

    def test_rejects_wrong_author(self):
        with self.assertRaisesRegex(ValueError, 'does not list'):
            pubmed.record_markdown(ET.fromstring(XML.replace('Machaalani', 'Other')))

    def test_skips_preprints_corrections_and_retractions(self):
        for kind in ['Preprint', 'Published Erratum', 'Retracted Publication', 'Retraction of Publication']:
            self.assertTrue(pubmed.excluded_record(ET.fromstring(XML.replace('>Review<', '>' + kind + '<'))))
        self.assertFalse(pubmed.excluded_record(ET.fromstring(XML)))

    def test_title_dedup_ignores_markup_and_punctuation(self):
        self.assertEqual(pubmed.normalized_title('<i>TERT</i>: A study.'), pubmed.normalized_title('TERT — a study'))

    def test_enrichment_preserves_editorial_content_and_manual_topics(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(pubmed, 'PUBLICATIONS_DIR', Path(directory)):
            path = Path(directory) / 'existing.md'
            path.write_text('---\ntitle: "My curated title"\npubmed: "https://pubmed.ncbi.nlm.nih.gov/12345/"\ntopics: ["My topic"]\nexcerpt: "My summary"\n---\nBody stays.\n')
            pubmed.enrich_record(ET.fromstring(XML), True)
            after = path.read_text()
            self.assertIn('topics: ["My topic"]', after)
            self.assertIn('excerpt: "My summary"', after)
            self.assertTrue(after.endswith('Body stays.\n'))
            pubmed.enrich_record(ET.fromstring(XML), True)
            self.assertEqual(after, path.read_text())

    def test_search_paginates(self):
        responses = [b'{"esearchresult":{"count":"2","idlist":["1"]}}', b'{"esearchresult":{"count":"2","idlist":["2"]}}']
        with patch.object(pubmed, 'fetch', side_effect=responses), patch.object(pubmed.time, 'sleep'):
            self.assertEqual(pubmed.esearch_ids(None), ['1', '2'])

    def test_existing_pubmed_urls_prevent_duplicates(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(pubmed, 'PUBLICATIONS_DIR', Path(directory)):
            (Path(directory) / 'paper.md').write_text('---\ntitle: "<i>TERT</i>: A study"\npubmed: "https://pubmed.ncbi.nlm.nih.gov/12345/"\n---\n')
            ids, titles = pubmed.existing_records()
            self.assertIn('12345', ids)
            self.assertIn(pubmed.normalized_title('TERT A study'), titles)


if __name__ == '__main__':
    unittest.main()
