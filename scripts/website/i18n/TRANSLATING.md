# Translating the DiskGarden website

You translate `source.json` (a JSON array of English strings) into one language and write
`scripts/website/i18n/<lang>.json`: a JSON object mapping **every** English string (exactly as in source.json) to its
translation. Write it with `ensure_ascii=False` and 1-space indent.

DiskGarden is a free macOS app that maps disk usage as an interactive sunburst ("bloom") and lets people clear space
safely through a review-before-delete "Waste bin". The site is a product website plus practical Mac storage guides.

## Rules

1. **Keep markup exactly.** Every HTML tag (`<b>`, `</b>`, `<a href="…">`, `<br>`, `<span class="…">`, `<kbd>` …)
   must appear in the translation unchanged, attributes included (do not translate or edit `href`, `class`, …).
   Tags may move to where they fit the sentence, but none may be added, removed or altered.
2. **Keep every `⟦n⟧` marker** (e.g. `⟦0⟧`, `⟦1⟧`). They stand for icons or code (Terminal commands, file paths) and
   must each appear exactly once. Move them only if the grammar requires it; usually keep their position.
3. **Placeholders** in `{braces}` (`{size}`, `{pct}`, `{name}`, `{total}`) stay exactly as written.
4. **Don't translate**: DiskGarden, Mac, macOS, Finder, Terminal, Time Machine, Spotlight, iCloud, Xcode, Docker,
   Docker Desktop, Apple, Apple silicon, Intel, Homebrew, npm, Product names, email addresses, version numbers, file
   paths, Terminal commands. Folder names shown in the demo (Users, System, Applications, Library, Movies, …) stay
   English.
5. **Use macOS's own wording in this language** for system settings and menus (e.g. System Settings → General →
   Storage, Privacy & Security, Full Disk Access, Software Update, Spotlight, Quick Look) — as Apple localizes them.
6. **Use the app's own terms** from `glossary.json` for this language (Waste bin, Scan, Scan as Administrator, hidden
   space, smaller objects, Free space, Show in Finder, Empty, …) so the website matches the app.
7. **Numbers**: localize decimal separators and units the way the language normally writes them
   (e.g. German "21,4 GB", French "21,4 Go" only if that's standard for the language — follow common Apple usage).
8. **Tone**: short, friendly, plain, confident — like Apple's own product pages. Natural, idiomatic sentences, not
   word-for-word. Headlines stay punchy. Keep the meaning; don't add claims.
9. Short isolated strings are UI labels (navigation, buttons, table cells). `free` (next to "Download") means
   "free of charge". `s` and `min` are abbreviations for seconds and minutes. `GB`/`MB`/`TB` are size units.
10. Page titles (`… — …` style) should stay under ~60 characters and descriptions under ~160 where possible.

## Check your work

Run `python3 scripts/website/check_i18n.py <lang>` from the repository root; it must report 0 missing and 0 changed
markers/tags. Fix anything it lists and run it again.
