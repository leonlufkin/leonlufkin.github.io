# Fonts

**Latin Modern Roman** — the OpenType form of Donald Knuth's Computer Modern,
i.e. the default LaTeX typeface. Maintained by GUST (the Polish TeX Users
Group). Sourced from the official CTAN `lm` package OTF masters, then subset to
Latin + punctuation and converted to woff2.

Files: `lmroman-{regular,italic,bold,bolditalic}.woff2` (~28–30 KB each,
10 pt optical master, `lmroman10-*`).

License: **GUST Font License (GFL)** — a free, LPPL-1.3c–based license that
permits redistribution and web embedding. Full text:
http://www.gust.org.pl/projects/e-foundry/licenses (the fetch failed at build
time; add `GUST-FONT-LICENSE.txt` here when convenient for completeness).

Regenerate: download the four `lmroman10-*.otf` from CTAN and run
`python3 -m fontTools.subset <otf> --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2000-206F,U+2212" --layout-features='*' --flavor=woff2 --output-file=<out>.woff2`
