"""Photo color sampling must leave layered artwork metadata intact."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "sample_background_colors", ROOT / "scripts/sample-background-colors.py"
)
sampler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sampler)


class BackgroundColorTests(unittest.TestCase):
    def test_samples_photos_without_opening_or_changing_layered_artwork(self):
        layered = json.loads((ROOT / "backgrounds/layered.json").read_text())["light"][0]
        photo = {"u": "/photo.png", "width": 1, "height": 1, "l": "Test photo"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            Image.new("RGB", (8, 6), (80, 120, 160)).save(root / "photo.png")
            manifest = root / "backgrounds.js"
            manifest.write_text(
                "window.BACKGROUNDS = { light: [\n"
                + json.dumps(layered) + ",\n"
                + json.dumps(photo) + "\n] };\n"
            )
            # Layer SVGs deliberately do not exist: only photos may be opened.
            with mock.patch.object(sampler, "ROOT", root), mock.patch.object(
                sampler, "MANIFEST", manifest
            ), contextlib.redirect_stdout(io.StringIO()):
                sampler.main()
            entries = [
                json.loads(match.group(2))
                for line in manifest.read_text().splitlines()
                if (match := sampler.ENTRY.fullmatch(line))
            ]
        self.assertEqual(entries[0], layered)
        self.assertEqual((entries[1]["width"], entries[1]["height"]), (8, 6))
        self.assertEqual(entries[1]["l"], "Test photo")
        self.assertEqual(set(entries[1]["edge"]), {"sides", "caps"})

    def test_generated_moon_subjects_match_the_oriented_photo_disc(self):
        photos = [
            {"u": "/assets/backgrounds/dark/home_moon1.jpg"},
            {"u": "/assets/backgrounds/dark/home_moon2.jpg"},
        ]
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "backgrounds.js"
            manifest.write_text(
                "window.BACKGROUNDS = { dark: [\n"
                + ",\n".join(json.dumps(photo) for photo in photos)
                + "\n] };\n"
            )
            with mock.patch.object(sampler, "MANIFEST", manifest), contextlib.redirect_stdout(io.StringIO()):
                sampler.main()
            entries = [
                json.loads(match.group(2))
                for line in manifest.read_text().splitlines()
                if (match := sampler.ENTRY.fullmatch(line))
            ]
        for entry in entries:
            with self.subTest(photo=entry["u"]), Image.open(ROOT / entry["u"].lstrip("/")) as source:
                image = ImageOps.exif_transpose(source)
                bounds = image.convert("L").point(lambda value: 255 if value > 35 else 0).getbbox()
                subject = entry["subject"]
                self.assertEqual(
                    (subject["x"], subject["y"], subject["x"] + subject["width"], subject["y"] + subject["height"]),
                    bounds,
                )
                self.assertEqual((entry["width"], entry["height"]), image.size)


if __name__ == "__main__":
    unittest.main()
