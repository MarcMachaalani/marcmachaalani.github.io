#!/usr/bin/env python3
"""Print the built /cv/ page to assets/cv.pdf with headless Chrome.

Run after `bundle exec jekyll build`. Chrome or Chromium must be on PATH.
The PDF uses the same print stylesheet as the on-page Print button.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "_site"
OUT = ROOT / "assets" / "cv.pdf"


def find_chrome() -> str:
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    raise SystemExit("Chrome or Chromium is not installed.")


def main() -> None:
    if not (SITE / "cv" / "index.html").exists():
        raise SystemExit("Missing _site/cv/index.html. Run: bundle exec jekyll build")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    handler = lambda *args, **kwargs: SimpleHTTPRequestHandler(*args, directory=str(SITE), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    tmp = OUT.with_suffix(".pdf.tmp")
    if tmp.exists():
        tmp.unlink()
    try:
        subprocess.run(
            [
                find_chrome(),
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--no-pdf-header-footer",
                "--virtual-time-budget=15000",
                f"--print-to-pdf={tmp}",
                f"http://{host}:{port}/cv/",
            ],
            check=True,
        )
    finally:
        server.shutdown()
    if not tmp.exists() or tmp.stat().st_size < 1000:
        raise SystemExit("Chrome did not write a PDF.")
    tmp.replace(OUT)
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
