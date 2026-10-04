// Page behaviour: the phone menu, support search and motion. The header, footer and release facts are plain HTML,
// baked in by scripts/build-website.py.
(() => {
  "use strict";
  const header = document.querySelector(".site-header");

  // ---------- Language menu ----------
  // Remembers the choice (so the English pages stop sending this visitor to their browser's language).
  document.querySelectorAll(".lang").forEach((box) => {
    const btn = box.querySelector(".lang-btn");
    const set = (open) => { box.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); set(!box.classList.contains("open")); });
    document.addEventListener("click", (e) => { if (!box.contains(e.target)) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
    box.querySelectorAll("a[data-lang]").forEach((a) => a.addEventListener("click", () => {
      try { localStorage.setItem("dg-lang", a.dataset.lang); } catch (_) { /* private mode */ }
    }));
  });

  // ---------- Phone menu ----------
  if (header) {
    const btn = header.querySelector(".menu-btn"), menu = header.querySelector(".mobile-nav");
    if (btn && menu) {
      btn.addEventListener("click", () => {
        const open = menu.classList.toggle("open");
        btn.setAttribute("aria-expanded", String(open));
      });
      menu.addEventListener("click", (e) => { if (e.target.closest("a")) menu.classList.remove("open"); });
    }
  }

  // ---------- Support search ----------
  function search() {
    const input = document.querySelector("[data-search]");
    if (!input) return;
    const items = [...document.querySelectorAll("[data-searchable]")];
    const empty = document.querySelector(".no-results");
    const run = () => {
      const terms = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      let shown = 0;
      items.forEach((el) => {
        const text = el.textContent.toLowerCase();
        const hit = terms.every((t) => text.includes(t));
        if (hit) { el.removeAttribute("data-search-hidden"); shown++; } else el.setAttribute("data-search-hidden", "");
        if (hit && terms.length && el.tagName === "DETAILS") el.open = true;
      });
      if (empty) empty.style.display = shown ? "none" : "block";
    };
    input.addEventListener("input", run);
  }

  // ---------- Motion ----------
  const motion = !window.matchMedia || window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

  function headerOnScroll() {
    if (!header) return;
    const update = () => header.classList.toggle("scrolled", window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  // Fade and rise elements in as they scroll into view, staggered within their group.
  function reveal() {
    if (!motion || !("IntersectionObserver" in window)) return;
    const groups = [
      ".section h2", ".section .eyebrow", ".section .lead", ".steps li", ".hint", ".features .card", ".split > .mock-frame",
      ".chips span", ".compost-card", ".compost-list li", ".warn-card", ".themes .mock-frame", ".free", ".stat",
      ".qa-row", ".qa-grid .side > *", ".cta", ".trust .pill", ".grid3 > .card", ".h2", ".faq details", ".contact > .card",
      ".help-strip", ".prose section", ".release", ".foot > *", ".sprout.draw",
      ".race", ".unlock", ".disk", ".feat", ".map-chart", ".review", ".cmp",
    ];
    document.querySelectorAll(".cmp-row").forEach((r, i) => r.style.setProperty("--i", String(i)));
    const els = [];
    for (const sel of groups) {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.closest(".hero .wrap, .site-header") || el.classList.contains("reveal")) return;
        // Stagger among siblings matched by the same selector.
        const sibs = [...el.parentElement.children].filter((c) => c.matches(sel));
        el.style.setProperty("--i", String(Math.min(sibs.indexOf(el), 6)));
        el.classList.add("reveal");
        els.push(el);
      });
    }
    // Disk rings start empty and fill when their disk scrolls in.
    const rings = [...document.querySelectorAll("[data-rings] svg.r circle + circle")];
    rings.forEach((c) => { c.dataset.to = c.getAttribute("stroke-dashoffset"); c.setAttribute("stroke-dashoffset", "333"); });
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
        if (e.target.matches(".disk")) {
          const c = e.target.querySelector("svg.r circle + circle");
          if (c) c.setAttribute("stroke-dashoffset", c.dataset.to);
        }
        if (e.target.matches(".race")) raceClocks(e.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    els.forEach((el) => io.observe(el));
  }

  // The race's timers count up with their bars (durations from the bars' --t, after the .3 s start delay).
  const T = (s) => (window.DG_I18N && window.DG_I18N[s]) || s;
  const formatTime = (s) => (s >= 60 ? `${Math.floor(s / 60)} ${T("min")} ${String(Math.round(s % 60))} ${T("s")}` : `${Math.round(s)} ${T("s")}`);
  function raceClocks(race) {
    race.querySelectorAll(".lane").forEach((lane) => {
      const el = lane.querySelector(".time"), to = parseFloat(el.dataset.to);
      const dur = parseFloat(getComputedStyle(lane.querySelector(".fill")).getPropertyValue("--t")) * 1000;
      el.textContent = "0 s";
      const start = performance.now() + 300;
      const tick = (now) => {
        const t = Math.min(1, Math.max(0, (now - start) / dur));
        el.textContent = formatTime(to * t);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // The hero window tips back in perspective and settles flat as it scrolls up.
  function heroTilt() {
    const frame = document.querySelector(".hero-frame");
    if (!frame || !motion) return;
    let queued = false;
    const update = () => {
      queued = false;
      const r = frame.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (r.top - window.innerHeight * 0.18) / (window.innerHeight * 0.55)));
      frame.style.setProperty("--tilt", t.toFixed(3));
    };
    update();
    window.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
  }

  // Scroll-coupled story: each section gets --e (1 → 0 as it arrives) and --x (0 → 1 as it leaves); the page gets
  // --sp (0 → 1 overall progress) and the glow colour of the section in view.
  function storyScroll() {
    const root = document.documentElement;
    const stories = [...document.querySelectorAll(".story")];
    document.querySelectorAll(".points, .flow").forEach((list) => [...list.children].forEach((li, i) => li.style.setProperty("--k", String(i))));
    // Entry/exit effects start with the first real scroll, so the page as loaded (and as audited) is fully legible;
    // sections below the fold aren't visible then anyway.
    let queued = false, glow = "", scrolled = window.scrollY > 0;
    const update = () => {
      queued = false;
      const vh = window.innerHeight, max = Math.max(1, root.scrollHeight - vh);
      root.style.setProperty("--sp", (window.scrollY / max).toFixed(4));
      let best = null, bestDist = Infinity;
      for (const s of stories) {
        const r = s.getBoundingClientRect();
        if (motion && scrolled) {
          const e = Math.min(1, Math.max(0, (r.top - vh * 0.15) / (vh * 0.75)));
          const x = Math.min(1, Math.max(0, (vh * 0.25 - r.bottom) / (vh * 0.6)));
          s.style.setProperty("--e", e.toFixed(3));
          s.style.setProperty("--x", x.toFixed(3));
        }
        const d = Math.abs(r.top + r.height / 2 - vh / 2);
        if (d < bestDist) { bestDist = d; best = s; }
      }
      const g = best && bestDist < vh ? best.dataset.glow : "#1ed660";
      if (g && g !== glow) {
        glow = g;
        root.style.setProperty("--glow", g);
        const i = stories.indexOf(best);
        root.style.setProperty("--glow2", (stories[i + 1] && stories[i + 1].dataset.glow) || "#c56cf0");
      }
    };
    update();
    window.addEventListener("scroll", () => { scrolled = true; if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
  }

  function boot() {
    storyScroll();
    search();
    headerOnScroll();
    reveal();
    heroTilt();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
