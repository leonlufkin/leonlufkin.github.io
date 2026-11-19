/* One retained GPU scene; the original SVG images remain the rasterization masters. */
(function () {
  "use strict";

  var PIXEL_LIMIT = 8000000;
  var names = ["sky", "coast", "diver"];
  var vertexSource = [
    "attribute vec2 a_point;",
    "uniform vec2 u_view;",
    "uniform vec4 u_rect;",
    "varying vec2 v_uv;",
    "void main() {",
    "  v_uv = a_point;",
    "  vec2 p = (u_rect.xy + a_point * u_rect.zw) / u_view;",
    "  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");
  var backgroundSource = [
    "varying vec2 v_uv;",
    "uniform sampler2D u_fill;",
    "uniform sampler2D u_boundary;",
    "uniform sampler2D u_palette;",
    "uniform vec2 u_view;",
    "uniform vec4 u_current;",
    "uniform vec4 u_previous;",
    "uniform vec2 u_previousView;",
    "uniform vec2 u_slopes;",
    "uniform float u_sourceHeight;",
    "uniform float u_exact;",
    "float ease(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }",
    "vec2 boundary(float u) {",
    "  vec4 encoded = texture2D(u_boundary, vec2((clamp(u, 0.0, 1.0) * 64.0 + 0.5) / 65.0, 0.5));",
    "  vec2 weights = vec2(256.0 / 257.0, 1.0 / 257.0);",
    "  return vec2(dot(encoded.rg, weights), dot(encoded.ba, weights)) * u_sourceHeight;",
    "}",
    "vec3 palette(float row, float t) {",
    "  return texture2D(u_palette, vec2((clamp(t, 0.0, 1.0) * 64.0 + 0.5) / 65.0, (row + 0.5) / 8.0)).rgb;",
    "}",
    "vec3 sideColor(vec2 p, float u, vec2 bounds) {",
    "  bool left = p.x < u_current.x;",
    "  float edge = left ? u_current.x : u_current.x + u_current.y;",
    "  float slope = left ? u_slopes.x : u_slopes.y;",
    "  float bend = clamp(slope * (p.x - edge), -u_view.y * 0.2, u_view.y * 0.2);",
    "  float y = p.y;",
    "  for (int i = 0; i < 3; i++) {",
    "    float angle = 3.141592653589793 * y / u_view.y;",
    "    y -= (y + bend * sin(angle) - p.y) / (1.0 + bend * 3.141592653589793 / u_view.y * cos(angle));",
    "  }",
    "  y = clamp(y, 0.0, u_view.y);",
    "  float sky = bounds.x * u_current.z;",
    "  float coast = bounds.y * u_current.z + u_current.w;",
    "  if (y <= sky || y >= coast) {",
    "    float position = (y <= sky ? y : y - u_current.w) / u_current.z / u_sourceHeight;",
    "    float row = left ? 4.0 : 5.0;",
    "    float distance = abs(p.x - edge);",
    "    return mix(palette(row, position), palette(row + 2.0, position), ease(distance / max(24.0, 64.0 * u_current.z)));",
    "  }",
    "  float gap = max(1.0, coast - sky);",
    "  float t = clamp((y - sky) / gap, 0.0, 1.0);",
    "  vec3 color = mix(palette(2.0, u), palette(3.0, u), ease(t));",
    "  float reach = min(gap / 3.0, max(24.0, 60.0 * u_current.z));",
    "  color = mix(color, palette(0.0, u), 1.0 - ease((y - sky) / reach));",
    "  float leftReach = 1.0 - ease(u / 0.45);",
    "  float coastReach = reach + leftReach * (min(gap * 0.8, max(96.0, 300.0 * u_current.z)) - reach);",
    "  color = mix(color, palette(1.0, u), 1.0 - ease((coast - y) / coastReach));",
    "  float oldSky = bounds.x * u_previous.z;",
    "  float oldCoast = bounds.y * u_previous.z + u_previous.w;",
    "  vec2 edgeUV = vec2(u_previous.x + u * u_previous.y + (left ? 0.5 : -0.5), oldSky + t * (oldCoast - oldSky)) / u_previousView;",
    "  vec4 cached = texture2D(u_fill, edgeUV);",
    "  return mix(cached.rgb + color * (1.0 - cached.a), color, ease(abs(p.x - edge) / max(24.0, 64.0 * u_current.z)));",
    "}",
    "void main() {",
    "  if (u_exact > 0.5) { gl_FragColor = texture2D(u_fill, v_uv); return; }",
    "  vec2 p = v_uv * u_view;",
    "  float u = clamp((p.x - u_current.x) / u_current.y, 0.0, 1.0);",
    "  vec2 bounds = boundary(u);",
    "  if (p.x < u_current.x || p.x > u_current.x + u_current.y) {",
    "    gl_FragColor = vec4(sideColor(p, u, bounds), 1.0);",
    "    return;",
    "  }",
    "  float sky = bounds.x * u_current.z;",
    "  float coast = bounds.y * u_current.z + u_current.w;",
    "  float oldSky = bounds.x * u_previous.z;",
    "  float oldCoast = bounds.y * u_previous.z + u_previous.w;",
    "  float y;",
    "  if (p.y < sky) y = p.y / u_current.z * u_previous.z;",
    "  else if (p.y > coast) y = (p.y - u_current.w) / u_current.z * u_previous.z + u_previous.w;",
    "  else y = oldSky + (p.y - sky) / max(1.0, coast - sky) * max(1.0, oldCoast - oldSky);",
    "  vec2 uv = vec2(u_previous.x + u * u_previous.y, y) / u_previousView;",
    "  gl_FragColor = texture2D(u_fill, uv);",
    "}"
  ].join("\n");
  var imageSource = [
    "varying vec2 v_uv;",
    "uniform sampler2D u_image;",
    "void main() { gl_FragColor = texture2D(u_image, v_uv); }"
  ].join("\n");

  function create(canvas, onContextLost) {
    var gl;
    try {
      gl = canvas.getContext("webgl", {
        alpha: true, premultipliedAlpha: true, antialias: false,
        depth: false, stencil: false, preserveDrawingBuffer: true,
        powerPreference: "low-power"
      });
    } catch (_) { return null; }
    if (!gl) return null;

    var shaders = [], programs = [], textures = [], buffer = null;
    var background, imageProgram, scratch, ctx;
    var maxTexture, maxWidth, maxHeight;
    var disposed = false, lost = false, broken = false, ready = false;
    var active = null, sourceImages = null, previous = null, layerScale = 0;
    var boundaryBytes = new Uint8Array(65 * 4);
    var paletteBytes = new Uint8Array(65 * 8 * 4);
    var layerTextures = [];
    var fillTexture, boundaryTexture, paletteTexture;

    function destroy() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("webglcontextlost", contextLost);
      for (var i = 0; i < textures.length; i++) gl.deleteTexture(textures[i]);
      for (var j = 0; j < programs.length; j++) gl.deleteProgram(programs[j]);
      for (var k = 0; k < shaders.length; k++) gl.deleteShader(shaders[k]);
      if (buffer) gl.deleteBuffer(buffer);
      if (scratch) { scratch.width = 1; scratch.height = 1; }
      canvas.width = canvas.height = 1;
      active = sourceImages = previous = ctx = scratch = null;
      ready = false;
    }
    function contextLost(event) {
      event.preventDefault();
      if (disposed || lost) return;
      lost = true;
      ready = false;
      if (onContextLost) onContextLost();
    }
    function compile(type, source) {
      var shader = gl.createShader(type);
      if (!shader) throw new Error("Landscape shader allocation failed");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Landscape shader compilation failed");
      return shader;
    }
    function program(vertex, fragment, uniforms) {
      var handle = gl.createProgram();
      if (!handle) throw new Error("Landscape program allocation failed");
      programs.push(handle);
      gl.attachShader(handle, vertex);
      gl.attachShader(handle, fragment);
      gl.bindAttribLocation(handle, 0, "a_point");
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error("Landscape program linking failed");
      var result = { handle: handle };
      for (var i = 0; i < uniforms.length; i++) result[uniforms[i]] = gl.getUniformLocation(handle, uniforms[i]);
      return result;
    }
    function texture() {
      var handle = gl.createTexture();
      if (!handle) throw new Error("Landscape texture allocation failed");
      textures.push(handle);
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return handle;
    }
    function outputRatio(g) {
      return Math.min(g.ratio || window.devicePixelRatio || 1, 2,
        Math.sqrt(PIXEL_LIMIT / (g.W * g.H)), maxWidth / g.W, maxHeight / g.H);
    }
    function raster(source, width, height) {
      if (scratch.width !== width) scratch.width = width;
      if (scratch.height !== height) scratch.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, width, height);
      return scratch;
    }
    function upload(handle, source) {
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    function uploadPalettes(entry, edges) {
      var layers = entry.layers, boundary = layers.boundary, colors = layers.colors;
      var rows = [colors.sky, colors.coast, colors.clearSky, colors.ocean,
        colors.left, colors.right, edges.left, edges.right];
      for (var i = 0; i < 65; i++) {
        var sky = Math.round(Math.max(0, Math.min(1, boundary.sky[i] / entry.height)) * 65535);
        var coast = Math.round(Math.max(0, Math.min(1, boundary.coast[i] / entry.height)) * 65535);
        boundaryBytes[i * 4] = sky >>> 8;
        boundaryBytes[i * 4 + 1] = sky & 255;
        boundaryBytes[i * 4 + 2] = coast >>> 8;
        boundaryBytes[i * 4 + 3] = coast & 255;
        for (var row = 0; row < 8; row++) {
          var offset = (row * 65 + i) * 4, color = rows[row][i];
          paletteBytes[offset] = Math.round(color[0]);
          paletteBytes[offset + 1] = Math.round(color[1]);
          paletteBytes[offset + 2] = Math.round(color[2]);
          paletteBytes[offset + 3] = 255;
        }
      }
      // These are data bytes, not colors with alpha; preserve all four boundary channels.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, boundaryTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 65, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, boundaryBytes);
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 65, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteBytes);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.useProgram(background.handle);
      gl.uniform1f(background.u_sourceHeight, entry.height);
      gl.uniform2f(background.u_slopes,
        (boundary.sky[1] - boundary.sky[0]) * 64 / entry.width,
        (boundary.sky[64] - boundary.sky[63]) * 64 / entry.width);
    }
    function update(entry, images, fillCanvas, g, edgePalettes) {
      if (disposed || lost || broken || gl.isContextLost()) return false;
      try {
        if (!(g.W > 0 && g.H > 0 && g.scale > 0 && g.width > 0 && fillCanvas.width > 0 && fillCanvas.height > 0)) return false;
        // Keep the framebuffer stable while dragging; resize it only with full-quality updates.
        var ratio = outputRatio(g);
        var width = Math.max(1, Math.floor(g.W * ratio)), height = Math.max(1, Math.floor(g.H * ratio));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.activeTexture(gl.TEXTURE0);
        var changed = entry !== active || !sourceImages || sourceImages[0] !== images[0] ||
          sourceImages[1] !== images[1] || sourceImages[2] !== images[2];
        var area = 0, limit = Infinity;
        for (var i = 0; i < 3; i++) {
          var piece = entry.layers[names[i]];
          area += piece.width * piece.height;
          limit = Math.min(limit, maxTexture / piece.width, maxTexture / piece.height);
        }
        // Quarter-source-pixel steps avoid rerasterizing SVGs for every small refinement.
        var scale = Math.min(Math.ceil(g.scale * outputRatio(g) * 4) / 4,
          Math.sqrt(PIXEL_LIMIT / area), limit);
        if (changed || scale > layerScale) {
          for (var j = 0; j < 3; j++) {
            var layer = entry.layers[names[j]];
            upload(layerTextures[j], raster(images[j], Math.max(1, Math.floor(layer.width * scale)),
              Math.max(1, Math.floor(layer.height * scale))));
          }
          layerScale = scale;
        }
        if (changed) uploadPalettes(entry, edgePalettes);
        var fillScale = Math.min(1, maxTexture / fillCanvas.width, maxTexture / fillCanvas.height,
          Math.sqrt(PIXEL_LIMIT / (fillCanvas.width * fillCanvas.height)));
        var source = fillScale < 1 ? raster(fillCanvas,
          Math.max(1, Math.floor(fillCanvas.width * fillScale)),
          Math.max(1, Math.floor(fillCanvas.height * fillScale))) : fillCanvas;
        upload(fillTexture, source);
        if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) { broken = true; return false; }
        active = entry;
        if (changed) sourceImages = [images[0], images[1], images[2]];
        previous = { W: g.W, H: g.H, left: g.left, width: g.width, scale: g.scale, spare: g.spare };
        gl.useProgram(background.handle);
        gl.uniform4f(background.u_previous, previous.left, previous.width, previous.scale, previous.spare);
        gl.uniform2f(background.u_previousView, previous.W, previous.H);
        ready = true;
        return true;
      } catch (_) { broken = true; return false; }
    }
    function render(g) {
      if (!ready || disposed || lost || broken || gl.isContextLost()) return false;
      try {
        if (!(g.W > 0 && g.H > 0 && g.scale > 0 && g.width > 0)) return false;
        gl.useProgram(background.handle);
        gl.uniform2f(background.u_view, g.W, g.H);
        gl.uniform4f(background.u_rect, 0, 0, g.W, g.H);
        gl.uniform4f(background.u_current, g.left, g.width, g.scale, g.spare);
        gl.uniform1f(background.u_exact, g.W === previous.W && g.H === previous.H &&
          g.left === previous.left && g.width === previous.width &&
          g.scale === previous.scale && g.spare === previous.spare ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fillTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, boundaryTexture);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
        // The fullscreen draw replaces every pixel, including transparent pixels from the old frame.
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.BLEND);
        gl.useProgram(imageProgram.handle);
        gl.uniform2f(imageProgram.u_view, g.W, g.H);
        gl.activeTexture(gl.TEXTURE0);
        for (var i = 0; i < 3; i++) {
          var box = g.boxes[i];
          gl.uniform4f(imageProgram.u_rect, box.x, box.y, box.w, box.h);
          gl.bindTexture(gl.TEXTURE_2D, layerTextures[i]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        if (gl.isContextLost()) return false;
        return true;
      } catch (_) { broken = true; return false; }
    }

    try {
      maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      var viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      var renderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      maxWidth = Math.min(viewport[0], renderbuffer, maxTexture);
      maxHeight = Math.min(viewport[1], renderbuffer, maxTexture);
      if (maxTexture < 65 || gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 3) throw new Error("Landscape texture limits unsupported");
      var precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      var prefix = precision && precision.precision ? "precision highp float;\n" : "precision mediump float;\n";
      var vertex = compile(gl.VERTEX_SHADER, prefix + vertexSource);
      background = program(vertex, compile(gl.FRAGMENT_SHADER, prefix + backgroundSource),
        ["u_view", "u_rect", "u_fill", "u_boundary", "u_palette", "u_current", "u_previous",
          "u_previousView", "u_slopes", "u_sourceHeight", "u_exact"]);
      imageProgram = program(vertex, compile(gl.FRAGMENT_SHADER, prefix + imageSource), ["u_view", "u_rect", "u_image"]);
      buffer = gl.createBuffer();
      if (!buffer) throw new Error("Landscape buffer allocation failed");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      fillTexture = texture();
      boundaryTexture = texture();
      paletteTexture = texture();
      for (var i = 0; i < 3; i++) layerTextures.push(texture());
      // Both SVG/canvas uploads and texture UVs start at the top left. All color pixels are premultiplied.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.DITHER);
      gl.useProgram(background.handle);
      gl.uniform1i(background.u_fill, 0);
      gl.uniform1i(background.u_boundary, 1);
      gl.uniform1i(background.u_palette, 2);
      gl.useProgram(imageProgram.handle);
      gl.uniform1i(imageProgram.u_image, 0);
      scratch = document.createElement("canvas");
      ctx = scratch.getContext("2d");
      if (!ctx || gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error("Landscape initialization failed");
      canvas.addEventListener("webglcontextlost", contextLost);
      return { update: update, render: render, destroy: destroy };
    } catch (_) {
      destroy();
      return null;
    }
  }

  window.SiteLandscapeGPU = { create: create };
})();
