#!/usr/bin/env python3
"""Bake the Monterey Bay skydive photo into the data textures the bay WebGL
shader needs — the same bake the kea's body gets from bake-kea-body.py.

Inputs : backgrounds/light/monterey_bay_watercolor.png (the watercolor)
Outputs: assets/images/kea/bay-planes.png   R,G,B = a hand-painted watercolor
                                           (planes split, edges inked)
         assets/images/kea/bay-mask.png     R = plane id (1 sky, 2 diver,
                                           3 bay), G = ink strength (0-1)
         assets/images/kea/bay.json         plane rects + seabird frame info

usage: uv run --with numpy --with pillow python tools/bake-bay.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "backgrounds/light/monterey_bay_watercolor.png"
IMG = ROOT / "assets/images/kea"
IMG.mkdir(parents=True, exist_ok=True)

W, H = 2048, 917  # bake resolution: same aspect as the 2400x1075 original

img = Image.open(SRC).convert("RGB").resize((W, H), Image.LANCZOS)
rgb = np.asarray(img).astype(np.float32) / 255.0
lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)

# ---------------------------------------------------------------- planes ----
# The scene splits into three planes the shader will treat differently:
#   sky   — above the horizon curve (washes bloom; gentlest motion)
#   diver — the freefly silhouette (rigid; the only plane that "turns")
#   bay   — beneath the horizon (granulating washes; deepest motion)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# Geometry measured from the painting (2048x917 bake frame):
#   horizon: the long sea/sky line, slightly bowed, at about y=200
#   diver:   one silhouette, centered near (1021, 311), radius ~48 px
horizon_y = 200
horizon = horizon_y + 34 * np.sin(np.pi * (xx / W) ** 0.9) - 6
sky = yy < horizon

DIV = {"x": 1021, "y": 311, "r": 48}
dx = (xx - DIV["x"]) / DIV["r"]
dy = (yy - DIV["y"]) / (DIV["r"] * 1.25)
rr = dx * dx + dy * dy
diver = np.clip((1.15 - rr) / 0.35, 0, 1)   # soft disc, feathered edge

bay = (~sky) & (diver < 0.5)

# The body canvas punches plane 2 hard; the dive canvas repaints it inside a
# feathered disc. Dilate plane 2 by ~4 px so the punch sits fully INSIDE the
# dive disc — a sliver of unpunched water at the rim would print a ring.
diver_dil = np.asarray(Image.fromarray((diver * 255).astype(np.uint8))
                       .filter(ImageFilter.MaxFilter(9))).astype(np.float32) / 255
plane2_punch = diver_dil > 0.5

plane_id = np.zeros((H, W), np.uint8)
plane_id[sky] = 1
plane_id[diver > 0.5] = 2
plane_id[bay] = 3
plane_id[plane2_punch] = 2          # punch includes the dilation ring

# ------------------------------------------------------------------- ink ----
# Ink strength: where the painting has real edges (Sobel); the horizon gets a
# hand-inked stroke. Ink around the diver punch is cleared below — the body's
# wick pass would print a dark halo just outside the cutout otherwise.
gx = np.abs(np.gradient(lum, axis=1))
gy = np.abs(np.gradient(lum, axis=0))
edge = np.hypot(gx, gy)
edge /= max(edge.max(), 1e-6)
edge = np.asarray(Image.fromarray((edge * 255).astype(np.uint8))
                  .filter(ImageFilter.GaussianBlur(1.0))).astype(np.float32) / 255
ink = np.clip(edge * 3.2, 0, 1)
ink[bay & (np.abs(yy - horizon) < 3)] = np.maximum(
    ink[bay & (np.abs(yy - horizon) < 3)], 0.7)             # horizon stroke

# Clear ink in a ring around the diver punch: those pixels are the silhouette's
# own Sobel edge bleeding past the punch, and the body's ink-wick pass would
# print a dark halo just outside the cutout. The dive shader inks the rim itself.
ring = (plane2_punch) & (diver < 0.5)
ring = np.asarray(Image.fromarray((ring * 255).astype(np.uint8))
                  .filter(ImageFilter.MaxFilter(9))).astype(np.float32) / 255
ink[ring > 0.5] = 0

mask = np.zeros((H, W, 4), np.uint8)
mask[..., 0] = plane_id
mask[..., 1] = (ink * 255).astype(np.uint8)
mask[..., 3] = 255
Image.fromarray(mask, "RGBA").save(IMG / "bay-mask.png")
img.save(IMG / "bay-planes.png")

# --------------------------------------------------------------- metadata ---
meta = {
    "width": W, "height": H,
    "horizon_y": horizon_y,
    "diver": DIV,
    "planes": {"sky": 1, "diver": 2, "bay": 3},
    "ink_scale": 3.2,
}
(IMG / "bay.json").write_text(json.dumps(meta, indent=2))
print(f"baked: horizon_y={horizon_y} diver=({DIV['x']},{DIV['y']}) r={DIV['r']} -> {IMG}")
