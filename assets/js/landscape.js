/* The light theme's background: one composited scene. The photograph, in three
   bitmap layers, sits whole at the bottom of the window; the height it leaves
   is sky painted above it. GPU resizing, with a cached Canvas2D fallback. */
(function () {
  "use strict";
  var root = document.documentElement;
  var scene = window.LandscapeScene, background = window.SiteBackground;
  var stage, fill, images = [], geometry = null;
  var observer, boxObserver, observedBox = null, frame = 0, diverFrame = 0, diverOffset = null, triangleCount = 0, edgePalettes;
  // Density set (1 or 2) of the layer bitmaps: on screen, and asked for.
  var loaded = 0, requested = 0, failed = false, loadVersion = 0;
  var refineTimer = 0;
  var texture, textureGeometry = null;
  var gpu, gpuCanvas, fallbackLayers = null, fallbackScale = 0;
  var names = ["sky", "coast", "diver"];
  var cloud = null, topMean;

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
    var p = scene.layers.boundary.sky, n = p.length - 1;
    var slope = side === "left" ? (p[1] - p[0]) * n / scene.width : (p[n] - p[n - 1]) * n / scene.width;
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
    // The rectangle is in source pixels; the bitmap may hold more than one pixel for each.
    var k = image.naturalWidth / scene.layers.sky.width;
    ctx.drawImage(image, 430 * k, 44 * k, canvas.width * k, canvas.height * k, 0, 0, canvas.width, canvas.height);
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
  // Wisps in the sky above the photograph, each a copy of the photographed one:
  // larger overhead, smaller and closer together toward the horizon, every
  // other one mirrored. A low sky has none.
  function paintWisps(ctx, g) {
    var n = g.spare < 100 ? 0 : clamp(Math.round(g.spare / 150), 1, 6), across = [0.30, 0.72, 0.44, 0.68, 0.28, 0.58];
    var unit = Math.max(g.scale, g.W / 1300);
    for (var i = 0; i < n; i++) {
      var s = n > 1 ? i / (n - 1) : 0.5, size = unit * 1.3 * (1 - 0.72 * s);
      var w = cloud.width * size, h = cloud.height * size;
      ctx.save();
      ctx.globalAlpha = 0.8 - 0.3 * s;
      ctx.translate(across[i] * g.W, g.spare * (0.10 + 0.70 * (1 - Math.pow(1 - s, 1.6))));
      if (i % 2) ctx.scale(-1, 1);
      ctx.drawImage(cloud, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
  // The sky painted above the photograph starts from the colors of its top
  // edge, evens out, and deepens by `zenith` on the way to the top of the
  // window, however far that is: a tall window shows more sky, not a darker one.
  function skyAbove(u, y, g) {
    var m = scene.layers, d = Math.max(0, g.spare - y);
    var rise = d ? (1 - Math.exp(-d / (0.7 * g.spare))) / (1 - Math.exp(-1 / 0.7)) : 0;
    var even = topMean.map(function (v, k) { return v - m.zenith[k] * rise; });
    return mix(sample(m.colors.top, u), even, smooth(d / Math.max(40, 110 * g.scale)));
  }
  function colorAt(x, y, g) {
    var m = scene.layers, u = clamp((x - g.left) / g.width, 0, 1);
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
    var sky = sample(m.boundary.sky, u) * g.scale + g.spare;
    var coast = sample(m.boundary.coast, u) * g.scale + g.spare;
    // Above the photograph, and under its sky layer, at whose top edge the painted sky shows through.
    if (y < g.spare || !side && y < sky - 1) return skyAbove(u, y, g);
    if (side && (y <= sky || y >= coast)) {
      var position = (y - g.spare) / g.scale / scene.height;
      var distance = side === "left" ? g.left - x : x - g.left - g.width;
      return mix(sample(m.colors[side], position), sample(edgePalettes[side], position),
        smooth(distance / Math.max(24, 64 * g.scale)));
    }
    var gap = Math.max(1, coast - sky), t = clamp((y - sky) / gap, 0, 1);
    var color = mix(sample(m.colors.clearSky, u), sample(m.colors.ocean, u), smooth(t));
    // Between the layers: match the real edges locally, rather than stretching cloud-white through the sliver.
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
          var top = sample(scene.layers.boundary.sky, u) * g.scale + g.spare - 1;
          var bottom = sample(scene.layers.boundary.coast, u) * g.scale + g.spare + 1;
          // Irregular rows and diagonals flow along the photographed horizon arcs.
          var bow = -Math.min(28 * g.scale, rect.h / 10) * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
          y = top + v * (bottom - top) + bow;
        } else {
          y = v * rect.h + (rect.sky ? 0 : sideBend(x, g, rect.x < g.left ? "left" : "right") * Math.sin(Math.PI * v));
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
    // Reproject the cached pixels: the sky above the photograph stretches, and what is painted around the
    // photograph moves with it. The two pieces meet on a whole pixel row, so no line shows between them.
    var rx = texture.width / previous.W, ry = texture.height / previous.H, rows = fill.height / g.H;
    var sx = previous.left * rx, sw = previous.width * rx, cut = previous.spare * ry;
    var seam = Math.round(g.spare * rows) / rows;
    if (seam > 0) ctx.drawImage(texture, sx, 0, sw, Math.max(1, cut), g.left, 0, g.width, seam);
    ctx.drawImage(texture, sx, cut, sw, texture.height - cut, g.left, seam, g.width, (previous.H - previous.spare) * g.scale / previous.scale);
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
    var boundary = scene.layers.boundary, gap = 0;
    for (var k = 0; k < boundary.sky.length; k++) gap = Math.max(gap, (boundary.coast[k] - boundary.sky[k]) * g.scale);
    // The sliver between the sky and coast layers, the sky above the photograph, and the margins beside it.
    var rects = [{ x: g.left, w: g.width, h: gap + 2, gap: true }];
    if (g.spare >= 1) rects.push({ x: g.left, w: g.width, h: g.spare + 8, sky: true });
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
    paintWisps(ctx, g);
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
      var p = scene.layers[name];
      area += p.width * p.height;
      limit = Math.min(limit, 4096 / p.width, 4096 / p.height);
    });
    var scale = Math.min(limit, Math.sqrt(8000000 / area),
      Math.max(0.25, Math.pow(2, Math.ceil(Math.log2(g.scale * texture.width / g.W)))));
    if (fallbackLayers && fallbackScale >= scale) return;
    fallbackLayers = images.map(function (image, i) {
      var p = scene.layers[names[i]], canvas = document.createElement("canvas");
      // Never above the bitmap's own resolution; drawing it larger adds no detail.
      var layerScale = Math.min(scale, image.naturalWidth / p.width);
      canvas.width = Math.max(1, Math.floor(p.width * layerScale));
      canvas.height = Math.max(1, Math.floor(p.height * layerScale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    });
    fallbackScale = scale;
  }
  function drawScene(g, refined) {
    if (gpu) {
      var renderer = gpu;
      if ((!refined || renderer.update(scene, images, texture, g, edgePalettes)) && renderer.render(g)) {
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
  // The bootstrap holds the page's text back for the scene: tell it when there
  // is nothing more to wait for, because the scene is on screen or never will be.
  function settled() { if (background.drawn) background.drawn(); }
  function fail() { root.classList.remove("has-landscape"); settled(); }
  function announceGeometry() {
    if (visible()) window.dispatchEvent(new Event("landscapegeometrychange"));
  }
  function refineFill() {
    refineTimer = 0;
    if (!geometry || !loaded) return;
    paintFill(geometry);
    announceGeometry();
  }
  function layout() {
    frame = 0;
    if (failed) { fail(); return; }
    if (!loaded) return;
    // A hidden prepared frame waits for its reveal instead of following every resize.
    if (geometry && !visible()) return;
    var W = stage.clientWidth, H = stage.clientHeight, ratio = window.devicePixelRatio || 1;
    if (!W || !H || geometry && geometry.W === W && geometry.H === H && geometry.ratio === ratio) return;
    // A window that has outgrown the loaded bitmaps gets the sharper set, swapped in once decoded.
    prepare(background.density());
    var m = scene.layers;
    // Fill the window's width, unless the photograph would then leave the skydiver no sky above it.
    var minimumHeight = m.sky.y + m.sky.height + m.coast.height + m.diver.height + 24;
    var scale = Math.min(W / scene.width, H / minimumHeight);
    var width = scene.width * scale, left = (W - width) / 2;
    var spare = Math.max(0, H - scene.height * scale);
    var g = { W: W, H: H, ratio: ratio, width: width, left: left, scale: scale, spare: spare, boxes: [] };
    // The photograph sits whole at the bottom of the window: the spare height is sky above it.
    names.forEach(function (name) {
      var p = m[name];
      g.boxes.push(name === "diver" ? placeDiver(g) : { x: left + p.x * scale, y: spare + p.y * scale, w: p.width * scale, h: p.height * scale });
    });
    clearTimeout(refineTimer); refineTimer = 0;
    if (!geometry || geometry.ratio !== ratio) paintFill(g);
    else {
      drawScene(g, false);
      refineTimer = setTimeout(refineFill, 120);
    }
    geometry = g;
    stage.classList.add("is-ready");
    if (visible()) settled();
    announceGeometry();
  }
  function scheduleLayout() { if (!frame) frame = requestAnimationFrame(layout); }
  // The skydiver hangs behind the page's text box, so that hiding the box (Esc)
  // uncovers it: behind the photo on the home page, and never over the bay.
  // While the box is hidden it keeps its place relative to the window's centre.
  function placeDiver(g) {
    var m = scene.layers, p = m.diver, w = p.width * g.scale, h = p.height * g.scale;
    var x = g.left + (p.x + p.width / 2) * g.scale;
    var y = (g.spare + sample(m.boundary.sky, 0.5) * g.scale) / 2; // midway up the sky
    var box = root.classList.contains("content-hidden") ? null : document.querySelector(".intro") || document.querySelector("body > main");
    var photo = box && box.querySelector(".headshot");
    // Measured where the page rests, before any scrolling, and from the stage's own corner: the stage does not
    // scroll, and where a browser's bars leave less than its height showing, its top is above the window's.
    var origin = stage.getBoundingClientRect();
    function rest(node) {
      var r = node.getBoundingClientRect(), dx = window.scrollX - origin.left, dy = window.scrollY - origin.top;
      return { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy };
    }
    if (photo) {
      var face = rest(photo);
      x = (face.left + face.right) / 2; y = (face.top + face.bottom) / 2;
    } else if (!box && diverOffset) {
      x = g.W / 2 + diverOffset.x; y = g.H / 2 + diverOffset.y;
    }
    for (var k = -1; k <= 1; k++) {
      y = Math.min(y, sample(m.boundary.coast, (x + k * w / 2 - g.left) / g.width) * g.scale + g.spare - h / 2);
    }
    if (box) {
      // The box has the last word: behind it, wherever it is.
      var cover = rest(box);
      x = clamp(x, cover.left + w / 2, cover.right - w / 2);
      y = clamp(y, cover.top + h / 2, cover.bottom - h / 2);
      if (box !== observedBox) { boxObserver.disconnect(); boxObserver.observe(box); observedBox = box; }
    }
    diverOffset = { x: x - g.W / 2, y: y - g.H / 2 };
    return { x: x - w / 2, y: y - h / 2, w: w, h: h };
  }
  // The box moved, changed or came back: put the skydiver behind it again.
  function moveDiver() {
    diverFrame = 0;
    if (!geometry || !visible()) return;
    var at = geometry.boxes[2], next = placeDiver(geometry);
    if (next.x === at.x && next.y === at.y) return;
    geometry.boxes[2] = next;
    drawScene(geometry, false);
  }
  function scheduleDiver() { if (!diverFrame) diverFrame = requestAnimationFrame(moveDiver); }
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
    edgePalettes = { left: softenEdge(scene.layers.colors.left), right: softenEdge(scene.layers.colors.right) };
    topMean = [0, 1, 2].map(function (k) {
      return scene.layers.colors.top.reduce(function (sum, color) { return sum + color[k]; }, 0) / scene.layers.colors.top.length;
    });
    document.body.appendChild(stage);
    observer = new ResizeObserver(scheduleLayout); observer.observe(stage);
    boxObserver = new ResizeObserver(scheduleDiver);
    new MutationObserver(scheduleDiver).observe(root, { attributes: true, attributeFilter: ["class"] });
  }
  // Load and decode one density set of the layers, then composite it. A set
  // already loaded or in flight is reused; a sharper one takes over only once
  // every layer has decoded, so one complete frame replaces another.
  function prepare(set) {
    if (failed || set <= requested) return;
    if (!stage) mount();
    requested = set;
    var version = ++loadVersion;
    var next = background.layers(set).map(function (url) {
      var image = new Image();
      image.decoding = "async";
      image.fetchPriority = visible() ? "high" : "low";
      image.src = url;
      return image;
    });
    Promise.all(next.map(function (image) { return image.decode(); })).then(function () {
      if (version !== loadVersion) return;
      var nextCloud = copyCloud(next[0]);
      images = next; cloud = nextCloud; loaded = set;
      fallbackLayers = null; fallbackScale = 0;
      geometry = null;
      scheduleLayout();
    }).catch(function () {
      if (version !== loadVersion) return;
      if (loaded) { requested = loaded; return; } // keep the set already on screen
      failed = true;
      stage.classList.remove("is-ready");
      fail();
    });
  }
  // Show the scene in the light theme. In the dark theme a prepared scene is
  // kept: the next switch back reveals it without reloading.
  function sync() {
    if (!visible()) return;
    if (failed) { fail(); return; }
    prepare(background.density());
    layout();
  }
  // While the moon is showing, prepare the scene in the background so the first
  // switch to light reveals a finished frame. Deferred past load and idle so it
  // never competes with the page's own resources.
  function warm() {
    if (requested || (navigator.connection && navigator.connection.saveData)) return;
    prepare(background.density());
  }
  function scheduleWarm() {
    if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 1000);
  }
  // Blend samples the same complete scene that is presented on screen.
  function sampleRect(rect) {
    if (!geometry || !visible()) return Promise.resolve(null);
    var g = geometry, origin = stage.getBoundingClientRect();
    var x = Math.max(0, rect.left - origin.left), y = Math.max(0, rect.top - origin.top);
    var w = Math.min(g.W, rect.right - origin.left) - x, h = Math.min(g.H, rect.bottom - origin.top) - y;
    if (w <= 0 || h <= 0) return Promise.resolve(null);
    var canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = scene.c; ctx.fillRect(0, 0, 32, 32);
    ctx.setTransform(32 / w, 0, 0, 32 / h, -x * 32 / w, -y * 32 / h);
    var surface = gpu ? gpuCanvas : fill;
    ctx.drawImage(surface, 0, 0, surface.width, surface.height, 0, 0, g.W, g.H);
    var pixels = ctx.getImageData(0, 0, 32, 32).data, sum = [0, 0, 0];
    for (var i = 0; i < pixels.length; i += 4) {
      sum[0] += pixels[i]; sum[1] += pixels[i + 1]; sum[2] += pixels[i + 2];
    }
    return Promise.resolve(sum.map(function (v) { return v / 1024; }));
  }
  window.SiteLandscape = { sample: sampleRect };
  // A browser's bars coming or going move the stage without resizing it: the skydiver's place is then another.
  window.addEventListener("resize", function () { scheduleLayout(); scheduleDiver(); });
  window.addEventListener("themechange", sync);
  window.addEventListener("pageswap", scheduleDiver);
  sync();
  if (document.readyState === "complete") scheduleWarm();
  else window.addEventListener("load", scheduleWarm, { once: true });
})();
