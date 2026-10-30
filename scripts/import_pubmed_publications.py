#!/usr/bin/env python3
"""Preview or import missing PubMed records into the Jekyll publications collection.

By default this only previews. Pass --write to create missing Markdown records.
Uses Python's standard library and NCBI E-utilities; no packages or API key needed.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLICATIONS_DIR = ROOT / "_publications"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
SEARCH_TERM = "Machaalani M[Author]"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "MarcMachaalaniAcademicSite/1.0 (PubMed sync)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def esearch_ids(pmids: list[str] | None) -> list[str]:
    if pmids:
        return pmids
    query = urllib.parse.urlencode(
        {
            "db": "pubmed",
            "term": SEARCH_TERM,
            "sort": "pub date",
            "retmax": "200",
            "retmode": "json",
            "tool": "marcmachaalani_site",
        }
    )
    result = json.loads(fetch(f"{EUTILS}/esearch.fcgi?{query}"))
    return result["esearchresult"]["idlist"]


def node_text(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return " ".join("".join(node.itertext()).split())


def article_date(article: ET.Element) -> tuple[str, str, str]:
    date_node = article.find(".//ArticleDate")
    if date_node is not None:
        year = node_text(date_node.find("Year"))
        month = node_text(date_node.find("Month"))
        day = node_text(date_node.find("Day"))
    else:
        pub_date = article.find("./Journal/JournalIssue/PubDate")
        year = node_text(pub_date.find("Year")) if pub_date is not None else ""
        month = node_text(pub_date.find("Month")) if pub_date is not None else ""
        day = node_text(pub_date.find("Day")) if pub_date is not None else ""

        if not year and pub_date is not None:
            medline_date = node_text(pub_date.find("MedlineDate"))
            match = re.search(r"\b(19|20)\d{2}\b", medline_date)
            year = match.group(0) if match else ""
            month_match = re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b", medline_date, re.I)
            month = month_match.group(0) if month_match else ""

    month_names = {
        "jan": "01", "feb": "02", "mar": "03", "apr": "04",
        "may": "05", "jun": "06", "jul": "07", "aug": "08",
        "sep": "09", "oct": "10", "nov": "11", "dec": "12",
    }
    month_number = month_names.get(month[:3].lower(), month.zfill(2) if month.isdigit() else "01")
    day_number = day.zfill(2) if day.isdigit() else "01"
    if not year.isdigit():
        raise ValueError("PubMed record has no usable publication year")
    return year, month_number, day_number


def citation_author(author: ET.Element) -> str:
    collective = node_text(author.find("CollectiveName"))
    if collective:
        return collective
    last = node_text(author.find("LastName"))
    initials = node_text(author.find("Initials"))
    suffix = node_text(author.find("Suffix"))
    name = " ".join(part for part in (last, initials, suffix) if part)
    if last == "Machaalani" and initials.startswith("M"):
        return f"<strong>{html.escape(name)}</strong>"
    return html.escape(name)


def excerpt_from_abstract(article: ET.Element) -> str:
    sections = [
        node_text(section)
        for section in article.findall("./Abstract/AbstractText")
        if node_text(section)
    ]
    abstract = " ".join(sections)
    if not abstract:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", abstract)
    excerpt = " ".join(sentences[:2]).strip()
    if len(excerpt) > 420:
        excerpt = excerpt[:417].rsplit(" ", 1)[0] + "..."
    return excerpt


def slugify(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def record_markdown(record: ET.Element) -> tuple[str, str, str]:
    citation_record = record.find("./MedlineCitation")
    article = citation_record.find("./Article") if citation_record is not None else None
    pmid = node_text(citation_record.find("./PMID")) if citation_record is not None else ""
    if article is None or not pmid:
        raise ValueError("PubMed response is missing an article or PMID")

    title = node_text(article.find("./ArticleTitle"))
    author_nodes = article.findall("./AuthorList/Author")
    if not any(
        node_text(author.find("./LastName")) == "Machaalani"
        and node_text(author.find("./Initials")).startswith("M")
        for author in author_nodes
    ):
        raise ValueError(f"PMID {pmid} does not list Marc Machaalani as an author")

    year, month, day = article_date(article)
    date_value = f"{year}-{month}-{day}"
    journal = node_text(article.find("./Journal/Title")) or node_text(article.find("./Journal/ISOAbbreviation"))
    abbreviation = node_text(article.find("./Journal/ISOAbbreviation")) or journal
    volume = node_text(article.find("./Journal/JournalIssue/Volume"))
    issue = node_text(article.find("./Journal/JournalIssue/Issue"))
    pages = node_text(article.find("./Pagination/MedlinePgn"))
    if not pages:
        for locator in article.findall("./ELocationID"):
            if locator.attrib.get("EIdType") == "pii":
                pages = node_text(locator)
                break

    doi = ""
    for locator in article.findall("./ELocationID"):
        if locator.attrib.get("EIdType") == "doi":
            doi = node_text(locator)
            break

    citation_authors = ", ".join(citation_author(author) for author in author_nodes)
    publication_details = year
    if volume:
        publication_details += f";{volume}"
        if issue:
            publication_details += f"({issue})"
        if pages:
            publication_details += f":{pages}"
    else:
        publication_details += f" {month}-{day}"
        if pages:
            publication_details += f":{pages}"
    citation = f"{citation_authors}. {html.escape(title)}. <i>{html.escape(abbreviation)}</i>. {publication_details}."
    if doi:
        citation += f" doi: {html.escape(doi)}."

    file_stem = f"{date_value}-{slugify(title)}"
    permalink = f"/publication/{file_stem}/"
    excerpt = excerpt_from_abstract(article)
    venue = f"<strong>{html.escape(journal)}</strong>"
    paper_url = f"https://doi.org/{doi}" if doi else ""
    pubmed_url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"

    fields = [
        f"title: {yaml_string(title)}",
        "collection: publications",
        "category: manuscripts",
        f"permalink: {permalink}",
        f"excerpt: {yaml_string(excerpt)}" if excerpt else "",
        f"date: {date_value}",
        f"venue: {yaml_string(venue)}",
        f"paperurl: {yaml_string(paper_url)}" if paper_url else "",
        f"pubmed: {yaml_string(pubmed_url)}",
        f"pmid: {yaml_string(pmid)}",
        f"citation: {yaml_string(citation)}",
    ]
    front_matter = "\n".join(field for field in fields if field)
    body = f"---\n{front_matter}\n---\n"
    return f"{file_stem}.md", title, body


def existing_records() -> tuple[set[str], set[str]]:
    pmids: set[str] = set()
    titles: set[str] = set()
    for path in PUBLICATIONS_DIR.glob("*.md"):
        content = path.read_text(encoding="utf-8")
        title_match = re.search(r"(?m)^title:\s*[\"']?(.*?)[\"']?\s*$", content)
        if title_match:
            titles.add(title_match.group(1).strip().casefold())
        pmid_match = re.search(r"(?m)^pmid:\s*[\"']?(\d+)", content)
        if pmid_match:
            pmids.add(pmid_match.group(1))
        else:
            url_match = re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)", content)
            if url_match:
                pmids.add(url_match.group(1))
    return pmids, titles


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pmid", nargs="+", help="Import or preview specific PubMed IDs")
    parser.add_argument("--write", action="store_true", help="Create new Markdown files; default is preview only")
    args = parser.parse_args()

    try:
        ids = esearch_ids(args.pmid)
        if not ids:
            print("PubMed returned no records.")
            return 0
        params = urllib.parse.urlencode(
            {
                "db": "pubmed",
                "id": ",".join(ids),
                "retmode": "xml",
                "tool": "marcmachaalani_site",
            }
        )
        root = ET.fromstring(fetch(f"{EUTILS}/efetch.fcgi?{params}"))
        existing_pmids, existing_titles = existing_records()
        candidates = []
        for record in root.findall("./PubmedArticle"):
            filename, title, markdown = record_markdown(record)
            pmid_match = re.search(r"pmid: \"(\d+)\"", markdown)
            pmid = pmid_match.group(1) if pmid_match else ""
            if pmid in existing_pmids or title.casefold() in existing_titles:
                continue
            candidates.append((filename, title, markdown))

        if not candidates:
            print("No new publications found.")
            return 0

        mode = "Importing" if args.write else "Previewing"
        print(f"{mode} {len(candidates)} new publication(s):")
        for filename, title, markdown in candidates:
            print(f"- {title} -> _publications/{filename}")
            if args.write:
                destination = PUBLICATIONS_DIR / filename
                if destination.exists():
                    print(f"  Skipped existing file: {destination.name}")
                    continue
                destination.write_text(markdown, encoding="utf-8")
            else:
                lines = markdown.splitlines()
                summary = next((line for line in lines if line.startswith("excerpt:")), "")
                if summary:
                    print(f"  {summary}")

        if not args.write:
            print("\nReview these records, then rerun with --write to create the files.")
        return 0
    except (OSError, ValueError, KeyError, ET.ParseError) as error:
        print(f"PubMed import failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
