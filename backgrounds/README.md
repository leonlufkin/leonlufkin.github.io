# Background source library

Raw originals for the site's rotating backgrounds. Everything here except this
README is **gitignored** — these are large HEIC/JPG/MP4 files that should never
be committed or deployed. Web-ready versions get processed into `assets/`
as a separate step.

## Layout

```
backgrounds/
  light/          photos suited to light mode (avg luminance > 35%)
  dark/           photos suited to dark mode  (avg luminance ≤ 35%)
  skipped/        kept for other uses, excluded from the background rotation
  video/          videos; specific frames to be extracted later
  widened/        AI-widened variants (+ optional .align sidecars)
  luminance.txt   measured average luminance (0–100) per photo
  thirds-todo.txt photos marked for recomposition to rule-of-thirds framing
```

Display rule: originals remain fully visible with `contain`. Horizontal
margins extend each photo row using separate colors from its left and right
edges. Two one-pixel-wide strips fill the corresponding half of the viewport
behind the original. Each changes vertically, and neither mixes in colors
from the opposite side. Their center join stays hidden behind the sharp photo.
Top/bottom margins retain a single sampled color. Of the photos in the active good
set, only those whose aspect ratios cover the most screen area are eligible
(within two percentage points of the best fit). The theme then prefers light
or dark photos among those matches. Photos are never cropped or stretched.
The photo fades into the margin along its left/right or top/bottom boundary,
depending on the screen shape. The always-visible **Photo blend** slider in
the style panel adjusts this transition from 0–40% of the photo dimension
per edge (default 12%). It updates immediately and saves the setting locally,
while leaving the center sharp. Fill and photo
use identical washes so the transition does not darken or brighten twice.

`assets/js/background-rows.js` derives and caches the two horizontal color strips
in the browser from thin 3% edge samples, with slight vertical smoothing.
Each photo also has two restrained fallback colors: `edge.sides` for left/right
margins while its strip loads and `edge.caps` for top/bottom margins. The runtime
applies the same light/dark wash over photo and margins.
Run `uv run --with pillow python
scripts/sample-background-colors.py` to derive colors from thin border strips;
the sampler also runs at the end of the export pipeline. Thun's side color
has an explicit muted-blue override. Dimensions and samples honor EXIF rotation.

The Sossusvlei dune-ridge photo has an optional, quiet generated extension,
configured by its `assets/backgrounds/widened/*.extension.json` sidecar.
On wide screens this layer sits between the row colors and the original,
with an actual 8px blur and faded outer edges. The original is kept in front.
Other photos use row colors alone. A `?photo=sossusvlei_dune2` review link
opens that photo temporarily without changing either curated set.

Open the local photo gallery to curate separate **Laptop** and **Mobile**
sets. Click a photo to preview it on the page; use its separate **Good**
checkbox to include or exclude it. Tabs and previews retain unsaved choices.
**Save** writes both sets to `assets/js/background-selections.js` through the
loopback-only development server (`python3 scripts/serve.py 4000 .`). Each set
must contain at least one photo. Regular public visitors see the gallery
without editing controls.

Each manifest entry records the exported JPEG's width and height. The current
photo stays across navigation and resizing while it remains eligible. Mobile
uses a viewport at most 620px wide, or a touch device with a short side at most
620px (including landscape phones). Panoramas are exported up to 3200px wide.

To skip a photo (keep it, but out of rotation): move it to `skipped/`, delete
its JPEG from `assets/backgrounds/`, and rerun `scripts/export-backgrounds.sh`.

## How photos were sorted

Each image was downscaled and its average relative luminance measured
(0.2126 R + 0.7152 G + 0.0722 B). The split at 35% falls in a natural gap in
the data: below it are night shots, dusk, stained glass, and dim interiors.
`luminance.txt` has the per-file values. The classification is just a starting
point — to reclassify a photo, simply move the file between `light/` and
`dark/`.

## Adding new backgrounds

Drop the original into `light/` or `dark/` (eyeball it, or borderline cases sit
around luminance 30–40). Videos go to `video/` until a frame is picked.

## Pipeline (planned next steps)

1. Export each chosen original to a web-sized JPEG (~1600px, q65,
   `sips -Z 1600 -s format jpeg -s formatOptions 65 in --out out.jpg`)
   into `assets/backgrounds/light/` or `assets/backgrounds/dark/` (committed).
2. Generate a manifest (list of filenames per mode) used by a small script to
   pick a random background per page load, honoring light/dark mode.
3. Extract chosen frames from `video/` clips into stills and run them through
   the same export.
