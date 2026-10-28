# Website

`website/` is the static site for https://diskgarden.app: plain HTML, CSS and JS. One small script,
`scripts/build-website.py`, bakes the shared parts into every page in place (head with SEO tags and structured data,
header, footer, release facts, sitemap, minified CSS). Run it after editing a page or the release facts; the deploy
workflow runs it too, so the live site is never stale.

| Page | File |
|---|---|
| Home | `website/index.html` |
| Download | `website/download/index.html` |
| Support (guides, FAQ, contact) | `website/support/index.html` |
| User guide (the app manual; Support's six cards link here) | `website/user-guide/index.html` |
| Release notes | `website/releases/index.html` (baked from `scripts/website/release.json`) |
| Articles (search traffic) | `website/guides/free-up-space-on-mac/`, `website/guides/system-data-mac/` |
| About, Privacy, Terms, 404 | `website/about/`, `privacy/`, `terms/`, `404.html` |

Shared pieces:
- `scripts/build-website.py`: per-page titles, descriptions and structured data live in its `PAGES` table; the header
  and footer templates are there too. Regions in the HTML look like `<!-- dg:head -->…<!-- /dg:head -->`.
- `assets/site.js`: the phone menu, support search and scroll/motion effects (no content).
- `assets/bloom.js` draws the bloom (the app's sunburst, same palette and petal shapes) and the app-window mocks.
- `assets/site.css` holds the design system.

## Preview locally

```sh
python3 scripts/build-website.py              # after any edit
cd website && python3 -m http.server 8000     # then open http://localhost:8000
```

Links are root-relative (`/download/`), so preview from `website/` as the server root.

The build script runs on Python 3.9 and up, so a stock `python3` is enough on any supported macOS. CI pins 3.12
(`actions/setup-python` in `.github/workflows/pages.yml`) rather than taking whatever the runner image ships.

## Per release

Edit `scripts/website/release.json`: `version`, `released`, `sizeMB`, `installedMB`, `dmg`, `sha256`, `signedBy`,
`notarized`, and add the release to the top of `history`. A value left `null` hides whatever shows it, so the site
never shows a placeholder. Run `python3 scripts/build-website.py` and commit; the workflow redeploys.

## Hosting (GitHub Pages)

This repository (`diskgarden/disk-garden`) is public (GitHub Pages is free for public repos); the app lives in the
private `firefinchdev/disk-garden-app`, which keeps a clone of this repo in its git-ignored `site/` folder.

`.github/workflows/pages.yml` builds and deploys on every push to `main` that touches `website/`, `scripts/` or the
workflow. Settings: **Pages → Source: GitHub Actions**, custom domain `diskgarden.app`, **Enforce HTTPS**.

DNS at the domain registrar: apex `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
`185.199.111.153` (and `AAAA` `2606:50c0:8000::153` … `2606:50c0:8003::153`), and `CNAME` `www` → `diskgarden.github.io`.
The site uses root-relative links, so it only renders correctly on the custom domain (not under
`diskgarden.github.io/disk-garden/`).

## Deploying

A push to `main` is what deploys, so the push *is* the publish step. Agents cannot run `git push`: it is denied in
root-owned managed settings (`/Library/Application Support/ClaudeCode/managed-settings.d/60-diskgarden-agents.json`),
the same deny that keeps the app repo unpublishable while the Sparkle key rotation and history scrub are outstanding.
Permission rules match the command string and not the working directory, so "allow a push only from `site/`" cannot be
written as a rule at all.

One wrapper is that rule. It is root-owned, allowed by its exact path, takes no arguments, and pushes this repository
and nothing else:

```sh
/usr/local/libexec/diskgarden/deploy-site.sh
```

It publishes committed work only, never force-pushes, and refuses rather than guesses — any non-zero exit means
nothing was pushed:

| Exit | Meaning |
|---|---|
| 0 | pushed; prints the before/after SHAs, the Actions URL and the rollback command |
| 1 | not this repo's root, `origin` repointed, not on `main`, or behind origin |
| 2 | working tree dirty — commit or stash first |
| 3 | nothing to push |
| 4 | `website/appcast.xml` would change |
| 5 | arguments given |

Exit 4 is the one worth knowing about. `website/appcast.xml` is the Sparkle feed served at
`https://diskgarden.app/appcast.xml`, so a change to it reaches *installed* copies of DiskGarden rather than only
visitors. That has to be verified against the app repo's `docs/UPDATES.md` and ships through the release path, never
through a website deploy.

Roll back by reverting forward — `git revert --no-edit <sha>`, then run the wrapper again. Published history is never
rewritten. The wrapper appends each push to `~/Library/Logs/diskgarden-deploy-site.log`; that is a convenience trail,
not the record — the record is the commit history and the task log.

Note that `pages.yml` only rebuilds when a push touches one of its `paths` — `website/**`, `scripts/**`,
`worker/src/attribution.js` or the workflow itself — so a change confined to `docs/` pushes but deploys nothing, by
design. Use **Actions → Website → Run workflow** if you ever need a rebuild without a matching change.

## Analytics

`CF_BEACON_TOKEN` at the top of `scripts/build-website.py` holds the Cloudflare Web Analytics site tag. Set, it bakes
the deferred `beacon.min.js` script into every page's `<head>`; empty, no beacon is emitted anywhere. The token is
public by design — it ships in every page and only names the site to report to — so it is not a credential and belongs
in this repository. Get it from Cloudflare dashboard → **Web Analytics** → `diskgarden.app` → **Manage site**.

Cloudflare Web Analytics is cookieless: no client-side state, no fingerprinting, nothing to consent to. Per page view
it reports path, host, referrer, country, browser, OS, device type, navigation type and Core Web Vitals. It has **no
custom events**, so a download click cannot be recorded — the funnel is page views here plus real DMG `GET`s from the
Cloudflare dashboard for `dl.diskgarden.app`. `website/privacy/` describes exactly this; if the token or the provider
changes, that page and its 17 translations have to change in the same commit.

## Download attribution (`?src=`)

Every download link the build emits carries `?src=<page>`, so the Worker in front of `dl.diskgarden.app` can report
which page produced a download — the gap Web Analytics leaves above, since it has no custom events. It has to be a
query string rather than the referrer: a cross-origin navigation to `dl.diskgarden.app` sends only the origin under the
default `strict-origin-when-cross-origin` policy, so the Worker would see `diskgarden.app` and never the path. The tag
is read server-side and nothing is stored in the visitor's browser, so the cookieless promise on `website/privacy/`
still holds and there is still nothing to consent to.

`src_for()` in `scripts/build-website.py` derives one label per page (`home`, `download`, `releases`, `support`,
`user-guide`, `guides`, `about`, `privacy`, `terms`, `404`, and `guide-<slug>` per guide) and `tag_src()` appends it to
the header CTA, the in-content `data-dg-href="dmg"` CTAs and the `/releases/` per-version links, on English and all 17
translations. Two things are deliberately **not** tagged: `website/appcast.xml`, because Sparkle fetches the same
object key as the download button and tagging it would attribute every installed copy's auto-update to a page, and the
JSON-LD `downloadUrl`, which is metadata rather than a link a person clicked.

The Worker that reads the tag lives in **`worker/`** in this repository — `worker/src/attribution.js` holds the
vocabulary and the request classification, `worker/src/index.js` does the I/O, and `cd worker && node --test` runs its
41 unit tests with no Cloudflare account involved. It is in this repo rather than the app repo so that one checkout
holds both sides of the contract and CI can compare them; it contains no key material and nothing account-specific
(`wrangler.toml` carries no account id).

**It is not deployed.** As of 2026-10-27 `dl.diskgarden.app` is served directly by the R2 custom domain, with no Worker
in the request path — confirmed by the absence of an `x-dg-served-by` response header. Deploying it needs a Cloudflare
token with `Workers Scripts: Edit` and `Workers Routes: Edit`, which no agent holds (DIS-4). **Until it is deployed the
`?src=` tags are inert:** they are carried, they are harmless (the object is served identically with or without one),
and nothing counts them. No attribution figure may be reported from `?src=` before the Worker is live and its
vocabulary confirmed against the built HTML.

The label vocabulary is **closed** — the Worker collapses anything it does not recognise to `other`, which credits the
download to nobody and still produces a plausible-looking number. Nothing fails loudly, so `scripts/check-src-tags.py`
asserts the agreement against the built HTML, and the deploy workflow runs it after the build. It reads the vocabulary
out of `worker/src/attribution.js` — including `SRC_SHAPE`, whose bound is applied before the set lookup and so is part
of the vocabulary — rather than keeping a copy, because a copy made both "sides" the same side and the check then
passed whatever the Worker recognised. Run it locally after a full build rather than `--check` (the translated pages
only exist once the build has written them):

```sh
python3 scripts/build-website.py && python3 scripts/check-src-tags.py
```

`content_hash()` strips the tag before fingerprinting a page, so adding or renaming a label does not re-date the home
page, `/download/` and `/releases/` in `modified.json` and `sitemap.xml` — a `?src=` tag is measurement, not content,
for the same reason the shared chrome is emptied out there.

## Releases and the update feed

The app repo's `scripts/publish-update.sh` signs a release into the app repo's `Releases/` (the master copy) and then
copies `appcast.xml` to `website/appcast.xml` and the archive (plus any deltas) to `website/releases/` here. Commit
and push this repo to publish — the feed is then at `https://diskgarden.app/appcast.xml` and the download at
`https://diskgarden.app/releases/DiskGarden-X.Y.dmg`. GitHub limits files to 100 MB, which a DMG of a few MB is far
below. Update `scripts/website/release.json` (version, size, sha256, …) in the same commit.

## SEO

What's in place (all generated by `scripts/build-website.py` unless noted):
- A unique `<title>` (≤ 60 characters) and meta description (≤ 160) per page, canonical URLs, `robots` with large image
  previews, Open Graph and Twitter cards with `assets/og-image.png` (1200×630).
- JSON-LD: Organization and WebSite everywhere; SoftwareApplication (free, macOS, version, download URL) on the home
  page; FAQPage on Home and Support, generated from the questions visible on the page; TechArticle on guides;
  BreadcrumbList on sub-pages. No ratings until there are real ones — fake ratings get a site penalized.
- `sitemap.xml` with last-modified dates, `robots.txt`, `llms.txt`, a web manifest, and icons Google can use in
  results (`/favicon.ico` 48 px, `assets/favicon.svg`, `assets/apple-touch-icon.png`).
- Page dates — `lastmod` in the sitemap and `dateModified` in the guides' TechArticle — come from
  `scripts/website/modified.json`, which the build keeps up to date: it holds a date and a fingerprint of each page's
  content, and re-dates a page only when that fingerprint changes. Editing a guide moves that guide's date, a release
  moves the pages that show the version, and a change to the shared head, header or footer moves none of them. Commit
  the file along with the page. (The dates cannot come from git here: the build bakes the date into the very file whose
  commit date it would read, and the deploy workflow's shallow clone reports the pushed commit's date for every path.)
- Content aimed at real searches: "free disk space analyzer for Mac" in the visible hero and titles, and 12 Mac storage
  guides under /guides/ (System Data, macOS size, large files, Xcode, Docker, iPhone backups, snapshots, purgeable
  space, Spotlight, Apple Intelligence, caches). Each gets breadcrumbs, a download call-to-action and 3 related guides,
  and they're linked from the home page, Support FAQ, the footer and llms.txt.

### Adding a guide
1. Add an entry to `ARTICLES` in `scripts/build-website.py` (slug, short name, title ≤ 60 chars, description ≤ 160,
   card line, 3 related slugs).
2. Create `website/guides/<slug>/index.html` from an existing guide: keep the `dg:` region markers, write the `<h1>`,
   lead and `<section>`s. Link to other guides and to /download/ where it helps the reader.
3. Run `python3 scripts/build-website.py` — head, structured data, breadcrumbs, related cards, hub, sitemap and
   llms.txt update themselves.
4. Add `guide-<slug>` to `GUIDE_SOURCES` in `worker/src/attribution.js` — one place, not two: `check-src-tags.py`
   reads that file rather than keeping its own copy. The `?src=` vocabulary is closed, so a new guide's downloads
   would otherwise be credited to nobody, and `check-src-tags.py` fails the build until you do (see *Download
   attribution* above).
- Delivery: GitHub Pages gzips everything; CSS is minified by build-website.py and the deploy workflow minifies the
  two scripts with esbuild (sources in the repo stay readable). The home page transfers ~26 KB of HTML/CSS/JS.
  HTML minification was measured at ~0.5 KB gzipped and skipped.
- Performance: static header/footer and release facts (no script needed for content), deferred scripts, charts built
  only as they scroll into view, reserved space for the mocks (no layout shift), minified CSS. Lighthouse:
  100 / 100 / 100 / 100 on every page tested (mobile and desktop).

Deliberately not done: hidden text, keyword lists, or a `meta keywords` tag — Google ignores the tag and treats the
first two as spam.

Regenerate the social image after a design change: copy `scripts/website/og.html` to `website/_og.html`, serve
`website/`, screenshot it at 1200×630 into `website/assets/og-image.png` (e.g. headless Chrome
`--window-size=1200,630 --screenshot=…`), and delete `_og.html`.

After launch (needs your accounts — see BACKLOG):
1. Google Search Console: add the `diskgarden.app` domain property (DNS TXT record), submit
   `https://diskgarden.app/sitemap.xml`, and check *Enhancements* for the FAQ / breadcrumb / software app data.
2. Bing Webmaster Tools: import from Search Console (Bing also feeds DuckDuckGo and ChatGPT search).
3. Links from other sites matter most for ranking a new domain: Product Hunt, MacUpdate, AlternativeTo, a Homebrew
   cask, r/macapps, and Mac blogs that review utilities.

## Languages

The site is in English plus the app's 17 other languages, each under its own folder (`/de/`, `/ja/`, `/pt-br/`, …).
English pages are the only source; `scripts/build-website.py` generates the others into `website/<folder>/` (git-
ignored; the deploy workflow builds them).

- **Catalogs:** `scripts/website/i18n/<lang>.json` map each English text segment to its translation.
  `source.json` lists every segment; `glossary.json` holds the app's own terms per language (Waste bin, Scan, …).
  Segments are leaf text blocks (headings, paragraphs, list items…), loose text and alt/title/aria-label/placeholder
  attributes; icons and `<code>` become `⟦n⟧` markers (see `scripts/website/i18n.py`).
- **After changing English text:** `python3 scripts/build-website.py --extract` refreshes `source.json` and prints how
  many segments each language is missing. Translate the missing ones (rules in `scripts/website/i18n/TRANSLATING.md`),
  check with `python3 scripts/website/check_i18n.py <lang>`, then run the build. Until then, the build shows the
  English text for missing segments and lists the counts.
- **Runtime text** in the charts and timers comes from `JS_STRINGS` in `i18n.py`, passed to the page as
  `window.DG_I18N`; numbers and percentages follow the page language via `Intl`.
- **SEO:** every page lists all versions with `hreflang` (plus `x-default` = English), has its own canonical URL,
  translated title/description, `og:locale` and structured data with `inLanguage`; the sitemap lists every version
  with its alternates. Arabic pages are right-to-left (charts and app mocks stay left-to-right, like the app).
- **Switcher and redirect:** the globe button lists all languages (links to the same page in each). On a first visit
  to an English page, a browser that prefers a supported language is sent to it — unless the visitor picked a
  language in the switcher (remembered in localStorage) or is a crawler. Pages in other languages never redirect.
