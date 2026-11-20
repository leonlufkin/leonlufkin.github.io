/* Theme, the text-box toggle, e-mail links and instant navigation.
   Perf design:
   - Each page's inline bootstrap (window.SiteBackground) applies the theme and
     its background before first paint; this file re-runs it only when the
     theme or the window's shape changes.
   - The background follows the theme alone — the layered Monterey Bay scene in
     light mode, the moon in dark mode — and never the page in front of it.
   - All three pages are prefetched into memory at idle; clicking a site link
     swaps <header>/<main> in place — no document reload, no progress bar, no
     background repaint. Falls back to normal navigation on error.
   - After a first visit the whole site is on the device: sw.js answers from a
     cache and refreshes it in the background, so no tap and no later visit
     waits on the connection.
   - This file loads deferred: nothing render-blocking. */

(function () {
  var root = document.documentElement;
  var background = window.SiteBackground;
  var mq = matchMedia("(prefers-color-scheme: dark)");
  // The local preview is where pages are edited: nothing may be served stale there.
  var local = ["localhost", "127.0.0.1", "[::1]"].indexOf(location.hostname) !== -1;

  function emit(type) {
    try { window.dispatchEvent(new Event(type)); } catch (e) {}
  }

  function stored() {
    try { var t = localStorage.getItem("theme"); return t === "light" || t === "dark" ? t : null; }
    catch (e) { return null; }
  }

  /* --- Theme ------------------------------------------------------------- */

  var themeButton;

  function label() {
    if (themeButton) {
      themeButton.setAttribute("aria-label", background.dark() ? "Switch to light mode" : "Switch to dark mode");
    }
  }

  function refreshTheme() {
    background.apply();
    label();
    setContentHidden(false); // a theme switch brings the text back, like a new page
    emit("themechange");
  }

  function toggleTheme() {
    try { localStorage.setItem("theme", background.dark() ? "light" : "dark"); } catch (e) {}
    refreshTheme();
  }

  if (mq.addEventListener) {
    mq.addEventListener("change", function () {
      if (!stored()) refreshTheme(); // auto mode follows the system as it flips
    });
  }

  // Unadvertised keys: D switches the theme, as on many sites, and Esc hides the
  // page's text box. Never while typing, with a modifier, or on key repeat.
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    var target = e.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.key === "d" || e.key === "D") toggleTheme();
    else if (e.key === "Escape") toggleContent();
  });

  // The fill color and the photo's feathered edge follow the window's shape.
  var shapeFrame = 0;
  window.addEventListener("resize", function () {
    if (shapeFrame) return;
    shapeFrame = requestAnimationFrame(function () {
      shapeFrame = 0;
      background.apply();
    });
  });

  /* --- Text-box toggle ---------------------------------------------------
     Esc hides the page's text box (the bio on the home page), so the skydiver
     or the moon behind it shows whole. Esc again, switching the theme or
     opening another page brings the text back. */

  function setContentHidden(hidden) {
    root.classList.toggle("content-hidden", hidden);
  }

  function toggleContent() {
    setContentHidden(!root.classList.contains("content-hidden"));
  }

  /* --- E-mail addresses --------------------------------------------------
     The markup carries each address base64-encoded, beside a reversed "@"-less
     fallback for readers without scripts: no address and no mailto: link for a
     harvester to find in the HTML. Decode them into real text and links here. */

  function showEmails() {
    var nodes = document.querySelectorAll("[data-email]");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i], address;
      try { address = atob(node.getAttribute("data-email")); } catch (e) { continue; }
      node.textContent = address;
      node.classList.remove("email-rev");
      node.removeAttribute("data-email");
      if (node.tagName === "A") node.setAttribute("href", "mailto:" + address);
    }
  }

  /* --- Page controls and content: initial markup, then every page swap --- */

  function mount() {
    var nav = document.querySelector("nav");
    themeButton = nav && nav.querySelector(".theme-toggle");
    if (themeButton) themeButton.onclick = toggleTheme;
    label();
    setContentHidden(false); // a newly shown page always arrives with its text
    showEmails();
  }
  mount();
  window.addEventListener("pageswap", mount);

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

  function loadPages(options) {
    PAGES.forEach(function (u) {
      var p = norm(new URL(u, location.href).pathname);
      if (!options && pageCache[p]) return;
      fetch(u, options)
        .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function (t) { pageCache[p] = t; warmPage(p); })
        .catch(function () {});
    });
  }

  // Local preview only: the prefetch cache is frozen at first fetch, so a page
  // edited on disk would never be picked up while the tab stays open.
  // Revalidate it whenever the tab becomes visible again; swaps keep using the
  // cached copy until the fresh one has landed.
  if (local) {
    var revalidatePages = function () { loadPages({ cache: "no-cache" }); };
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) revalidatePages();
    });
    window.addEventListener("focus", revalidatePages);
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
    emit("pageswap");
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

  function whenIdle(task, timeout) {
    if ("requestIdleCallback" in window) requestIdleCallback(task, { timeout: timeout });
    else setTimeout(task, 300);
  }

  // Fetch the other pages at idle, so a first click swaps without the network.
  whenIdle(function () { loadPages(); }, 2000);

  /* --- The whole site on the device --------------------------------------
     sw.js answers every request from a cache on the device and refreshes that
     cache in the background. A first visit still has to fetch what it shows;
     after it, nothing waits on the connection — not a tap, not the next visit.
     Not in the local preview, where an edit must show at once. */

  var offline = "serviceWorker" in navigator && !local;
  var interacted = false, settled = false, warmed = {};
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (type) {
    window.addEventListener(type, function () { interacted = true; }, { capture: true, passive: true });
  });

  // Reload at most once in a while, whatever the server keeps sending.
  function reloadOnce() {
    try {
      if (Date.now() - (+sessionStorage.getItem("reloaded") || 0) < 15000) return;
      sessionStorage.setItem("reloaded", String(Date.now()));
    } catch (e) { return; }
    location.reload();
  }

  if (offline) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
    // A page that was just served from the cache has changed on the server.
    navigator.serviceWorker.addEventListener("message", function (e) {
      var data = e.data || {};
      if (data.type !== "page-updated") return;
      var path = norm(data.path);
      delete pageCache[path];
      loadPages(); // later swaps get the new copy
      // The page on screen: show the new one, unless the visitor is already using this one.
      if (path === norm(location.pathname) && !interacted) reloadOnce();
    });
  }

  function saving() {
    return navigator.connection && navigator.connection.saveData;
  }

  // Hand the worker every address this visit has fetched, and the rest of the
  // site; it stores the ones it lacks. This is what puts a first visit on the
  // device: it loads before the worker is in control, and not every later
  // fetch reaches the worker (WebKit keeps font loads from a page it took over).
  function store() {
    if (!offline) return;
    navigator.serviceWorker.ready.then(function (registration) {
      if (!registration.active) return;
      var used = performance.getEntriesByType("resource").map(function (entry) { return entry.name; });
      registration.active.postMessage({ type: "store", urls: ["/", location.pathname].concat(
        PAGES.map(function (page) { return "/" + page; }), saving() ? [] : background.layers(background.density()), used) });
    }).catch(function () {});
  }

  // Fetch what another page shows, so swapping to it needs no network. Only
  // once this page has everything it shows itself.
  // - Pictures: each is rebuilt as a detached <picture> in this document,
  //   sources first and the image's own address last, so the browser fetches
  //   the one candidate it would pick on that page.
  // - Type: a page with accented names needs the font file for that range.
  function warmPage(path) {
    if (!settled || warmed[path] || !pageCache[path] || saving()) return;
    var kept = warmed[path] = [];
    prepare(pageCache[path]).then(function (html) {
      var page = new DOMParser().parseFromString(html, "text/html"), images = page.querySelectorAll("img"), fetched = [];
      if (document.fonts && document.fonts.load && page.body) {
        fetched.push(document.fonts.load('1em "Latin Modern Roman"', page.body.textContent).catch(function () {}));
      }
      for (var i = 0; i < images.length; i++) {
        var frame = images[i].closest("picture"), sources = frame ? frame.querySelectorAll("source") : [];
        var picture = document.createElement("picture"), image = document.createElement("img");
        fetched.push(new Promise(function (done) { image.onload = image.onerror = done; }));
        for (var j = 0; j < sources.length; j++) picture.appendChild(document.importNode(sources[j], true));
        picture.appendChild(image);
        for (var k = 0, names = ["sizes", "srcset", "src"]; k < names.length; k++) {
          if (images[i].hasAttribute(names[k])) image.setAttribute(names[k], images[i].getAttribute(names[k]));
        }
        kept.push(picture);
      }
      if (fetched.length) return Promise.all(fetched).then(store);
    }).catch(function () {});
  }

  // Fetch what the rest of the site shows: the other theme's background, the
  // other pages' pictures and type.
  function warmSite() {
    settled = true;
    if (!saving() && !background.dark()) {
      var moon = new Image();
      moon.onload = store;
      moon.src = background.photo;
    }
    Object.keys(pageCache).forEach(warmPage);
    store();
  }

  // Start once the page has loaded everything it shows now and, on a first
  // visit, once the worker is in control: what is fetched from then on lands
  // in its cache. A worker that never takes over must not hold this back.
  function settle() {
    var begun = false;
    function begin() {
      if (begun) return;
      begun = true;
      whenIdle(warmSite, 4000);
    }
    if (!offline || navigator.serviceWorker.controller) { begin(); return; }
    navigator.serviceWorker.addEventListener("controllerchange", begin);
    setTimeout(begin, 5000);
  }
  if (document.readyState === "complete") settle();
  else window.addEventListener("load", settle, { once: true });
})();
