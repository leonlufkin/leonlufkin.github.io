#!/usr/bin/env python3
"""Update solid margin colors from the served photos; never modify images.

Run: uv run --with pillow python scripts/sample-background-colors.py
Photo entries receive edge.sides/caps and browser-oriented dimensions; layered SVG metadata stays.
EXIF orientation is honored for sampling; photo files and other metadata stay.
"""

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "assets/js/backgrounds.js"
ENTRY = re.compile(r"^(\s*)(\{.*\})(,?)(\s*)$")
OVERRIDES = {
    # The castle's mixed stone/foliage edges otherwise yield a muddy gray.
    "thun_schlosssommer.jpg": {"sides": "#829bb1"},
}
SUBJECTS = {
    # Moon-disc bounds in browser (EXIF-oriented) source pixels.
    # These subjects may shift into the black margins to peek past the content box.
    "home_moon1.jpg": {"x": 495, "y": 685, "width": 311, "height": 313},
    "home_moon2.jpg": {"x": 445, "y": 200, "width": 819, "height": 810},
}


def distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


def dominant_color(pixels):
    """Choose a populated color family instead of averaging sky with earth."""
    bins = defaultdict(lambda: [0, 0, 0, 0])
    for rgb in pixels:
        bucket = bins[tuple(c // 24 for c in rgb)]
        bucket[0] += 1
        for channel, value in enumerate(rgb, 1):
            bucket[channel] += value
    points = [
        (tuple(total / count for total in sums), count)
        for _, (count, *sums) in sorted(bins.items())
    ]
    centers = [max(points, key=lambda item: item[1])[0]]
    # Farthest weighted seeds, followed by a fixed number of Lloyd steps:
    # deterministic across runs and inexpensive for the tiny edge sample.
    while len(centers) < min(4, len(points)):
        candidate = max(
            points,
            key=lambda item: item[1] ** 0.5
            * min(distance(item[0], center) for center in centers),
        )[0]
        if candidate in centers:
            break
        centers.append(candidate)
    groups = []
    for _ in range(12):
        groups = [[] for _ in centers]
        for rgb, count in points:
            nearest = min(range(len(centers)), key=lambda i: distance(rgb, centers[i]))
            groups[nearest].append((rgb, count))
        for index, group in enumerate(groups):
            weight = sum(count for _, count in group)
            if weight:
                centers[index] = tuple(
                    sum(rgb[channel] * count for rgb, count in group) / weight
                    for channel in range(3)
                )
    winner = max(range(len(groups)), key=lambda i: sum(count for _, count in groups[i]))
    rgb = centers[winner]
    luma = sum(value * weight for value, weight in zip(rgb, (0.2126, 0.7152, 0.0722)))
    # Keep the photograph's hue, but avoid a loud colored frame. The site's
    # light/dark wash is applied later in CSS, exactly once over both layers.
    restrained = [round(value * 0.88 + luma * 0.12) for value in rgb]
    return "#" + "".join(f"{value:02x}" for value in restrained)


def photo_details(path):
    with Image.open(path) as source:
        orientation = source.getexif().get(274, 1)
        # Browsers apply EXIF orientation. Sampling raw encoded pixels can
        # swap the side/cap colors and report the wrong display dimensions.
        photo = ImageOps.exif_transpose(source).convert("RGB")
        width, height = photo.size
        dx, dy = max(1, round(width * 0.03)), max(1, round(height * 0.03))
        boxes = {
            "sides": [(0, 0, dx, height), (width - dx, 0, width, height)],
            "caps": [(0, 0, width, dy), (0, height - dy, width, height)],
        }
        colors = {}
        for axis, strips in boxes.items():
            size = (16, 128) if axis == "sides" else (128, 16)
            pixels = []
            for box in strips:
                sample = photo.crop(box).resize(size, Image.Resampling.BOX)
                pixels.extend(sample.get_flattened_data())
            colors[axis] = dominant_color(pixels)
        colors.update(OVERRIDES.get(path.name, {}))
        return colors, (width, height), orientation


def edge_colors(path):
    return photo_details(path)[0]


def main():
    lines = MANIFEST.read_text().splitlines()
    updated = []
    count = 0
    corrected = 0
    orientations = Counter()
    for line in lines:
        match = ENTRY.fullmatch(line)
        if match:
            indent, raw, comma, suffix = match.groups()
            entry = json.loads(raw)
            if "u" in entry and "layers" not in entry:
                photo = ROOT / entry["u"].lstrip("/")
                entry["edge"], size, orientation = photo_details(photo)
                orientations[orientation] += 1
                if size != (entry.get("width"), entry.get("height")):
                    corrected += 1
                    print(f"Corrected {photo.name}: EXIF {orientation}, {size[0]}x{size[1]}")
                entry["width"], entry["height"] = size
                if photo.name in SUBJECTS:
                    entry["subject"] = SUBJECTS[photo.name]
                extension = ROOT / "assets/backgrounds/widened" / (photo.stem + ".extension.json")
                if extension.is_file():
                    entry["extension"] = json.loads(extension.read_text())
                line = indent + json.dumps(entry, ensure_ascii=False) + comma + suffix
                count += 1
                print(f"{photo.name}: {entry['edge']['sides']} / {entry['edge']['caps']}")
        updated.append(line)
    if not count:
        raise RuntimeError("No photo entries found; catalog was not changed.")
    # All photos must be readable before a replacement is written.
    MANIFEST.write_text("\n".join(updated) + "\n")
    print(f"Updated margin colors for {count} photos.")
    print(f"Corrected {corrected} display dimensions; EXIF orientations: {dict(sorted(orientations.items()))}")


if __name__ == "__main__":
    main()
