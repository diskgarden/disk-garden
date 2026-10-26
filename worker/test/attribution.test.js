// Run with: node --test   (from dis4/worker)
//
// Covers the pure classification logic and drives the worker's fetch handler
// against a fake R2 binding. No wrangler, no deploy, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAMPAIGN_SOURCES,
  GUIDE_SOURCES,
  PAGE_SOURCES,
  classifyClient,
  eventKind,
  parseRange,
  refererHost,
  sanitizeSrc,
  versionFromKey,
} from "../src/attribution.js";
import worker from "../src/index.js";

/* ---------------------------------------------------------------- sanitizeSrc */

test("sanitizeSrc keeps our own vocabulary", () => {
  assert.equal(sanitizeSrc("home"), "home");
  assert.equal(sanitizeSrc("download"), "download");
  assert.equal(sanitizeSrc("ph"), "ph");
  assert.equal(sanitizeSrc("HOME"), "home", "case is normalised");
  assert.equal(sanitizeSrc("  home  "), "home", "surrounding space is trimmed");
});

test("sanitizeSrc accepts each guide by name", () => {
  assert.equal(sanitizeSrc("guide-system-data-mac"), "guide-system-data-mac");
  assert.equal(sanitizeSrc("guide-docker-storage-mac"), "guide-docker-storage-mac");
  // 34 chars. It used to fail a 32-char cap and record as "other", so this one
  // guide's downloads were being credited to nobody while the rest worked.
  assert.equal(sanitizeSrc("guide-time-machine-local-snapshots"), "guide-time-machine-local-snapshots");
  assert.equal(sanitizeSrc("guide-"), "other", "a bare prefix is not a guide");
});

test("sanitizeSrc bounds cardinality for attacker-supplied values", () => {
  // dl.diskgarden.app is public, so ?src= is attacker-controlled. Unbounded
  // values would burn the daily write budget and wreck every query.
  assert.equal(sanitizeSrc("totally-made-up"), "other");
  assert.equal(sanitizeSrc("a".repeat(64)), "other", "over the shape cap");
  assert.equal(sanitizeSrc("drop table"), "other", "space fails the shape check");
  assert.equal(sanitizeSrc("../../etc/passwd"), "other");
  assert.equal(sanitizeSrc("réddit"), "other", "non-ASCII fails the shape check");
});

test("the vocabulary is closed: no prefix family lets cardinality escape", () => {
  // This is the property the old `guide-*` prefix match did not have. A length
  // cap bounds how long a label is, not how many distinct ones can be written,
  // so a prefix family left the write budget and query cardinality open.
  for (const forged of [
    "guide-aaa",
    "guide-not-a-real-guide",
    "guide-system-data-mac-x",
    "guide-1",
    "home-x",
    "downloads",
  ]) {
    assert.equal(sanitizeSrc(forged), "other", `${forged} must not be recorded verbatim`);
  }
  // Control: the loop above is not passing because everything collapses.
  assert.equal(sanitizeSrc("guide-system-data-mac"), "guide-system-data-mac");
  // Every accepted label comes from the declared sets and nowhere else.
  const declared = new Set([...PAGE_SOURCES, ...GUIDE_SOURCES, ...CAMPAIGN_SOURCES]);
  for (const label of declared) {
    assert.equal(sanitizeSrc(label), label);
  }
  assert.equal(declared.size, 31, "page + guide + campaign labels, so a silent drop is visible here");
});

test("sanitizeSrc reports absence distinctly from rejection", () => {
  assert.equal(sanitizeSrc(null), "none");
  assert.equal(sanitizeSrc(undefined), "none");
  assert.equal(sanitizeSrc(""), "none");
  assert.equal(sanitizeSrc("   "), "none");
  assert.equal(sanitizeSrc(42), "none");
});

test("every page label the website builds survives sanitizeSrc", () => {
  // The failure this guards against is silent: an unlisted label buckets as
  // "other", so that page's downloads get credited to nobody and the number
  // looks plausible. check-src-tags.py checks the same property against the
  // built HTML; this checks it against the vocabulary itself.
  for (const label of [...PAGE_SOURCES, ...GUIDE_SOURCES, ...CAMPAIGN_SOURCES]) {
    assert.equal(sanitizeSrc(label), label, `${label} must not collapse`);
  }
});

test("page labels cover every page that carries the header download button", () => {
  // Every built page has the header CTA, so every page needs a label. These are
  // the paths in build-website.py's PAGES; guides are covered by guide-<slug>.
  for (const label of [
    "home",
    "download",
    "support",
    "user-guide",
    "guides",
    "releases",
    "about",
    "privacy",
    "terms",
    "404",
  ]) {
    assert.ok(PAGE_SOURCES.has(label), `PAGES has a page labelled ${label}`);
    assert.equal(sanitizeSrc(label), label);
  }
  // Control: the assertions above can fail. A page-shaped label we do not build
  // is still rejected, so this is not passing because everything is accepted.
  assert.equal(sanitizeSrc("pricing"), "other");
  assert.equal(sanitizeSrc("user-guide-2"), "other");
});

/* -------------------------------------------------------------- classifyClient */

test("classifyClient separates Sparkle updates from new downloads", () => {
  // This is the whole point: appcast.xml enclosures use the same object key as
  // the website's download button, so without this every existing user's
  // auto-update would be reported as a new download.
  assert.equal(classifyClient("DiskGarden/1.0.6 Sparkle/2.6.4"), "update");
  assert.equal(classifyClient("Sparkle/2.0"), "update");
});

test("classifyClient flags bots and tools", () => {
  assert.equal(classifyClient("Mozilla/5.0 (compatible; Googlebot/2.1)"), "bot");
  assert.equal(classifyClient("curl/8.4.0"), "bot");
  assert.equal(classifyClient("Wget/1.21"), "bot");
  assert.equal(classifyClient("python-requests/2.31.0"), "bot");
  assert.equal(classifyClient("Twitterbot/1.0"), "bot");
  assert.equal(classifyClient("Slackbot-LinkExpanding 1.0"), "bot");
});

test("classifyClient treats a real browser as a browser", () => {
  const safari =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  assert.equal(classifyClient(safari), "browser");
  assert.equal(classifyClient(""), "unknown");
  assert.equal(classifyClient(null), "unknown");
});

/* ------------------------------------------------------------------ parseRange */

const SIZE = 6236826; // the real 1.0.6 DMG, from site/website/appcast.xml

test("parseRange serves the whole object when there is no range", () => {
  assert.deepEqual(parseRange(null, SIZE), { kind: "full" });
  assert.deepEqual(parseRange("", SIZE), { kind: "full" });
  assert.deepEqual(parseRange("   ", SIZE), { kind: "full" });
});

test("parseRange handles an open-ended resume", () => {
  assert.deepEqual(parseRange("bytes=1000-", SIZE), {
    kind: "partial",
    offset: 1000,
    end: SIZE - 1,
    length: SIZE - 1000,
  });
});

test("parseRange handles a closed range", () => {
  assert.deepEqual(parseRange("bytes=0-99", SIZE), {
    kind: "partial",
    offset: 0,
    end: 99,
    length: 100,
  });
});

test("parseRange clamps an end past the last byte", () => {
  assert.deepEqual(parseRange(`bytes=100-${SIZE + 5000}`, SIZE), {
    kind: "partial",
    offset: 100,
    end: SIZE - 1,
    length: SIZE - 100,
  });
});

test("parseRange handles a suffix range", () => {
  assert.deepEqual(parseRange("bytes=-500", SIZE), {
    kind: "partial",
    offset: SIZE - 500,
    end: SIZE - 1,
    length: 500,
  });
  assert.deepEqual(
    parseRange("bytes=-99999999", SIZE),
    { kind: "partial", offset: 0, end: SIZE - 1, length: SIZE },
    "a suffix larger than the object is the whole object",
  );
});

test("parseRange rejects a range that starts past the end", () => {
  // The reason this module exists: R2 silently ignores an unsatisfiable range
  // and returns the whole object, which would otherwise be mislabelled 206.
  assert.deepEqual(parseRange(`bytes=${SIZE}-`, SIZE), { kind: "unsatisfiable" });
  assert.deepEqual(parseRange(`bytes=${SIZE + 1}-${SIZE + 10}`, SIZE), { kind: "unsatisfiable" });
  assert.deepEqual(parseRange("bytes=-0", SIZE), { kind: "unsatisfiable" });
  assert.deepEqual(parseRange("bytes=0-0", 0), { kind: "unsatisfiable" }, "empty object");
});

test("parseRange ignores malformed and multi-range headers per RFC 7233", () => {
  assert.deepEqual(parseRange("bytes=0-99,200-299", SIZE), { kind: "full" }, "no multipart");
  assert.deepEqual(parseRange("items=0-99", SIZE), { kind: "full" }, "wrong unit");
  assert.deepEqual(parseRange("bytes=abc-def", SIZE), { kind: "full" });
  assert.deepEqual(parseRange("bytes=500-100", SIZE), { kind: "full" }, "reversed");
  assert.deepEqual(parseRange("bytes=-", SIZE), { kind: "full" });
  assert.deepEqual(parseRange("garbage", SIZE), { kind: "full" });
});

/* ------------------------------------------------------------------- eventKind */

test("eventKind counts only genuine new downloads", () => {
  const browser = { method: "GET", clientKind: "browser", rangeKind: "full" };
  assert.equal(eventKind(browser), "download");
  assert.equal(eventKind({ ...browser, method: "HEAD" }), "head");
  assert.equal(eventKind({ ...browser, clientKind: "update" }), "update");
  assert.equal(eventKind({ ...browser, clientKind: "bot" }), "bot");
  assert.equal(
    eventKind({ ...browser, rangeKind: "partial" }),
    "resume",
    "one interrupted download makes many ranged GETs; counting each would multiply it",
  );
  assert.equal(eventKind({ ...browser, rangeKind: "unsatisfiable" }), "bad-range");
  assert.equal(eventKind({ ...browser, clientKind: "unknown" }), "unknown");
});

test("eventKind prefers the client kind over the request shape", () => {
  // A resuming Sparkle update is an update, not a website download.
  assert.equal(
    eventKind({ method: "GET", clientKind: "update", rangeKind: "partial" }),
    "update",
  );
  assert.equal(eventKind({ method: "HEAD", clientKind: "update", rangeKind: "full" }), "head");
});

/* --------------------------------------------------- refererHost/versionFromKey */

test("refererHost keeps the host and drops the rest of the URL", () => {
  assert.equal(refererHost("https://news.ycombinator.com/item?id=123"), "news.ycombinator.com");
  assert.equal(refererHost("https://diskgarden.app/download/"), "diskgarden.app");
  assert.equal(refererHost(""), "none");
  assert.equal(refererHost(null), "none");
  assert.equal(refererHost("not a url"), "invalid");
});

test("versionFromKey reads the version out of the object key", () => {
  assert.equal(versionFromKey("DiskGarden-1.0.6.dmg"), "1.0.6");
  assert.equal(versionFromKey("DiskGarden-1.2.3.dmg"), "1.2.3");
  assert.equal(versionFromKey("DiskGarden.dmg"), "stable");
  assert.equal(versionFromKey("something-else.zip"), "unknown");
  assert.equal(versionFromKey(null), "unknown");
});

/* ------------------------------------------------------------- the fetch handler */

const BODY = "x".repeat(1000);

function fakeObject({ size = BODY.length, withBody = true } = {}) {
  const o = {
    size,
    httpEtag: '"abc123"',
    writeHttpMetadata(headers) {
      headers.set("content-type", "application/x-apple-diskimage");
    },
  };
  if (withBody) o.body = BODY;
  return o;
}

function makeEnv({ object = fakeObject(), onWrite = () => {}, bucketThrows = false } = {}) {
  return {
    BUCKET: {
      async head() {
        if (bucketThrows) throw new Error("r2 down");
        return object;
      },
      async get() {
        if (bucketThrows) throw new Error("r2 down");
        return object;
      },
    },
    DOWNLOADS: { writeDataPoint: onWrite },
  };
}

function req(url, { method = "GET", headers = {} } = {}) {
  return new Request(url, { method, headers });
}

const URL_106 = "https://dl.diskgarden.app/DiskGarden-1.0.6.dmg";

test("a plain download serves 200 and records one download for its source", async () => {
  const points = [];
  const res = await worker.fetch(
    req(`${URL_106}?src=guide-system-data-mac`, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" },
    }),
    makeEnv({ onWrite: (p) => points.push(p) }),
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(BODY.length));
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(await res.text(), BODY);

  assert.equal(points.length, 1);
  const [src, kind, version] = points[0].blobs;
  assert.equal(src, "guide-system-data-mac");
  assert.equal(kind, "download");
  assert.equal(version, "1.0.6");
  assert.deepEqual(points[0].indexes, ["guide-system-data-mac"]);
});

test("a Sparkle fetch of the same key is recorded as an update, not a download", async () => {
  const points = [];
  const res = await worker.fetch(
    req(URL_106, { headers: { "user-agent": "DiskGarden/1.0.5 Sparkle/2.6.4" } }),
    makeEnv({ onWrite: (p) => points.push(p) }),
  );
  assert.equal(res.status, 200);
  assert.equal(points[0].blobs[1], "update");
  assert.equal(points[0].blobs[0], "none", "Sparkle sends no ?src=");
});

test("a resume serves 206 with a correct Content-Range and is not counted", async () => {
  const points = [];
  const res = await worker.fetch(
    req(URL_106, { headers: { range: "bytes=100-199", "user-agent": "Safari/605.1.15" } }),
    makeEnv({ onWrite: (p) => points.push(p) }),
  );
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 100-199/${BODY.length}`);
  assert.equal(res.headers.get("content-length"), "100");
  assert.equal(points[0].blobs[1], "resume");
});

test("an unsatisfiable range serves 416 rather than a mislabelled whole object", async () => {
  const points = [];
  const res = await worker.fetch(
    req(URL_106, { headers: { range: "bytes=999999-", "user-agent": "Safari/605.1.15" } }),
    makeEnv({ onWrite: (p) => points.push(p) }),
  );
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), `bytes */${BODY.length}`);
  assert.equal(await res.text(), "", "no body on a 416");
  assert.equal(points[0].blobs[1], "bad-range");
});

test("a conditional request that is already current serves 304 with no body", async () => {
  const points = [];
  const res = await worker.fetch(
    req(URL_106, { headers: { "if-none-match": '"abc123"' } }),
    makeEnv({ object: fakeObject({ withBody: false }), onWrite: (p) => points.push(p) }),
  );
  assert.equal(res.status, 304);
  assert.equal(res.headers.get("content-length"), null);
  assert.equal(points[0].blobs[1], "not-modified");
});

test("HEAD returns metadata with no body and is not counted as a download", async () => {
  const points = [];
  const res = await worker.fetch(
    req(URL_106, { method: "HEAD", headers: { "user-agent": "Safari/605.1.15" } }),
    makeEnv({ onWrite: (p) => points.push(p) }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(BODY.length));
  assert.equal(await res.text(), "");
  assert.equal(points[0].blobs[1], "head");
});

test("a missing object is a 404, not a 502", async () => {
  const points = [];
  const res = await worker.fetch(
    req("https://dl.diskgarden.app/DiskGarden-9.9.9.dmg"),
    makeEnv({ object: null, onWrite: (p) => points.push(p) }),
  );
  assert.equal(res.status, 404);
  assert.equal(points[0].blobs[1], "missing");
});

test("unsupported methods are refused with Allow", async () => {
  const res = await worker.fetch(req(URL_106, { method: "DELETE" }), makeEnv());
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET, HEAD");
});

test("the versioned DMG is cached immutably and the stable alias is not", async () => {
  const versioned = await worker.fetch(req(URL_106), makeEnv());
  assert.match(versioned.headers.get("cache-control"), /immutable/);

  const stable = await worker.fetch(
    req("https://dl.diskgarden.app/DiskGarden.dmg"),
    makeEnv(),
  );
  assert.equal(stable.headers.get("cache-control"), "public, max-age=300");
});

/* ------------------------------------------------- the property that must hold */

test("a failing analytics write still serves the download", async () => {
  // The worker owns the critical download path. Measurement is best effort and
  // must never cost a download.
  const env = makeEnv({
    onWrite: () => {
      throw new Error("analytics engine unavailable");
    },
  });
  const res = await worker.fetch(req(`${URL_106}?src=home`), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), BODY);
});

test("a missing analytics binding still serves the download", async () => {
  // e.g. deployed before the dataset binding exists.
  const env = makeEnv();
  delete env.DOWNLOADS;
  const res = await worker.fetch(req(`${URL_106}?src=home`), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), BODY);
});

test("an R2 failure surfaces as 502 rather than a misleading 404", async () => {
  const points = [];
  const res = await worker.fetch(
    req(`${URL_106}?src=home`),
    makeEnv({ bucketThrows: true, onWrite: (p) => points.push(p) }),
  );
  assert.equal(res.status, 502);
  assert.equal(points[0].blobs[1], "error");
});

/* ------------------------------------------------------- the x-dg-served-by mark */

test("every response identifies the worker as the server", async () => {
  // Stage 2 flips a route in front of a hostname that already works. Bare R2
  // passes 21 of the 23 HTTP checks on its own, so "the suite went green" does
  // not establish that the route took effect. This header does, and its absence
  // is what proves a rollback actually landed. Every exit path must carry it,
  // including the error paths — a 502 from the worker and a 502 from somewhere
  // else need to be distinguishable at 2am.
  const cases = [
    ["200 full GET", req(URL_106), {}],
    ["206 partial", req(URL_106, { headers: { range: "bytes=0-99" } }), {}],
    ["416 unsatisfiable", req(URL_106, { headers: { range: "bytes=999999-" } }), {}],
    ["200 HEAD", req(URL_106, { method: "HEAD" }), {}],
    ["405 write attempt", req(URL_106, { method: "POST" }), {}],
    ["404 traversal", req("https://dl.diskgarden.app/..%2Fsecret"), {}],
    ["404 missing object", req("https://dl.diskgarden.app/nope.dmg"), { object: null }],
    ["502 R2 failure", req(URL_106), { bucketThrows: true }],
  ];

  for (const [label, request, envOpts] of cases) {
    const res = await worker.fetch(request, makeEnv(envOpts));
    assert.equal(res.headers.get("x-dg-served-by"), "worker", `${label} must be marked`);
  }
});

test("the 304 path is marked too", async () => {
  // R2 signals "onlyIf not satisfied" by returning metadata with no body.
  const res = await worker.fetch(
    req(URL_106, { headers: { "if-none-match": '"abc123"' } }),
    makeEnv({ object: fakeObject({ withBody: false }) }),
  );
  assert.equal(res.status, 304);
  assert.equal(res.headers.get("x-dg-served-by"), "worker");
});

/* ----------------------------------------------------------------- robots.txt */

const ROBOTS_URL = "https://dl.diskgarden.app/robots.txt";

test("robots.txt disallows every crawler on the download host", async () => {
  const res = await worker.fetch(req(ROBOTS_URL), makeEnv());

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(res.headers.get("x-dg-served-by"), "worker");

  const body = await res.text();
  assert.equal(body, "User-agent: *\nDisallow: /\n");
  assert.equal(res.headers.get("content-length"), String(body.length));

  // The directives a crawler actually acts on, asserted rather than assumed:
  // an empty or comment-only robots.txt means "crawl everything", which is what
  // the host served before this existed.
  const directives = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  assert.deepEqual(directives, ["User-agent: *", "Disallow: /"]);
});

test("robots.txt does not depend on the bucket", async () => {
  // It must hold when the object is absent and when R2 itself is down —
  // "no robots.txt" silently means "crawl everything", so a bucket outage must
  // not quietly re-open the host to crawlers.
  for (const envOpts of [{ object: null }, { bucketThrows: true }]) {
    const res = await worker.fetch(req(ROBOTS_URL), makeEnv(envOpts));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "User-agent: *\nDisallow: /\n");
  }
});

test("a HEAD of robots.txt has no body but still sizes it", async () => {
  const res = await worker.fetch(req(ROBOTS_URL, { method: "HEAD" }), makeEnv());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), "26");
  assert.equal(await res.text(), "");
});

test("robots.txt is recorded, and never as a download", async () => {
  const points = [];
  await worker.fetch(req(`${ROBOTS_URL}?src=home`), makeEnv({ onWrite: (p) => points.push(p) }));

  assert.equal(points.length, 1);
  const [src, kind, version] = points[0].blobs;
  assert.equal(kind, "robots"); // must not be "download" — it would inflate the count
  assert.equal(src, "home"); // a tagged crawl of it is still attributable
  assert.equal(version, "unknown");
  assert.deepEqual(points[0].doubles, [200, 26]);
});

test("robots.txt does not shadow a release whose key merely contains it", async () => {
  // Guards against a prefix/substring match creeping in: only the exact key is
  // the policy file, everything else is still served from the bucket.
  const res = await worker.fetch(req("https://dl.diskgarden.app/robots.txt.dmg"), makeEnv());
  assert.equal(res.status, 200);
  assert.equal(await res.text(), BODY);
});

test("robots.txt still refuses writes", async () => {
  const res = await worker.fetch(req(ROBOTS_URL, { method: "POST" }), makeEnv());
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET, HEAD");
});
