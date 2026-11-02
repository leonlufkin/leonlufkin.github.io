/* Theme (light/dark) + random background + instant navigation.
   Perf design:
   - A tiny inline bootstrap in each page's <head> applies the saved theme
     class and the session's background before first paint.
   - The background is rolled ONCE per session (sessionStorage) and reused
     across pages, so navigation never refetches an image. A new tab, a
     theme flip, or a system-mode change rolls a fresh one.
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

  function pool() {
    return (window.BACKGROUNDS || {})[isDark() ? "dark" : "light"] || [];
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

  function applyPick(p) {
    root.style.setProperty("--bg-image", 'url("' + p.u + '")');
    root.style.setProperty("--sky", p.c);
    if (p.w) root.style.setProperty("--bg-wide", 'url("' + p.w + '")');
    else root.style.removeProperty("--bg-wide");
    // per-image alignment when the widened center is a crop band of the original
    if (p.w && p.s != null) {
      root.style.setProperty("--bg-size", "auto " + p.s + "%");
      root.style.setProperty("--bg-pos", "center " + p.y + "%");
    } else {
      root.style.removeProperty("--bg-size");
      root.style.removeProperty("--bg-pos");
    }
    setLabel(p.l);
  }

  // Reuse the session's background if it matches the current mode and still
  // exists in the manifest; otherwise (or when forced) roll a new one.
  function roll(force) {
    var m = isDark() ? "d" : "l";
    var p = sessionPick();
    var list = pool();
    var valid = p && p.m === m && list.some(function (e) { return e.u === p.u; });
    if (valid && !force) { applyPick(p); return; }
    if (!list.length) return; // no manifest: CSS fallback image stays
    var e = list[Math.floor(Math.random() * list.length)];
    p = { m: m, u: e.u, c: e.c };
    if (e.l) p.l = e.l; // location label
    if (e.w) p.w = e.w; // AI-widened variant for wide windows
    if (e.s != null) { p.s = e.s; p.y = e.y; } // its alignment, if measured
    try { sessionStorage.setItem("bg", JSON.stringify(p)); } catch (err) {}
    applyPick(p);
  }

  function announce() {
    try { window.dispatchEvent(new Event("themechange")); } catch (e) {}
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
  /* --- Photo gallery ------------------------------------------------------
     A grid of every background (light + dark), opened from the nav. Uses the
     small /thumbs/ images with lazy loading, so opening it costs only the
     thumbnails actually scrolled into view. Tapping a photo makes it the
     current background. */

  var galleryBtn = document.createElement("button");
  galleryBtn.className = "theme-toggle gallery-btn";
  galleryBtn.textContent = "▦";
  galleryBtn.setAttribute("aria-label", "Photo gallery");
  var galleryEl = null;

  function thumbUrl(u) {
    return u.replace("/light/", "/thumbs/").replace("/dark/", "/thumbs/");
  }

  function buildGallery() {
    galleryEl = document.createElement("div");
    galleryEl.id = "gallery";
    var close = document.createElement("button");
    close.className = "gallery-close";
    close.innerHTML = "&#10005;";
    close.setAttribute("aria-label", "Close gallery");
    close.onclick = function () { toggleGallery(false); };
    var grid = document.createElement("div");
    grid.className = "gallery-grid";
    ["light", "dark"].forEach(function (mode) {
      ((window.BACKGROUNDS || {})[mode] || []).forEach(function (e) {
        var fig = document.createElement("figure");
        var img = new Image();
        img.loading = "lazy";
        img.decoding = "async";
        img.src = thumbUrl(e.u);
        img.alt = e.l || "";
        fig.appendChild(img);
        if (e.l) {
          var cap = document.createElement("figcaption");
          cap.textContent = e.l;
          fig.appendChild(cap);
        }
        fig.addEventListener("click", function () {
          var p = { m: isDark() ? "d" : "l", u: e.u, c: e.c };
          if (e.l) p.l = e.l;
          if (e.w) p.w = e.w;
          if (e.s != null) { p.s = e.s; p.y = e.y; }
          try { sessionStorage.setItem("bg", JSON.stringify(p)); } catch (err) {}
          applyPick(p);
          toggleGallery(false);
        });
        grid.appendChild(fig);
      });
    });
    galleryEl.appendChild(close);
    galleryEl.appendChild(grid);
    document.body.appendChild(galleryEl);
  }

  function toggleGallery(open) {
    var want = open != null ? open : !root.classList.contains("gallery-open");
    if (want && !galleryEl) buildGallery();
    root.classList.toggle("gallery-open", want);
  }

  galleryBtn.onclick = function () { toggleGallery(); };
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") toggleGallery(false);
  });

  function mount() {
    var nav = document.querySelector("nav");
    if (nav) {
      nav.appendChild(b);
      nav.appendChild(galleryBtn);
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
