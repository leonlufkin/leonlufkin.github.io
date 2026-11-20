#!/usr/bin/env python3
"""Rasterize the layered Monterey Bay artwork into the WebP layers the site loads.

The SVGs in scripts/landscape/ are the masters: about 60,000 stroked triangles
that take a browser seconds to parse and rasterize on its main thread. The site
therefore ships bitmaps instead, at two densities of the 1721x771 source frame:

    1x  phones and small windows
    2x  everything else

The diver is tiny (86x71 source pixels) and is exported at twice each set's
density so the one figure in the scene stays crisp.

Run: uv run --with resvg-py --with pillow python scripts/export-landscape.py
"""
import io
import re
from pathlib import Path

import resvg_py
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / "scripts/landscape"
OUTPUT = ROOT / "assets/images"
# layer -> density multiplier within each set
LAYERS = {"sky": 1, "coast": 1, "diver": 2}
SETS = (1, 2)
QUALITY = 92


def source_size(svg):
    root = re.search(r"<svg\b[^>]*>", svg).group(0)
    return tuple(int(re.search(rf'\b{name}="(\d+)"', root).group(1)) for name in ("width", "height"))


def main():
    for layer, boost in LAYERS.items():
        svg = (MASTERS / f"skydiving-{layer}.svg").read_text(encoding="utf-8")
        width, height = source_size(svg)
        for density in SETS:
            scale = density * boost
            png = resvg_py.svg_to_bytes(svg_string=svg, width=width * scale, height=height * scale)
            image = Image.open(io.BytesIO(bytes(png))).convert("RGBA")
            target = OUTPUT / f"skydiving-{layer}-{density}x.webp"
            image.save(target, "WEBP", quality=QUALITY, alpha_quality=100, method=6)
            print(f"{target.relative_to(ROOT)}  {image.width}x{image.height}  {target.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
