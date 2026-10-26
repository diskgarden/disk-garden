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

The Worker's vocabulary is read out of `worker/src/attribution.js` rather than
copied into this file. An earlier version kept its own literal copy "so the two
sides can drift apart visibly", which sounds right and is not: both sides were
then the same side, so the check passed no matter what the Worker recognised.
The two sides that matter are the built HTML and the Worker that reads the tags.

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
ATTRIBUTION = ROOT / "worker" / "src" / "attribution.js"

DMG_HREF = re.compile(r'href="(https://dl\.diskgarden\.app/[^"]*)"')
SRC_PARAM = re.compile(r"[?&]src=([^&\"]*)")

# A floor, not an expected count: it may legitimately grow. It exists so a parse
# that silently finds the wrong thing — the file moved, the declarations were
# reshaped — fails here instead of producing a short vocabulary that rejects
# real labels, or an empty one whose error message would point at the HTML.
MIN_LABELS = {"PAGE_SOURCES": 8, "GUIDE_SOURCES": 10, "CAMPAIGN_SOURCES": 5}


def fail(msg):
    print(f"✗ {msg}")
    sys.exit(1)


def js_set(text, name):
    """The double-quoted members of `export const <name> = new Set([...])`."""
    m = re.search(
        r"export\s+const\s+" + name + r"\s*=\s*new\s+Set\(\[(.*?)\]\)",
        text,
        re.S,
    )
    if not m:
        fail(f"{ATTRIBUTION.name} has no `export const {name} = new Set([...])` — "
             f"the Worker's vocabulary could not be read, so this check cannot "
             f"compare the built HTML against it")
    # Each member carries a trailing // comment naming its page, and those
    # comments contain quoted strings ("/", "/download/"). Strip comments before
    # reading members, or the paths get picked up as labels. Labels are
    # [a-z0-9-] only, so no label can contain "//".
    body = re.sub(r"//[^\n]*", "", m.group(1))
    members = set(re.findall(r'"([^"]+)"', body))
    floor = MIN_LABELS[name]
    if len(members) < floor:
        fail(f"{ATTRIBUTION.name}: {name} parsed as only {len(members)} label(s) "
             f"({', '.join(sorted(members)) or 'none'}), fewer than the {floor} "
             f"this check expects at minimum — the declaration was probably "
             f"reshaped and is no longer being read correctly")
    return members


def js_src_shape(text):
    """The Worker's SRC_SHAPE, compiled. Its bound is part of the vocabulary:
    a label longer than the cap buckets as "other" even when it is in the set,
    which is how guide-time-machine-local-snapshots (34 chars) was lost to a
    32-char cap."""
    m = re.search(r"const\s+SRC_SHAPE\s*=\s*/(.+?)/\s*;", text)
    if not m:
        fail(f"{ATTRIBUTION.name} has no `const SRC_SHAPE = /.../;` — the bound "
             f"the Worker applies before the set lookup could not be read")
    pattern = m.group(1)
    # Only a literal character-class pattern is accepted. JS and Python regex
    # syntax agree on this subset; anything richer would need a real translation
    # and must not be guessed at.
    if not re.fullmatch(r"\^\[[a-z0-9\-\\\]]+\][^/]*\$", pattern):
        fail(f"{ATTRIBUTION.name}: SRC_SHAPE is {pattern!r}, which is richer than "
             f"the character-class form this check knows how to evaluate in "
             f"Python — port it here deliberately rather than trusting a guess")
    try:
        return re.compile(pattern)
    except re.error as exc:
        fail(f"{ATTRIBUTION.name}: SRC_SHAPE {pattern!r} does not compile in Python ({exc})")


def js_known_sources(text, names):
    """Assert `KNOWN_SOURCES` really is the union of the three sets.

    sanitizeSrc queries KNOWN_SOURCES; this file rebuilds the union from the
    three sets instead. So the two sides only agree for as long as KNOWN_SOURCES
    is actually that union, and nothing else here would notice if it stopped
    being one. Dropping `...GUIDE_SOURCES` from the spread buckets all thirteen
    guides as "other" while every other check in this file still passes — the
    same silent miscrediting this script exists to catch, one level down.
    """
    m = re.search(
        r"export\s+const\s+KNOWN_SOURCES\s*=\s*new\s+Set\(\[(.*?)\]\)", text, re.S
    )
    if not m:
        fail(f"{ATTRIBUTION.name} has no `export const KNOWN_SOURCES = new Set([...])` "
             f"— that is the set sanitizeSrc actually queries, so without it this "
             f"check cannot tell which labels the Worker would keep")
    body = re.sub(r"//[^\n]*", "", m.group(1))
    spread = set(re.findall(r"\.\.\.\s*([A-Za-z_][A-Za-z0-9_]*)", body))
    if spread != set(names):
        missing = ", ".join(sorted(set(names) - spread)) or "none"
        extra = ", ".join(sorted(spread - set(names))) or "none"
        fail(f"{ATTRIBUTION.name}: KNOWN_SOURCES spreads {', '.join(sorted(spread)) or 'nothing'}, "
             f"not the three sets this check compares against (missing: {missing}; "
             f"unexpected: {extra}) — labels from a missing set would record as "
             f'"other" even though they are still listed above')
    leftover = re.sub(r"\.\.\.\s*[A-Za-z_][A-Za-z0-9_]*\s*,?", "", body).strip()
    if leftover:
        fail(f"{ATTRIBUTION.name}: KNOWN_SOURCES contains {leftover!r} beyond the "
             f"three spreads — a label added straight into the union is accepted "
             f"by the Worker but invisible to this check")


if not ATTRIBUTION.is_file():
    fail(f"no Worker vocabulary at {ATTRIBUTION.relative_to(ROOT)} — the ?src= "
         f"labels in the built HTML are only meaningful if the Worker that reads "
         f"them recognises them, and there is nothing here to compare against")

_JS = ATTRIBUTION.read_text()
PAGE_SOURCES = js_set(_JS, "PAGE_SOURCES")
GUIDE_SOURCES = js_set(_JS, "GUIDE_SOURCES")
CAMPAIGN_SOURCES = js_set(_JS, "CAMPAIGN_SOURCES")
SRC_SHAPE = js_src_shape(_JS)
js_known_sources(_JS, ("PAGE_SOURCES", "GUIDE_SOURCES", "CAMPAIGN_SOURCES"))

# The Worker applies SRC_SHAPE *before* the set lookup, so a label that is in the
# set but fails the shape still buckets as "other". That is not hypothetical:
# guide-time-machine-local-snapshots is 34 characters and the cap was once 32, so
# one guide's downloads were credited to nobody while the other twelve worked.
_unreachable = sorted(
    label
    for label in PAGE_SOURCES | GUIDE_SOURCES | CAMPAIGN_SOURCES
    if not SRC_SHAPE.match(label)
)
if _unreachable:
    fail(f"{ATTRIBUTION.name} contradicts itself: {', '.join(_unreachable)} "
         f"is in the vocabulary but fails SRC_SHAPE ({SRC_SHAPE.pattern}), so the "
         f"Worker would record it as \"other\" despite listing it")


def accepted(label):
    """True when the Worker's sanitizeSrc would keep `label` rather than bucket it."""
    if not SRC_SHAPE.match(label):
        return False
    return label in PAGE_SOURCES or label in GUIDE_SOURCES or label in CAMPAIGN_SOURCES


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
    print(f"✓ src tags OK (vocabulary read from {ATTRIBUTION.relative_to(ROOT)}: "
          f"{len(PAGE_SOURCES)} page + {len(GUIDE_SOURCES)} guide + "
          f"{len(CAMPAIGN_SOURCES)} campaign labels)")


if __name__ == "__main__":
    main()
