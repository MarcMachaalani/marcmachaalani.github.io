import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "scholar", Path(__file__).resolve().parents[1] / "scripts/import_scholar_abstracts.py"
)
scholar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scholar)

LIST_HTML = '''
<tr class="gsc_a_tr"><td class="gsc_a_t">
<a href="/citations?view_op=view_citation&hl=en&user=hYkqkEUAAAAJ&citation_for_view=hYkqkEUAAAAJ:abc" class="gsc_a_at">1037 Non-infectious sarcoid-like conditions.</a>
<div class="gs_gray">M Machaalani, TK Choueiri</div>
<div class="gs_gray">Journal for ImmunoTherapy of Cancer, 2025</div>
</td><td class="gsc_a_y"><span class="gsc_a_h">2025</span></td></tr>
<tr class="gsc_a_tr"><td class="gsc_a_t">
<a href="/citations?view_op=view_citation&citation_for_view=hYkqkEUAAAAJ:paper" class="gsc_a_at">A full journal article about renal cell carcinoma</a>
<div class="gs_gray">M Machaalani</div>
<div class="gs_gray">Nature Medicine, 2026</div>
</td><td class="gsc_a_y"><span class="gsc_a_h">2026</span></td></tr>
'''

CITATION_HTML = '''
<div class="gsc_oci_field">Authors</div><div class="gsc_oci_value">M Machaalani, TK Choueiri</div>
<div class="gsc_oci_field">Publication date</div><div class="gsc_oci_value">2025/11/4</div>
<div class="gsc_oci_field">Journal</div><div class="gsc_oci_value">Journal for ImmunoTherapy of Cancer</div>
<div class="gsc_oci_field">Description</div><div class="gsc_oci_value">Background ICIs can cause toxicities. Methods We collected cases. Results Most reactions appeared after treatment. Conclusions Sarcoid-like reactions often appear after checkpoint therapy ends. Ethics Approval waived.</div>
<a href="https://doi.org/10.1136/example.1037">DOI</a>
'''


class ScholarTests(unittest.TestCase):
    def test_list_parser_and_abstract_filter(self):
        rows = scholar.parse_list(LIST_HTML)
        self.assertEqual(len(rows), 2)
        self.assertTrue(scholar.looks_like_meeting_abstract(rows[0]["title"], rows[0]["venue"], ""))
        self.assertFalse(scholar.looks_like_meeting_abstract(rows[1]["title"], rows[1]["venue"], ""))
        self.assertTrue(rows[0]["url"].startswith("https://scholar.google.com/citations?"))

    def test_title_cleaning_and_conclusion_excerpt(self):
        self.assertEqual(
            scholar.clean_title("Abstract A003: baseline levels of HIF2."),
            "Baseline levels of HIF2",
        )
        self.assertEqual(
            scholar.finding_excerpt("Background This study asked a question. Conclusions The variant predicted toxicity but not survival."),
            "The variant predicted toxicity but not survival.",
        )
        self.assertNotIn("asked a question", scholar.finding_excerpt("Background This study asked a question. Methods Assay."))

    def test_record_bolds_author_and_journal(self):
        item = scholar.parse_list(LIST_HTML)[0]
        filename, title, content = scholar.record_markdown(item, scholar.parse_citation(CITATION_HTML))
        self.assertTrue(filename.startswith("2025-11-04-"))
        self.assertFalse(title[0].isdigit())
        self.assertNotIn("1037", title)
        self.assertIn("<strong>Machaalani M</strong>", content)
        self.assertIn('venue: "<strong>Journal for ImmunoTherapy of Cancer</strong>"', content)
        self.assertIn("category: abstracts", content)
        self.assertIn("cv: false", content)
        self.assertIn("often appear after checkpoint therapy", content)
        self.assertNotIn("can cause toxicities", content.split("excerpt:")[1])

    def test_blocked_page_and_duplicate_title(self):
        self.assertTrue(scholar.scholar_blocked("<html>unusual traffic recaptcha</html>"))
        self.assertFalse(scholar.scholar_blocked(LIST_HTML))
        self.assertTrue(scholar.same_work(
            scholar.clean_title("1037 Non-infectious sarcoid-like inflammatory conditions"),
            "Non-infectious sarcoid-like inflammatory conditions from the consortium",
        ))


if __name__ == "__main__":
    unittest.main()
