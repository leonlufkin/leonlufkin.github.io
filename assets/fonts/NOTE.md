# Fonts

**Latin Modern Roman** — the OpenType form of Donald Knuth's Computer Modern,
i.e. the default LaTeX typeface. Maintained by GUST (the Polish TeX Users
Group). Sourced from the official CTAN `lm` package OTF masters (kept in
`scripts/fonts/`), then subset and converted to woff2.

Files: each of `lmroman-{regular,italic,bold,bolditalic}` comes in two parts
(10 pt optical master, `lmroman10-*`), joined by `unicode-range` in
`assets/css/style.css`:

- `<style>.woff2` (13–15 KB): ASCII and the punctuation the pages use. These
  are the files every visit downloads.
- `<style>-ext.woff2` (18–20 KB): the rest of Latin-1, Latin Extended-A and
  General Punctuation. Fetched only when a page contains such a character.

License: **GUST Font License (GFL)** — a free, LPPL-1.3c–based license that
permits redistribution and web embedding. Full text:
http://www.gust.org.pl/projects/e-foundry/licenses (the fetch failed at build
time; add `GUST-FONT-LICENSE.txt` here when convenient for completeness).

Regenerate, for each style, from the repository root:

```
BASIC="U+0020-007E,U+00A0,U+00B7,U+2013-2014,U+2018-2019,U+201C-201D,U+2026,U+2212"
EXT="U+00A1-00B6,U+00B8-00FF,U+0100-017F,U+2000-2012,U+2015-2017,U+201A-201B,U+201E-2025,U+2027-206F"
uv run --with fonttools --with brotli python -m fontTools.subset scripts/fonts/lmroman10-<style>.otf \
  --unicodes="$BASIC" --flavor=woff2 --output-file=assets/fonts/lmroman-<style>.woff2
uv run --with fonttools --with brotli python -m fontTools.subset scripts/fonts/lmroman10-<style>.otf \
  --unicodes="$EXT" --flavor=woff2 --output-file=assets/fonts/lmroman-<style>-ext.woff2
```

The two lists must stay in step with the `unicode-range` values in the stylesheet.
