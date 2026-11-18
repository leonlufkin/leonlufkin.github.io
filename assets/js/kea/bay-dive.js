/* The skydiver as a rigid cutout with ink dynamics — the kea's head logic,
   ported: the painted diver is a separate plane; the pointer's pull tilts it
   on damped springs (fall-line pitch), and wind streaks stream past it harder
   the faster it falls. At rest the render is the painting.
   The body canvas (bay-body.js) punches the diver out of the painting; this
   canvas repaints it inside a soft disc centred on it, sampling the painting
   rotated about the diver's centre by the spring angle. */
window.mountBayDive = function mountBayDive(container, {
    planes = '/assets/images/kea/bay-planes.png', mask = '/assets/images/kea/bay-mask.png',
    meta: metaUrl = '/assets/images/kea/bay.json', onFail,
} = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = 'c-baydive__canvas';
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return onFail && onFail('no webgl');

    const vs = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const fs = `precision highp float;
    uniform vec2 uRes, uPaintSize;
    uniform float uT;
    uniform vec2 uPitch;     // tilt as (cos, sin) of the fall-line angle
    uniform float uSpeed;    // 0 at rest -> 1 flat-spinning
    uniform float uTurn;     // 0 = at rest (pure painting), 1 = fully turned
    uniform vec2 uDiver;     // diver centre, painting px (y down)
    uniform float uDiverR;
    uniform sampler2D uPaint, uMask;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        vec2 tcoord = vec2(uv.x, 1.0 - uv.y);           // painting px, y down
        vec2 pc = tcoord * uPaintSize;
        vec2 d = pc - uDiver;

        // the cutout disc: hugs the diver, feathered — it lies OVER the
        // painting (the body no longer punches), so at rest it must match the
        // painting pixel for pixel out to its rim
        float rr = length(d / vec2(uDiverR, uDiverR * 1.25));
        float disc = 1.0 - smoothstep(0.95, 1.12, rr);

        // the cutout content: unrotated at rest (pixel-identical to the
        // painting below), rotating about the diver centre as uTurn rises
        float c = uPitch.x, s = uPitch.y;
        vec2 r = uDiver + mat2(c, -s, s, c) * d;
        vec4 cutRot = texture2D(uPaint, clamp(r / uPaintSize, 0.0, 1.0));
        vec4 cutRest = texture2D(uPaint, clamp(tcoord, 0.0, 1.0));
        vec4 cut = mix(cutRest, cutRot, clamp(uTurn, 0.0, 1.0));
        vec4 m = texture2D(uMask, clamp(tcoord, 0.0, 1.0));

        // wind streaks: thin ink lines streaming past the diver, faster with speed
        float along = d.y;
        float streakField = noise(vec2(d.x * 0.09, (along + uT * (40.0 + 160.0 * uSpeed)) * 0.05));
        float streak = smoothstep(0.62, 0.72, streakField) * smoothstep(uDiverR * 2.8, uDiverR * 0.7, abs(d.x));
        float fade = smoothstep(-uDiverR * 3.2, -uDiverR * 0.5, along) * smoothstep(uDiverR * 3.5, uDiverR * 0.8, along);
        float wind = streak * fade * uSpeed * 0.55;
        // The disc only exists while the diver is turning: at rest the cutout
        // is pixel-identical to the painting below it, so any disc edge, rim
        // ink or sample rotation would show as a ring. uTurn gates it all.
        float turn = clamp(uTurn, 0.0, 1.0);
        vec4 outc = cut * disc;
        float ink = m.g * (1.0 - smoothstep(0.45, 0.95, rr));
        outc.rgb *= 1.0 - 0.16 * ink * turn * (0.8 + 0.2 * sin(uT * 1.7));
        outc = mix(cut, outc, turn);

        vec4 streaks = vec4(vec3(0.21, 0.20, 0.24) * wind, wind);
        float a = outc.a + (1.0 - outc.a) * streaks.a;
        vec3 col = (outc.rgb * outc.a + streaks.rgb * streaks.a * (1.0 - outc.a)) / max(a, 1e-4);
        gl_FragColor = vec4(col * a, a);
    }`;

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    }
    let prog;
    try {
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
        console.error('bay-dive:', e.message);
        return onFail && onFail(e.message);
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);

    function upload(unit, img) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    // damped springs, exactly the kea's head logic
    const spring = (k, zeta) => ({ v: 0, target: 0, value: 0, k, c: 2 * zeta * Math.sqrt(k) });
    const pitch = spring(30, 0.55), speed = spring(20, 0.8);
    let pointer = null, raf = 0, last = 0, fidgetT = 0;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 0.05); last = now;
        // The pointer's pull drives the fall-line: the diver banks toward it.
        // No idle fidget — any rest rotation would force the cutout disc to
        // stay visible (it must sit exactly on the painting at rest).
        if (pointer) {
            const r = container.getBoundingClientRect();
            const nx = (pointer.x - r.left) / r.width - 0.5;
            pitch.target = Math.max(-0.5, Math.min(0.5, nx * 1.2));
            speed.target = Math.min(1, Math.hypot(pointer.vx || 0, pointer.vy || 0) / 900);
        } else {
            pitch.target = 0;
            speed.target = 0;
        }
        fidgetT += dt;
        step(pitch, dt); step(speed, dt);
        draw(now);
        // keep drawing while visible: the canvas composites over the wash layer
        raf = document.hidden ? 0 : requestAnimationFrame(tick);
    }
    function draw(now) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
        if (!w || !h) return;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(U('uRes'), w, h);
        gl.uniform1f(U('uT'), now / 1000);
        gl.uniform2f(U('uPitch'), Math.cos(pitch.value), Math.sin(pitch.value));
        gl.uniform1f(U('uSpeed'), Math.max(0, Math.min(1, speed.value)));
        gl.uniform1f(U('uTurn'), Math.min(1, Math.abs(pitch.value) * 6 + speed.value * 1.4));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
    addEventListener('pointermove', e => {
        const prev = pointer;
        pointer = { x: e.clientX, y: e.clientY };
        if (prev) {
            const dt = Math.max((e.timeStamp - prev.t) / 1000, 0.001);
            pointer.vx = (e.clientX - prev.x) / dt;
            pointer.vy = (e.clientY - prev.y) / dt;
        }
        wake();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

    const load = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    const loaded = Promise.all([fetch(metaUrl).then(r => r.json()), load(planes), load(mask)])
        .then(([meta, paint, maskImg]) => {
            upload(0, paint); upload(1, maskImg);
            gl.uniform1i(U('uPaint'), 0);
            gl.uniform1i(U('uMask'), 1);
            gl.uniform2f(U('uPaintSize'), meta.width, meta.height);
            gl.uniform2f(U('uDiver'), meta.diver.x, meta.diver.y);
            gl.uniform1f(U('uDiverR'), meta.diver.r);
            wake();
        })
        .catch(e => { onFail && onFail(String(e)); });

    return { canvas, ready: loaded, wake };
};
