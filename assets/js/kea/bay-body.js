/* The bay as living watercolor planes, on a canvas under the diver layer.
   Baked by tools/bake-bay.py: bay-planes.png (the painting) + bay-mask.png
   (plane id per pixel: 1 sky, 2 diver, 3 bay; G = ink strength).
   Each plane gets its own slow wet-wash drift — the sky's clouds slide as
   paper-wash puddles, the bay's water breathes in granulation patches, the
   coastline ink wicks along the paper fibres. The diver plane stays rigid;
   bay-dive.js owns it. At rest the render is the painting. */
window.mountBayBody = function mountBayBody(container, {
    planes = '/assets/images/kea/bay-planes.png', mask = '/assets/images/kea/bay-mask.png',
    meta: metaUrl = '/assets/images/kea/bay.json', onFail,
} = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = 'c-baybody__canvas';
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!gl) return onFail && onFail('no webgl');

    const vs = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const fs = `precision highp float;
    uniform vec2 uRes;
    uniform float uT;              // seconds, for the wash drift
    uniform sampler2D uPaint, uMask;


    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    // domain-warp: where a wash puddle boundary sits, sampling drifts sideways
    vec2 warp(vec2 uv, float t, float scale, float speed) {
        return uv + scale * vec2(
            noise(uv * scale + vec2(t * speed, 0.0)) - 0.5,
            noise(uv * scale + vec2(0.0, t * speed) + 7.3) - 0.5);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        vec2 tcoord = vec2(uv.x, 1.0 - uv.y);   // painting px, y down (matches the bake)
        vec4 m = texture2D(uMask, tcoord);
        float plane = m.r * 255.0;
        float ink = m.g;

        // per-plane wash drift. The sky puddles slowly sideways; the bay
        // breathes along the coast (up-down bias); the diver plane does not
        // move (bay-dive.js owns it).
        vec2 uv2 = tcoord;
        if (plane > 0.5 && plane < 1.5) {
            uv2 = warp(tcoord, uT, 0.004, 0.014);
        } else if (plane > 2.5) {
            uv2 = warp(tcoord, uT, 0.0018, 0.010) + vec2(0.0, 0.0015 * noise(tcoord * 2.0 + uT * 0.011));
        }
        vec4 c = texture2D(uPaint, uv2);
        // NOTE: the diver plane is NOT punched here. bay-dive.js paints a
        // tight opaque disc over it; at rest the disc's pixels are identical
        // to the painting below, so no seam shows. A punched hole would flash
        // the page background whenever the disc's coverage dips.
        // ink wicks along paper fibres where the mask says an edge was inked:
        // the line darkens and grows faint hairy side-lines that drift slowly
        float fibre = noise(uv * vec2(90.0, 130.0) + vec2(uT * 0.015, 0.0));
        float line = ink * (0.85 + 0.3 * fibre);
        c.rgb *= 1.0 - 0.16 * line;
        // faint ink hairs beside strong lines, strongest on the coastline
        float hairs = ink > 0.4 ? (noise(uv * 55.0 + vec2(0.0, uT * 0.02)) - 0.5) * 0.10 * ink : 0.0;
        c.rgb *= 1.0 - max(hairs, 0.0);

        gl_FragColor = c;
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
        console.error('bay-body:', e.message);
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
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    const load = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    const ready = Promise.all([fetch(metaUrl).then(r => r.json()), load(planes), load(mask)])
        .then(([, paint, maskImg]) => {
            upload(0, paint);
            upload(1, maskImg);
            gl.uniform1i(U('uPaint'), 0);
            gl.uniform1i(U('uMask'), 1);
            return meta => meta;
        })
        .catch(e => { onFail && onFail(String(e)); return null; });

    let raf = 0, t0 = 0;
    function draw(now) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
        if (!w || !h) { raf = requestAnimationFrame(draw); return; }
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.uniform2f(U('uRes'), w, h);
        gl.uniform1f(U('uT'), (now - t0) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        raf = requestAnimationFrame(draw);
    }
    function wake() { if (!raf) { t0 = performance.now() - (t0 || 0); raf = requestAnimationFrame(draw); } }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    wake();

    return { canvas, ready, wake };
};
