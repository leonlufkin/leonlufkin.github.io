/* Mounts the living bay (bay-body.js + bay-dive.js) as the site's background.
   The static watercolor stays in place for first paint and as the no-WebGL
   fallback; once the canvases are ready they take over (html.has-bay hides
   the static layer, which is pixel-identical at rest anyway). */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Bump ASSET_V whenever tools/bake-bay.py rewrites the textures/metadata:
  // the browser otherwise serves the stale cached bake for the bare URLs.
  var ASSET_V = '2';

  function mount() {
    var stage = document.createElement('div');
    stage.id = 'bay-stage';
    stage.setAttribute('aria-hidden', 'true');
    var ASSET_V = '7';
    var opts = {
      planes: '/assets/images/kea/bay-planes.png?v=' + ASSET_V,
      mask: '/assets/images/kea/bay-mask.png?v=' + ASSET_V,
      meta: '/assets/images/kea/bay.json?v=' + ASSET_V,
      onFail: function () { stage.remove(); }
    };
    var body = mountBayBody(stage, opts);
    var dive = mountBayDive(stage, opts);
    // canvas sizing lives in the stylesheet (#bay-stage canvas fills the
    // window); the shaders fit the painting inside (top edge = window top,
    // bottom edge = window bottom, colours extended beyond)
    stage.appendChild(body.canvas);
    stage.appendChild(dive.canvas);
    document.body.appendChild(stage);
    // Hide the static photo only once both live layers have actually painted:
    // has-bay before that would flash the page background instead.
    return Promise.all([body.ready, dive.ready]).then(function () {
      return new Promise(function (resolve) {
        // two frames out: both raf loops have composed at least one frame
        requestAnimationFrame(function () {
          requestAnimationFrame(resolve);
        });
      });
    }).then(function () {
      document.documentElement.classList.add('has-bay');
    }).catch(function (e) {
      console.error('bay mount failed:', e && e.message || e);
      stage.remove();
      throw e;
    });
  }

  function start(attempt) {
    mount().catch(function () {
      // transient load failures happen (six parallel fetches on a cold cache);
      // one retry before falling back to the static photo
      if (attempt < 1) setTimeout(function () { start(attempt + 1); }, 800);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { start(0); });
  } else {
    start(0);
  }
})();
