"""Reject a site artifact whose HTML or JavaScript references missing local files."""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

root = Path(sys.argv[1]).resolve()
missing = []


def check(source, url):
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return
    target = source.parent / unquote(parsed.path)
    if not target.is_file():
        missing.append(f"{source.relative_to(root)} → {url}")


class PageAssets(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            check(self.source, attrs["src"])
        if tag == "link" and attrs.get("rel") == "stylesheet" and attrs.get("href"):
            check(self.source, attrs["href"])


for page in root.rglob("*.html"):
    parser = PageAssets()
    parser.source = page
    parser.feed(page.read_text())

imports = re.compile(r"\b(?:from|import)\s*(?:\(\s*)?['\"](\./[^'\"]+)['\"]")
for module in root.rglob("*.js"):
    for reference in imports.findall(module.read_text()):
        check(module, reference)

if missing:
    raise SystemExit("Missing published assets:\n" + "\n".join(missing))
print("Published HTML and JavaScript dependencies are complete.")
