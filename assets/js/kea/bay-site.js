/* Mounts the living bay (bay-body.js + bay-dive.js) as the site's background.
   The static watercolor stays in place for first paint and as the no-WebGL
   fallback; once the canvases are ready they take over (html.has-bay hides
   the static layer, which is pixel-identical at rest anyway). */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var stage = document.createElement('div');
  stage.id = 'bay-stage';
  stage.setAttribute('aria-hidden', 'true');

  function mount() {
    var opts = {
      planes: '/assets/images/kea/bay-planes.png',
      mask: '/assets/images/kea/bay-mask.png',
      meta: '/assets/images/kea/bay.json',
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
    Promise.all([body.ready, dive.ready]).then(function () {
      // two frames out: both raf loops have composed at least one frame
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          document.documentElement.classList.add('has-bay');
        });
      });
    }).catch(function () {
      // either layer failed: fall back to the static photo
      stage.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
