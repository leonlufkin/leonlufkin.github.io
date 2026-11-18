/* Mounts the living bay (bay-body.js + bay-dive.js) as the site's background.
   The static watercolor stays in place for first paint and as the no-WebGL
   fallback; once the canvases are ready they take over (html.has-bay hides
   the static layer, which is pixel-identical at rest anyway). */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Bump ASSET_V whenever tools/bake-bay.py rewrites the textures/metadata:
  // the browser otherwise serves the stale cached bake for the bare URLs.
  var ASSET_V = '9';

  function mount() {
    window.__log = (window.__log || []); window.__log.push('mount called');
    var stage = document.createElement('div');
    stage.id = 'bay-stage';
    stage.setAttribute('aria-hidden', 'true');
    var opts = {
      planes: '/assets/images/kea/bay-planes.png?v=' + ASSET_V,
      mask: '/assets/images/kea/bay-mask.png?v=' + ASSET_V,
      // the json is tiny and every rebake rewrites it — never let the
      // browser serve a stale cached copy (old json lacks the band fields
      // the shaders need)
      meta: '/assets/images/kea/bay.json?v=' + ASSET_V + '&t=' + Date.now(),
    };
    var body, dive;
    try {
      body = mountBayBody(stage, opts);
      dive = mountBayDive(stage, opts);
    } catch (e) {
      window.__log.push('SYNC THROW: ' + e.message);
      throw e;
    }
    stage.appendChild(body.canvas);
    stage.appendChild(dive.canvas);
    document.body.appendChild(stage);
    window.__log.push('stage in DOM: ' + !!document.getElementById('bay-stage'));
    (function poll(t) {
      setTimeout(function () {
        var present = !!document.getElementById('bay-stage');
        window.__log.push('t+' + t + 'ms stage: ' + present);
        if (t < 3000) poll(t + 500);
      }, 500);
    })(0);
    // canvas sizing lives in the stylesheet (#bay-stage canvas fills the
    // window); the shaders fit the painting inside (top edge = window top,
    // bottom edge = window bottom, colours extended beyond)
    function withTimeout(p, ms) {
      return Promise.race([p, new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error('mount timeout')); }, ms);
      })]);
    }
    return withTimeout(Promise.all([body.ready, dive.ready]), 4000).then(function () {
      body.draw(performance.now());
      dive.draw(performance.now());
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(resolve);
        });
      });
    }).then(function () {
      document.documentElement.classList.add('has-bay');
    }).catch(function (e) {
      window.__log.push('CATCH: ' + ((e && e.message) || String(e)).slice(0, 200));
      console.error('bay mount failed:', e && e.message || e);
      stage.remove();
      throw e;
    });
  }

  function start(attempt) {
    window.__bayAttempt = attempt;
    mount().catch(function () {
      // transient load failures happen (six parallel fetches on a cold cache);
      // one retry before falling back to the static photo
      if (attempt < 2) setTimeout(function () { start(attempt + 1); }, 1200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { start(0); });
  } else {
    start(0);
  }
})();
