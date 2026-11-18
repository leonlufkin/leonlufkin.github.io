/* Mounts the living bay (bay-body.js + bay-dive.js) as the site's background.
   The static watercolor stays in place for first paint and as the no-WebGL
   fallback; once the canvases are ready they take over (html.has-bay hides
   the static layer, which is pixel-identical at rest anyway). */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var stage = document.createElement('div');
  stage.id = 'bay-stage';
  stage.setAttribute('aria-hidden', 'true');

  function letterbox(canvas) {
    canvas.style.position = 'absolute';
    canvas.style.left = '50%';
    canvas.style.top = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';
    // contain geometry, matching body::after's photo sizing
    canvas.style.width = 'min(100vw, calc(100vh * 2048 / 917))';
    canvas.style.height = 'min(100vh, calc(100vw * 917 / 2048))';
  }

  function mount() {
    var opts = {
      planes: '/assets/images/kea/bay-planes.png',
      mask: '/assets/images/kea/bay-mask.png',
      meta: '/assets/images/kea/bay.json',
      onFail: function () { stage.remove(); }
    };
    var body = mountBayBody(stage, opts);
    var dive = mountBayDive(stage, opts);
    letterbox(body.canvas);
    letterbox(dive.canvas);
    stage.appendChild(body.canvas);
    stage.appendChild(dive.canvas);
    document.body.appendChild(stage);
    document.documentElement.classList.add('has-bay');
    Promise.all([body.ready, dive.ready]).catch(function () {
      // either layer failed: fall back to the static photo
      document.documentElement.classList.remove('has-bay');
      stage.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
