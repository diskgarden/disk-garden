#!/usr/bin/env python3
"""Checks the ?src= download-attribution tags in the built website (DIS-4).

Run after build-website.py:   python3 scripts/check-src-tags.py

The failure this exists to catch is silent. The Worker in front of
dl.diskgarden.app collapses any ?src= label it does not recognise into "other",
so a page whose label drifts out of the Worker's vocabulary keeps producing
downloads that get credited to nobody — and the resulting number still looks
plausible. Nothing in the build or the Worker complains. So the agreement
between the two vocabularies is asserted here, against the HTML that actually
shipped rather than against either list in isolation.

It also pins the two places that must NOT carry a tag:
  - appcast.xml, which Sparkle reads. Tagging it would attribute every installed
    copy's auto-update to a page and inflate downloads by the whole install base.
  - the JSON-LD downloadUrl, which is metadata rather than a link anyone clicked.

Exits non-zero with a specific reason on the first problem.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "website"

# Mirrors PAGE_SOURCES / CAMPAIGN_SOURCES in the Worker's src/attribution.js, and
# SRC_SHAPE's bound. Kept as literals on purpose: the point is to detect the two
# sides drifting, which importing one into the other would hide.
PAGE_SOURCES = {
    "home", "download", "releases", "support", "user-guide",
    "guides", "about", "privacy", "terms", "404",
}
GUIDE_SOURCES = {
    "guide-apple-intelligence-storage", "guide-clear-cache-mac", "guide-docker-storage-mac",
    "guide-find-large-files-mac", "guide-free-up-space-on-mac", "guide-iphone-backups-mac",
    "guide-mac-cleaner-apps", "guide-macos-system-storage", "guide-purgeable-space-mac",
    "guide-spotlight-index-mac", "guide-system-data-mac", "guide-time-machine-local-snapshots",
    "guide-xcode-storage",
}
CAMPAIGN_SOURCES = {"ph", "reddit", "hn", "x", "medium", "threads", "instagram", "appcast"}
SRC_SHAPE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

DMG_HREF = re.compile(r'href="(https://dl\.diskgarden\.app/[^"]*)"')
SRC_PARAM = re.compile(r"[?&]src=([^&\"]*)")


def accepted(label):
    """True when the Worker's sanitizeSrc would keep `label` rather than bucket it."""
    if not SRC_SHAPE.match(label):
        return False
    return label in PAGE_SOURCES or label in GUIDE_SOURCES or label in CAMPAIGN_SOURCES


def fail(msg):
    print(f"✗ {msg}")
    sys.exit(1)


def main():
    if not SITE.is_dir():
        fail(f"no built website at {SITE}")

    html_files = sorted(SITE.rglob("*.html"))
    if not html_files:
        fail(f"no HTML under {SITE} - run build-website.py first")

    tagged = untagged = 0
    labels = {}

    for path in html_files:
        rel = path.relative_to(SITE)
        text = path.read_text()
        for href in DMG_HREF.findall(text):
            m = SRC_PARAM.search(href)
            if not m:
                untagged += 1
                print(f"  untagged download link in {rel}: {href}")
                continue
            label = m.group(1)
            if not accepted(label):
                fail(f"{rel}: ?src={label!r} is not in the Worker's vocabulary, so it "
                     f"would record as \"other\" and credit the download to nobody")
            tagged += 1
            labels.setdefault(label, []).append(str(rel))

    if untagged:
        fail(f"{untagged} download link(s) carry no ?src=; they would record as \"none\"")
    if not tagged:
        fail("no tagged download links found at all - the tagging did not run")

    # The two that must stay clean.
    appcast = SITE / "appcast.xml"
    if appcast.exists():
        if "src=" in appcast.read_text():
            fail("appcast.xml carries a ?src= tag: every installed copy's auto-update "
                 "would be attributed to a page and counted as a download")
        print("  ✓ appcast.xml carries no ?src= (Sparkle updates stay unattributed)")
    else:
        fail("appcast.xml is missing - cannot confirm Sparkle updates stay untagged")

    for path in html_files:
        for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', path.read_text(), re.S):
            try:
                url = json.dumps(json.loads(block))
            except ValueError:
                continue
            if "dl.diskgarden.app" in url and "src=" in url:
                fail(f"{path.relative_to(SITE)}: JSON-LD downloadUrl carries a ?src= tag")
    print("  ✓ no JSON-LD downloadUrl carries a ?src= tag")

    # Every page family we build must actually appear, or a label silently stopped
    # being emitted and this check would otherwise pass on the remaining ones.
    seen = set(labels)
    missing = (PAGE_SOURCES | GUIDE_SOURCES) - seen
    if missing:
        fail(f"no download link was tagged for: {', '.join(sorted(missing))}")

    print(f"  ✓ {tagged} tagged download links across {len(html_files)} pages, "
          f"{len(seen)} distinct labels, all accepted by the Worker")
    print("✓ src tags OK")


if __name__ == "__main__":
    main()
