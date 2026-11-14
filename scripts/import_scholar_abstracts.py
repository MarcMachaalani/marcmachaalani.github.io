#!/usr/bin/env python3
"""Preview or import new Google Scholar meeting abstracts.

Journal articles are left to the PubMed importer. This only proposes records
that look like conference abstracts and are not already on the site. By default
it previews. Pass --write to create Markdown files. A blocked Scholar response
changes nothing and is not treated as a failure.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLICATIONS_DIR = ROOT / "_publications"
SCHOLAR_USER = "hYkqkEUAAAAJ"
LIST_URL = (
    "https://scholar.google.com/citations?hl=en&user={user}"
    "&view_op=list_works&sortby=pubdate&cstart={start}&pagesize=100"
)

TOPIC_RULES = {
    "Renal cell carcinoma": r"renal cell|kidney (?:cancer|neoplasms)|rcc|ccrcc|mrcc",
    "Immunotherapy": r"immunotherap|immune checkpoint|checkpoint inhib|nivolumab|ipilimumab|avelumab|pembrolizumab",
    "Biomarkers": r"biomarker|kim-1|madcam|liquid biopsy|prognostic",
    "Cancer genomics": r"genomic|mutation|germline|polygenic|nf2|tert|erbb2",
    "Cancer metabolism": r"metaboli|slc1a1|gfpt2|hexosamine",
    "Targeted therapies": r"belzutifan|hif-?2|axl|cabozantinib|nkt2152|targeted",
    "Public health": r"medical graduate|young-onset|seer|comorbidity",
    "Clinical outcomes": r"overall survival|real-world|response rate|progression",
}


class ScholarBlocked(Exception):
    """Google Scholar returned a captcha or an unusable page."""


def normalized_title(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", "", value))
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", value).casefold())


def fetch(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        if error.code in {403, 429, 503}:
            raise ScholarBlocked(f"HTTP {error.code}") from error
        raise
    if scholar_blocked(body):
        raise ScholarBlocked("captcha")
    return body


def scholar_blocked(page: str) -> bool:
    lowered = page.lower()
    return any(token in lowered for token in ("recaptcha", "unusual traffic", "gs_captcha", "not a robot"))


def clean_text(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value))
    return re.sub(r"\s+", " ", value).strip()


def clean_title(raw: str) -> str:
    title = clean_text(raw).replace("…", " ").replace("...", " ")
    title = re.sub(r"(?i)^abstract\s+[a-z]{0,4}\d+[a-z]{0,4}:\s*", "", title)
    title = re.sub(r"^\d{1,4}[A-Za-z]{0,3}[:\s]+", "", title)
    title = re.sub(r"^\d{1,4}(?=[A-Z])", "", title)
    title = re.sub(r"\s+", " ", title).strip().rstrip(" .")
    if title and title[0].islower():
        title = title[0].upper() + title[1:]
    return title


def looks_like_meeting_abstract(title: str, venue: str, description: str) -> bool:
    if re.match(r"(?i)^abstract\s+[a-z]{0,4}\d+", title.strip()):
        return True
    if re.match(r"^\d{1,4}[A-Za-z]{0,3}(?:[:\s]|(?=[A-Z]))", title.strip()):
        return True
    blob = f"{title} {venue} {description}"
    return bool(re.search(r"\b(?:abstract|poster)\s+[A-Z]{0,4}\d{2,4}[A-Z]{0,3}\b", blob, re.I))


def finding_excerpt(text: str) -> str:
    text = clean_text(text)
    match = re.search(r"(?i)conclusions?\s*:?\s*(.+)", text)
    body = match.group(1) if match else ""
    if not body:
        results = re.search(r"(?i)results?\s*:?\s*(.+?)(?=conclusions?|$)", text)
        body = results.group(1) if results else ""
    body = re.split(r"(?i)\b(?:ethics approval|citation format|funding|disclosure)\b", body)[0].strip()
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", body) if sentence.strip()]
    excerpt = " ".join(sentences[:2]).strip()
    if len(excerpt) > 360:
        excerpt = excerpt[:357].rsplit(" ", 1)[0] + "..."
    return excerpt


def format_author(raw: str) -> str:
    raw = clean_text(raw).rstrip(",")
    parts = raw.split()
    initials = ""
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{1,4}", parts[0]):
        initials = parts[0]
        name = f"{' '.join(parts[1:])} {initials}"
    else:
        name = raw
        initials = parts[0] if parts else ""
    if re.search(r"machaalani", name, re.I) and (initials.startswith(("M", "m")) or name.lower().startswith("marc")):
        return f"<strong>{html.escape(name)}</strong>"
    return html.escape(name)


def parse_authors(value: str) -> list[str]:
    return [format_author(part) for part in re.split(r",\s*", value) if clean_text(part)]


def parse_date(value: str, fallback_year: str) -> str:
    match = re.search(r"(20\d{2})(?:[/-](\d{1,2}))?(?:[/-](\d{1,2}))?", value or "")
    if not match and fallback_year.isdigit():
        return f"{fallback_year}-12-31"
    if not match:
        raise ValueError("Scholar record has no publication year")
    year, month, day = match.group(1), match.group(2) or "12", match.group(3) or ("31" if not match.group(2) else "01")
    return f"{year}-{int(month):02d}-{int(day):02d}"


def slugify(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)[:80].strip("-")


def topics_for(text: str) -> list[str]:
    topics = [label for label, pattern in TOPIC_RULES.items() if re.search(pattern, text, re.I)]
    return topics or ["Other research"]


def parse_list(page: str) -> list[dict[str, str]]:
    rows = []
    for row in re.findall(r'class="gsc_a_tr"(.*?)</tr>', page, re.S):
        link = re.search(r'href="([^"]*citation_for_view=[^"]+)"[^>]*class="gsc_a_at"[^>]*>(.*?)</a>', row, re.S)
        if not link:
            link = re.search(r'class="gsc_a_at"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', row, re.S)
        if not link:
            continue
        grays = re.findall(r'class="gs_gray"[^>]*>(.*?)</div>', row, re.S)
        year = re.search(r'class="gsc_a_h[^"]*"[^>]*>(.*?)</span>', row, re.S)
        href = html.unescape(link.group(1))
        if href.startswith("/"):
            href = "https://scholar.google.com" + href
        rows.append({
            "title": clean_text(link.group(2)),
            "authors": clean_text(grays[0]) if grays else "",
            "venue": clean_text(grays[1]) if len(grays) > 1 else "",
            "year": clean_text(year.group(1)) if year else "",
            "url": href,
        })
    return rows


def parse_citation(page: str) -> dict[str, str]:
    fields = {}
    for field, value in re.findall(
        r'class="gsc_oci_field"[^>]*>(.*?)</div>\s*<div class="gsc_oci_value"[^>]*>(.*?)</div>',
        page,
        re.S,
    ):
        fields[clean_text(field).lower()] = clean_text(value)
    doi = ""
    for href in re.findall(r'href="([^"]+)"', page):
        href = html.unescape(href)
        match = re.search(r"doi\.org/(10\.\S+)", href)
        if match:
            doi = match.group(1).rstrip(".,);")
            break
    return {
        "authors": fields.get("authors", ""),
        "date": fields.get("publication date", ""),
        "venue": re.sub(r",\s*20\d{2}$", "", fields.get("journal", "") or fields.get("conference", "")),
        "description": fields.get("description", ""),
        "doi": doi,
    }


def same_work(left: str, right: str) -> bool:
    a, b = normalized_title(left), normalized_title(right)
    if not a or not b:
        return False
    if a == b:
        return True
    short, long = sorted((a, b), key=len)
    return len(short) >= 40 and long.startswith(short)


def existing_records() -> tuple[set[str], set[str]]:
    titles: set[str] = set()
    dois: set[str] = set()
    for path in PUBLICATIONS_DIR.glob("*.md"):
        content = path.read_text(encoding="utf-8")
        title_match = re.search(r'(?m)^title:\s*(".*"|\'.*\'|.+)$', content)
        if title_match:
            raw = title_match.group(1).strip()
            try:
                raw = json.loads(raw) if raw[:1] in "\"'" else raw.strip("'\"")
            except json.JSONDecodeError:
                raw = raw.strip("'\"")
            titles.add(normalized_title(str(raw)))
        doi_match = re.search(r"doi\.org/(10\.[^\s\"']+)", content)
        if doi_match:
            dois.add(doi_match.group(1).rstrip(".,").lower())
    return titles, dois


def record_markdown(item: dict[str, str], detail: dict[str, str]) -> tuple[str, str, str]:
    source_title = detail.get("title") or item["title"]
    title = clean_title(source_title)
    if not title:
        raise ValueError("Scholar record has no usable title")
    authors = parse_authors(detail.get("authors") or item.get("authors", ""))
    if not any("Machaalani" in author for author in authors):
        raise ValueError(f"{title} does not list Marc Machaalani")
    venue = clean_text(detail.get("venue") or re.sub(r",\s*20\d{2}$", "", item.get("venue", "")))
    venue = re.sub(r"\s+\d+$", "", venue).strip(" ,")
    date_value = parse_date(detail.get("date", ""), item.get("year", ""))
    year = date_value[:4]
    description = detail.get("description", "")
    excerpt = finding_excerpt(description)
    doi = detail.get("doi", "")
    paper_url = f"https://doi.org/{doi}" if doi else item.get("url", "")
    citation = f"{', '.join(authors)}. {html.escape(title)}. <i>{html.escape(venue)}</i>. {year}."
    if doi:
        citation += f" doi:{html.escape(doi)}."
    stem = f"{date_value}-{slugify(title)}"
    abstract = ""
    if len(description) > 180:
        body = re.split(r"(?i)\b(?:citation format|ethics approval)\b", description)[0].strip()
        abstract = "abstract:\n  - text: |-\n" + "\n".join(f"      {line}" for line in body.splitlines() or [body]) + "\n"
    fields = [
        f"title: {json.dumps(title, ensure_ascii=False)}",
        "collection: publications",
        "category: abstracts",
        f"permalink: /publications/{stem}/",
        "cv: false",
        abstract.rstrip("\n"),
        f"excerpt: {json.dumps(excerpt, ensure_ascii=False)}" if excerpt else "",
        f"date: {date_value}",
        f"venue: {json.dumps('<strong>' + html.escape(venue) + '</strong>', ensure_ascii=False)}",
        f"paperurl: {json.dumps(paper_url, ensure_ascii=False)}" if paper_url else "",
        'article_type: "Abstract"',
        f"topics: {json.dumps(topics_for(title + ' ' + description), ensure_ascii=False)}",
        f"citation: {json.dumps(citation, ensure_ascii=False)}",
    ]
    body = "---\n" + "\n".join(field for field in fields if field) + "\n---\n"
    return f"{stem}.md", title, body


def list_works(fetcher) -> list[dict[str, str]]:
    works = []
    for start in range(0, 500, 100):
        page = fetcher(LIST_URL.format(user=SCHOLAR_USER, start=start))
        batch = parse_list(page)
        works.extend(batch)
        if len(batch) < 100:
            break
        time.sleep(1.0)
    return works


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Create new Markdown files; default is preview only")
    args = parser.parse_args()
    try:
        works = list_works(fetch)
    except ScholarBlocked as error:
        print(f"Google Scholar blocked this request ({error}). No files were changed.")
        return 0
    except (OSError, ValueError) as error:
        print(f"Google Scholar import failed: {error}", file=sys.stderr)
        return 1

    titles, dois = existing_records()
    created = 0
    for item in works:
        if not looks_like_meeting_abstract(item["title"], item["venue"], ""):
            continue
        try:
            time.sleep(0.8)
            detail = parse_citation(fetch(item["url"]))
        except ScholarBlocked as error:
            print(f"Google Scholar blocked this request ({error}). No further files were changed.")
            return 0
        except (OSError, ValueError) as error:
            print(f"Skipped {item['title']}: {error}", file=sys.stderr)
            continue
        doi = detail.get("doi", "").lower()
        if doi and doi in dois:
            continue
        if any(same_work(item["title"], existing) or same_work(clean_title(item["title"]), existing) for existing in titles):
            continue
        try:
            filename, title, markdown = record_markdown(item, detail)
        except ValueError as error:
            print(f"Skipped {item['title']}: {error}")
            continue
        if any(same_work(title, existing) for existing in titles):
            continue
        print(f"{'Importing' if args.write else 'Previewing'}: {title} -> _publications/{filename}")
        titles.add(normalized_title(title))
        if doi:
            dois.add(doi)
        if args.write:
            destination = PUBLICATIONS_DIR / filename
            if destination.exists():
                print(f"  Skipped existing file: {destination.name}")
                continue
            destination.write_text(markdown, encoding="utf-8")
            created += 1
    if created == 0 and args.write:
        print("No new abstracts found.")
    elif not args.write:
        print("Review these records, then rerun with --write to create the files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
