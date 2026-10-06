#!/usr/bin/env python3
"""Bakes the shared parts of the website into its HTML files, in place (docs/WEBSITE.md).

- <head>: title, description, canonical, Open Graph / Twitter cards, icons, structured data (JSON-LD)
- the header and footer
- release facts from scripts/website/release.json (version, size, download link, notes …)
- sitemap.xml

Regions are delimited by <!-- dg:NAME --> … <!-- /dg:NAME --> and rewritten on every run, so the HTML stays plain
static files with no JavaScript needed for content. Run it after editing pages or release.json; the deploy workflow
runs it too.  Usage: python3 scripts/build-website.py [--check]
"""
import datetime
import html
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "website"))
import i18n  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "website"
ORIGIN = "https://diskgarden.app"
REL = json.loads((ROOT / "scripts/website/release.json").read_text())
YEAR = datetime.date.today().year

APP_DESCRIPTION = ("DiskGarden is a free disk space analyzer for Mac. It maps every file and folder on your disk as an "
                   "interactive chart, shows hidden space, and lets you clear space safely.")

# path → page settings. `crumbs`: breadcrumb trail (name, path) after Home. `kind`: extra structured data.
PAGES = {
    "index.html": dict(
        path="/", nav="home", bloom=True, kind="home",
        title="DiskGarden — Free Disk Space Analyzer for Mac",
        description="See what's taking up space on your Mac. DiskGarden is a free disk space analyzer that maps every "
                    "folder as an interactive chart, so you can clear space safely."),
    "download/index.html": dict(
        path="/download/", nav="download", crumbs=[("Download", "/download/")],
        title="Download DiskGarden for Mac — Free Disk Space Analyzer",
        description="Download DiskGarden, the free disk space analyzer for macOS: one .dmg, no account. Requirements, "
                    "install steps and what's new in the latest version."),
    "support/index.html": dict(
        path="/support/", nav="support", kind="faq", crumbs=[("Support", "/support/")],
        title="DiskGarden Support — Guides, FAQ and Contact",
        description="Help with DiskGarden: guides for scanning, reading the disk map, the Waste bin and Full Disk Access, "
                    "answers to common questions, and a person to write to."),
    "user-guide/index.html": dict(
        path="/user-guide/", nav="support", kind="article", crumbs=[("User guide", "/user-guide/")],
        title="DiskGarden User Guide — Scan, Read the Map, Free Up Space",
        description="How to use DiskGarden: scan a disk, read the map, clear space safely with the Waste bin, Deep Scan "
                    "(Admin), external drives and keyboard shortcuts."),
    "guides/index.html": dict(
        path="/guides/", nav="support", kind="guides", crumbs=[("Guides", "/guides/")],
        title="Mac Storage Guides — Free Up Disk Space on macOS",
        description="Practical guides to Mac storage: what System Data is, cleaning up Xcode and Docker, iPhone "
                    "backups, Time Machine snapshots, Spotlight, purgeable space and more."),
    "releases/index.html": dict(
        path="/releases/", nav="releases", crumbs=[("Release notes", "/releases/")],
        title="DiskGarden Release Notes — What's New",
        description="What changed in each version of DiskGarden, the free disk space analyzer for Mac."),
    "about/index.html": dict(
        path="/about/", nav="about", crumbs=[("About", "/about/")],
        title="About DiskGarden — A Free Disk Space Map for Mac",
        description="DiskGarden is a free, native Mac app that shows where your disk space went and helps you clear "
                    "it safely."),
    "privacy/index.html": dict(
        path="/privacy/", nav="privacy", crumbs=[("Privacy", "/privacy/")],
        title="DiskGarden Privacy Policy",
        description="What DiskGarden sends and what it never sends: your files and scans stay on your Mac."),
    "terms/index.html": dict(
        path="/terms/", nav="terms", crumbs=[("Terms", "/terms/")],
        title="DiskGarden Terms of Use",
        description="The terms for using DiskGarden, the free disk space analyzer for Mac."),
    "404.html": dict(
        path="/404.html", nav="", noindex=True,
        title="Page not found · DiskGarden",
        description="This page doesn't exist."),
}

# The guides (website/guides/<slug>/index.html), in hub order. `card` is the one-line summary on cards and in the
# hub; `related` are slugs linked at the end of the article.
ARTICLES = [
    dict(slug="free-up-space-on-mac", short="Free up space on your Mac",
         title="How to Free Up Space on Your Mac — Find What's Using It",
         description="Mac disk almost full? Find what's taking up space, where big files hide (backups, Xcode, "
                     "Docker, caches, Downloads) and how to clear them safely.",
         card="Find what's using your disk, where big files hide, and how to clear them safely.",
         related=["find-large-files-mac", "system-data-mac", "purgeable-space-mac"]),
    dict(slug="system-data-mac", short="What is System Data?",
         title="What Is “System Data” on Mac — and How to Reduce It",
         description="What macOS counts as System Data, why it gets so big (caches, Time Machine snapshots, Docker, "
                     "Xcode) and how to shrink it safely.",
         card="What macOS counts as System Data, why it grows so large, and how to shrink it.",
         related=["time-machine-local-snapshots", "macos-system-storage", "clear-cache-mac"]),
    dict(slug="macos-system-storage", short="Why macOS takes so much space",
         title="Why Does macOS Take Up So Much Space on My Mac?",
         description="Why the macOS category in Storage settings is so large — system volume, Recovery, swap, "
                     "downloaded assets, updates — and what you can actually reclaim.",
         card="The system volume, Recovery, swap, downloaded assets and updates — and what you can reclaim.",
         related=["system-data-mac", "apple-intelligence-storage", "purgeable-space-mac"]),
    dict(slug="find-large-files-mac", short="Find large files",
         title="How to Find Large Files on a Mac (3 Ways)",
         description="Three ways to find the biggest files and folders on your Mac: Storage settings, a Finder size "
                     "search, and a disk space map that shows every folder at once.",
         card="Storage settings, a Finder size search, and a map of every folder at once.",
         related=["free-up-space-on-mac", "iphone-backups-mac", "clear-cache-mac"]),
    dict(slug="xcode-storage", short="Clean up Xcode",
         title="Xcode Taking Up Space? Clean DerivedData and Simulators",
         description="Where Xcode's gigabytes go — DerivedData, simulator runtimes, device support, archives — and "
                     "how to clean each one safely on your Mac.",
         card="DerivedData, simulator runtimes, device support and archives — and how to clean them.",
         related=["docker-storage-mac", "system-data-mac", "find-large-files-mac"]),
    dict(slug="docker-storage-mac", short="Docker taking up space",
         title="Docker Taking Up Space on Mac? Shrink Docker.raw Safely",
         description="Why Docker Desktop's disk image grows on macOS, how to see its real size, and how to reclaim "
                     "space with prune commands and the virtual disk limit.",
         card="Why Docker.raw grows, how to see its real size, and how to reclaim the space.",
         related=["xcode-storage", "system-data-mac", "free-up-space-on-mac"]),
    dict(slug="iphone-backups-mac", short="Old iPhone backups",
         title="How to Delete Old iPhone and iPad Backups on a Mac",
         description="Find and delete old iPhone and iPad backups stored on your Mac — in Finder or directly in the "
                     "MobileSync folder — and what to keep before you do.",
         card="Find and delete old device backups — and what to keep before you do.",
         related=["free-up-space-on-mac", "find-large-files-mac", "system-data-mac"]),
    dict(slug="time-machine-local-snapshots", short="Time Machine local snapshots",
         title="Time Machine Local Snapshots Taking Up Space? What to Do",
         description="What Time Machine local snapshots are, why they use space on your Mac's disk, how to list them "
                     "and when (and how) to delete them.",
         card="What local snapshots are, how to list them, and when to delete them.",
         related=["purgeable-space-mac", "system-data-mac", "macos-system-storage"]),
    dict(slug="purgeable-space-mac", short="Purgeable space",
         title="What Is Purgeable Space on Mac — and How to Free It",
         description="Why your Mac shows purgeable space, why apps still say the disk is full, and how to turn "
                     "purgeable space into free space.",
         card="Why the disk can look full even when macOS calls space purgeable.",
         related=["time-machine-local-snapshots", "system-data-mac", "free-up-space-on-mac"]),
    dict(slug="spotlight-index-mac", short="Spotlight's index",
         title="Is Spotlight Taking Up Space on Your Mac? Check and Rebuild",
         description="How big the Spotlight index on your Mac is, why it sometimes balloons, and how to rebuild it or "
                     "exclude folders.",
         card="How big the Spotlight index is, why it balloons, and how to rebuild it.",
         related=["macos-system-storage", "system-data-mac", "clear-cache-mac"]),
    dict(slug="apple-intelligence-storage", short="Apple Intelligence storage",
         title="How Much Storage Does Apple Intelligence Use on a Mac?",
         description="How much disk space Apple Intelligence's on-device models need on a Mac, where it shows up in "
                     "Storage settings, and how to get it back if you don't use it.",
         card="How much space the on-device models need, and how to get it back.",
         related=["macos-system-storage", "system-data-mac", "purgeable-space-mac"]),
    dict(slug="mac-cleaner-apps", short="Do you need a Mac cleaner?",
         title="Do You Need a Mac Cleaner App? What Actually Frees Space",
         description="What Mac cleaner apps really remove, why the space comes back, and what frees more disk space "
                     "for good: finding the large files you don't need.",
         card="What cleaners really remove, why the space comes back, and what works better.",
         related=["clear-cache-mac", "find-large-files-mac", "free-up-space-on-mac"]),
    dict(slug="clear-cache-mac", short="Clear caches safely",
         title="Is It Safe to Delete Caches on a Mac? Which Ones and How",
         description="Which Mac caches are safe to delete (user caches, browser caches, package managers), which to "
                     "leave alone, and how much space they really free.",
         card="Which caches are safe to delete, which to leave alone, and how much they free.",
         related=["system-data-mac", "free-up-space-on-mac", "xcode-storage"]),
]
ARTICLE_BY_SLUG = {a["slug"]: a for a in ARTICLES}
for a in ARTICLES:
    PAGES[f"guides/{a['slug']}/index.html"] = dict(
        path=f"/guides/{a['slug']}/", nav="support", kind="article",
        crumbs=[("Guides", "/guides/"), (a["short"], f"/guides/{a['slug']}/")],
        title=a["title"], description=a["description"], slug=a["slug"])

SPROUT = ('<svg class="sprout" viewBox="0 0 24 24" aria-hidden="true">'
          '<path fill="currentColor" d="M11.37 23.52Q10.32 17.76 11.37 12.00L13.05 12.00Q12.00 17.76 13.05 23.52ZM12.00 12.96Q1.92 12.48 2.34 2.40Q11.16 1.92 12.00 12.96ZM12.42 11.04Q13.26 0.48 21.66 0.48Q22.08 10.56 12.42 11.04Z"/></svg>')  # the app's SproutShape
DOWNLOAD_ICON = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" '
                 'stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>')


def esc(s):
    return html.escape(s, quote=True)


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
# Release facts are filled in per language from these templates (translation skips the filled-in elements, so
# a new version, date or size never turns into an untranslated sentence). Extracted for translation in main().
RELEASE_STRINGS = MONTHS + [
    "{month} {day}, {year}", "Version {version}", "macOS {macos} or later", "macOS {macos} {name} or later",
    "Released {date}", "{size} MB", "About {size} MB", "{a} on {b}", "Download {version}", "Not released yet",
    "Yes", "No", "Apple silicon and Intel", "Apple silicon", "English and 17 more",
]


def same(s):
    return s


# Languages that write 6,1 instead of 6.1.
DECIMAL_COMMA = {"de", "es", "fr", "it", "pl", "pt-BR", "pt-PT", "ru", "sv", "tr", "uk", "vi"}


def fmt_num(x, lang="en"):
    return str(x).replace(".", ",") if lang in DECIMAL_COMMA else str(x)


def fmt_date(iso, tr=same):
    d = datetime.date.fromisoformat(iso)
    return tr("{month} {day}, {year}").format(month=tr(MONTHS[d.month - 1]), day=d.day, year=d.year)


def absolute(path):
    return path if path.startswith("http") else ORIGIN + path


# ---------------------------------------------------------------------------------------------------------- head

def ld(obj):
    return ('<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) +
            "</script>")


ORG = {"@type": "Organization", "@id": ORIGIN + "/#org", "name": "DiskGarden", "url": ORIGIN + "/",
       "logo": ORIGIN + "/assets/app-icon-512.png",
       "contactPoint": {"@type": "ContactPoint", "contactType": "customer support", "email": REL["supportEmail"]}}
WEBSITE = {"@type": "WebSite", "@id": ORIGIN + "/#website", "name": "DiskGarden", "url": ORIGIN + "/",
           "publisher": {"@id": ORIGIN + "/#org"}, "inLanguage": "en"}


def software_app():
    app = {
        "@type": "SoftwareApplication", "@id": ORIGIN + "/#app", "name": "DiskGarden",
        "description": APP_DESCRIPTION, "url": ORIGIN + "/",
        "applicationCategory": "UtilitiesApplication", "applicationSubCategory": "Disk space analyzer",
        "operatingSystem": f"macOS {REL['minMacOS']} or later",
        "softwareVersion": REL["version"],
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "image": ORIGIN + "/assets/app-icon-512.png", "screenshot": ORIGIN + "/assets/og-image.png",
        "publisher": {"@id": ORIGIN + "/#org"},
        "featureList": ["Interactive disk space map (sunburst chart)", "Finds the largest files and folders",
                        "Reveals hidden and purgeable space", "Deep Scan (Admin)",
                        "Safe review-before-delete Waste bin", "Scans external drives, disk images and network shares",
                        "Light and dark mode", "18 languages"],
    }
    if REL.get("dmg"):
        app["downloadUrl"] = absolute(REL["dmg"])
    if REL.get("sizeMB"):
        app["fileSize"] = f"{REL['sizeMB']}MB"
    if REL.get("released"):
        app["datePublished"] = REL["released"]
    return app


def strip_tags(s):
    s = re.sub(r"<svg.*?</svg>", "", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def faq_from(page_html):
    """The page's visible questions and answers (structured data must match what's on the page)."""
    qa = []
    for q, a in re.findall(r'<div class="qa-row[^"]*"><h3>(.*?)</h3><p[^>]*>(.*?)</p></div>', page_html, re.S):
        qa.append((strip_tags(q), strip_tags(a)))
    for q, a in re.findall(r'<details[^>]*>\s*<summary>(.*?)</summary>\s*<div class="answer">(.*?)</div>\s*</details>',
                           page_html, re.S):
        qa.append((strip_tags(q), strip_tags(a)))
    return {"@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qa if q and a]}


def breadcrumbs(crumbs, folder=""):
    items = [("DiskGarden", i18n.lang_path(folder, "/"))] + crumbs
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": absolute(p)} for i, (n, p) in enumerate(items)]}


IDENTITY = lambda s: s


def alternates(path):
    """hreflang links for a page: every language plus x-default (English)."""
    out = [f'<link rel="alternate" hreflang="{hl}" href="{ORIGIN}{i18n.lang_path(folder, path)}">'
           for _c, folder, hl, *_ in i18n.LANGS]
    out.append(f'<link rel="alternate" hreflang="x-default" href="{ORIGIN}{path}">')
    return out


# First visit to an English page: send people whose browser prefers a supported language to it, unless they chose a
# language in the switcher (localStorage) or are a crawler. Runs before anything paints.
REDIRECT = ("<script>(function(){try{if(localStorage.getItem('dg-lang'))return}catch(e){}"
            "if(/bot|crawl|spider|slurp|lighthouse|headless/i.test(navigator.userAgent))return;"
            "var S=%s,L=navigator.languages||[navigator.language||''];"
            "for(var i=0;i<L.length;i++){var l=(L[i]||'').toLowerCase(),f=null;"
            "if(l.indexOf('en')===0)return;"
            "if(/^zh-(tw|hk|mo|hant)/.test(l))f='zh-hant';else if(l.indexOf('zh')===0)f='zh-hans';"
            "else if(l==='pt-pt')f='pt-pt';else if(l.indexOf('pt')===0)f='pt-br';"
            "else if(S.indexOf(l.slice(0,2))>=0)f=l.slice(0,2);"
            "if(f){location.replace('/'+f+location.pathname+location.search+location.hash);return}}})()</script>")


def head(page, page_html, modified, lang="en", tr=IDENTITY):
    code, folder, hl, _name, oglocale, _dir = i18n.LANG_BY_CODE[lang]
    url = ORIGIN + i18n.lang_path(folder, page["path"])
    title, desc = tr(page["title"]), tr(page["description"])
    website = dict(WEBSITE, inLanguage=hl)
    graph = [ORG, website]
    kind = page.get("kind")
    if kind == "home":
        app = software_app()
        app["description"] = tr(app["description"])
        app["featureList"] = [tr(f) for f in app["featureList"]]
        app["url"] = url
        graph.append(app)
    faq = faq_from(page_html) if kind in ("home", "faq") else None
    if faq and faq["mainEntity"]:
        graph.append(faq)
    if kind == "article":
        h1 = re.search(r"<h1>(.*?)</h1>", page_html, re.S)
        graph.append({"@type": "TechArticle", "headline": strip_tags(h1.group(1)) if h1 else title,
                      "description": desc, "url": url, "dateModified": modified, "inLanguage": hl,
                      "author": {"@id": ORIGIN + "/#org"}, "publisher": {"@id": ORIGIN + "/#org"},
                      "image": ORIGIN + "/assets/og-image.png", "about": {"@id": ORIGIN + "/#app"}})
    if kind == "guides":
        graph.append({"@type": "ItemList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "url": ORIGIN + i18n.lang_path(folder, f"/guides/{a['slug']}/"),
             "name": tr(a["short"])}
            for i, a in enumerate(ARTICLES)]})
    if page.get("crumbs"):
        graph.append(breadcrumbs([(tr(n), i18n.lang_path(folder, p)) for n, p in page["crumbs"]], folder))

    lines = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{esc(title)}</title>",
        f'<meta name="description" content="{esc(desc)}">',
    ]
    if page.get("noindex"):
        lines.append('<meta name="robots" content="noindex">')
    else:
        lines += [f'<link rel="canonical" href="{url}">',
                  '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">']
        lines += alternates(page["path"])
    lines += [
        '<meta name="theme-color" content="#0f1513">',
        '<meta name="color-scheme" content="dark">',
        '<meta property="og:site_name" content="DiskGarden">',
        f'<meta property="og:type" content="{"article" if kind == "article" else "website"}">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(desc)}">',
        f'<meta property="og:url" content="{url}">',
        f'<meta property="og:image" content="{ORIGIN}/assets/og-image.png">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        f'<meta property="og:image:alt" content="{esc(tr("DiskGarden: a disk space map of a Mac, drawn as a colorful bloom"))}">',
        f'<meta property="og:locale" content="{oglocale}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(title)}">',
        f'<meta name="twitter:description" content="{esc(desc)}">',
        f'<meta name="twitter:image" content="{ORIGIN}/assets/og-image.png">',
        '<link rel="icon" href="/favicon.ico" sizes="48x48">',
        '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">',
        '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">',
        '<link rel="manifest" href="/site.webmanifest">',
        '<link rel="stylesheet" href="/assets/site.min.css">',
        # The `js` class gates the hidden "before" states of animations, so no-JS visitors see everything.
        '<script>document.documentElement.classList.add("js")</script>',
    ]
    if lang == "en" and not page.get("noindex"):
        lines.append(REDIRECT % json.dumps([l[1] for l in i18n.TRANSLATED if len(l[1]) == 2]))
    if lang != "en":
        lines.append("<script>window.DG_I18N=" + json.dumps(i18n.js_strings(CATALOGS.get(lang, {})),
                                                            ensure_ascii=False) + "</script>")
    lines += [
        '<script src="/assets/site.js" defer></script>',
    ]
    if page.get("bloom"):
        lines.append('<script src="/assets/bloom.js" defer></script>')
    lines.append(ld({"@context": "https://schema.org", "@graph": graph}))
    return "\n".join("  " + l for l in lines)


# ------------------------------------------------------------------------------------------------ header/footer

GLOBE = ('<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" '
         'stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 2.6 14.6 0 '
         '17M12 3.5c-2.6 2.4-2.6 14.6 0 17"/></g></svg>')


def lang_switcher(path, lang):
    cur = i18n.LANG_BY_CODE[lang]
    items = "".join(
        f'<a href="{i18n.lang_path(folder, path)}" hreflang="{hl}" lang="{hl}" data-lang="{folder or "en"}"'
        f'{" aria-current=\"true\"" if code == lang else ""} translate="no">{name}</a>'
        for code, folder, hl, name, *_ in i18n.LANGS)
    return (f'<div class="lang"><button class="lang-btn" type="button" aria-haspopup="true" aria-expanded="false" '
            f'aria-label="Language">{GLOBE}<span translate="no">{cur[2].split("-")[0].upper()}</span></button>'
            f'<div class="lang-menu" role="menu">{items}</div></div>')


def header(nav, path="/", lang="en"):
    cur = lambda n: ' aria-current="page"' if n == nav else ""
    dmg = REL.get("dmg") or "/download/"
    return f'''  <header class="site-header">
    <div class="bar">
      <a class="brand" href="/" aria-label="DiskGarden home">{SPROUT}DiskGarden</a>
      <nav class="nav" aria-label="Main">
        <a href="/#features">Features</a>
        <a href="/download/"{cur("download")}>Download</a>
        <a href="/support/"{cur("support")}>Support</a>
      </nav>
      <div class="header-cta">
        {lang_switcher(path, lang)}
        <a class="btn btn-primary btn-sm dl-btn" href="{dmg}" aria-label="Download">{DOWNLOAD_ICON}<span class="dl-label">Download<span class="label-long"> free</span></span></a>
        <button class="menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="mobile-nav">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>
    </div>
    <nav class="mobile-nav" id="mobile-nav" aria-label="Main">
      <a href="/#features">Features</a>
      <a href="/download/"{cur("download")}>Download</a>
      <a href="/support/"{cur("support")}>Support</a>
      <a href="/guides/">Mac storage guides</a>
      <a href="/releases/"{cur("releases")}>Release notes</a>
    </nav>
  </header>'''


def footer():
    col = lambda title, links: (f'<div><p class="foot-h">{title}</p><ul>' +
                                "".join(f'<li><a href="{h}">{t}</a></li>' for t, h in links) + "</ul></div>")
    return f'''  <footer class="site-footer">
    <div class="wrap">
      <div class="foot">
        <div>
          <a class="brand" href="/">{SPROUT}DiskGarden</a>
          <p>A free disk space analyzer for the Mac.</p>
        </div>
        <div class="foot-cols">
          {col("Product", [("Features", "/#features"), ("Download", "/download/"), ("Release notes", "/releases/")])}
          {col("Learn", [("Mac storage guides", "/guides/"), ("Free up space on a Mac", "/guides/free-up-space-on-mac/"), ("What is System Data?", "/guides/system-data-mac/"), ("User guide", "/user-guide/")])}
          {col("Support", [("FAQ", "/support/#faq"), ("Contact", "/support/#contact"), ("Privacy", "/privacy/")])}
          {col("Company", [("About", "/about/"), ("Terms", "/terms/")])}
        </div>
      </div>
      <div class="legal"><span>© {YEAR} DiskGarden. DiskGarden is free software.</span><span>Apple, Mac and macOS are trademarks of Apple Inc.</span></div>
    </div>
  </footer>'''


# ------------------------------------------------------------------------------------------------ release facts

def release_values(tr=same, lang="en"):
    r = REL
    return {
        "version": r.get("version"),
        "macosFull": r.get("minMacOS") and (
            tr("macOS {macos} {name} or later").format(macos=r["minMacOS"], name=r["minMacOSName"]) if r.get("minMacOSName")
            else tr("macOS {macos} or later").format(macos=r["minMacOS"])),
        "arch": r.get("architectures") and tr(r["architectures"]),
        "size": r.get("sizeMB") and tr("{size} MB").format(size=fmt_num(r["sizeMB"], lang)),
        "installed": r.get("installedMB") and tr("About {size} MB").format(size=fmt_num(r["installedMB"], lang)),
        "languages": r.get("languages") and tr(r["languages"]),
        "sha256": r.get("sha256"),
        "signedBy": r.get("signedBy"),
        "notarized": {True: tr("Yes"), False: tr("No")}.get(r.get("notarized")),
        "email": r.get("supportEmail"),
        "dmgName": r.get("version") and f"DiskGarden-{r['version']}.dmg",
    }


def meta_parts(tr=same, lang="en"):
    r = REL
    return {
        "version": r.get("version") and tr("Version {version}").format(version=r["version"]),
        "macos": r.get("minMacOS") and tr("macOS {macos} or later").format(macos=r["minMacOS"]),
        "arch": r.get("architectures") and tr(r["architectures"]),
        "size": r.get("sizeMB") and tr("{size} MB").format(size=fmt_num(r["sizeMB"], lang)),
        "dmg": ".dmg",
        "released": r.get("released") and tr("Released {date}").format(date=fmt_date(r["released"], tr)),
    }


def set_attr(tag, name, value):
    """Sets (or with value None removes) an attribute in an opening tag."""
    tag = re.sub(rf'\s{name}(="[^"]*")?(?=[\s>])', "", tag)
    if value is None:
        return tag
    return tag[:-1] + (f" {name}" if value is True else f' {name}="{esc(value)}"') + ">"


def bake_release(text, tr=same, lang="en"):
    """Fills in the release facts (data-dg…, notes, history). Runs on the English page and again on each translated
    page with that language's `tr`; translation itself skips these elements (i18n.protect)."""
    values, parts = release_values(tr, lang), meta_parts(tr, lang)

    def inner(attr_re, fn):
        nonlocal text
        pattern = re.compile(rf'(<(\w+)\b[^>]*\b{attr_re}[^>]*>)(.*?)(</\2>)', re.S)
        text = pattern.sub(fn, text)

    def fill(m):
        tag, key = m.group(1), re.search(r'data-dg="([^"]+)"', m.group(1)).group(1)
        v = values.get(key)
        return tag + (esc(v) if v else m.group(3)) + m.group(4)
    inner(r'data-dg="[^"]+"', fill)

    def meta(m):
        tag = m.group(1)
        keys = re.search(r'data-dg-meta="([^"]+)"', tag).group(1).split(",")
        sep = (re.search(r'data-dg-sep="([^"]*)"', tag) or [None, " · "])[1]
        items = [parts[k.strip()] for k in keys if parts.get(k.strip())]
        if sep == "facts":
            body = "".join(f"<span>{esc(t)}</span>" for t in items)
        elif sep == " on " and len(items) == 2:
            body = esc(tr("{a} on {b}").format(a=items[0], b=items[1]))
        else:
            body = esc(sep.join(items))
        return set_attr(tag, "hidden", None if items else True) + body + m.group(4)
    inner(r'data-dg-meta="[^"]+"', meta)

    def cond(m):
        tag = m.group(0)
        keys = re.search(r'data-dg-if="([^"]+)"', tag).group(1).split(",")
        return set_attr(tag, "hidden", None if all(values.get(k.strip()) for k in keys) else True)
    text = re.sub(r'<\w+\b[^>]*\bdata-dg-if="[^"]+"[^>]*>', cond, text)

    def href(m):
        tag = m.group(0)
        key = re.search(r'data-dg-href="([^"]+)"', tag).group(1)
        url = {"dmg": REL.get("dmg"), "email": REL.get("supportEmail") and "mailto:" + REL["supportEmail"]}.get(key)
        return set_attr(tag, "href", url) if url else tag
    text = re.sub(r'<a\b[^>]*\bdata-dg-href="[^"]+"[^>]*>', href, text)

    current = (REL.get("history") or [{}])[0]
    text = region(text, "notes", "".join(f"<li>{esc(tr(n))}</li>" for n in current.get("notes", [])), indent=False)
    history = "".join(f'''
      <article class="release" id="v{esc(r['version'])}">
        <div><h2>{esc(r['version'])}</h2><small data-dg-local>{esc(fmt_date(r['date'], tr) if r.get('date') else tr("Not released yet"))}</small></div>
        <div><ul class="ticks">{"".join(f"<li>{esc(tr(n))}</li>" for n in r['notes'])}</ul>{
            f'<p style="margin-top:18px"><a class="link" data-dg-local href="{esc(r["dmg"])}">{esc(tr("Download {version}").format(version=r["version"]))}</a></p>'
            if r.get("date") and r.get("dmg") else ""}</div>
      </article>''' for r in REL.get("history", []))
    text = region(text, "history", history + "\n    ", indent=False)
    return text


# ------------------------------------------------------------------------------------------------------- regions

def region(text, name, content, indent=True):
    pattern = re.compile(rf"<!-- dg:{name} -->.*?<!-- /dg:{name} -->", re.S)
    if not pattern.search(text):
        return text
    body = f"\n{content}\n" if indent else content
    return pattern.sub(lambda _: f"<!-- dg:{name} -->{body}<!-- /dg:{name} -->", text, count=1)


def crumbs_html(page):
    trail = [("DiskGarden", "/")] + page.get("crumbs", [])
    links = [f'<a href="{p}">{esc(n)}</a>' for n, p in trail[:-1]] + [f"<span>{esc(trail[-1][0])}</span>"]
    return f'    <nav class="crumbs" aria-label="Breadcrumb">{" › ".join(links)}</nav>'


def guide_card(a, heading="h3"):
    return (f'<a class="card guide" href="/guides/{a["slug"]}/"><{heading}>{esc(a["short"])}</{heading}>'
            f'<p>{esc(a["card"])}</p></a>')


def related_html(page):
    a = ARTICLE_BY_SLUG[page["slug"]]
    cards = "".join(guide_card(ARTICLE_BY_SLUG[s]) for s in a["related"])
    return f'''      <section class="related">
        <h2>Related guides</h2>
        <div class="grid3 learn">{cards}</div>
        <p style="margin-top: 22px"><a href="/guides/">All Mac storage guides →</a></p>
      </section>'''


def cta_html():
    return '''      <section class="article-cta">
        <h2>See where your space went</h2>
        <p>DiskGarden is a free disk space analyzer for Mac: it maps every folder by size, so the space hogs stand out. No account, and your files never leave your Mac.</p>
        <p style="margin-top: 22px"><a class="btn btn-primary" href="/download/">Download DiskGarden — free</a></p>
      </section>'''


def last_modified(path):
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", str(path)], cwd=ROOT,
                             capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", str(path)], cwd=ROOT,
                               capture_output=True, text=True).stdout.strip()
        if out and not dirty:
            return out
    except OSError:
        pass
    return datetime.date.today().isoformat()


def minify_css(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};,])\s*", r"\1", css)
    return css.replace(";}", "}").strip() + "\n"


CATALOGS = {}


def main():
    check = "--check" in sys.argv
    extract_mode = "--extract" in sys.argv
    for code, *_ in i18n.TRANSLATED:
        CATALOGS[code] = i18n.load_catalog(code)
    built = {}
    changed, sitemap = [], []
    css_out = SITE / "assets/site.min.css"
    css = minify_css((SITE / "assets/site.css").read_text())
    if not css_out.exists() or css_out.read_text() != css:
        changed.append("assets/site.min.css")
        if not check:
            css_out.write_text(css)
    for rel, page in PAGES.items():
        path = SITE / rel
        original = path.read_text()
        text = bake_release(original)
        modified = last_modified(path)
        if page.get("crumbs"):
            text = region(text, "crumbs", crumbs_html(page))
        if page.get("slug"):
            text = region(text, "related", related_html(page))
            text = region(text, "cta", cta_html())
        text = region(text, "guides", "\n".join("          " + guide_card(a, "h2") for a in ARTICLES))
        text = region(text, "featured", "\n".join("          " + guide_card(ARTICLE_BY_SLUG[s]) for s in
                                                   ["free-up-space-on-mac", "system-data-mac", "macos-system-storage"]))
        text = region(text, "head", head(page, text, modified))
        text = region(text, "header", header(page["nav"], page["path"]))
        text = region(text, "footer", footer())
        if text != original:
            changed.append(rel)
            if not check:
                path.write_text(text)
        built[rel] = (text, modified)
        if not page.get("noindex"):
            sitemap.append((page["path"], modified))
    llms = ("# DiskGarden\n\n> " + APP_DESCRIPTION + " No account; scans stay on the Mac.\n\n"
            f"- Requires macOS {REL['minMacOS']} or later. Free, no ads.\n\n## Pages\n"
            "- [Home](https://diskgarden.app/): what DiskGarden does\n"
            "- [Download](https://diskgarden.app/download/): download, requirements, install steps\n"
            "- [User guide](https://diskgarden.app/user-guide/)\n"
            "- [Support and FAQ](https://diskgarden.app/support/)\n"
            "- [Privacy](https://diskgarden.app/privacy/)\n\n## Mac storage guides\n" +
            "".join(f"- [{a['short']}](https://diskgarden.app/guides/{a['slug']}/): {a['card']}\n" for a in ARTICLES))
    lp = SITE / "llms.txt"
    if not lp.exists() or lp.read_text() != llms:
        changed.append("llms.txt")
        if not check:
            lp.write_text(llms)
    # ---- languages: catalog keys, then generated pages (website/<folder>/…, not in git)
    if extract_mode:
        keys = []
        def add(k):
            if k and i18n.has_text(k) and k not in keys:
                keys.append(k)
        for rel, page in PAGES.items():
            if page.get("noindex"):
                continue
            add(page["title"]); add(page["description"])
            for n, _p in page.get("crumbs", []):
                add(n)
            for k in i18n.extract(built[rel][0]):
                add(k)
        for k in [APP_DESCRIPTION, "DiskGarden: a disk space map of a Mac, drawn as a colorful bloom"] + \
                software_app()["featureList"] + i18n.JS_STRINGS + RELEASE_STRINGS:
            add(k)
        out = i18n.I18N / "source.json"
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(keys, ensure_ascii=False, indent=1) + "\n")
        print(f"{len(keys)} segments → {out.relative_to(ROOT)}")
        for code, *_ in i18n.TRANSLATED:
            have = CATALOGS[code]
            print(f"  {code:8} missing {sum(1 for k in keys if k not in have)}")
        return
    report = {}
    for code, folder, hl, _n, _o, direction in i18n.TRANSLATED:
        cat = CATALOGS[code]
        missing = set()
        tr = lambda s, cat=cat, missing=missing: cat.get(s) or (missing.add(s) or s)
        for rel, page in PAGES.items():
            if page.get("noindex"):
                continue
            text, modified = built[rel]
            text = region(text, "header", header(page["nav"], page["path"], code))
            top, body = i18n.body_of(text)
            body = i18n.rewrite_links(i18n.translate_body(body, cat, missing), folder, None)
            text = bake_release(top + body, tr, code)
            text = text.replace('<html lang="en">', f'<html lang="{hl}" dir="{direction}">', 1)
            text = region(text, "head", head(page, text, modified, code, tr))
            out = SITE / folder / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            if not check and (not out.exists() or out.read_text() != text):
                out.write_text(text)
        report[code] = len(missing)
    if any(report.values()):
        print("untranslated segments (English shown):", ", ".join(f"{c} {n}" for c, n in report.items() if n))

    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for path, d in sitemap:
        alts = "".join(f'<xhtml:link rel="alternate" hreflang="{hl}" href="{ORIGIN}{i18n.lang_path(folder, path)}"/>'
                       for _c, folder, hl, *_ in i18n.LANGS)
        for _c, folder, *_ in i18n.LANGS:
            xml.append(f"  <url><loc>{ORIGIN}{i18n.lang_path(folder, path)}</loc><lastmod>{d}</lastmod>{alts}</url>")
    xml.append("</urlset>\n")
    sm = SITE / "sitemap.xml"
    if not sm.exists() or sm.read_text() != "\n".join(xml):
        changed.append("sitemap.xml")
        if not check:
            sm.write_text("\n".join(xml))
    if check and changed:
        print("website is out of date; run scripts/build-website.py:", ", ".join(changed))
        sys.exit(1)
    print(("would update: " if check else "updated: ") + (", ".join(changed) or "nothing"))


if __name__ == "__main__":
    main()
