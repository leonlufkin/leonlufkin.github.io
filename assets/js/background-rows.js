/* Independent left and right margin colors for each photo row.
   Sampling is cached by URL; the original image is never modified. */
(function () {
  var cache = new Map();

  function strip(image) {
    var W = image.naturalWidth, H = image.naturalHeight;
    if (!(W > 0 && H > 0)) return null;
    var height = Math.min(H, 2048), edge = Math.max(1, Math.round(W * 0.03));
    var sample = document.createElement("canvas");
    sample.width = 16; sample.height = height;
    var context = sample.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, edge, H, 0, 0, 8, height);
    context.drawImage(image, W - edge, 0, edge, H, 8, 0, 8, height);
    var pixels = context.getImageData(0, 0, 16, height).data;
    var rows = [new Float32Array(height * 3), new Float32Array(height * 3)];
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < 16; x++) {
        var source = (y * 16 + x) * 4;
        var side = x < 8 ? 0 : 1;
        for (var c = 0; c < 3; c++) rows[side][y * 3 + c] += pixels[source + c] / 8;
      }
    }

    // Blur each edge vertically, never mixing colors across the two sides.
    // The original photo stays sharp; only these one-pixel margin strips change.
    var sigma = Math.max(2, height * 0.006), radius = Math.ceil(3 * sigma);
    var weights = [], weightSum = 0;
    for (var offset = -radius; offset <= radius; offset++) {
      var weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
      weights.push(weight);
      weightSum += weight;
    }
    function encode(values) {
      var output = document.createElement("canvas");
      output.width = 1; output.height = height;
      var target = output.getContext("2d");
      if (!target) return null;
      var data = target.createImageData(1, height);
      for (var row = 0; row < height; row++) {
        for (var channel = 0; channel < 3; channel++) {
          var total = 0;
          for (var tap = 0; tap < weights.length; tap++) {
            var neighbor = Math.max(0, Math.min(height - 1, row + tap - radius));
            total += values[neighbor * 3 + channel] * weights[tap];
          }
          data.data[row * 4 + channel] = Math.round(total / weightSum);
        }
        data.data[row * 4 + 3] = 255;
      }
      target.putImageData(data, 0, 0);
      return output.toDataURL("image/png");
    }
    var left = encode(rows[0]), right = encode(rows[1]);
    return left && right ? { left: left, right: right } : null;
  }

  function get(url) {
    if (typeof url !== "string" || !url) return Promise.resolve(null);
    if (!cache.has(url)) {
      var result = new Promise(function (resolve) {
        var image = new Image();
        image.decoding = "async";
        image.onload = function () {
          try { resolve(strip(image)); } catch (error) { resolve(null); }
          image.onload = image.onerror = null;
        };
        image.onerror = function () {
          image.onload = image.onerror = null;
          resolve(null);
        };
        image.src = url;
      }).catch(function () { return null; });
      cache.set(url, result);
    }
    return cache.get(url);
  }

  window.BackgroundRows = { get: get };
})();
