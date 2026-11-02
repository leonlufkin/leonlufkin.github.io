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

Display rule: a photo is never zoomed in. The site renders backgrounds with
`contain` (whole photo, natural aspect, centered) and fills leftover space
with the photo's own averaged edge color (stored in the manifest). Panoramas
(aspect > 2) are exported wider (3200px) and their fill color comes from the
top/bottom edges, since that's where their fill bands appear.

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
