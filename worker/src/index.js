// dl.diskgarden.app — serves the DMG from R2 and records one Analytics Engine
// data point per request so downloads can be attributed to the page or campaign
// that produced them.
//
// Non-negotiable property: this worker sits in the critical download path. A
// Workers route takes precedence over the bucket's R2 custom domain on the same
// hostname, so if this code throws, downloads break for everyone. Every
// measurement step is therefore best-effort and wrapped; the only job that may
// not fail is handing back the object.

import {
  classifyClient,
  eventKind,
  parseRange,
  refererHost,
  sanitizeSrc,
  versionFromKey,
} from "./attribution.js";

/** Long cache for immutable versioned DMGs, short for the moving "stable" alias. */
function cacheControl(version) {
  return version === "stable" ? "public, max-age=300" : "public, max-age=31536000, immutable";
}

// Marks every response this worker produced. Bare R2 never sets it, so one
// header answers the two questions that stage 2 cannot otherwise answer: did the
// route actually take over the hostname, and after a rollback, has R2 taken it
// back? Without this, a post-flip test suite passing proves nothing — bare R2
// already passes 21 of its 23 checks.
const SERVED_BY = { "x-dg-served-by": "worker" };

/**
 * robots.txt for dl.diskgarden.app.
 *
 * Served from code rather than stored as a bucket object, so it cannot drift
 * from this worker and cannot be lost if the bucket is ever re-created. The
 * hostname serves exactly one kind of thing — release binaries — and none of it
 * belongs in a search index: /download/ on the website is the page that should
 * rank, and a SoftwareApplication rich result does not need its downloadUrl
 * target to be crawlable.
 *
 * This is a measurement fix more than an SEO one. Every page the website builds
 * carries a tagged download link, so the DMG is reachable by crawl from ~400
 * pages under ~23 distinct ?src= labels. Crawler fetches that identify
 * themselves are already labelled "bot" and excluded from the download count by
 * eventKind, but a crawler sending a browser-shaped user-agent is
 * indistinguishable from a person. Not being crawled is the only robust fix,
 * and it matters most now, while real downloads are near zero and a handful of
 * crawl hits would look like genuine interest.
 *
 * Safe for updates: Sparkle does not consult robots.txt, and neither does any
 * HTTP client a human download goes through.
 */
const ROBOTS_TXT = "User-agent: *\nDisallow: /\n";

function record(env, point) {
  // Best effort by design: a measurement failure must never cost a download.
  try {
    env.DOWNLOADS?.writeDataPoint(point);
  } catch (err) {
    console.error("analytics write failed", err?.message);
  }
}

function baseHeaders(object, version) {
  const headers = new Headers();
  object.writeHttpMetadata(headers); // content-type etc. from the R2 object
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", cacheControl(version));
  headers.set("x-dg-served-by", "worker");
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }
  return headers;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...SERVED_BY, allow: "GET, HEAD", "cache-control": "no-store" },
      });
    }

    let key;
    try {
      key = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return new Response("Bad request", { status: 400, headers: { ...SERVED_BY, "cache-control": "no-store" } });
    }
    if (key === "" || key.includes("..")) {
      return new Response("Not found", { status: 404, headers: { ...SERVED_BY, "cache-control": "no-store" } });
    }

    const src = sanitizeSrc(url.searchParams.get("src"));
    const clientKind = classifyClient(request.headers.get("user-agent"));
    const version = versionFromKey(key);
    const country = request.cf?.country || "unknown";
    const referrer = refererHost(request.headers.get("referer"));

    const write = (kind, status, bytes) =>
      record(env, {
        indexes: [src],
        blobs: [src, kind, version, country, referrer, key],
        doubles: [status, bytes],
      });

    // Answered before any bucket lookup, so it holds whatever the bucket
    // contains. Recorded like everything else — one data point per request —
    // which also makes crawl pressure visible instead of invisible.
    if (key === "robots.txt") {
      const bytes = ROBOTS_TXT.length; // pure ASCII, so chars == bytes
      const headers = new Headers({
        ...SERVED_BY,
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=86400",
        "content-length": String(bytes),
      });
      write("robots", 200, bytes);
      return new Response(method === "HEAD" ? null : ROBOTS_TXT, { status: 200, headers });
    }

    try {
      if (method === "HEAD") {
        const head = await env.BUCKET.head(key);
        if (!head) {
          write("missing", 404, 0);
          return new Response(null, { status: 404, headers: { ...SERVED_BY, "cache-control": "no-store" } });
        }
        const headers = baseHeaders(head, version);
        headers.set("content-length", String(head.size));
        write(eventKind({ method, clientKind, rangeKind: "full" }), 200, 0);
        return new Response(null, { status: 200, headers });
      }

      const rangeHeader = request.headers.get("range");

      // Only pay for the extra head() when a Range header actually needs sizing.
      let range = { kind: "full" };
      if (rangeHeader) {
        const head = await env.BUCKET.head(key);
        if (!head) {
          write("missing", 404, 0);
          return new Response("Not found", {
            status: 404,
            headers: { ...SERVED_BY, "cache-control": "no-store" },
          });
        }
        range = parseRange(rangeHeader, head.size);
        if (range.kind === "unsatisfiable") {
          write(eventKind({ method, clientKind, rangeKind: range.kind }), 416, 0);
          const headers = baseHeaders(head, version);
          headers.set("content-range", `bytes */${head.size}`);
          headers.delete("content-length");
          return new Response(null, { status: 416, headers });
        }
      }

      const object = await env.BUCKET.get(key, {
        onlyIf: request.headers,
        ...(range.kind === "partial"
          ? { range: { offset: range.offset, length: range.length } }
          : {}),
      });

      if (object === null) {
        write("missing", 404, 0);
        return new Response("Not found", { status: 404, headers: { ...SERVED_BY, "cache-control": "no-store" } });
      }

      // onlyIf not satisfied: R2 returns the metadata with no body.
      if (!("body" in object)) {
        const headers = baseHeaders(object, version);
        headers.delete("content-length");
        write("not-modified", 304, 0);
        return new Response(null, { status: 304, headers });
      }

      const kind = eventKind({ method, clientKind, rangeKind: range.kind });
      const headers = baseHeaders(object, version);

      if (range.kind === "partial") {
        headers.set("content-length", String(range.length));
        headers.set("content-range", `bytes ${range.offset}-${range.end}/${object.size}`);
        write(kind, 206, range.length);
        return new Response(object.body, { status: 206, headers });
      }

      headers.set("content-length", String(object.size));
      write(kind, 200, object.size);
      return new Response(object.body, { status: 200, headers });
    } catch (err) {
      // Serving failed for a reason we did not anticipate. Say so honestly with a
      // 502 rather than a misleading 404, and leave a breadcrumb in the logs.
      console.error("serve failed", key, err?.message);
      record(env, {
        indexes: [src],
        blobs: [src, "error", version, country, referrer, key],
        doubles: [502, 0],
      });
      return new Response("Download temporarily unavailable", {
        status: 502,
        headers: { ...SERVED_BY, "cache-control": "no-store" },
      });
    }
  },
};
