import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CvDataTests(unittest.TestCase):
    def test_cv_sources_have_no_email(self):
        data_paths = ["_data/cv_content.yml", "_data/awards.yml", "_data/cv_talks.yml"]
        template_paths = data_paths + [
            "_pages/cv.html",
            "_layouts/cv.html",
            "_includes/cv-date.html",
            "_includes/cv-range.html",
            "_includes/cv-talks.html",
            "assets/css/cv-print.css",
        ]
        for rel in data_paths:
            text = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn("@", text, rel)
        for rel in template_paths:
            text = (ROOT / rel).read_text(encoding="utf-8").lower()
            self.assertNotIn("mailto:", text, rel)
            self.assertNotRegex(text, r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", rel)

    def test_handwritten_sections_and_dates(self):
        text = (ROOT / "_data/cv_content.yml").read_text(encoding="utf-8")
        for key in ("education:", "research_experience:", "reviewing:", "leadership:", "languages:"):
            self.assertIn(key, text)
        self.assertIn("solfège", text)
        for line in text.splitlines():
            match = re.match(r"\s+(?:start|end):\s*(.+)$", line)
            if not match:
                continue
            value = match.group(1).strip().strip("'\"")
            if value == "present":
                continue
            self.assertRegex(value, r"^\d{4}(-\d{2}(-\d{2})?)?$")

    def test_awards_match_the_public_list(self):
        text = (ROOT / "_data/awards.yml").read_text(encoding="utf-8")
        titles = re.findall(r"(?m)^  title: (.+)$", text)
        self.assertEqual(len(titles), 8)
        shaughnessy = text.split("Frank Shaughnessy Endowed Fellowship in Kidney Cancer", 1)[1].split("\n- ", 1)[0]
        self.assertNotIn("organization:", shaughnessy)
        self.assertIn("Boston, MA, USA", shaughnessy)
        self.assertIn("2026-02-25", text)
        self.assertIn("2025-02-12", text)
        for line in text.splitlines():
            match = re.match(r"\s+date:\s*(.+)$", line)
            if not match:
                continue
            value = match.group(1).strip().strip("'\"")
            self.assertRegex(value, r"^\d{4}-\d{2}(-\d{2})?$")

    def test_talk_author_keys_exist_and_every_talk_has_a_date(self):
        raw = (ROOT / "_data/cv_talks.yml").read_text(encoding="utf-8")
        keys = re.findall(r'(?m)^"([^"]+)":', raw)
        self.assertGreaterEqual(len(keys), 12)
        for key in keys:
            self.assertTrue((ROOT / "_talks" / f"{key}.md").exists(), key)
        for path in (ROOT / "_talks").glob("*.md"):
            self.assertRegex(path.read_text(encoding="utf-8"), r"(?m)^date:\s*\d{4}-\d{2}-\d{2}\s*$")

    def test_onclive_2025_date_keeps_its_permalink(self):
        text = (ROOT / "_talks/2025-02-25-onclive-kim1-oral.md").read_text(encoding="utf-8")
        self.assertIn("date: 2025-02-12", text)
        self.assertIn("permalink: /talks/2025-02-25-onclive-kim1-oral", text)

    def test_covid_paper_is_not_a_pubmed_record(self):
        path = ROOT / "_publications/2025-09-12-covid-cvd-knowledge-lebanon.md"
        text = path.read_text(encoding="utf-8")
        self.assertIn("doi:10.3390/covid5090155", text)
        self.assertIn('topics: ["Public health"]', text)
        self.assertNotIn("pmid:", text)
        self.assertIn("<strong>Machaalani M</strong>", text)
