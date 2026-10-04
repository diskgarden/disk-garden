# diskgarden.app

The website of [DiskGarden](https://diskgarden.app), a free disk space analyzer for the Mac.

Plain HTML, CSS and JavaScript in `website/`, plus one build script that bakes shared parts (head, header, footer,
release facts, sitemap) into the pages and generates the 17 translated versions. Published to GitHub Pages by
`.github/workflows/pages.yml` on every push to `main`.

```sh
python3 scripts/build-website.py              # after any edit
cd website && python3 -m http.server 8000     # preview at http://localhost:8000
```

Details — pages, SEO, languages, releases: [docs/WEBSITE.md](docs/WEBSITE.md).
