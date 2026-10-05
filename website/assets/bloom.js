// The DiskGarden bloom: the app's sunburst, drawn in SVG from a made-up disk. Same palette (App/Sunburst/
// SunburstPalette.swift), ring sizes and rounded, evenly gapped petals as the app.
(() => {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  const GB = 1e9;

  // ---------- Palette ----------
  const ANCHORS = [[15, .79, .72], [45, .87, .74], [75, .98, .77], [105, .95, .75], [135, .95, .77], [165, .94, .80],
    [195, .94, .79], [225, .90, .73], [255, .89, .73], [285, .90, .69], [315, .79, .62], [345, .78, .62]];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function degrees(position) {
    const p = clamp(((position % 1) + 1) % 1, 0, 1);
    return Math.pow(p, 1.12) * 360;
  }
  function anchor(d) {
    const list = ANCHORS.concat([[ANCHORS[0][0] + 360, ANCHORS[0][1], ANCHORS[0][2]]]);
    let h = d < ANCHORS[0][0] ? d + 360 : d;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (h >= a[0] && h <= b[0]) {
        const t = (h - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
    }
    return [ANCHORS[0][1], ANCHORS[0][2]];
  }
  function hsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, hp = h / 60, x = c * (1 - Math.abs((hp % 2) - 1));
    const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return [r + m, g + m, b + m];
  }
  // The app's palette values, shown as sRGB: softer, like the design (and the same on every screen).
  const p3 = ([r, g, b]) => `rgb(${(r * 255).toFixed(1)} ${(g * 255).toFixed(1)} ${(b * 255).toFixed(1)})`;
  const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

  function folderColor(hue, depth, light) {
    const d = degrees(hue), [s, l] = anchor(d), shift = 0.018 * (Math.min(depth, 6) - 2);
    if (light) return p3(hsl(d, s * 0.72, clamp(0.70 * l - 0.08 + 2.2 * shift, 0.38, 0.62)));
    return p3(hsl(d, s, clamp(l + shift, 0.58, 0.86)));
  }
  const NEUTRAL = {
    smaller: { dark: p3(hex(0x29312F)), light: p3(hex(0xDCDFDD)) },
    smallerDot: { dark: p3(hex(0x6E7673)), light: p3(hex(0xA6AFAB)) },
    file: { dark: p3(hex(0x6E7774)), light: p3(hex(0xA6AFAB)) },
    hidden: { dark: p3(hex(0x7A3C89)), light: p3(hex(0x7A3C89)) },
  };
  function colorOf(node, light) {
    const mode = light ? "light" : "dark";
    if (node.kind === "smaller") return NEUTRAL.smaller[mode];
    if (node.kind === "hidden") return NEUTRAL.hidden[mode];
    if (node.kind === "file") return NEUTRAL.file[mode];
    return folderColor((node.hue[0] + node.hue[1]) / 2, node.depth, light);
  }

  // ---------- A made-up Mac ----------
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const NAMES = ["Library", "Caches", "Developer", "Xcode", "DerivedData", "Application Support", "Containers",
    "Photos Library.photoslibrary", "Projects", "node_modules", "Archive", "Backups", "Mail", "Messages", "Music",
    "Podcasts", "Videos", "Exports", "Footage", "Renders", "Simulators", "Docker", "Steam", "Games", "Assets",
    "Old Mac", "Screenshots", "Recordings", "Sessions", "Logic", "Final Cut", "Samples", "Fonts", "Frameworks",
    "Resources", "Data", "Media", "Images", "Documents", "Downloads", "iOS DeviceSupport", "CoreSimulator",
    "Slack", "Google", "Chrome", "Spotify", "Zoom", "Figma", ".npm", ".gradle", ".cargo", "go", "build", "dist"];

  function grow(node, depth, rand, maxDepth) {
    if (depth >= maxDepth || node.size < 0.05 * GB || node.kind !== "dir") return;
    const count = 2 + Math.floor(rand() * (depth < 3 ? 5 : 4));
    const coverage = 0.72 + rand() * 0.24;
    const weights = Array.from({ length: count }, () => Math.pow(rand(), 1.8) + 0.04).sort((a, b) => b - a);
    const sum = weights.reduce((a, b) => a + b, 0);
    node.children = weights.map((w) => ({
      name: NAMES[Math.floor(rand() * NAMES.length)], size: node.size * coverage * (w / sum), kind: "dir",
    }));
    if (rand() < 0.35) node.children.push({ name: "small items…", size: node.size * (1 - coverage) * 0.5, kind: "smaller" });
    for (const c of node.children) grow(c, depth + 1, rand, maxDepth);
  }

  function demoDisk(seed = 7) {
    const rand = rng(seed);
    const dir = (name, gb, children) => ({ name, size: gb * GB, kind: "dir", children });
    const root = dir("Macintosh HD", 508.7, [
      dir("Users", 377.1, [dir("Movies", 141.6), dir("Library", 92.3), dir("Developer", 58.4), dir("Downloads", 36.1),
        dir("Pictures", 21.7), dir("Music", 9.8), { name: "small items…", size: 7.4 * GB, kind: "smaller" }]),
      dir("System", 49.4), dir("Applications", 42.6), dir("Library", 7.3), dir("private", 7.2), dir("opt", 5),
      { name: "small items…", size: 1.8 * GB, kind: "smaller" },
      { name: "hidden space…", size: 18.2 * GB, kind: "hidden" },
    ]);
    const walk = (n, depth) => {
      if (n.children) n.children.forEach((c) => walk(c, depth + 1));
      else grow(n, depth, rand, depth <= 2 ? 7 : 5);
    };
    walk(root, 0);
    return root;
  }

  // Parents, depths and hue ranges (each folder's children split its hue range by size).
  function annotate(node, parent, hue) {
    node.parent = parent;
    node.hue = hue;
    const kids = node.children || [];
    const total = kids.reduce((a, c) => a + c.size, 0) || 1;
    let at = hue[0];
    for (const c of kids) {
      const span = (hue[1] - hue[0]) * (c.size / total);
      annotate(c, node, [at, at + span]);
      at += span;
    }
  }

  // ---------- Geometry ----------
  const HOLE = 64, RINGS = [58, 44, 36, 30, 25, 20, 16, 13, 10];
  const radii = (depth) => {
    let inner = HOLE + 4;
    for (let i = 0; i < depth - 1; i++) inner += RINGS[i];
    return [inner, inner + RINGS[Math.min(depth - 1, RINGS.length - 1)]];
  };
  const gapFor = (depth) => (depth <= 2 ? 3 : 2.5);
  const cornerFor = (depth) => Math.min(4, RINGS[Math.min(depth - 1, RINGS.length - 1)] / 6);
  const pt = (r, a) => [r * Math.sin(a), -r * Math.cos(a)]; // a: radians clockwise from 12 o'clock

  // A ring segment shrunk by `gap` on every side; side edges stay parallel (like the app's tiles).
  function sector(r0, r1, a0, a1, gap) {
    const h = gap / 2, ri = r0 + h, ro = r1 - h;
    if (ro - ri < 0.5 || ri <= h || ro <= h) return null;
    const ii = Math.asin(Math.min(1, h / ri)), io = Math.asin(Math.min(1, h / ro));
    const s0 = a0 + io, e0 = a1 - io, s1 = a0 + ii, e1 = a1 - ii;
    if (e0 - s0 < 0.002 || e1 - s1 < 0.002) return null;
    const [x0, y0] = pt(ro, s0), [x1, y1] = pt(ro, e0), [x2, y2] = pt(ri, e1), [x3, y3] = pt(ri, s1);
    const lo = e0 - s0 > Math.PI ? 1 : 0, li = e1 - s1 > Math.PI ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${ro} ${ro} 0 ${lo} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}` +
      `L${x2.toFixed(2)} ${y2.toFixed(2)}A${ri} ${ri} 0 ${li} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
  }

  // ---------- Formatting ----------
  // Text is translated on localized pages (window.DG_I18N, from the build) and numbers follow the page language.
  const T = (s, vars) => {
    let out = (window.DG_I18N && window.DG_I18N[s]) || s;
    for (const k in vars || {}) out = out.split(`{${k}}`).join(vars[k]);
    return out;
  };
  const LANG = document.documentElement.lang || "en";
  const nf = (min, max) => new Intl.NumberFormat(LANG, { minimumFractionDigits: min, maximumFractionDigits: max });
  const fmtSize = (bytes) => {
    const gb = bytes / GB;
    if (gb >= 1) return `${nf(gb % 1 ? 1 : 0, 1).format(gb)} ${T("GB")}`;
    return `${nf(1, 1).format(bytes / 1e6)} ${T("MB")}`;
  };
  const fmtPct = (f) => new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: f >= 0.1 ? 0 : 1 }).format(f);

  // ---------- Chart ----------
  // Every node gets fixed coordinates once: x0..x1 (its share of the whole disk, 0…1) and its depth. What's on screen
  // is a *view* — the x-range shown across the sweep and how many levels are scrolled into the center — so zooming is
  // just animating the view, like the app: the folder's slice widens to the full sweep while rings slide inward.
  function partition(node, parent, x0, x1, depth) {
    node.parent = parent; node.x0 = x0; node.x1 = x1; node.depth = depth;
    let at = x0;
    for (const c of node.children || []) {
      const w = (x1 - x0) * (c.size / node.size);
      partition(c, node, at, at + w, depth + 1);
      at += w;
    }
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  // Radii of a (possibly fractional) ring; ring 0 collapses onto the center disc.
  function ringRadii(r) {
    if (r <= 0) return [HOLE + 4, HOLE + 4];
    const lo = Math.floor(r), f = r - lo;
    const a = lo === 0 ? [HOLE + 4, HOLE + 4] : radii(lo), b = radii(lo + 1);
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
  }

  /**
   * Draws a bloom into `host`. options: theme "dark" | "light", start/sweep (degrees, 0 = 12 o'clock), maxDepth,
   * interactive, disc ("summary" | "plain" | "none"), label (name path to pin a label on), crop (tight box around the
   * sweep), cycle (name paths the idle label walks through).
   */
  function Bloom(host, options = {}) {
    const o = Object.assign({ theme: "dark", start: -45, sweep: 270, maxDepth: 7, interactive: false, disc: "none",
      label: null, crop: true, seed: 7, cycle: null }, options);
    const motion = !window.matchMedia || window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    const light = o.theme === "light";
    const root = demoDisk(o.seed);
    partition(root, null, 0, 1, 0);
    annotate(root, null, [0, 1]); // legend colours in the report window
    const all = [];
    (function flat(n) { for (const c of n.children || []) { all.push(c); flat(c); } })(root);
    const used = (root.children || []).reduce((a, c) => a + c.size, 0);
    const toRad = (d) => (d * Math.PI) / 180;
    const A0 = toRad(o.start), SW = toRad(o.sweep);

    let view = { x0: 0, x1: 1, d: 0, z: 0 }; // z: 0 at the top level, 1 inside a folder (colour spread)
    let focus = root, hovered = null, pinned = null, animating = false;
    // Opening animation (0 → 1), like the app's blossom: the sweep grows around the disc while each ring grows
    // outward, inner rings first.
    let grow = motion ? 0 : 1;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    host.classList.add("bloom");
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", T("A disk-space map: rings of folders, each petal as wide as the space it takes."));
    const petals = document.createElementNS(SVGNS, "g");
    const outline = document.createElementNS(SVGNS, "path");
    outline.classList.add("outline");
    outline.style.fill = "none";
    outline.style.stroke = light ? "rgba(20,27,24,.8)" : "rgba(255,255,255,.85)";
    outline.style.strokeLinejoin = "round";
    outline.style.pointerEvents = "none";
    svg.append(outline, petals); // under the petals: just a thin rim around the hovered tile shows
    host.appendChild(svg);
    const label = document.createElement("div");
    label.className = "bloom-label";
    label.innerHTML = "<i></i><span><b></b><small></small></span>";
    host.appendChild(label);
    let disc = null;
    if (o.disc !== "none") {
      disc = document.createElement("div");
      disc.className = "bloom-disc";
      disc.innerHTML = "<b></b><small></small>";
      host.appendChild(disc);
    }

    // A fixed frame: the box never changes, so nothing grows or shifts while zooming.
    const maxR = radii(o.maxDepth)[1] + 4;
    let viewBox = [-maxR, -maxR, 2 * maxR, 2 * maxR];
    if (o.crop) {
      let x0 = -HOLE, y0 = -HOLE, x1 = HOLE, y1 = HOLE;
      for (let i = 0; i <= 64; i++) {
        const [x, y] = pt(maxR, A0 + (SW * i) / 64);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      viewBox = [x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12];
    }
    svg.setAttribute("viewBox", viewBox.map((v) => v.toFixed(1)).join(" "));

    // ----- geometry of a node under the current view -----
    function geom(n) {
      const ring = n.depth - view.d;
      if (ring <= 0.02 || ring > o.maxDepth + 0.98) return null;
      const span = view.x1 - view.x0;
      const a = clamp((n.x0 - view.x0) / span, 0, 1), b = clamp((n.x1 - view.x0) / span, 0, 1);
      if (b - a <= 0) return null;
      const [r0, r1] = ringRadii(ring);
      const arc = (b - a) * SW * (r0 + r1) / 2;
      if (arc < 3) return null;
      // Petals squeezed toward nothing (leaving the view) fade out instead of popping.
      let fade = clamp((arc - 3) / 3, 0, 1);
      // Children of a narrow petal end there (no towers of slivers), like the app.
      const p = n.parent;
      if (p && p !== root && p.depth - view.d >= 1) {
        const pa = clamp((p.x0 - view.x0) / span, 0, 1), pb = clamp((p.x1 - view.x0) / span, 0, 1);
        const [q0, q1] = ringRadii(p.depth - view.d);
        const parc = (pb - pa) * SW * (q0 + q1) / 2;
        if (parc < 9) return null;
        fade = Math.min(fade, clamp((parc - 9) / 4, 0, 1));
      }
      let s0 = A0 + SW * a, e0 = A0 + SW * b, out = r1;
      if (grow < 1) {
        const e = ease(grow);
        s0 = A0 + (s0 - A0) * e; e0 = A0 + (e0 - A0) * e;
        const local = easeOut(clamp((grow - 0.06 * (ring - 1)) / 0.55, 0, 1));
        out = r0 + (r1 - r0) * local;
        fade = Math.min(fade, Math.min(1, local * 1.5));
        if (fade <= 0.01 || out - r0 < 0.5) return null;
      }
      const depthIdx = Math.max(1, Math.round(ring));
      fade = Math.min(fade, ring < 1 ? ring * ring : ring > o.maxDepth ? o.maxDepth + 1 - ring : 1);
      if (fade <= 0.01) return null;
      return { ring, r0, r1: out, s: s0, e: e0, depthIdx, fade };
    }
    function colorFor(n, g) {
      if (n.kind !== "dir") return colorOf(n, light);
      const span = view.x1 - view.x0;
      const hue = clamp(((n.x0 + n.x1) / 2 - view.x0) / span, 0, 1) * (1 - 0.1 * view.z);
      return folderColor(hue, g.depthIdx, light);
    }
    function shape(g) {
      const rc = cornerFor(g.depthIdx);
      let d = rc > 0.3 ? sector(g.r0, g.r1, g.s, g.e, gapFor(g.depthIdx) + 2 * rc) : null;
      if (d) return { d, rc };
      return { d: sector(g.r0, g.r1, g.s, g.e, gapFor(g.depthIdx)), rc: 0 };
    }

    // ----- render: one path per node, reused across frames -----
    const paths = new Map();
    function render() {
      for (const n of all) {
        const g = geom(n);
        let p = paths.get(n);
        if (!g) { if (p) p.style.display = "none"; continue; }
        const { d, rc } = shape(g);
        if (!d) { if (p) p.style.display = "none"; continue; }
        if (!p) {
          p = document.createElementNS(SVGNS, "path");
          p.__node = n;
          p.style.strokeLinejoin = "round";
          // Blossom delay: inner rings first, sweeping around.
          p.style.setProperty("--d", `${((g.ring - 1) * 0.08 + ((g.s - A0) / SW) * 0.42).toFixed(3)}s`);
          paths.set(n, p);
          petals.appendChild(p);
        }
        p.style.display = "";
        p.setAttribute("d", d);
        const c = colorFor(n, g);
        p.style.fill = c;
        p.style.stroke = rc > 0 ? c : "none";
        p.style.strokeWidth = rc > 0 ? 2 * rc : 0;
        p.style.opacity = g.fade < 0.999 ? g.fade.toFixed(3) : "";
        n.__g = g;
      }
      drawOutline();
    }
    function drawOutline() {
      const n = hovered;
      const p = n && paths.get(n);
      if (!n || animating || !p || p.style.display === "none") { outline.style.display = "none"; return; }
      outline.style.display = "";
      outline.setAttribute("d", p.getAttribute("d"));
      outline.style.strokeWidth = (parseFloat(p.style.strokeWidth) || 0) + 3;
    }

    // ----- overlays -----
    function project(x, y) {
      // Layout size, not getBoundingClientRect: mocks are zoomed and the hero tilts in 3D.
      const w = host.clientWidth, h = host.clientHeight, vb = viewBox;
      const s = Math.min(w / vb[2], h / vb[3]);
      return [(w - vb[2] * s) / 2 + (x - vb[0]) * s, (h - vb[3] * s) / 2 + (y - vb[1]) * s, s];
    }
    function layoutOverlays() {
      if (disc) {
        const [x, y, s] = project(0, 0);
        disc.style.left = `${x}px`;
        disc.style.top = `${y}px`;
        disc.style.width = disc.style.height = `${2 * HOLE * s}px`;
        disc.style.fontSize = `${s * 11}px`;
      }
      if (hovered && !animating) placeLabel(hovered);
    }
    function updateDisc() {
      if (!disc) return;
      const [b, small] = disc.children;
      if (focus === root) {
        b.textContent = fmtSize(root.size);
        small.textContent = o.disc === "summary" ? T("of {total} used", { total: fmtSize(994.6 * GB) }) : T("used");
      } else {
        b.textContent = fmtSize(focus.size);
        small.textContent = focus.name;
      }
      disc.classList.toggle("is-zoomed", focus !== root);
    }
    const share = (n) => {
      const vars = { size: fmtSize(n.size), pct: fmtPct(n.size / (focus === root ? used : focus.size)), name: focus.name };
      return focus === root ? T("{size} · {pct} of used", vars) : T("{size} · {pct} of {name}", vars);
    };
    function placeLabel(n) {
      const g = n.__g;
      if (!g || !paths.get(n) || paths.get(n).style.display === "none") { label.classList.remove("is-on"); return; }
      const [x, y] = pt((g.r0 + g.r1) / 2, (g.s + g.e) / 2);
      const [px, py, s] = project(x, y);
      label.style.left = `${px}px`;
      label.style.top = `${py}px`;
      label.style.fontSize = `${Math.max(0.62, Math.min(1, s * 1.05)) * 100}%`;
      const c = colorFor(n, g);
      label.querySelector("i").style.background = c;
      label.style.setProperty("--tint", c);
      label.querySelector("b").textContent = n.kind === "dir" ? n.name : T(n.name);
      label.querySelector("small").textContent = share(n);
      label.classList.add("is-on");
      // Keep the label inside the chart (narrow screens): it's drawn 12% of its width left of the anchor.
      const lw = label.offsetWidth, hw = host.clientWidth;
      if (lw && hw) {
        const x = Math.min(Math.max(px - 0.12 * lw, 4), Math.max(4, hw - lw - 4));
        label.style.left = `${x + 0.12 * lw}px`;
      }
    }
    function setHover(n) {
      hovered = n;
      drawOutline();
      if (n && !animating) placeLabel(n); else label.classList.remove("is-on");
      let top = n;
      while (top && top.parent && top.parent !== root) top = top.parent;
      host.dispatchEvent(new CustomEvent("bloomhover", { bubbles: true, detail: { name: top && top.parent === root ? top.name : null } }));
    }
    function hover(n) {
      if (n === hovered) return;
      setHover(n || (focus === root && pinned && pinned.__g ? pinned : null));
    }

    // ----- zoom: animate the view -----
    let anim = 0;
    function zoom(target) {
      if (!target || target === focus || animating) return;
      const from = { ...view };
      const to = { x0: target === root ? 0 : target.x0, x1: target === root ? 1 : target.x1, d: target.depth, z: target === root ? 0 : 1 };
      focus = target;
      updateDisc();
      hovered = null;
      label.classList.remove("is-on");
      if (!motion) { view = to; render(); return; }
      animating = true;
      host.classList.add("is-zooming");
      const t0 = performance.now(), dur = 700, id = ++anim;
      const step = (now) => {
        if (id !== anim) return;
        const t = ease(Math.min(1, (now - t0) / dur));
        view = { x0: lerp(from.x0, to.x0, t), x1: lerp(from.x1, to.x1, t), d: lerp(from.d, to.d, t), z: lerp(from.z, to.z, t) };
        render();
        if (t < 1) { requestAnimationFrame(step); return; }
        view = to;
        animating = false;
        host.classList.remove("is-zooming");
        render();
        if (focus === root && pinned) hover(pinned);
      };
      requestAnimationFrame(step);
    }

    // ----- blossom on first view -----
    let bloomTimer = null;
    function blossom() {
      if (!motion) return;
      clearTimeout(bloomTimer);
      host.classList.remove("will-bloom", "bloomed");
      host.classList.add("is-blooming");
      animating = true;
      const t0 = performance.now() + 150, dur = 900;
      const frame = (now) => {
        grow = clamp((now - t0) / dur, 0, 1);
        render();
        if (grow < 1) { requestAnimationFrame(frame); return; }
        animating = false;
        host.classList.remove("is-blooming");
        host.classList.add("bloomed");
        if (pinned) setHover(pinned);
      };
      requestAnimationFrame(frame);
    }

    function findPath(names) {
      let n = root;
      for (const name of names) {
        n = (n.children || []).find((c) => c.name === name);
        if (!n) return null;
      }
      return n;
    }

    if (motion) host.classList.add("will-bloom");
    render();
    updateDisc();
    layoutOverlays();
    if (o.label) { pinned = findPath(o.label); if (pinned) hover(pinned); }

    let visible = false, userActive = false, step = 0;
    if ("IntersectionObserver" in window && motion) {
      new IntersectionObserver((entries) => {
        for (const e of entries) {
          visible = e.isIntersecting;
          if (visible && host.classList.contains("will-bloom")) blossom();
        }
      }, { threshold: 0.25 }).observe(host);
    } else {
      host.classList.remove("will-bloom");
      grow = 1; render();
    }
    if (o.cycle && motion) {
      const stops = o.cycle.map((p) => findPath(p.split("/"))).filter(Boolean);
      setInterval(() => {
        if (!visible || userActive || focus !== root || animating || !host.classList.contains("bloomed") || !stops.length) return;
        step = (step + 1) % stops.length;
        pinned = stops[step];
        setHover(pinned);
      }, 2600);
    }

    if (o.interactive) {
      let lastTouch = null;
      svg.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch" || animating) return;
        userActive = true;
        hover(e.target.__node || null);
      });
      svg.addEventListener("pointerleave", () => { userActive = false; if (!animating) hover(null); });
      svg.addEventListener("click", (e) => {
        const n = e.target.__node;
        if (!n || animating) return;
        if (e.pointerType === "touch" && lastTouch !== n) { lastTouch = n; setHover(n); return; }
        lastTouch = null;
        if (n.kind === "dir" && n.children && n.children.length) zoom(n);
      });
      svg.style.cursor = "pointer";
      if (disc) {
        disc.addEventListener("click", () => { if (focus !== root) zoom(focus.parent || root); });
        disc.setAttribute("title", T("Back out"));
      }
    }

    if ("ResizeObserver" in window) new ResizeObserver(() => layoutOverlays()).observe(host);
    return { zoom, root };
  }

  // ---------- The report window (hero, themes) ----------
  const LEGEND = [["Users", 0.74, 377.1, true], ["System", 0.10, 49.4], ["Applications", 0.08, 42.6],
    ["Library", 0.014, 7.3], ["private", 0.014, 7.2], ["opt", 0.01, 5]];

  function sprout(cls = "sprout") {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.37 23.52Q10.32 17.76 11.37 12.00L13.05 12.00Q12.00 17.76 13.05 23.52ZM12.00 12.96Q1.92 12.48 2.34 2.40Q11.16 1.92 12.00 12.96ZM12.42 11.04Q13.26 0.48 21.66 0.48Q22.08 10.56 12.42 11.04Z"/></svg>`;
  }
  const leaf = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4.5 7h15M9.5 7V4.5h5V7m-8 0 .8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L18 7M10 11v5.5M14 11v5.5"/></svg>`;

  function reportWindow(el) {
    const theme = el.dataset.theme || "dark";
    const light = theme === "light";
    const root = demoDisk(7);
    annotate(root, null, [0, 1]);
    root.children.forEach((c) => (c.depth = 1));
    const color = (name) => colorOf(root.children.find((c) => c.name === name), light);
    const capacity = 994.6;
    const bar = root.children.filter((c) => c.kind === "dir").map((c) =>
      `<i style="width:${((c.size / GB / capacity) * 100).toFixed(2)}%;background:${colorOf(c, light)}"></i>`).join("") +
      `<i style="width:${((18.2 / capacity) * 100).toFixed(2)}%;background:${NEUTRAL.hidden.dark}"></i>`;
    const rows = LEGEND.map(([n, p, s, on]) =>
      `<li data-name="${n}"${on ? ' class="on"' : ""}><i style="background:${color(n)}"></i><span>${n}</span><em>${fmtPct(p)}</em><b>${fmtSize(s * GB)}</b></li>`).join("") +
      `<li class="muted"><i style="background:${NEUTRAL.smallerDot[light ? "light" : "dark"]}"></i><span>${T("small items…")}</span><em>${fmtPct(0.004)}</em><b>${fmtSize(1.8 * GB)}</b></li>` +
      `<li class="hidden-space"><i style="background:${NEUTRAL.hidden.dark}"></i><span>${T("hidden space…")}</span><em>${fmtPct(0.036)}</em><b>${fmtSize(18.2 * GB)}</b></li>`;
    el.classList.add("appwin", `appwin--${theme}`);
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `
      <div class="appwin-inner">
        <div class="aw-bar">
          <span class="aw-lights"><i></i><i></i><i></i></span>
          <span class="aw-chip aw-nav"><svg viewBox="0 0 24 24"><path d="M14.5 6 8.5 12l6 6" /></svg><svg viewBox="0 0 24 24" class="dim"><path d="m9.5 6 6 6-6 6" /></svg></span>
          <span class="aw-chip aw-path">${T("Volumes")} <svg viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6" /></svg> <b>${T("Macintosh HD")}</b></span>
          <span class="aw-brand">${sprout()}DiskGarden</span>
          <span class="aw-share"><svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M6 11v7.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V11" /></svg></span>
        </div>
        <div class="aw-legend">
          <div class="aw-head"><b>${T("Macintosh HD")}</b><span>${T("{pct} full", { pct: fmtPct(0.51) })}</span></div>
          <div class="aw-stack">${bar}</div>
          <ul>${rows}</ul>
          <hr>
          <ul class="aw-free"><li><i class="ring"></i><span>${T("Available")}</span><b>${fmtSize(485.9 * GB)}</b></li><li><i class="ring dashed"></i><span>${T("Available (incl. purgeable)")}</span><b>${fmtSize(547.3 * GB)}</b></li></ul>
        </div>
        <div class="aw-compost"><span class="aw-leaf">${leaf}</span><span><b>${T("Waste bin")}</b><small>${T("Drop files here. Nothing is removed until you empty it.")}</small></span></div>
        <div class="aw-chart" data-bloom data-theme="${theme}" data-disc="summary" data-label="Users" data-crop="false"
          data-cycle="${el.dataset.cycle || ""}"></div>
      </div>`;
    // The legend highlights the top-level folder of whatever the chart shows.
    el.addEventListener("bloomhover", (e) => {
      el.querySelectorAll(".aw-legend li[data-name]").forEach((li) => li.classList.toggle("on", li.dataset.name === e.detail.name));
    });
  }

  // Scales a fixed-size mock (its first child) to the width of its frame. The frame reserves the mock's aspect ratio
  // in CSS until then, so nothing below it shifts.
  function fitMocks() {
    document.querySelectorAll("[data-fit]").forEach((frame) => {
      const inner = frame.firstElementChild;
      const base = parseFloat(frame.dataset.fit);
      const apply = () => { inner.style.zoom = String(frame.clientWidth / base); };
      apply();
      if ("ResizeObserver" in window) new ResizeObserver(apply).observe(frame);
    });
  }

  function mountBloom(el) {
    const d = el.dataset;
    Bloom(el, {
      theme: d.theme || "dark",
      interactive: d.interactive === "true",
      disc: d.disc || "none",
      label: d.label ? d.label.split("/") : null,
      crop: d.crop !== "false",
      start: d.start ? parseFloat(d.start) : -45,
      sweep: d.sweep ? parseFloat(d.sweep) : 270,
      cycle: d.cycle ? d.cycle.split(",") : null,
    });
  }
  function mount(el) {
    if (el.hasAttribute("data-report-window")) {
      reportWindow(el);
      el.querySelectorAll("[data-bloom]").forEach(mountBloom);
    } else {
      mountBloom(el);
    }
  }

  // Charts are built only as they approach the viewport: a few hundred SVG paths each, so the page starts light.
  function init() {
    fitMocks();
    const targets = [...document.querySelectorAll("[data-report-window], [data-bloom]")]
      .filter((el) => !el.closest("[data-report-window]") || el.hasAttribute("data-report-window"));
    if (!("IntersectionObserver" in window)) { targets.forEach(mount); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        mount(e.target);
      }
    }, { rootMargin: "600px 0px" });
    targets.forEach((el) => io.observe(el));
  }

  window.DGBloom = { Bloom, sprout };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
