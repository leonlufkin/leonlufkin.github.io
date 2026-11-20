# Backgrounds

The site has two backgrounds, chosen by the theme alone. Both are fixed to the
viewport: they never depend on the page, its scroll position, a scrollbar or a
mobile browser's bars. The grid button in the nav hides the page's text box, so
either one can be seen whole (on the home page that reveals the skydiver, or
the moon).

## Light: Monterey Bay

A layered low-poly scene. Three bitmap layers (sky, coast, diver) are composited
by `assets/js/landscape.js` (WebGL, with a Canvas2D fallback). When the window is
taller or wider than the artwork the layers move apart, and the sky and ocean
between them are painted from the boundary curves and palettes in
`assets/js/landscape-scene.js`.

The masters are the SVGs in `scripts/landscape/`, about 60,000 triangles in
all. Browsers need seconds to rasterize them, so the site ships WebP bitmaps at
two densities instead (`assets/images/skydiving-*-1x.webp` for phones and small
windows, `-2x.webp` otherwise). Regenerate them after changing a master:

```
uv run --with resvg-py --with pillow python scripts/export-landscape.py
```

## Dark: the moon

`assets/backgrounds/dark/home_moon2.jpg`, shown whole at contain scale with the
moon's disc on the center of the viewport. Its dimensions, edge colors and the
disc's bounds (`subject`) live in the inline bootstrap at the top of each page,
which applies the background before first paint.

## This directory

Everything here except this README is **gitignored**: it is the place for raw
originals (large HEIC/JPG/MP4 files) that should never be committed or deployed.
