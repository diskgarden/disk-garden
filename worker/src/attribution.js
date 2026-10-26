// Pure request-classification logic for the dl.diskgarden.app download worker.
//
// Everything here is deliberately free of Workers runtime APIs so it can be run
// under plain `node --test` (see ../test/attribution.test.js). The worker entry
// point in index.js does the I/O; this file decides *what a request means*.

/**
 * Sources we expect to see. Anything else collapses to "other" (see sanitizeSrc).
 *
 * PAGE_SOURCES must cover every page the website builds a download link into,
 * because every page carries the header download button. A page whose label is
 * missing here does not fail loudly — it silently buckets as "other", so its
 * downloads get credited to nobody. The labels are produced by src_for() in the
 * website's scripts/build-website.py; check-src-tags.py asserts the two agree
 * against the built HTML rather than trusting these two lists to stay in step.
 */
export const PAGE_SOURCES = new Set([
  "home", // "/"            homepage hero + mid-page CTA + header
  "download", // "/download/"
  "releases", // "/releases/"    header + the per-version history links
  "support", // "/support/"
  "user-guide", // "/user-guide/"
  "guides", // "/guides/"      the guide index; individual guides are guide-<slug>
  "about", // "/about/"
  "privacy", // "/privacy/"
  "terms", // "/terms/"
  "404", // "/404.html"
]);

/**
 * One label per guide under /guides/, as `guide-<slug>` (see src_for in the
 * website's build-website.py).
 *
 * Enumerated rather than accepted as an open-ended `guide-*` family, which is
 * what this used to be. Two reasons, both found by check-src-tags.py:
 *   - A prefix match put no bound on cardinality at all. dl.diskgarden.app is
 *     public, so anyone could have written unlimited distinct `guide-xxx` labels
 *     into Analytics Engine, burning the daily write budget and wrecking the
 *     cardinality of every query. The old comment claimed this was bounded by a
 *     length cap; a length cap bounds length, not the number of distinct values.
 *   - "guide-time-machine-local-snapshots" is 34 characters and the shape check
 *     capped labels at 32, so that guide's downloads were silently recording as
 *     "other" while every other guide worked.
 *
 * The cost is that a new guide must be added here too. That is deliberate: the
 * check script turns an unlisted guide into a build failure, which is a better
 * failure than a number that quietly credits the wrong page.
 */
export const GUIDE_SOURCES = new Set([
  "guide-apple-intelligence-storage",
  "guide-clear-cache-mac",
  "guide-docker-storage-mac",
  "guide-find-large-files-mac",
  "guide-free-up-space-on-mac",
  "guide-iphone-backups-mac",
  "guide-mac-cleaner-apps",
  "guide-macos-system-storage",
  "guide-purgeable-space-mac",
  "guide-spotlight-index-mac",
  "guide-system-data-mac",
  "guide-time-machine-local-snapshots",
  "guide-xcode-storage",
]);

/** Tags we add to links we post ourselves, rather than to pages we build. */
export const CAMPAIGN_SOURCES = new Set([
  "ph", // Product Hunt
  "reddit",
  "hn",
  "x",
  "medium",
  "threads",
  "instagram",
  "appcast", // Sparkle feed, should it ever be tagged explicitly
]);

export const KNOWN_SOURCES = new Set([...PAGE_SOURCES, ...GUIDE_SOURCES, ...CAMPAIGN_SOURCES]);

// A cheap bound applied before the set lookup, so a megabyte of query string is
// rejected without being lowercased and hashed. Every label we actually use is
// well inside it; the set membership below is what decides acceptance, so this
// cap can be generous without widening what gets recorded.
const SRC_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Collapse a caller-supplied ?src= into a closed, low-cardinality label.
 *
 * dl.diskgarden.app is a public URL, so `src` is attacker-controlled: without a
 * bound, anyone could write unlimited distinct strings into Analytics Engine and
 * burn the daily write budget / wreck the cardinality of every query. The
 * vocabulary is therefore closed — exactly KNOWN_SOURCES, with no prefix
 * families — and everything else buckets as "other".
 */
export function sanitizeSrc(raw) {
  if (typeof raw !== "string") return "none";
  const s = raw.trim().toLowerCase();
  if (s === "") return "none";
  if (!SRC_SHAPE.test(s)) return "other";
  return KNOWN_SOURCES.has(s) ? s : "other";
}

const BOT_MARKERS = [
  "bot",
  "crawler",
  "spider",
  "curl/",
  "wget",
  "python-requests",
  "go-http-client",
  "headlesschrome",
  "slackbot",
  "facebookexternalhit",
  "twitterbot",
  "discordbot",
  "whatsapp",
  "telegrambot",
  "preview",
  "monitor",
  "uptime",
];

/**
 * What kind of client is this?
 *
 * The distinction that matters most: Sparkle fetches the very same object key as
 * the website's download button (site/website/appcast.xml enclosures point at
 * https://dl.diskgarden.app/DiskGarden-<version>.dmg), so counting raw requests
 * would report every existing user's auto-update as a new download.
 */
export function classifyClient(userAgent) {
  const ua = (userAgent || "").toLowerCase();
  if (ua === "") return "unknown";
  if (ua.includes("sparkle")) return "update";
  if (BOT_MARKERS.some((m) => ua.includes(m))) return "bot";
  return "browser";
}

/**
 * Parse a single-range `Range` header against a known object size.
 *
 * Returns one of:
 *   { kind: "full" }                                  serve 200, whole object
 *   { kind: "unsatisfiable" }                          serve 416
 *   { kind: "partial", offset, length, end }           serve 206
 *
 * Why this exists rather than passing the header straight to R2: R2 silently
 * ignores a range it cannot satisfy and hands back the whole object. Trusting it
 * would mean labelling a full body as 206 with a bogus Content-Range. So we
 * decide the status from our own parse and only ask R2 for ranges we know are
 * satisfiable.
 *
 * Per RFC 7233 a malformed or multi-range header is ignored (serve the full
 * representation) rather than rejected; we do not implement multipart/byteranges.
 */
export function parseRange(rangeHeader, size) {
  if (typeof rangeHeader !== "string" || rangeHeader.trim() === "") {
    return { kind: "full" };
  }
  const m = /^bytes=(.*)$/i.exec(rangeHeader.trim());
  if (!m) return { kind: "full" };

  const spec = m[1].trim();
  if (spec.includes(",")) return { kind: "full" }; // multi-range: unsupported, serve all

  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return { kind: "full" };
  const [, rawStart, rawEnd] = parts;

  // An empty object can satisfy no byte range at all.
  if (size === 0) return { kind: "unsatisfiable" };

  if (rawStart === "") {
    // Suffix range: last N bytes. "bytes=-0" is meaningless -> unsatisfiable.
    if (rawEnd === "") return { kind: "full" };
    const suffix = Number(rawEnd);
    if (suffix === 0) return { kind: "unsatisfiable" };
    const offset = Math.max(0, size - suffix);
    return { kind: "partial", offset, end: size - 1, length: size - offset };
  }

  const start = Number(rawStart);
  if (start >= size) return { kind: "unsatisfiable" };

  if (rawEnd === "") {
    return { kind: "partial", offset: start, end: size - 1, length: size - start };
  }
  const end = Math.min(Number(rawEnd), size - 1);
  if (end < start) return { kind: "full" }; // nonsense range: ignore it
  return { kind: "partial", offset: start, end, length: end - start + 1 };
}

/**
 * The label a data point gets, combining client kind with request shape.
 *
 * Only "download" is a new human download. Resumes are excluded because a single
 * interrupted download produces several ranged GETs, and counting each would
 * multiply one download into many.
 */
export function eventKind({ method, clientKind, rangeKind }) {
  if (method === "HEAD") return "head"; // browsers/Sparkle probe before fetching
  if (clientKind === "update") return "update";
  if (clientKind === "bot") return "bot";
  if (rangeKind === "partial") return "resume";
  if (rangeKind === "unsatisfiable") return "bad-range";
  return clientKind === "unknown" ? "unknown" : "download";
}

/** Host only, so we keep the referring site without the full (possibly sensitive) URL. */
export function refererHost(referer) {
  if (typeof referer !== "string" || referer === "") return "none";
  try {
    return new URL(referer).hostname || "none";
  } catch {
    return "invalid";
  }
}

/** "DiskGarden-1.0.6.dmg" -> "1.0.6"; the stable "DiskGarden.dmg" -> "stable". */
export function versionFromKey(key) {
  if (typeof key !== "string") return "unknown";
  const m = /^DiskGarden-(\d+(?:\.\d+)*)\.dmg$/.exec(key);
  if (m) return m[1];
  if (key === "DiskGarden.dmg") return "stable";
  return "unknown";
}
