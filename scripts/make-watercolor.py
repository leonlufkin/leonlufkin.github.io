#!/usr/bin/env python3
"""Turn "Eye on the Sky" into a Monterey Bay watercolor.

usage: uv run --with numpy --with pillow python scripts/make-watercolor.py IN OUT [--width N]

Not a filter chain: the image is segmented into three pigment planes and each
one is painted the way a watercolorist would lay it down.

  1. grade            slight curve, saturation lift -> pigment that dries bright
  2. planes           soft masks for SKY (wet-on-wet), BAY (granulating wash),
                      LAND (drybrush / broken color)
  3. sky              wet-in-wet bleed driven by a water map; cloud wisps and
                      backrun rims bloom unevenly
  4. bay              granulating cobalt/teal blotches; darker value mid-bay,
                      paler toward both shores
  5. land             thin wash with drybrush skips -> paper shows through;
                      a warm ochre glaze over fields and beach
  6. lift             soft lifted highlights on wave spray and foam lines
  7. unify            paper texture everywhere; gentle warm light
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import watercolor_lib as wl


def plane_masks(h, w, rgb):
    """Sky / bay / land masks grounded in this photo's geometry.

    Sky: above the horizon curve (upper-left ~y=0.13, gently rising right).
    Land: the bottom band — beach, Santa Cruz, farmland. Its signature is
    weak blue dominance AND dark-to-mid value; sandy beach is warm/bright.
    Bay: everything else (strong blue dominance, including hazy far water).
    """
    lum = wl.luminance(rgb)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    yn, xn = yy / h, xx / w

    # Land: below a piecewise coastline curve fitted to the photo's bay arc.
    # City hill left, spit center, farmland right. Color gate: land is warm
    # sand or weakly blue-dominant (the water is strongly blue).
    coast_pts = [(0.0, 0.58), (0.3, 0.66), (0.55, 0.87), (0.8, 0.82), (1.0, 0.74)]
    coast = np.interp(xn, [p[0] for p in coast_pts], [p[1] for p in coast_pts])
    band = wl.smoothstep(-0.02, 0.06, yn - coast) * wl.smoothstep(0.50, 0.56, yn)
    warm = wl.smoothstep(0.88, 1.04, rgb[..., 0] / np.maximum(rgb[..., 2], 1e-4))
    dull = wl.smoothstep(0.55, 0.40, rgb[..., 2] - rgb[..., 0])
    land = wl.blur(band * np.maximum(warm, dull), 4)

    # Sky: above the horizon curve.
    horizon = 0.115 + 0.05 * xn + 0.03 * np.sin(xn * 5.2)
    sky = wl.smoothstep(horizon + 0.06, horizon - 0.06, yn)
    sky = sky * wl.smoothstep(0.20, 0.45, lum)
    sky = np.clip(sky - land, 0, 1)
    sky = wl.blur(sky, 8)

    bay = np.clip(1.0 - land - sky, 0, 1)
    total = bay + sky + land + 1e-5
    return sky / total, bay / total, land / total


def paint_sky(rgb, sky, seed):
    """Wet-on-wet sky: terraced puddle levels, blooms, backrun rims.

    A wash on a tilted sheet doesn't stay a gradient — it dries in uneven
    puddle bands with ragged bleeding boundaries. We quantize tone into a
    few levels and make the boundaries ragged and wet.
    """
    h, w = rgb.shape[:2]
    paper = np.array([0.985, 0.975, 0.955], np.float32)
    water = wl.smoothstep(0.30, 0.75, wl.fbm(h, w, seed, octaves=4, base=(3, 10))) * sky

    # 1. Terraced wash: quantize sky luminance into puddle bands with
    #    noise-warped boundaries.
    lum = wl.luminance(rgb)
    warp = wl.blur_gray(wl.fbm(h, w, seed + 2, octaves=3, base=(4, 18)), 6)
    lw = lum + 0.18 * (warp - 0.5) * 2.0
    steps = 5
    terr = np.floor(lw * steps) / steps + (0.35 / steps)
    terr = np.clip(terr, 0, 1)
    # Ragged boundary: soft near the level cut, hard where wet.
    delta = np.abs(lw - terr)
    softness = 0.03 + 0.05 * (1.0 - water)
    blend = 1.0 - wl.smoothstep(0.0, softness, delta)
    tone = lum * (1 - blend) + terr * blend
    out = rgb * (tone / np.maximum(lum, 1e-4))[..., None]

    # 2. Puddle tint: darker bands lean cerulean-blue, light bands lean
    #    paper. No green — green makes mud in a sky.
    t = wl.smoothstep(0.3, 0.75, terr)
    out[..., 2] = np.clip(out[..., 2] + 0.10 * (1 - t) * sky, 0, 1)
    out[..., 0] = np.clip(out[..., 0] * (1 - 0.10 * (1 - t) * sky), 0, 1)

    # 3. Cloud wisps bloom into near-pure paper; wobbly wet edges.
    lum2 = wl.luminance(out)
    cloud = wl.smoothstep(0.66, 0.88, lum2) * sky
    halo = np.clip(wl.blur_gray(cloud, 24) - cloud, 0, 1)
    wobble = wl.fbm(h, w, seed + 5, octaves=3, base=(2, 14))
    bloom = np.clip(halo * (0.5 + 1.2 * wobble), 0, 1) * (0.4 + 0.6 * water)
    out = out * (1 - bloom)[..., None] + paper * bloom[..., None]

    # 4. Wet bleed only in the sky band; darks (the skydiver) hold shape.
    soft = wl.blur(out, 2)
    ran = wl.blur(out, 22)
    lum3 = wl.luminance(out)
    hold = 0.25 + 0.75 * wl.smoothstep(0.08, 0.30, lum3)
    run = water * hold
    out = soft * (1 - 0.22 * run)[..., None] + ran * (0.22 * run)[..., None]

    # 5. Backruns: dark rims where water pushed into the damp wash.
    lum4 = wl.luminance(out)
    rim = wl.backruns(wl.smoothstep(0.50, 0.80, lum4) * sky, radius=24, depth=0.32)
    rim = rim * wl.smoothstep(0.35, 0.75, wl.fbm(h, w, seed + 3, octaves=3, base=14))
    out *= (1 - rim)[..., None]
    return out






def paint_bay(rgb, bay, seed):
    """Granulating wash: blotchy pigment density, deep mid-bay, pale shores."""
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    yn, xn = yy / h, xx / w
    cx, cy = 0.42, 0.62          # deepest water sits center-left of frame
    dist = np.sqrt(((xn - cx) * 1.6) ** 2 + (yn - cy) ** 2)
    deep = wl.smoothstep(0.60, 0.15, dist) * bay

    g1 = wl.granulation(1.0, h, w, seed + 11, cells=9)
    g2 = wl.granulation(1.0, h, w, seed + 23, cells=34)
    gran = np.clip(0.65 * g1 + 0.35 * g2, -1, 1) * (0.35 + 0.65 * deep)
    pos = wl.smoothstep(0.02, 0.16, gran)     # cobalt pile-up: darker, bluer
    neg = wl.smoothstep(-0.02, -0.16, gran)   # thin skim: lighter, turquoise
    wash = rgb.copy()
    wash[..., 2] = np.clip(wash[..., 2] * (1 + 0.22 * pos - 0.06 * neg), 0, 1)
    wash[..., 1] = np.clip(wash[..., 1] * (1 + 0.10 * pos - 0.02 * neg), 0, 1)
    wash[..., 0] = np.clip(wash[..., 0] * (1 - 0.30 * pos), 0, 1)
    wash = wash * (1 - 0.16 * pos[..., None])
    # Deep value mid-bay (the eye's anchor), much lighter toward shores.
    wash *= (1 - 0.18 * deep)[..., None]

    # Shoreward the wash runs out: pale granulating wash, paper showing
    # through between granules.
    pale = wl.smoothstep(0.30, 0.70, dist) * bay
    shore_tone = np.array([0.62, 0.78, 0.83], np.float32)
    skim = wl.value_noise(h, w, 60, seed + 27)
    shore_lift = shore_tone * (0.85 + 0.15 * skim)[..., None]
    wash = wash * (1 - 0.60 * pale)[..., None] + shore_lift * (0.60 * pale)[..., None]
    return np.clip(wash, 0, 1)


def paint_land(rgb, land, paper, seed):
    """Drybrush / broken color over a thin warm wash; dark pooling at edges."""
    h, w = rgb.shape[:2]
    lum = wl.luminance(rgb)

    # Thin warm wash base: paper glows through, ochre bias.
    thin = rgb * 0.55 + paper * 0.45
    thin[..., 0] = np.clip(thin[..., 0] + 0.06, 0, 1)
    thin[..., 1] = np.clip(thin[..., 1] + 0.03, 0, 1)

    # Terraced field tones: a painter flattens the patchwork into a few
    # value shapes with ragged wet edges, like the sky.
    warp = wl.blur_gray(wl.fbm(h, w, seed + 45, octaves=3, base=(5, 20)), 5)
    lw = lum + 0.14 * (warp - 0.5) * 2.0
    steps = 4
    terr = np.clip(np.floor(lw * steps) / steps + (0.35 / steps), 0, 1)
    delta = np.abs(lw - terr)
    blend = 1.0 - wl.smoothstep(0.0, 0.035, delta)
    tone = lum * (1 - blend) + terr * blend
    out = thin * (tone / np.maximum(lum, 1e-4))[..., None]

    # Paper tooth: crisp, high-frequency skips — drybrush drags across the
    # weave, it does not fade softly.
    tooth = 0.5 * wl.value_noise(h, w, 90, seed + 41) + \
            0.3 * wl.value_noise(h, w, 180, seed + 42) + \
            0.2 * wl.value_noise(h, w, 360, seed + 43)
    streak = wl.fbm(h, w, seed + 44, octaves=2, base=(6, 60))
    hi = wl.smoothstep(0.52, 0.72, np.clip(tooth * (0.55 + 0.45 * streak), 0, 1))
    out = out * (1 - hi)[..., None] + paper * hi[..., None]

    # Pigment creeps into creases: dark pools along the coastline where
    # land meets bright water/foam.
    edge = np.abs(wl.blur_gray(lum, 2) - lum)
    pool = wl.smoothstep(0.05, 0.16, edge) * wl.smoothstep(0.55, 0.25, lum)
    stroke = wl.smoothstep(0.35, 0.75, wl.fbm(h, w, seed + 61, octaves=3, base=16))
    accents = pool * (0.45 + 0.55 * stroke) * land
    out = out * (1 - 0.50 * accents)[..., None]

    # Coherent dark accents (towns, roads) as rough dark strokes.
    dark = wl.smoothstep(0.45, 0.15, wl.blur(lum, 4)) * land
    out = out * (1 - 0.40 * dark * stroke)[..., None]
    return out * land[..., None] + rgb * (1 - land[..., None])



def lift_highlights(rgb, seed):
    """Lift color with a damp brush: foam lines and spray return to paper."""
    h, w = rgb.shape[:2]
    lum = wl.luminance(rgb)
    bright = wl.smoothstep(0.78, 0.94, lum)
    wobble = wl.smoothstep(0.4, 0.8, wl.fbm(h, w, seed + 71, octaves=3, base=24))
    lift = np.clip(bright * (0.70 + 0.30 * wobble), 0, 1)
    paper = np.array([0.985, 0.975, 0.955], np.float32)
    return rgb * (1 - lift)[..., None] + paper * lift[..., None]


def watercolor(src, width=2400, seed=7):
    img = Image.open(src).convert("RGB")
    if img.width != width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    rgb = np.asarray(img).astype(np.float32) / 255.0
    h, w = rgb.shape[:2]

    # 1. grade: pigment that dries bright, never gray.
    mean = rgb.mean(axis=2, keepdims=True)
    rgb = np.clip(mean + (rgb - mean) * 1.22, 0, 1)
    lum = wl.luminance(rgb)
    rgb = np.clip(rgb * (1.0 + 0.10 * wl.smoothstep(0.75, 0.35, lum))[..., None], 0, 1)

    # Warm bright paper shows through everywhere at the end; keep a copy.
    paper = np.array([0.985, 0.975, 0.955], np.float32)

    # 2. planes
    sky, bay, land = plane_masks(h, w, rgb)

    # 3-5. paint each plane its own way
    out = paint_sky(rgb, sky, seed)
    out = paint_bay(out, bay, seed)
    out = paint_land(out, land, paper, seed)

    # 6. lifted highlights: wave spray, foam, glint
    out = lift_highlights(out, seed)

    # 7. unify: cold-press weave + slight warm light from upper left
    out = out * wl.paper_texture(h, w, seed)[..., None]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    warm = 1.0 + 0.04 * (1.0 - (xx / w + yy / h) / 2.0)
    out = np.clip(out * warm[..., None], 0, 1)
    return Image.fromarray(wl.to_u8(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--width", type=int, default=2400)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    watercolor(a.src, a.width, a.seed).save(a.dst, quality=92)
    print(f"wrote {a.dst}")


if __name__ == "__main__":
    main()
