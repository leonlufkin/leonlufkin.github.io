/* One composited scene: GPU resizing, with a cached Canvas2D fallback. */
(function () {
  "use strict";
  var root = document.documentElement;
  var stage, fill, images = [], active = null, failed = null, geometry = null;
  var observer, frame = 0, triangleCount = 0, edgePalettes;
  var loaded = null, loadVersion = 0;
  var refineTimer = 0;
  var texture, textureGeometry = null;
  var gpu, gpuCanvas, fallbackLayers = null, fallbackScale = 0;
  var names = ["sky", "coast", "diver"];
  var cloud = null;
  var cloudCopies = [
    { x: 0.24, t: 0.20, scale: 1, opacity: 0.9 },
    { x: 0.74, t: 0.39, scale: 0.72, opacity: 0.75 },
    { x: 0.42, t: 0.61, scale: 0.55, opacity: 0.6 },
    { x: 0.12, scale: 0.8, coast: true, opacity: 0.45 }
  ];

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function sample(values, t) {
    var p = clamp(t, 0, 1) * (values.length - 1), i = Math.floor(p);
    var a = values[i], b = values[Math.min(i + 1, values.length - 1)], f = p - i;
    return Array.isArray(a) ? a.map(function (v, k) { return v + (b[k] - v) * f; }) : a + (b - a) * f;
  }
  function mix(a, b, t) { return a.map(function (v, k) { return v + (b[k] - v) * t; }); }
  function softenEdge(values) {
    return values.map(function (_, i) {
      var sum = [0, 0, 0], weight = 0;
      for (var j = -7; j <= 7; j++) {
        var w = 8 - Math.abs(j), color = values[clamp(i + j, 0, values.length - 1)];
        for (var k = 0; k < 3; k++) sum[k] += color[k] * w;
        weight += w;
      }
      return sum.map(function (v) { return v / weight; });
    });
  }
  function sideBend(x, g, side) {
    var p = active.layers.boundary.sky, n = p.length - 1;
    var slope = side === "left" ? (p[1] - p[0]) * n / active.width : (p[n] - p[n - 1]) * n / active.width;
    var edge = side === "left" ? g.left : g.left + g.width;
    return clamp(slope * (x - edge), -g.H * 0.2, g.H * 0.2);
  }
  function noise(x, y) {
    var n = Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663);
    n = Math.imul(n ^ (n >>> 16), 2246822519);
    return (n >>> 0) / 4294967295 - 0.5;
  }
  function copyCloud(image) {
    var canvas = document.createElement("canvas");
    canvas.width = 750; canvas.height = 58;
    var ctx = canvas.getContext("2d");
    // Copy the photographed thin cloud above the horizon, including its original facet detail.
    ctx.drawImage(image, 430, 44, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data;
    for (var x = 0; x < canvas.width; x++) {
      var top = 0, bottom = 0;
      for (var j = 0; j < 4; j++) {
        top += data[(j * canvas.width + x) * 4];
        bottom += data[((canvas.height - 1 - j) * canvas.width + x) * 4];
      }
      top /= 4; bottom /= 4;
      for (var y = 0; y < canvas.height; y++) {
        var i = (y * canvas.width + x) * 4;
        var blue = top + (bottom - top) * y / (canvas.height - 1);
        // Remove only the blue backdrop; the copied cloud supplies every detail of the matte.
        var alpha = clamp((data[i] - blue - 2) / Math.max(1, 235 - blue), 0, 1);
        alpha *= smooth(Math.min(x, canvas.width - 1 - x) / 24) * smooth(Math.min(y, canvas.height - 1 - y) / 4);
        data[i] = 235; data[i + 1] = 244; data[i + 2] = 250; data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }
  function paintClouds(ctx, g) {
    if (!cloud) return;
    var boundary = active.layers.boundary;
    ctx.save();
    cloudCopies.forEach(function (copy) {
      var sky = sample(boundary.sky, copy.x) * g.scale;
      var coast = sample(boundary.coast, copy.x) * g.scale + g.spare;
      var w = cloud.width * g.scale * copy.scale, h = cloud.height * g.scale * copy.scale;
      var y = copy.coast ? coast - Math.max(6, 18 * g.scale) : sky + (coast - sky) * copy.t;
      ctx.globalAlpha = copy.opacity;
      ctx.drawImage(cloud, g.left + copy.x * g.width - w / 2, y - h / 2, w, h);
    });
    ctx.restore();
  }
  function colorAt(x, y, g) {
    var m = active.layers, u = clamp((x - g.left) / g.width, 0, 1);
    var side = x < g.left ? "left" : x > g.left + g.width ? "right" : null;
    if (side) {
      // Continue the cloud arcs into side margins instead of extruding horizontal stripes.
      var bend = sideBend(x, g, side), mapped = y;
      for (var k = 0; k < 3; k++) {
        var angle = Math.PI * mapped / g.H;
        mapped -= (mapped + bend * Math.sin(angle) - y) / (1 + bend * Math.PI / g.H * Math.cos(angle));
      }
      y = clamp(mapped, 0, g.H);
    }
    var sky = sample(m.boundary.sky, u) * g.scale;
    var coast = sample(m.boundary.coast, u) * g.scale + g.spare;
    if (side && (y <= sky || y >= coast)) {
      var position = (y <= sky ? y : y - g.spare) / g.scale / active.height;
      var distance = side === "left" ? g.left - x : x - g.left - g.width;
      return mix(sample(m.colors[side], position), sample(edgePalettes[side], position),
        smooth(distance / Math.max(24, 64 * g.scale)));
    }
    var gap = Math.max(1, coast - sky), t = clamp((y - sky) / gap, 0, 1);
    var color = mix(sample(m.colors.clearSky, u), sample(m.colors.ocean, u), smooth(t));
    // Match the real edges locally, rather than stretching cloud-white through the gap.
    var reach = Math.min(gap / 3, Math.max(24, 60 * g.scale));
    color = mix(color, sample(m.colors.sky, u), 1 - smooth((y - sky) / reach));
    // Give the lower-left ocean join more room to change color gradually.
    var left = 1 - smooth(u / 0.45);
    var coastReach = reach + left * (Math.min(gap * 0.8, Math.max(96, 300 * g.scale)) - reach);
    return mix(color, sample(m.colors.coast, u), 1 - smooth((coast - y) / coastReach));
  }
  function paintFace(ctx, a, b, c, seed, g) {
    var x = (a[0] + b[0] + c[0]) / 3, y = (a[1] + b[1] + c[1]) / 3;
    var u = (x - g.left) / g.width, v = y / g.H;
    var delta = noise(seed, 29) * 4 + 1.5 * Math.sin(15 * u + 9 * v) + 1.5 * Math.sin(27 * u - 5 * v);
    var color = "rgb(" + colorAt(x, y, g).map(function (v) {
      return Math.round(clamp(v + delta, 0, 255));
    }).join(",") + ")";
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.fill(); ctx.stroke();
    triangleCount++;
  }
  function triangleQuality(a, b, c) {
    var abx = b[0] - a[0], aby = b[1] - a[1], acx = c[0] - a[0], acy = c[1] - a[1];
    var bcx = c[0] - b[0], bcy = c[1] - b[1];
    return (abx * acy - aby * acx) / (abx * abx + aby * aby + acx * acx + acy * acy + bcx * bcx + bcy * bcy);
  }
  function paintMesh(ctx, rect, cell, region, g) {
    var cols = Math.max(1, Math.ceil(rect.w / cell));
    var rows = Math.max(1, Math.ceil(rect.h / (cell * 0.866)));
    function rowAt(j) {
      var row = [];
      for (var i = 0; i <= cols; i++) {
        var u = (i + (i && i < cols ? noise(j, region + 17) * 0.16 + noise(i, j + region * 83) * 0.44 : 0)) / cols;
        var v = (j + (j && j < rows ? noise(j, region + 59) * 0.1 + noise(j, i + region * 97) * 0.5 : 0)) / rows;
        u += 0.01 * Math.sin(6 * Math.PI * u) * Math.sin(Math.PI * u);
        v -= 0.04 * Math.sin(2 * Math.PI * v);
        var x = rect.x + u * rect.w, y;
        if (rect.gap) {
          var top = sample(active.layers.boundary.sky, u) * g.scale - 1;
          var bottom = sample(active.layers.boundary.coast, u) * g.scale + g.spare + 1;
          // Irregular rows and diagonals flow along the photographed horizon arcs.
          var bow = -Math.min(28 * g.scale, rect.h / 10) * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
          y = top + v * (bottom - top) + bow;
        } else {
          y = v * rect.h + sideBend(x, g, rect.x < g.left ? "left" : "right") * Math.sin(Math.PI * v);
        }
        row.push([x, y]);
      }
      return row;
    }
    var previous = rowAt(0);
    for (var j = 0; j < rows; j++) {
      var next = rowAt(j + 1);
      for (var i = 0; i < cols; i++) {
        var a = previous[i], b = previous[i + 1], c = next[i], d = next[i + 1];
        var seed = region * 65537 + j * 977 + i * 2;
        var ad = Math.min(triangleQuality(a, b, d), triangleQuality(a, d, c));
        var bc = Math.min(triangleQuality(a, b, c), triangleQuality(b, d, c));
        if (ad > bc) {
          paintFace(ctx, a, b, d, seed, g); paintFace(ctx, a, d, c, seed + 1, g);
        } else {
          paintFace(ctx, a, b, c, seed, g); paintFace(ctx, b, d, c, seed + 1, g);
        }
      }
      previous = next;
    }
  }
  function paintPreview(g) {
    var ctx = fill.getContext("2d"), previous = textureGeometry;
    ctx.setTransform(fill.width / g.W, 0, 0, fill.height / g.H, 0, 0);
    ctx.clearRect(0, 0, g.W, g.H);
    if (previous === g) {
      ctx.drawImage(texture, 0, 0, texture.width, texture.height, 0, 0, g.W, g.H);
      return;
    }
    // Reproject cached gap pixels between the actual curved boundaries, not the whole viewport.
    var boundary = active.layers.boundary, strips = 256;
    var rx = texture.width / previous.W, ry = texture.height / previous.H;
    for (var i = 0; i < strips; i++) {
      var u = (i + 0.5) / strips;
      var sky = sample(boundary.sky, u), coast = sample(boundary.coast, u);
      var sy = sky * previous.scale + 1;
      var sh = Math.max(1, coast * previous.scale + previous.spare - sy - 1);
      var dy = sky * g.scale - 2, dh = coast * g.scale + g.spare - dy + 2;
      ctx.drawImage(texture,
        (previous.left + i * previous.width / strips) * rx, sy * ry,
        previous.width / strips * rx, sh * ry,
        g.left + i * g.width / strips, dy, g.width / strips + 0.5, dh);
    }
    // Side margins may appear mid-drag; a small current-geometry mesh avoids stale edge bands.
    if (g.left > 0.1) {
      ctx.lineWidth = 1; ctx.lineJoin = "round";
      var cell = Math.max(g.left / 8, g.H / 24);
      paintMesh(ctx, { x: 0, w: g.left, h: g.H }, cell, 1, g);
      paintMesh(ctx, { x: g.left + g.width, w: g.left, h: g.H }, cell, 2, g);
    }
  }
  function paintFill(g) {
    // Bound bitmap memory and geometry independently; neither grows without limit.
    var ratio = Math.min(g.ratio, 2, Math.sqrt(8000000 / (g.W * g.H)));
    texture.width = Math.max(1, Math.round(g.W * ratio));
    texture.height = Math.max(1, Math.round(g.H * ratio));
    var ctx = texture.getContext("2d");
    ctx.setTransform(texture.width / g.W, 0, 0, texture.height / g.H, 0, 0);
    ctx.lineWidth = 1; ctx.lineJoin = "round";
    var boundary = active.layers.boundary, gap = 0;
    for (var k = 0; k < boundary.sky.length; k++) gap = Math.max(gap, g.spare + (boundary.coast[k] - boundary.sky[k]) * g.scale);
    var rects = [{ x: g.left, w: g.width, h: gap + 2, gap: true }];
    if (g.left > 0.1) {
      rects.push({ x: 0, w: g.left, h: g.H });
      rects.push({ x: g.left + g.width, w: g.left, h: g.H });
    }
    var cell = Math.max(6, 12 * g.scale);
    function count() {
      return rects.reduce(function (sum, r) { return sum + 2 * Math.ceil(r.w / cell) * Math.ceil(r.h / (cell * 0.866)); }, 0);
    }
    while (count() > 12000) cell *= 1.05;
    triangleCount = 0;
    rects.forEach(function (r, i) { paintMesh(ctx, r, cell, i, g); });
    paintClouds(ctx, g);
    fill.dataset.triangles = String(triangleCount);
    textureGeometry = g;
    drawScene(g, true);
  }
  function disableGPU() {
    if (!gpu) return;
    gpu.destroy(); gpu = null;
    stage.classList.remove("has-gpu", "is-ready");
    geometry = null;
    clearTimeout(refineTimer); refineTimer = 0;
    scheduleLayout();
  }
  function prepareFallbackLayers(g) {
    var area = 0, limit = Infinity;
    names.forEach(function (name) {
      var p = active.layers[name];
      area += p.width * p.height;
      limit = Math.min(limit, 4096 / p.width, 4096 / p.height);
    });
    var scale = Math.min(limit, Math.sqrt(8000000 / area),
      Math.max(0.25, Math.pow(2, Math.ceil(Math.log2(g.scale * texture.width / g.W)))));
    if (fallbackLayers && fallbackScale >= scale) return;
    fallbackLayers = images.map(function (image, i) {
      var p = active.layers[names[i]], canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(p.width * scale));
      canvas.height = Math.max(1, Math.floor(p.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    });
    fallbackScale = scale;
  }
  function drawScene(g, refined) {
    if (gpu) {
      var renderer = gpu;
      if ((!refined || renderer.update(active, images, texture, g, edgePalettes)) && renderer.render(g)) {
        stage.classList.add("has-gpu");
        stage.dataset.renderer = "webgl";
        return;
      }
      disableGPU();
    }
    if (refined || !fallbackLayers) {
      prepareFallbackLayers(g);
      fill.width = texture.width; fill.height = texture.height;
    }
    paintPreview(g);
    var ctx = fill.getContext("2d");
    fallbackLayers.forEach(function (image, i) {
      var box = g.boxes[i]; ctx.drawImage(image, box.x, box.y, box.w, box.h);
    });
    stage.dataset.renderer = "2d";
  }
  function visible() { return root.classList.contains("has-landscape"); }
  function announceGeometry() {
    if (visible()) window.dispatchEvent(new Event("landscapegeometrychange"));
  }
  function refineFill() {
    refineTimer = 0;
    if (!geometry || loaded !== active || !active) return;
    paintFill(geometry);
    announceGeometry();
  }
  function layout() {
    frame = 0;
    if (!active || loaded !== active || failed === active) return;
    // A hidden prepared frame waits for its reveal instead of following every resize.
    if (geometry && !visible()) return;
    var W = stage.clientWidth, H = stage.clientHeight, ratio = window.devicePixelRatio || 1;
    if (!W || !H || geometry && geometry.W === W && geometry.H === H && geometry.ratio === ratio) return;
    var m = active.layers;
    // Fill the window width unless the three real image pieces would collide.
    var minimumHeight = m.sky.y + m.sky.height + m.coast.height + m.diver.height + 24;
    var scale = Math.min(W / active.width, H / minimumHeight);
    var width = active.width * scale, left = (W - width) / 2;
    var spare = Math.max(0, H - active.height * scale);
    var g = { W: W, H: H, ratio: ratio, width: width, left: left, scale: scale, spare: spare, boxes: [] };
    names.forEach(function (name, i) {
      var p = m[name], y = p.y * scale;
      if (name === "coast") y += spare;
      if (name === "diver") y = ((m.sky.y + m.sky.height) * scale + H - m.coast.height * scale - p.height * scale) / 2;
      var box = { x: left + p.x * scale, y: y, w: p.width * scale, h: p.height * scale };
      g.boxes.push(box);
    });
    clearTimeout(refineTimer); refineTimer = 0;
    if (!geometry || geometry.ratio !== ratio) paintFill(g);
    else {
      drawScene(g, false);
      refineTimer = setTimeout(refineFill, 120);
    }
    geometry = g;
    stage.classList.add("is-ready");
    announceGeometry();
  }
  function scheduleLayout() { if (!frame) frame = requestAnimationFrame(layout); }
  function mount() {
    stage = document.createElement("div");
    stage.id = "landscape-stage"; stage.setAttribute("aria-hidden", "true");
    fill = document.createElement("canvas");
    texture = document.createElement("canvas");
    fill.className = "landscape-fill";
    stage.appendChild(fill);
    gpuCanvas = document.createElement("canvas");
    gpuCanvas.className = "landscape-gpu";
    stage.appendChild(gpuCanvas);
    gpu = window.SiteLandscapeGPU ? window.SiteLandscapeGPU.create(gpuCanvas, disableGPU) : null;
    names.forEach(function (name) {
      var image = document.createElement("img");
      image.className = "landscape-piece landscape-" + name;
      image.alt = ""; image.draggable = false; image.decoding = "async"; image.fetchPriority = "high";
      stage.appendChild(image); images.push(image);
    });
    document.body.appendChild(stage);
    observer = new ResizeObserver(scheduleLayout); observer.observe(stage);
  }
  // Load, decode and composite one entry. Safe to call repeatedly: a prepared
  // entry (or one still in flight) is reused rather than restarted.
  function prepare(entry) {
    if (!stage) mount();
    if (active === entry) return;
    clearTimeout(refineTimer); refineTimer = 0;
    active = entry; loaded = null; geometry = null; cloud = null;
    fallbackLayers = null; fallbackScale = 0;
    var version = ++loadVersion;
    stage.classList.remove("is-ready");
    edgePalettes = { left: softenEdge(entry.layers.colors.left), right: softenEdge(entry.layers.colors.right) };
    names.forEach(function (name, i) {
      images[i].fetchPriority = visible() ? "high" : "low";
      images[i].src = entry.layers[name].u;
    });
    // Reveal one complete frame, not three independently decoded pieces and two fill paints.
    Promise.all(images.map(function (image) { return image.decode(); })).then(function () {
      if (active !== entry || version !== loadVersion) return;
      cloud = copyCloud(images[0]);
      loaded = entry;
      scheduleLayout();
    }).catch(function () {
      if (active !== entry || version !== loadVersion) return;
      failed = entry; loaded = null;
      stage.classList.remove("is-ready");
      root.classList.remove("has-landscape");
    });
  }
  function catalog() {
    return window.SiteBackgrounds ? window.SiteBackgrounds.all() : (window.BACKGROUNDS || {}).light || [];
  }
  function sync() {
    var list = catalog();
    var current = window.SiteBackgrounds && window.SiteBackgrounds.current();
    var entry = current ? list.find(function (e) { return e.u === current.u; }) : list[0];
    if (!entry || !entry.layers || failed === entry) {
      // Keep the prepared scene: the next switch back reveals it without reloading.
      root.classList.remove("has-landscape"); return;
    }
    root.classList.add("has-landscape");
    prepare(entry);
    layout();
  }
  // While a photo is showing, prepare the light default in the background so
  // the first switch reveals a finished frame. Deferred past load and idle so
  // it never competes with the page's own resources.
  function warm() {
    var defaults = window.SiteBackgroundDefaults;
    if (active || !defaults || (navigator.connection && navigator.connection.saveData)) return;
    var url = defaults.get("light").u;
    var entry = catalog().find(function (e) { return e.u === url && e.layers; });
    if (entry && failed !== entry) prepare(entry);
  }
  function scheduleWarm() {
    if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 1000);
  }
  // Blend samples the same complete scene that is presented on screen.
  async function sampleRect(rect) {
    var entry = active;
    if (!entry || !geometry || !root.classList.contains("has-landscape")) return null;
    try { await Promise.all(images.map(function (image) { return image.decode(); })); }
    catch (e) { return null; }
    if (active !== entry || failed === entry) return null;
    var g = geometry, x = Math.max(0, rect.left), y = Math.max(0, rect.top);
    var w = Math.min(g.W, rect.right) - x, h = Math.min(g.H, rect.bottom) - y;
    if (w <= 0 || h <= 0) return null;
    var canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = entry.c; ctx.fillRect(0, 0, 32, 32);
    ctx.setTransform(32 / w, 0, 0, 32 / h, -x * 32 / w, -y * 32 / h);
    var surface = gpu ? gpuCanvas : fill;
    ctx.drawImage(surface, 0, 0, surface.width, surface.height, 0, 0, g.W, g.H);
    var pixels = ctx.getImageData(0, 0, 32, 32).data, sum = [0, 0, 0];
    for (var i = 0; i < pixels.length; i += 4) {
      sum[0] += pixels[i]; sum[1] += pixels[i + 1]; sum[2] += pixels[i + 2];
    }
    return sum.map(function (v) { return v / 1024; });
  }
  window.SiteLandscape = { sample: sampleRect };
  window.addEventListener("resize", scheduleLayout);
  window.addEventListener("backgroundchange", sync);
  window.addEventListener("backgroundgeometrychange", scheduleLayout);
  sync();
  if (document.readyState === "complete") scheduleWarm();
  else window.addEventListener("load", scheduleWarm, { once: true });
})();
