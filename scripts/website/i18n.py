"""Website localization (docs/WEBSITE.md → Languages).

The English pages are the only source. Their visible text is split into *segments* — the inner HTML of leaf text blocks
(headings, paragraphs, list items, …) plus loose text nodes and a few attributes — and each language has a catalog
scripts/website/i18n/<lang>.json mapping every English segment to its translation. Pages for a language are generated
from the built English page by swapping segments, so a change to an English sentence only needs that segment
re-translated. Missing or malformed translations fall back to English and are reported.

Inline SVG and <code> are replaced by ⟦n⟧ markers before segmenting, so segments stay short and code is never
translated; translations must keep every ⟦n⟧ marker and every HTML tag exactly.
"""
import html
import json
import re
from pathlib import Path

I18N = Path(__file__).resolve().parent / "i18n"

# code, folder, hreflang, native name, og:locale, text direction
LANGS = [
    ("en", "", "en", "English", "en_US", "ltr"),
    ("es", "es", "es", "Español", "es_ES", "ltr"),
    ("pt-BR", "pt-br", "pt-BR", "Português (Brasil)", "pt_BR", "ltr"),
    ("pt-PT", "pt-pt", "pt-PT", "Português (Portugal)", "pt_PT", "ltr"),
    ("fr", "fr", "fr", "Français", "fr_FR", "ltr"),
    ("it", "it", "it", "Italiano", "it_IT", "ltr"),
    ("de", "de", "de", "Deutsch", "de_DE", "ltr"),
    ("sv", "sv", "sv", "Svenska", "sv_SE", "ltr"),
    ("pl", "pl", "pl", "Polski", "pl_PL", "ltr"),
    ("tr", "tr", "tr", "Türkçe", "tr_TR", "ltr"),
    ("ru", "ru", "ru", "Русский", "ru_RU", "ltr"),
    ("uk", "uk", "uk", "Українська", "uk_UA", "ltr"),
    ("ar", "ar", "ar", "العربية", "ar_AR", "rtl"),
    ("zh-Hans", "zh-hans", "zh-Hans", "简体中文", "zh_CN", "ltr"),
    ("zh-Hant", "zh-hant", "zh-Hant", "繁體中文", "zh_TW", "ltr"),
    ("ja", "ja", "ja", "日本語", "ja_JP", "ltr"),
    ("ko", "ko", "ko", "한국어", "ko_KR", "ltr"),
    ("vi", "vi", "vi", "Tiếng Việt", "vi_VN", "ltr"),
]
LANG_BY_CODE = {l[0]: l for l in LANGS}
TRANSLATED = [l for l in LANGS if l[0] != "en"]

# Text the scripts draw at runtime (bloom.js, site.js); passed to the page as window.DG_I18N.
JS_STRINGS = [
    "used", "of {total} used", "{size} · {pct} of used", "{size} · {pct} of {name}", "GB", "MB", "TB",
    "Back out", "min", "s", "Volumes", "Macintosh HD", "{pct} full", "small items…", "hidden space…",
    "Available", "Available (incl. purgeable)", "Waste bin", "Drop files here. Nothing is removed until you empty it.",
    "A disk-space map: rings of folders, each petal as wide as the space it takes.",
]

BLOCKS = ("h1", "h2", "h3", "h4", "p", "li", "summary", "dt", "dd", "figcaption", "blockquote", "label", "title")
ATTRS = ("alt", "title", "aria-label", "placeholder")
LETTER = re.compile(r"[^\W\d_]", re.UNICODE)
MARK = re.compile(r"⟦(\d+)⟧")


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def has_text(s):
    return bool(LETTER.search(re.sub(r"<[^>]+>|⟦\d+⟧", "", s)))


# ---------------------------------------------------------------------------------------------------- protection

def protect(text):
    """Replaces <svg>…</svg>, <code>…</code>, <script>…</script>, <style>…</style>, translate="no" elements and the
    release facts (data-dg / data-dg-meta / data-dg-local, filled in per language) with ⟦n⟧ markers. Returns (text,
    stash)."""
    stash = []

    def keep(m):
        stash.append(m.group(0))
        return f"⟦{len(stash) - 1}⟧"
    text = re.sub(r"<script\b.*?</script>|<style\b.*?</style>", keep, text, flags=re.S)
    text = re.sub(r"<svg\b.*?</svg>", keep, text, flags=re.S)
    text = re.sub(r"<code\b[^>]*>.*?</code>", keep, text, flags=re.S)
    text = re.sub(r'<(\w+)\b[^>]*\btranslate="no"[^>]*>.*?</\1>', keep, text, flags=re.S)
    # Release facts (version, size, dates…) are filled in per language by build-website.py's bake_release.
    text = re.sub(r'<(\w+)\b[^>]*(?:\bdata-dg(?:-meta)?="[^"]*"|\bdata-dg-local\b)[^>]*>.*?</\1>', keep, text, flags=re.S)
    return text, stash


def restore(text, stash):
    while MARK.search(text):
        text = MARK.sub(lambda m: stash[int(m.group(1))], text)
    return text


def localize_marks(seg):
    """Renumbers a segment's page-wide ⟦n⟧ markers to ⟦0⟧, ⟦1⟧… (the catalog key) and returns the mapping."""
    order = []
    def sub(m):
        if m.group(1) not in order:
            order.append(m.group(1))
        return f"⟦{order.index(m.group(1))}⟧"
    return MARK.sub(sub, seg), order


# ---------------------------------------------------------------------------------------------------- segmenting

def _leaf_blocks(text):
    """Spans (inner_start, inner_end) of block elements that contain no other block element."""
    spans = []
    open_re = re.compile(r"<(" + "|".join(BLOCKS) + r")(\s[^>]*)?>")
    for m in open_re.finditer(text):
        tag = m.group(1)
        depth, pos = 1, m.end()
        tok = re.compile(rf"<(/?){tag}(\s[^>]*)?>")
        while depth:
            n = tok.search(text, pos)
            if not n:
                break
            depth += -1 if n.group(1) else 1
            pos = n.end()
        if depth:
            continue
        inner_start, inner_end = m.end(), n.start()
        inner = text[inner_start:inner_end]
        if open_re.search(inner):
            continue
        spans.append((inner_start, inner_end))
    return spans


def segments(text):
    """[(start, end, kind)] for translatable pieces of a protected page body; kind is "html" or "text"."""
    out = []
    covered = []
    for a, b in _leaf_blocks(text):
        inner = text[a:b]
        if has_text(inner):
            # Trim surrounding whitespace so the key is stable.
            lead = len(inner) - len(inner.lstrip())
            trail = len(inner) - len(inner.rstrip())
            out.append((a + lead, b - trail, "html"))
        covered.append((a, b))
    covered.sort()

    def inside(i):
        return any(a <= i < b for a, b in covered)
    for m in re.finditer(r">([^<>]+)<", text):
        a, b = m.start(1), m.end(1)
        chunk = text[a:b]
        if not has_text(chunk) or inside(a):
            continue
        lead = len(chunk) - len(chunk.lstrip())
        trail = len(chunk) - len(chunk.rstrip())
        out.append((a + lead, b - trail, "text"))
    return sorted(out)


def attr_segments(text):
    """[(start, end)] of translatable attribute values (alt, title, aria-label, placeholder) in a protected body."""
    out = []
    for m in re.finditer(r'\s(' + "|".join(ATTRS) + r')="([^"]*)"', text):
        if has_text(m.group(2)):
            out.append((m.start(2), m.end(2)))
    return out


def body_of(page_html):
    a = page_html.index("<body")
    return page_html[:a], page_html[a:]


def extract(page_html):
    """English segments of a page (catalog keys), in page order."""
    _, body = body_of(page_html)
    prot, _ = protect(body)
    keys = []
    for a, b, _kind in segments(prot):
        keys.append(localize_marks(norm(prot[a:b]))[0])
    for a, b in attr_segments(prot):
        keys.append(html.unescape(prot[a:b]))
    return keys


# ---------------------------------------------------------------------------------------------------- translating

def load_catalog(code):
    p = I18N / f"{code}.json"
    return json.loads(p.read_text()) if p.exists() else {}


def tags_of(s):
    return sorted(re.findall(r"</?[a-zA-Z][^>]*>", s))


def valid(key, value):
    """A translation must keep every marker and every tag (with its attributes) of the English segment."""
    return (isinstance(value, str) and value.strip() and
            sorted(MARK.findall(key)) == sorted(MARK.findall(value)) and tags_of(key) == tags_of(value))


def translate_body(body, catalog, missing):
    prot, stash = protect(body)
    # Text segments first: their keys contain the English attributes (e.g. a placeholder inside a label).
    pieces, last = [], 0
    for a, b, _kind in segments(prot):
        raw = prot[a:b]
        key, order = localize_marks(norm(raw))
        t = catalog.get(key)
        if t is None or not valid(key, t):
            missing.add(key)
            continue
        t = MARK.sub(lambda m: f"⟦{order[int(m.group(1))]}⟧", t)
        pieces.append(prot[last:a])
        pieces.append(t)
        last = b
    pieces.append(prot[last:])
    prot = "".join(pieces)

    def attr(m):
        val = html.unescape(m.group(2))
        t = catalog.get(val)
        if t is None or not t.strip():
            missing.add(val)
            return m.group(0)
        return f' {m.group(1)}="{html.escape(t, quote=True)}"'
    prot = re.sub(r'\s(' + "|".join(ATTRS) + r')="([^"]*)"',
                  lambda m: attr(m) if has_text(m.group(2)) else m.group(0), prot)
    return restore(prot, stash)


def rewrite_links(body, folder, page_paths):
    """Internal links point into the language's folder (the switcher's own links carry hreflang and are left alone)."""
    def fix(m):
        tag = m.group(0)
        if "hreflang=" in tag:
            return tag
        def href(h):
            url = h.group(1)
            path = url.split("#")[0]
            if not url.startswith("/") or url.startswith("//"):
                return h.group(0)
            if path.startswith(("/assets/", "/releases/DiskGarden", "/favicon", "/site.webmanifest", "/sitemap", "/llms")):
                return h.group(0)
            return f'href="/{folder}{url}"'
        return re.sub(r'href="([^"]*)"', href, tag)
    return re.sub(r"<a\b[^>]*>", fix, body)


def js_strings(catalog):
    return {k: catalog[k] for k in JS_STRINGS if catalog.get(k)}


def lang_path(folder, path):
    return f"/{folder}{path}" if folder else path
