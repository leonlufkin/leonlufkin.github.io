#!/usr/bin/env python3
"""Watercolor primitives shared by make-watercolor.py and preview variants.

Everything is numpy + Pillow only. Arrays are float32 in [0, 1].
"""
import numpy as np
from PIL import Image, ImageFilter


def luminance(rgb):
    return rgb[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)


def saturation(rgb):
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    return (mx - mn) / np.maximum(mx, 1e-4)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def to_u8(a):
    return (np.clip(a, 0, 1) * 255).astype(np.uint8)


def blur(a, sigma):
    """Gaussian blur on an HxW or HxWx3 float array."""
    if a.ndim == 2:
        img = Image.fromarray(to_u8(a))
    else:
        img = Image.fromarray(to_u8(a), "RGB")
    img = img.filter(ImageFilter.GaussianBlur(sigma))
    return np.asarray(img).astype(np.float32) / 255.0


def blur_gray(a, sigma):
    return blur(a, sigma)


def value_noise(h, w, cells, seed):
    """Value noise via bilinear upsampling of a random lattice.

    `cells` may be an int or an (cy, cx) tuple for anisotropic lattices
    (e.g. (4, 40) gives horizontal streaks).
    """
    rng = np.random.default_rng(seed)
    if np.isscalar(cells):
        cells = (cells, cells)
    cy, cx = cells
    lattice = rng.random((cy + 1, cx + 1)).astype(np.float32)
    img = Image.fromarray(to_u8(lattice), "L").resize((w, h), Image.BILINEAR)
    return np.asarray(img).astype(np.float32) / 255.0


def fbm(h, w, seed, octaves=4, base=6, cells=None):
    """Fractal brownian motion of value noise, normalized to [0, 1]."""
    out = np.zeros((h, w), np.float32)
    total = 0.0
    amp = 1.0
    for o in range(octaves):
        c = base * (2 ** o) if np.isscalar(base) else tuple(v * (2 ** o) for v in base)
        out += amp * value_noise(h, w, c, seed + o * 101)
        total += amp
        amp *= 0.55
    return out / total


def channel_jitter(rgb, amount, seed):
    """Misregister channels a hair, like pigment floors drying unevenly."""
    rng = np.random.default_rng(seed)
    out = rgb.copy()
    for c in range(3):
        dx, dy = rng.integers(-amount, amount + 1, size=2)
        out[..., c] = np.roll(out[..., c], (dy, dx), axis=(0, 1))
    return out


def wet_blend(rgb, water, soft_sigma=3, wet_sigma=22, dark_hold=0.35):
    """Wet-on-wet: low-frequency `water` map picks how far pigment ran.

    `water` in [0,1]; dark areas (luminance below the hold range) keep their
    edges so silhouettes survive the soak.
    """
    lum = luminance(rgb)
    hold = smoothstep(0.10, 0.45, lum)
    w = water * np.maximum(hold, dark_hold)
    soft = blur(rgb, soft_sigma)
    wet = blur(rgb, wet_sigma)
    return soft * (1 - w)[..., None] + wet * w[..., None]


def backruns(blobs, radius=15, depth=0.12):
    """Dark rims where water pushed into a wet wash.

    `blobs` is a soft HxW mask in [0,1]; returns a rim mask peaking just
    outside the blob edges.
    """
    spread = blur_gray(blobs, radius)
    return np.clip(spread - blobs, 0, 1) ** 0.7 * depth


def granulation(strength, h, w, seed, cells=9):
    """Blotchy +-value modulation that reads as granulating pigment."""
    g = fbm(h, w, seed, octaves=5, base=cells)
    return (g - 0.5) * 2.0 * strength


def drybrush_broken(rgb, lum, noise_hi, noise_lo, paper):
    """Broken color: thin wash skips show paper, thick strokes go darker."""
    hi = smoothstep(0.60, 0.85, noise_hi)   # paper showing through
    lo = smoothstep(0.40, 0.15, noise_lo)   # pigment piled up
    out = rgb * (1 - 0.16 * lo)[..., None]
    return out * (1 - hi)[..., None] + paper * hi[..., None]


def paper_texture(h, w, seed, strength=0.025):
    """Cold-press weave: fine grain plus a few fiber streaks. Multiplicative."""
    grain = fbm(h, w, seed, octaves=3, base=160)
    fibers = value_noise(h, w, (h // 90, 6), seed + 7)
    tex = 1.0 + strength * ((grain - 0.5) * 2.0 + (fibers - 0.5) * 0.8)
    return np.clip(tex, 0.9, 1.1)
