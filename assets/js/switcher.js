/* TEMPORARY style-preview tool — not part of the final site.
   A panel of ‹ › cyclers for font, size, border, corners, background photo
   strength, theme, accent color, and text alignment. Settings persist in
   localStorage so they follow you across pages.
   Delete this file and the <script> tags that load it once decided. */

(function () {
  var root = document.documentElement;
  var mqDark = matchMedia("(prefers-color-scheme: dark)");

  var FONTS = [
    ["Latin Modern", '"Latin Modern Roman", Georgia, serif'],
    // Classic serifs
    ["Times New Roman", '"Times New Roman", Times, serif'],
    ["Georgia", "Georgia, serif"],
    ["Palatino", '"Palatino Linotype", Palatino, "Book Antiqua", serif'],
    ["Baskerville", 'Baskerville, "Baskerville Old Face", serif'],
    ["Hoefler Text", '"Hoefler Text", "Times New Roman", serif'],
    ["Didot", 'Didot, "Bodoni MT", serif'],
    ["Charter", 'Charter, "Bitstream Charter", "Times New Roman", serif'],
    ["Iowan Old Style", '"Iowan Old Style", Palatino, serif'],
    ["Athelas", 'Athelas, Georgia, serif'],
    ["Big Caslon", '"Big Caslon", "Book Antiqua", serif'],
    ["Cochin", 'Cochin, Georgia, serif'],
    ["Superclarendon", 'Superclarendon, "Bookman Old Style", serif'],
    // Typewriter / monospace
    ["American Typewriter", '"American Typewriter", "Courier New", serif'],
    ["Courier New", '"Courier New", Courier, monospace'],
    ["Courier", 'Courier, "Courier New", monospace'],
    ["Menlo", 'Menlo, Consolas, monospace'],
    ["Monaco", 'Monaco, Consolas, monospace'],
    // Sans, for comparison
    ["Helvetica Neue", '"Helvetica Neue", Helvetica, Arial, sans-serif'],
    ["Optima", 'Optima, Candara, sans-serif'],
    ["Gill Sans", '"Gill Sans", "Gill Sans MT", sans-serif'],
    ["Futura", 'Futura, "Trebuchet MS", sans-serif'],
    ["Avenir Next", '"Avenir Next", Avenir, "Segoe UI", sans-serif'],
  ];

  var SIZES = ["15px", "16px", "17px", "18px", "19px", "20px", "21px"];

  // Border line and box fill are independent switches.
  var LINES = [
    ["Site default", null], // baked-in default (no line)
    ["Off", { border: "none" }],
    ["Hairline", { border: "1px solid var(--text)" }],
    ["Double", { border: "4px double var(--text)" }],
    ["Heavy double", { border: "7px double var(--text)" }],
    ["Bold", { border: "2px solid var(--text)" }],
    ["Heavy", { border: "4px solid var(--text)" }],
    ["Dashed", { border: "1px dashed var(--text)" }],
    ["Dotted", { border: "2px dotted var(--text)" }],
    ["Groove", { border: "5px groove var(--muted)" }],
    ["Ridge", { border: "5px ridge var(--muted)" }],
    ["Frame", { border: "1px solid var(--text)", outline: "1px solid var(--text)", outlineOffset: "5px" }],
    ["Shadow", { boxShadow: "0 0 0 1px var(--line), 0 16px 44px rgba(0,0,0,.28)" }],
  ];

  // Fill defines the SHAPE/transition; the Color row picks what color feeds
  // it ("COL" placeholder = page background or the sampled blend color).
  // Fill shapes. Clouds are the baked-in blurred backdrop plate, tuned via
  // CSS vars (reach = extension beyond the box, blur = softness) — a single
  // gaussian surface, so the fade has no seams. Mist replaces the plate
  // with an elliptical gradient on the box itself.
  var FILLS = [
    ["Site default", null], // baked solid + hairline
    ["Solid", { vars: { "--cloud-display": "none" } }],
    ["Cloud M", { vars: { "--cloud-display": "block", "--cloud-reach": "26px", "--cloud-blur": "26px" } }],
    ["Cloud L", { vars: { "--cloud-display": "block", "--cloud-reach": "44px", "--cloud-blur": "40px" } }],
    ["Cloud XL", { vars: { "--cloud-display": "block", "--cloud-reach": "72px", "--cloud-blur": "62px" } }],
    ["Mist", { vars: { "--cloud-display": "none" }, styles: { background: "radial-gradient(ellipse 140% 150% at center, COL 40%, transparent 75%)", padding: "3rem 3.5rem" } }],
    ["Mist XL", { vars: { "--cloud-display": "none" }, styles: { background: "radial-gradient(ellipse 170% 190% at center, COL 30%, transparent 80%)", padding: "4rem 5rem" } }],
  ];

  var COLORS = [
    ["Page", null],
    ["Blend", "sampled"], // average photo color behind the box
  ];

  var OPACS = [
    ["100%", 1], ["90%", 0.9], ["80%", 0.8], ["70%", 0.7],
    ["60%", 0.6], ["50%", 0.5], ["35%", 0.35], ["0%", 0],
  ];

  var CORNERS = [
    ["Square", "0"],
    ["Soft", "8px"],
    ["Round", "18px"],
  ];

  // Background image row: built dynamically from the manifest (backgrounds.js)
  // for the effective theme. Index 0 = whatever the random pick loaded.
  function bgList() {
    var mode = effectiveDark() ? "dark" : "light";
    var pool = (window.BACKGROUNDS || {})[mode] || [];
    return [["Random", null]].concat(pool.map(function (e) {
      return [e.u.split("/").pop().replace(/\.jpg$/, ""), e];
    }));
  }

  var ROWS = [
    { key: "f", label: "Font", list: FONTS },
    { key: "z", label: "Size", list: SIZES.map(function (s) { return [s]; }) },
    { key: "l", label: "Line", list: LINES },
    { key: "k", label: "Fill", list: FILLS },
    { key: "n", label: "Color", list: COLORS },
    { key: "o", label: "Opacity", list: OPACS },
    { key: "c", label: "Corners", list: CORNERS },
    { key: "i", label: "Image", list: bgList },
  ];

  function rowList(r) {
    return typeof r.list === "function" ? r.list() : r.list;
  }

  // Defaults mirror the styles baked into style.css (Georgia; hairline boxes
  // are baked in, so "Site default" applies no inline override).
  // Theme is handled by the site's real toggle (site.js), not the picker.
  var DEFAULTS = { f: 0, z: 1, l: 0, k: 0, n: 0, o: 0, c: 0, i: 0, min: 0 };
  var s;
  // v5 key: ignore state saved before Line/Fill/Color became independent rows
  try { s = JSON.parse(localStorage.getItem("stylePreview-v9")) || {}; } catch (e) { s = {}; }
  for (var k in DEFAULTS) { if (typeof s[k] !== "number") s[k] = DEFAULTS[k]; }

  var css = document.createElement("style");
  css.textContent =
    "#style-switcher{position:fixed;right:14px;bottom:14px;z-index:999;" +
    "background:var(--bg);border:1px solid var(--line);border-radius:6px;" +
    "padding:8px 12px 10px;font:13px/1.7 -apple-system,system-ui,sans-serif;" +
    "color:var(--text);box-shadow:0 2px 14px rgba(0,0,0,.2);user-select:none}" +
    "#style-switcher .hd{display:flex;align-items:center;justify-content:space-between;" +
    "gap:10px;margin-bottom:4px;font-weight:600}" +
    "#style-switcher .hd .btns{display:flex;gap:6px}" +
    "#style-switcher .hd button{width:auto;padding:0 8px;font-size:11px}" +
    "#style-switcher .row{display:flex;align-items:center;gap:6px}" +
    "#style-switcher .lab{color:var(--muted);width:52px;flex-shrink:0}" +
    "#style-switcher .val{width:168px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#style-switcher .val small{color:var(--muted);font-size:10px}" +
    "#style-switcher button{cursor:pointer;height:22px;min-width:22px;line-height:1;" +
    "border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--text)}" +
    "#style-switcher button:hover{border-color:var(--muted)}" +
    "#style-switcher.sw-min .row{display:none}" +
    "#style-switcher.sw-min{padding:6px 10px}" +
    "#style-switcher.sw-min .hd{margin:0}";
  document.head.appendChild(css);

  var panel = document.createElement("div");
  panel.id = "style-switcher";
  var html =
    '<div class="hd"><span>Style preview</span><span class="btns">' +
    '<button id="sw-reset" title="Back to defaults">reset</button>' +
    '<button id="sw-min" title="Collapse">&ndash;</button></span></div>';
  ROWS.forEach(function (r) {
    html +=
      '<div class="row"><span class="lab">' + r.label + "</span>" +
      '<button data-k="' + r.key + '" data-d="-1" aria-label="previous ' + r.label + '">&lsaquo;</button>' +
      '<span class="val" id="sw-v-' + r.key + '"></span>' +
      '<button data-k="' + r.key + '" data-d="1" aria-label="next ' + r.label + '">&rsaquo;</button></div>';
  });
  panel.innerHTML = html;
  document.body.appendChild(panel);

  function target() {
    return document.querySelector(".intro") || document.querySelector("main");
  }

  function setLbl(text) {
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

  // Average the photo pixels behind the box, composite the wash over them,
  // and expose the result as --sampled-bg for the "Blend" border styles.
  var lastSampleKey = null;
  function sampleBehindBox(t) {
    var cs = getComputedStyle(root);
    var bgi = (root.style.getPropertyValue("--bg-image") || "").trim();
    var url = bgi ? bgi.slice(bgi.indexOf('("') + 2, bgi.lastIndexOf('")'))
                  : "/assets/images/background-web.jpg";
    var r = t.getBoundingClientRect();
    var key = [url, Math.round(r.left), Math.round(r.top), Math.round(r.width),
               Math.round(r.height), innerWidth, innerHeight,
               root.style.getPropertyValue("--bg-size"),
               cs.getPropertyValue("--wash")].join("|");
    if (key === lastSampleKey) return;

    var img = new Image();
    img.onload = function () {
      var W = innerWidth, H = innerHeight, dispW, dispH, left, top;
      var sizeOv = (root.style.getPropertyValue("--bg-size") || "").trim();
      if (sizeOv) { // "auto S%" per-image alignment override
        dispH = H * (parseFloat(sizeOv.replace(/[^\d.]/g, "")) || 100) / 100;
        dispW = dispH * img.naturalWidth / img.naturalHeight;
      } else { // contain
        var sc = Math.min(W / img.naturalWidth, H / img.naturalHeight);
        dispW = img.naturalWidth * sc; dispH = img.naturalHeight * sc;
      }
      left = (W - dispW) / 2;
      var posOv = (root.style.getPropertyValue("--bg-pos") || "").trim();
      top = posOv ? (H - dispH) * ((parseFloat(posOv.split(/\s+/).pop()) || 50) / 100)
                  : (H - dispH) / 2;

      var x0 = Math.max(r.left, left), x1 = Math.min(r.right, left + dispW);
      var y0 = Math.max(r.top, top), y1 = Math.min(r.bottom, top + dispH);
      var avg = null;
      if (x1 - x0 > 4 && y1 - y0 > 4) {
        try {
          var scX = img.naturalWidth / dispW, scY = img.naturalHeight / dispH;
          var c = document.createElement("canvas"); c.width = 32; c.height = 32;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, (x0 - left) * scX, (y0 - top) * scY,
                        (x1 - x0) * scX, (y1 - y0) * scY, 0, 0, 32, 32);
          var d = ctx.getImageData(0, 0, 32, 32).data;
          var R = 0, G = 0, B = 0, n = d.length / 4;
          for (var i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
          avg = [R / n, G / n, B / n];
        } catch (e) { avg = null; }
      }
      if (!avg) { // box sits over the side fill, not the photo
        var sky = (cs.getPropertyValue("--sky") || "#8aa3c9").trim().replace("#", "");
        if (sky.length === 3) sky = sky.replace(/./g, "$&$&");
        avg = [parseInt(sky.slice(0, 2), 16), parseInt(sky.slice(2, 4), 16), parseInt(sky.slice(4, 6), 16)];
      }
      var m = (cs.getPropertyValue("--wash") || "").match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/);
      if (m) {
        var a = m[4] != null ? parseFloat(m[4]) : 1;
        avg = [+m[1] * a + avg[0] * (1 - a), +m[2] * a + avg[1] * (1 - a), +m[3] * a + avg[2] * (1 - a)];
      }
      root.style.setProperty("--sampled-bg", "#" + avg.map(function (v) {
        return ("0" + Math.round(v).toString(16)).slice(-2);
      }).join(""));
      lastSampleKey = key;
    };
    img.src = url;
  }

  var resizeTimer = null;
  addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (s.n === 1) { var t = target(); if (t) sampleBehindBox(t); }
    }, 150);
  });

  function effectiveDark() {
    if (root.classList.contains("dark")) return true;
    if (root.classList.contains("light")) return false;
    return mqDark.matches;
  }

  function apply() {
    document.body.style.fontFamily = FONTS[s.f][1];
    document.body.style.fontSize = SIZES[s.z];

    var bgs = bgList();
    s.i = s.i % bgs.length;
    if (s.i > 0) { // specific image chosen; index 0 leaves the random pick
      var be = bgs[s.i][1];
      root.style.setProperty("--bg-image", 'url("' + be.u + '")');
      root.style.setProperty("--sky", be.c);
      if (be.w) root.style.setProperty("--bg-wide", 'url("' + be.w + '")');
      else root.style.removeProperty("--bg-wide");
      if (be.w && be.s != null) {
        root.style.setProperty("--bg-size", "auto " + be.s + "%");
        root.style.setProperty("--bg-pos", "center " + be.y + "%");
      } else {
        root.style.removeProperty("--bg-size");
        root.style.removeProperty("--bg-pos");
      }
      setLbl(be.l);
    }

    var t = target();
    if (t) {
      t.style.border = "";
      t.style.outline = "";
      t.style.outlineOffset = "";
      t.style.boxShadow = "";
      t.style.padding = "";
      t.style.background = "";
      t.style.borderRadius = "";
      var line = LINES[s.l][1], fill = FILLS[s.k][1], blend = s.n === 1;
      var alpha = OPACS[s.o][1];
      var col = blend ? "var(--sampled-bg, var(--bg))" : "var(--bg)";
      if (alpha < 1) col = "color-mix(in srgb, " + col + " " + Math.round(alpha * 100) + "%, transparent)";
      // Color/opacity feed the baked backdrop plate via --box-fill;
      // cloud geometry via the reach/blur vars. All orthogonal.
      ["--cloud-reach", "--cloud-blur", "--cloud-radius", "--cloud-display"].forEach(function (v) {
        root.style.removeProperty(v);
      });
      if (blend || alpha < 1) root.style.setProperty("--box-fill", col);
      else root.style.removeProperty("--box-fill");
      if (blend) sampleBehindBox(t);
      if (fill && fill.vars) {
        for (var vk in fill.vars) root.style.setProperty(vk, fill.vars[vk]);
      }
      if (fill && fill.styles) {
        t.style.padding = fill.styles.padding || "";
        for (var fp in fill.styles) {
          if (fp !== "padding") t.style[fp] = String(fill.styles[fp]).split("COL").join(col);
        }
      }
      if (line) {
        for (var lp in line) t.style[lp] = line[lp];
      }
      if (s.c > 0) { // non-square corners apply to the box and the plate
        t.style.borderRadius = CORNERS[s.c][1];
        root.style.setProperty("--cloud-radius", CORNERS[s.c][1]);
      }
    }

    ROWS.forEach(function (r) {
      var list = rowList(r), i = s[r.key] % list.length, n = list.length;
      document.getElementById("sw-v-" + r.key).innerHTML =
        list[i][0] + " <small>" + (i + 1) + "/" + n + "</small>";
    });

    panel.classList.toggle("sw-min", !!s.min);
    document.getElementById("sw-min").innerHTML = s.min ? "+" : "&ndash;";

    localStorage.setItem("stylePreview-v9", JSON.stringify(s));
  }

  panel.addEventListener("click", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-k");
    if (!k) return;
    var row = ROWS.filter(function (r) { return r.key === k; })[0];
    var n = rowList(row).length;
    s[k] = (s[k] + n + +e.target.getAttribute("data-d")) % n;
    if (k === "i" && s.i === 0) { // back to Random: roll a fresh one
      var pool = bgList().slice(1);
      if (pool.length) {
        var pick = pool[Math.floor(Math.random() * pool.length)][1];
        root.style.setProperty("--bg-image", 'url("' + pick.u + '")');
        root.style.setProperty("--sky", pick.c);
        if (pick.w) root.style.setProperty("--bg-wide", 'url("' + pick.w + '")');
        else root.style.removeProperty("--bg-wide");
        if (pick.w && pick.s != null) {
          root.style.setProperty("--bg-size", "auto " + pick.s + "%");
          root.style.setProperty("--bg-pos", "center " + pick.y + "%");
        } else {
          root.style.removeProperty("--bg-size");
          root.style.removeProperty("--bg-pos");
        }
        setLbl(pick.l);
      }
    }
    apply();
  });

  document.getElementById("sw-reset").onclick = function () {
    localStorage.removeItem("stylePreview-v9");
    location.reload();
  };
  document.getElementById("sw-min").onclick = function () {
    s.min = s.min ? 0 : 1;
    apply();
  };

  if (mqDark.addEventListener) mqDark.addEventListener("change", apply);
  window.addEventListener("themechange", apply); // real toggle (site.js) flipped
  window.addEventListener("pageswap", apply); // instant nav replaced <main>

  apply();
})();
