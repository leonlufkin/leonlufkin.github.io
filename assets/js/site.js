/* Theme (light/dark) + random background + instant navigation.
   Perf design:
   - A tiny inline bootstrap in each page's <head> applies the saved theme
     class and the session's background before first paint.
   - The background is reused across pages while it fits the viewport.
     Photos are filtered by aspect ratio to minimize the margins.
     Resizing only replaces a photo when it no longer fits the new shape.
   - All three pages are prefetched into memory at idle; clicking a site
     link swaps <header>/<main> in place — no document reload, no progress
     bar, no background repaint. Falls back to normal navigation on error.
   - This file (and backgrounds.js) load deferred: nothing render-blocking. */

(function () {
  var root = document.documentElement;
  var mq = matchMedia("(prefers-color-scheme: dark)");

  /* --- Theme + background ------------------------------------------------ */

  function stored() {
    try { return localStorage.getItem("theme"); } catch (e) { return null; }
  }

  function isDark() {
    var t = stored();
    return t ? t === "dark" : mq.matches;
  }

  function applyTheme() {
    var t = stored();
    root.classList.toggle("dark", t === "dark");
    root.classList.toggle("light", t === "light");
  }

  function viewportRatio() {
    return Math.max(1, innerWidth) / Math.max(1, innerHeight);
  }

  // Always display the full original; edge colors extend into the margins.
  function layout(e) {
    var W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
    var scale = Math.min(W / e.width, H / e.height);
    var width = e.width * scale, height = e.height * scale;
    return { width: width, height: height, left: (W - width) / 2, top: (H - height) / 2 };
  }

  function edgeColor(e) {
    var axis = viewportRatio() >= e.width / e.height ? "sides" : "caps";
    return e.edge && e.edge[axis] || e.c;
  }

  // With contain, this is the fraction of the viewport covered by the photo.
  // Only keep the closest shapes, within two percentage points of the best.
  function fitting(list) {
    var ratio = viewportRatio();
    var scored = list.filter(function (e) {
      return Number.isFinite(e.width) && e.width > 0 &&
        Number.isFinite(e.height) && e.height > 0;
    }).map(function (e) {
      var aspect = e.width / e.height;
      return { entry: e, fit: Math.min(aspect / ratio, ratio / aspect) };
    });
    var best = scored.reduce(function (value, e) { return Math.max(value, e.fit); }, 0);
    var cutoff = best - 0.02;
    return scored.filter(function (e) { return e.fit >= cutoff; })
      .map(function (e) { return e.entry; });
  }

  function all() {
    var catalog = window.BACKGROUNDS || {};
    return (catalog.light || []).concat(catalog.dark || []);
  }

  function device() {
    var touchPhone = matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) <= 620;
    return innerWidth <= 620 || touchPhone ? "mobile" : "laptop";
  }

  var selectedSets = window.BACKGROUND_SELECTIONS || {
    laptop: all().filter(function (e) { return e.width >= e.height; }).map(function (e) { return e.u; }),
    mobile: all().filter(function (e) { return e.width < e.height; }).map(function (e) { return e.u; })
  };
  var previewPick = null;

  function selections() {
    return { laptop: selectedSets.laptop.slice(), mobile: selectedSets.mobile.slice() };
  }

  function galleryPool() {
    var selected = selectedSets[device()];
    return fitting(all().filter(function (e) { return selected.indexOf(e.u) !== -1; }));
  }

  function pool(mode) {
    var candidates = galleryPool();
    var themeEntries = (window.BACKGROUNDS || {})[mode || (isDark() ? "dark" : "light")] || [];
    var themed = candidates.filter(function (e) {
      return themeEntries.some(function (entry) { return entry.u === e.u; });
    });
    // Geometry and the owner's selections take priority over photo brightness.
    return themed.length ? themed : candidates;
  }

  function setSelections(value) {
    var known = all().map(function (e) { return e.u; });
    var valid = ["laptop", "mobile"].every(function (key) {
      return Array.isArray(value[key]) && value[key].length &&
        value[key].every(function (u) { return known.indexOf(u) !== -1; });
    });
    if (!valid) throw new Error("Choose at least one known photo for Laptop and Mobile.");
    selectedSets = { laptop: value.laptop.slice(), mobile: value.mobile.slice() };
    previewPick = null;
    roll(false);
    window.dispatchEvent(new Event("backgroundselectionchange"));
  }

  function sessionPick() {
    try { return JSON.parse(sessionStorage.getItem("bg") || "null"); } catch (e) { return null; }
  }

  // faint bottom-left location label for the current photo
  function setLabel(text) {
    var el = document.getElementById("bg-label");
    if (!el) {
      el = document.createElement("div");
      el.id = "bg-label";
      el.className = "bg-label";
      document.body.appendChild(el);
    }
    el.textContent = text || "";
    el.style.display = text ? "" : "none";
  }

  var rowRequest = 0, rowPhoto = null;
  function validRows(rows) {
    return rows && ["left", "right"].every(function (side) {
      return typeof rows[side] === "string" && rows[side].indexOf("data:image/png;base64,") === 0;
    });
  }
  function showRows(rows) {
    ["left", "right"].forEach(function (side) {
      root.style.setProperty("--bg-rows-" + side, 'url("' + rows[side] + '")');
    });
  }
  function applyRows(p) {
    var request = ++rowRequest;
    var horizontal = !p.layered && viewportRatio() > p.width / p.height;
    root.style.removeProperty("--bg-rows"); // discard the old shared-color profile
    if (!horizontal || rowPhoto !== p.u) {
      root.style.removeProperty("--bg-rows-left");
      root.style.removeProperty("--bg-rows-right");
    }
    rowPhoto = horizontal ? p.u : null;
    if (p.layered) {
      delete p.rows;
      return;
    }
    if (!horizontal || !window.BackgroundRows) return;
    if (validRows(p.rows)) showRows(p.rows);
    window.BackgroundRows.get(p.u).then(function (rows) {
      // An earlier image load must never recolor a newer choice or rotation.
      if (request !== rowRequest || !validRows(rows)) return;
      showRows(rows);
      p.rows = rows;
      try { sessionStorage.setItem("bg", JSON.stringify(p)); } catch (e) {}
    });
  }

  function applyExtension(p) {
    var active = !p.layered && !!p.extension && viewportRatio() > p.width / p.height;
    root.classList.toggle("has-extension", active);
    if (!active) {
      ["--bg-extension", "--extension-width", "--extension-height"]
        .forEach(function (key) { root.style.removeProperty(key); });
      return;
    }
    var layer = document.getElementById("bg-extension");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "bg-extension";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    var height = layout(p).height;
    root.style.setProperty("--bg-extension", 'url("' + p.extension.u + '")');
    root.style.setProperty("--extension-width", height * p.extension.width / p.extension.height + "px");
    root.style.setProperty("--extension-height", height + "px");
  }

  function applyPick(p) {
    root.classList.toggle("has-landscape", !!p.layered);
    root.style.setProperty("--bg-image", 'url("' + p.u + '")');
    root.style.setProperty("--sky", p.c);
    var aspect = p.width / p.height;
    root.style.setProperty("--photo-ratio", String(aspect));
    root.style.setProperty("--photo-inverse", String(1 / aspect));
    applyRows(p);
    applyExtension(p);
    // Clear overrides left by older sessions or the previous preview tool.
    root.classList.remove("has-outpaint");
    var oldLayer = document.getElementById("bg-outpaint");
    if (oldLayer) oldLayer.remove();
    ["--bg-wide", "--bg-size", "--bg-pos", "--bg-outpaint", "--bg-photo-width", "--bg-photo-height", "--bg-outpaint-width", "--bg-outpaint-height"]
      .forEach(function (key) { root.style.removeProperty(key); });
    setLabel((p.l || "") + (p.preview ? " · Preview" : ""));
    window.dispatchEvent(new Event("backgroundchange"));
  }

  function savePick(e, manual, preview) {
    var p = { v: 6, m: isDark() ? "d" : "l", u: e.u, c: edgeColor(e), l: e.l,
      width: e.width, height: e.height, viewport: viewportRatio(), device: device(),
      manual: !!manual, preview: !!preview, layered: !!e.layers };
    if (e.edge) p.edge = e.edge;
    if (e.extension) p.extension = e.extension;
    var previous = sessionPick();
    // The asset changed at the same URL; only reuse samples from this revision.
    if (!p.layered && previous && previous.v === p.v && previous.u === e.u && validRows(previous.rows)) p.rows = previous.rows;
    try { sessionStorage.setItem("bg", JSON.stringify(p)); } catch (err) {}
    applyPick(p);
  }

  function choose(entry) {
    var e = galleryPool().find(function (candidate) { return candidate.u === entry.u; });
    if (!e) return false;
    previewPick = null;
    savePick(e, true);
    return true;
  }

  function preview(entry) {
    var e = all().find(function (candidate) { return candidate.u === entry.u; });
    if (!e) return false;
    previewPick = e;
    savePick(e, true, true);
    return true;
  }

  // Refresh cached metadata from the manifest, and keep a manual gallery
  // choice across navigation even when it belongs to the other theme.
  function roll(force) {
    if (force) previewPick = null;
    if (previewPick) { savePick(previewPick, true, true); return; }
    var m = isDark() ? "d" : "l";
    var p = sessionPick();
    var list = pool();
    var candidates = p && p.manual ? galleryPool() : list;
    var valid = p && !p.preview && p.m === m && candidates.find(function (e) { return e.u === p.u; });
    if (valid && !force) { savePick(valid, p.manual); return; }
    if (!list.length) return; // no manifest: CSS fallback image stays
    var e = list[Math.floor(Math.random() * list.length)];
    savePick(e, false);
  }

  // Shared by the gallery and the temporary style preview's image control.
  window.SiteBackgrounds = { pool: pool, galleryPool: galleryPool, all: all,
    choose: choose, preview: preview, roll: roll, current: sessionPick,
    device: device, selections: selections, setSelections: setSelections, layout: layout };

  function announce() {
    try { window.dispatchEvent(new Event("themechange")); } catch (e) {}
  }

  // A review link opens one photo without modifying either curated set.
  var focusPhoto = /(?:^|[?&])photo=([a-z0-9_-]+)(?:&|$)/.exec(location.search || "");
  if (focusPhoto) {
    previewPick = all().find(function (e) {
      return e.u.split("/").pop().replace(/\.[^.]+$/, "") === focusPhoto[1];
    }) || null;
  }
  applyTheme();
  roll(false);

  // Toggle button, mounted at the end of the nav row. Instant navigation
  // replaces the nav, so it gets re-mounted on every page swap.
  var b = document.createElement("button");
  b.className = "theme-toggle";
  function label() {
    b.textContent = isDark() ? "☀" : "☾"; // shows the mode you'd switch TO
    b.setAttribute("aria-label", isDark() ? "Switch to light mode" : "Switch to dark mode");
  }
  b.onclick = function () {
    try { localStorage.setItem("theme", isDark() ? "light" : "dark"); } catch (e) {}
    applyTheme();
    roll(true);
    label();
    announce();
  };
  // Gallery UI and its independent Laptop/Mobile editor live in gallery.js.
  var geometryTimer;
  window.addEventListener("resize", function () {
    clearTimeout(geometryTimer);
    geometryTimer = setTimeout(function () {
      roll(false);
      window.dispatchEvent(new Event("backgroundgeometrychange"));
    }, 200);
  });

  function mount() {
    var nav = document.querySelector("nav");
    if (nav) {
      nav.appendChild(b);
    }
  }
  label();
  mount();
  window.addEventListener("pageswap", mount);

  if (mq.addEventListener) {
    mq.addEventListener("change", function () {
      if (!stored()) { // auto mode follows the system as it flips
        roll(false); // mode changed, so the session pick is invalid → re-rolls
        label();
        announce();
      }
    });
  }

  /* --- Instant navigation ------------------------------------------------ */

  var PAGES = ["index.html", "research.html", "cv.html"];
  var pageCache = {};

  function norm(path) {
    return path.replace(/\/index\.html$/, "/");
  }

  // Returns the normalized site path for a link we handle, else null.
  function pagePath(a) {
    if (a.origin !== location.origin || a.target || a.hasAttribute("download")) return null;
    var p = norm(a.pathname);
    return (p === "/" || p === "/research.html" || p === "/cv.html") ? p : null;
  }

  function prefetchPages() {
    PAGES.forEach(function (u) {
      var p = norm(new URL(u, location.href).pathname);
      if (pageCache[p]) return;
      fetch(u)
        .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function (t) { pageCache[p] = t; })
        .catch(function () {});
    });
  }

  // The prefetch cache is frozen at first fetch, so a page edited on disk
  // (local preview) would never be picked up while the tab stays open.
  // Revalidate it in the background whenever the tab becomes visible again;
  // swaps keep using the cached copy until the fresh one has landed.
  function revalidatePages() {
    PAGES.forEach(function (u) {
      var p = norm(new URL(u, location.href).pathname);
      fetch(u, { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function (t) { pageCache[p] = t; })
        .catch(function () {});
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) revalidatePages();
  });
  window.addEventListener("focus", revalidatePages);

  function render(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    document.title = doc.title;
    document.body.className = doc.body.className;
    var oldHeader = document.querySelector("body > header");
    var oldMain = document.querySelector("body > main");
    if (oldHeader) oldHeader.remove();
    if (oldMain) oldMain.remove();
    var frag = document.createDocumentFragment();
    var newHeader = doc.querySelector("body > header");
    var newMain = doc.querySelector("body > main");
    if (newHeader) frag.appendChild(newHeader);
    if (newMain) frag.appendChild(newMain);
    document.body.insertBefore(frag, document.body.firstChild);
    try { window.dispatchEvent(new Event("pageswap")); } catch (e) {}
  }

  // If the site is password-gated, fetched pages are encrypted; decrypt them
  // (the key is cached after unlock). Plaintext pages pass through.
  function prepare(text) {
    if (window.SiteGate && window.SiteGate.decryptDoc) return window.SiteGate.decryptDoc(text);
    return Promise.resolve(text);
  }

  function go(path, push) {
    var done = function (html) {
      render(html);
      if (push) history.pushState(null, "", path);
      scrollTo(0, 0);
    };
    var use = function (raw) {
      prepare(raw).then(done).catch(function () { location.href = path; });
    };
    if (pageCache[path]) { use(pageCache[path]); return; }
    fetch(path)
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (t) { pageCache[path] = t; use(t); })
      .catch(function () { location.href = path; }); // graceful fallback
  }

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest("a") : null;
    if (!a) return;
    var p = pagePath(a);
    if (!p) return; // external links, mailto, cmd+click etc. behave normally
    e.preventDefault();
    if (p === norm(location.pathname)) { scrollTo(0, 0); return; }
    go(p, true);
  });

  window.addEventListener("popstate", function () {
    go(norm(location.pathname), false);
  });

  // On pages that offer a typeset PDF (the CV), Cmd/Ctrl+P serves it instead
  // of the browser's print pipeline — printing the PDF itself can never pick
  // up the browser's URL/date header-footer stamps.
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey &&
        (e.key === "p" || e.key === "P")) {
      var pdf = document.querySelector("a.pdf-link");
      if (pdf) {
        e.preventDefault();
        location.href = pdf.getAttribute("href");
      }
    }
  });

  if ("requestIdleCallback" in window) {
    requestIdleCallback(prefetchPages, { timeout: 2000 });
  } else {
    setTimeout(prefetchPages, 300);
  }
})();
