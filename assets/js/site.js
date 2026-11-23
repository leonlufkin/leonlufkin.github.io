/* Everything after the first impression: theme, the text-box toggle, e-mail
   links, instant navigation and keeping the site on the device.
   Perf design:
   - Each page's inline bootstrap (window.SiteBackground) applies the theme and
     its background before first paint, and holds the text back until that
     background is on screen. It fetches this file only once both are showing:
     nothing here competes with the first impression.
   - The background follows the theme alone — the layered Monterey Bay scene in
     light mode, the moon in dark mode — and never the page in front of it.
   - All three pages are prefetched into memory at idle; clicking a site link
     swaps <header>/<main> in place — no document reload, no progress bar, no
     background repaint. Falls back to normal navigation on error.
   - After a first visit the whole site is on the device: sw.js answers from a
     cache and refreshes it in the background, so no tap and no later visit
     waits on the connection. */

(function () {
  var root = document.documentElement;
  var background = window.SiteBackground;
  var mq = matchMedia("(prefers-color-scheme: dark)");
  // A pointer that hovers and a keyboard: where a link can open beside the site, and the PDF inside it.
  var desktop = matchMedia("(hover: hover) and (pointer: fine)");
  // The local preview is where pages are edited: nothing may be served stale there.
  var local = ["localhost", "127.0.0.1", "[::1]"].indexOf(location.hostname) !== -1;

  function emit(type) {
    try { window.dispatchEvent(new Event(type)); } catch (e) {}
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
    if (!background.dark() && background.draw) background.draw(); // the scene's code, if the page opened on the moon
    label();
    setContentHidden(false); // a theme switch brings the text back, like a new page
    emit("themechange");
  }

  // A choice that differs from the system's is kept; one that agrees with it is
  // no choice, and the bootstrap drops it (stored there).
  function toggleTheme() {
    try { localStorage.setItem("theme-override", background.dark() ? "light" : "dark"); } catch (e) {}
    refreshTheme();
  }

  // The system's own switch is followed as it happens. It also ends a choice of
  // the visitor's: the system has come round to it.
  if (mq.addEventListener) mq.addEventListener("change", refreshTheme);

  // Unadvertised keys: D switches the theme, as on many sites, Esc hides the
  // page's text box, and L, R and C open Leon, Research and CV. On Research, S
  // and X open Scholar and X; on the CV, P opens its PDF. Never while typing,
  // with a modifier, on key repeat, or while the PDF is showing.
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || pdfView) return;
    var target = e.target, key = e.key;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (key === "d" || key === "D") toggleTheme();
    else if (key === "Escape") toggleContent();
    else if (key === "l" || key === "L") visit("/");
    else if (key === "r" || key === "R") visit("/research.html");
    else if (key === "c" || key === "C") visit("/cv.html");
    else if (key === "s" || key === "S") leave(profile("Google Scholar"));
    else if (key === "x" || key === "X") leave(profile("X"));
    else if (key === "p" || key === "P") openPdf();
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

  /* --- The same toggle, by touch -----------------------------------------
     A phone has no Esc: there, one tap on the home page's portrait hides the
     text box, and one tap anywhere on the scenery that uncovers brings it
     back. Nothing on the page says so, and nothing else changes: a swipe, a
     pinch, a long press, and a tap on text, on a link or on a button stay the
     browser's, and while the text shows so does a tap on the scenery. */

  // What a tap may land on: the portrait while the text shows, and the scenery
  // once it is hidden, when the portrait is gone with it. The scenery is what
  // paints nothing over the background. Hidden text takes no touches, so it is
  // then everything but the navigation (on the home page <main> only lays out
  // the box and the navigation).
  var PORTRAIT = ".headshot", SCENERY = ":root, body, body > header, body.home > main";
  // A tap is one finger, down and up within this many px and ms: less than any
  // browser takes for a drag or a long press.
  var TAP_SLOP = 8, TAP_MS = 400;
  // A finger this near (px) a link or a button, or wide enough to reach one,
  // was meant for it, and the browser gives it that tap.
  var NEAR = 16;
  var tap = null, scrolledAt = -Infinity;

  function nearControl(touch) {
    var x = touch.clientX, y = touch.clientY, reach = Math.max(NEAR, touch.radiusX || 0, touch.radiusY || 0);
    var controls = document.querySelectorAll("a, button");
    for (var i = 0; i < controls.length; i++) {
      var r = controls[i].getBoundingClientRect();
      if (r.width && x > r.left - reach && x < r.right + reach && y > r.top - reach && y < r.bottom + reach &&
          getComputedStyle(controls[i]).visibility === "visible") return true; // not one hidden with the text
    }
    return false;
  }

  function strayed(touch) {
    var dx = touch.clientX - tap.x, dy = touch.clientY - tap.y;
    return dx * dx + dy * dy > TAP_SLOP * TAP_SLOP;
  }

  window.addEventListener("scroll", function (e) { scrolledAt = e.timeStamp; }, { passive: true });

  document.addEventListener("touchstart", function (e) {
    var touch = e.touches[0], target = e.target, selection = window.getSelection();
    tap = null;
    if (e.touches.length !== 1) return; // a second finger: a pinch
    if (!target.matches || !target.matches(root.classList.contains("content-hidden") ? SCENERY : PORTRAIT)) return;
    if (e.timeStamp - scrolledAt < 100) return; // the page is moving: this touch stops it
    if (selection && !selection.isCollapsed) return; // this touch dismisses a selection
    if (nearControl(touch)) return;
    tap = { x: touch.clientX, y: touch.clientY, at: e.timeStamp };
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (tap && strayed(e.touches[0])) tap = null; // a swipe, even one that ends where it began
  }, { passive: true });

  // The browser took the touch for itself: a scroll, a menu.
  document.addEventListener("touchcancel", function () { tap = null; });

  document.addEventListener("touchend", function (e) {
    var tapped = tap && e.cancelable && e.timeStamp - tap.at < TAP_MS && !strayed(e.changedTouches[0]);
    tap = null;
    if (!tapped) return;
    // The browser's click must not follow: text that comes back could put a link under the finger.
    e.preventDefault();
    toggleContent();
  });

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

  /* --- Hover follows the pointer, not the page ---------------------------
     When a page is swapped in, whatever lands under the finger that tapped, or
     under a resting pointer, would light up as hovered. :root.pointer-still
     switches the hover styles off until the pointer really moves. */

  var pointerX = null, pointerY = null;
  window.addEventListener("mousemove", function (e) {
    // Browsers replay the pointer's position once the page has changed under
    // it: only a new position is a move.
    var moved = pointerX !== null && (pointerX !== e.clientX || pointerY !== e.clientY);
    pointerX = e.clientX; pointerY = e.clientY;
    if (moved) root.classList.remove("pointer-still");
  }, { passive: true });
  window.addEventListener("pageswap", function () { root.classList.add("pointer-still"); });

  /* --- Instant navigation ------------------------------------------------ */

  var PAGES = ["index.html", "research.html", "cv.html"];
  var pageCache = {};
  var showing = norm(location.pathname); // the page whose text is in the document

  function norm(path) {
    return path.replace(/\/index\.html$/, "/");
  }

  // The pages that are swapped in place. Nothing else is ever fetched and
  // rendered: an address is not safe just because the browser is showing it.
  function known(path) {
    return path === "/" || path === "/research.html" || path === "/cv.html";
  }

  // Returns the normalized site path for a link we handle, else null.
  function pagePath(a) {
    if (a.origin !== location.origin || a.target || a.hasAttribute("download")) return null;
    var p = norm(a.pathname);
    return known(p) ? p : null;
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
      showing = path;
      if (push) history.pushState(null, "", path);
      scrollTo(0, 0);
      syncPdf();
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

  // Show a site page in place; the one already showing just returns to its top.
  function visit(path) {
    if (path === norm(location.pathname)) { scrollTo(0, 0); return; }
    go(path, true);
  }

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  /* --- Links elsewhere, from the keyboard -------------------------------- */

  // The page's own icon link to a profile elsewhere (Research has Scholar and X).
  function profile(label) {
    var list = document.querySelector(".page-links"), links = list ? list.querySelectorAll("a") : [];
    for (var i = 0; i < links.length; i++) if (links[i].getAttribute("aria-label") === label) return links[i];
    return null;
  }

  // Beside the site on a desktop, in its place on a phone.
  function leave(link) {
    if (!link) return;
    if (desktop.matches) window.open(link.getAttribute("href"), "_blank", "noopener");
    else location.href = link.getAttribute("href");
  }

  /* --- The typeset PDF, inside the page ----------------------------------
     A browser's own PDF viewer takes the keyboard with it: in a tab filled by
     a PDF, Safari on a Mac may not go back on Cmd+Left. So on a desktop the PDF
     a page offers is shown inside this document, at the page's address with
     #pdf: the page hears every key first, and Back, Cmd+[ and Cmd+Left return
     to it. A phone opens the file itself, which it shows better than it
     embeds one. */

  var PDF = "#pdf", pdfView = null;

  function pdfLink() { return document.querySelector(".pdf-link"); }

  // The address says whether the PDF is showing.
  function syncPdf() {
    var link = location.hash === PDF ? pdfLink() : null;
    if (link && !desktop.matches) { location.replace(link.getAttribute("href")); return; }
    if (!link === !pdfView) return;
    if (pdfView) { pdfView.remove(); pdfView = null; }
    else {
      pdfView = document.createElement("embed");
      pdfView.className = "pdf-view";
      pdfView.setAttribute("type", "application/pdf");
      pdfView.setAttribute("src", link.getAttribute("href"));
      document.body.appendChild(pdfView);
      pdfView.focus(); // its own keys scroll it at once, as in a tab of its own
    }
    root.classList.toggle("pdf-open", !!pdfView);
  }

  function openPdf() {
    var link = pdfLink();
    if (!link) return;
    if (!desktop.matches) { location.href = link.getAttribute("href"); return; }
    history.pushState(null, "", PDF);
    syncPdf();
  }
  syncPdf(); // a page opened, or reloaded, at #pdf

  // While it shows, its viewer may have the keyboard, and a key the viewer
  // takes never reaches the browser: go back here on the Mac's keys for Back.
  document.addEventListener("keydown", function (e) {
    if (pdfView && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "[")) {
      e.preventDefault();
      history.back();
    }
  }, true);

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest("a") : null;
    if (!a) return;
    if (a === pdfLink() && desktop.matches) { e.preventDefault(); openPdf(); return; }
    var p = pagePath(a);
    if (!p) return; // external links, mailto, cmd+click etc. behave normally
    e.preventDefault();
    visit(p);
  });

  // Back and forward can land on any address the site was opened at. The 404
  // page answers for all of them, and a path like "//other.host/" would be
  // fetched from that host and rendered here: only the site's own pages are
  // swapped in, anything else is loaded afresh.
  window.addEventListener("popstate", function () {
    var path = norm(location.pathname);
    if (!known(path)) location.reload();
    else if (path === showing) syncPdf(); // to or from the PDF over the page that is showing
    else go(path, false);
  });

  // On pages that offer a typeset PDF (the CV), Cmd/Ctrl+P serves it instead
  // of the browser's print pipeline — printing the PDF itself can never pick
  // up the browser's URL/date header-footer stamps.
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey &&
        (e.key === "p" || e.key === "P")) {
      var pdf = pdfLink();
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
  var interacted = false, settled = false, warmed = {}, linked = [];
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

  // A page that was just served from the cache has changed on the server.
  function heard(data) {
    if (!data || data.type !== "page-updated") return;
    var path = norm(data.path);
    delete pageCache[path];
    loadPages(); // later swaps get the new copy
    // The page on screen: show the new one, unless the visitor is already using this one.
    if (path === norm(location.pathname) && !interacted) reloadOnce();
  }

  if (offline) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
    navigator.serviceWorker.addEventListener("message", function (e) { heard(e.data); });
    // The worker can report before this file has arrived: the bootstrap kept those.
    (background.early || []).forEach(heard);
  }
  background.early = null;

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
        PAGES.map(function (page) { return "/" + page; }), saving() ? [] : background.layers(background.density()), linked, used) });
    }).catch(function () {});
  }

  // Fetch what another page shows, so swapping to it needs no network. Only
  // once this page has everything it shows itself.
  // - Pictures: each is rebuilt as a detached <picture> in this document,
  //   sources first and the image's own address last, so the browser fetches
  //   the one candidate it would pick on that page.
  // - Type: a page with accented names needs the font file for that range.
  // - The typeset PDF a page offers is fetched ahead by the worker, so the
  //   browser already holds it; opening it stays the browser's own business.
  function warmPage(path) {
    if (!settled || warmed[path] || !pageCache[path] || saving()) return;
    var kept = warmed[path] = [];
    prepare(pageCache[path]).then(function (html) {
      var page = new DOMParser().parseFromString(html, "text/html"), images = page.querySelectorAll("img"), fetched = [];
      var pdfs = page.querySelectorAll("a.pdf-link");
      for (var n = 0; n < pdfs.length; n++) linked.push(new URL(pdfs[n].getAttribute("href"), location.origin + path).href);
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
      return Promise.all(fetched).then(store);
    }).catch(function () {});
  }

  // Fetch what the rest of the site shows: the other theme's background, the
  // other pages' pictures and type.
  function warmSite() {
    settled = true;
    if (!saving()) {
      if (background.dark()) {
        if (background.draw) background.draw(); // the scene's code, which then prepares its layers
      } else {
        var moon = new Image();
        moon.onload = store;
        moon.src = background.photo;
      }
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
