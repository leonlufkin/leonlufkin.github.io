"""The typeset CV must show the real e-mail addresses that cv.html stores encoded.

Run: cd scripts && uv run --with fpdf2 --with fonttools python -m unittest test_build_cv_pdf
"""
import base64
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("build-cv-pdf.py")


@unittest.skipUnless(importlib.util.find_spec("fpdf"), "needs fpdf2")
class ContactLineTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("build_cv_pdf", SCRIPT)
        self.builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.builder)

    def test_encoded_addresses_are_typeset_in_place_of_their_fallback_markup(self):
        encoded = base64.b64encode(b"a@b.example").decode()
        parser = self.builder.CVParser()
        parser.feed(
            '<div class="cv-printhead print-only"><h1>Ada Lovelace</h1>'
            f'<p><span class="email-rev" data-email="{encoded}">elpmaxe.b<span class="at"></span>a</span>'
            ' &middot; example.org</p></div>'
            '<h2>Education</h2>'
        )
        self.assertEqual(parser.name, "Ada Lovelace")
        self.assertEqual(parser.contact, "a@b.example · example.org")
        # The skipped fallback markup must not unbalance what follows it.
        self.assertEqual([heading for heading, _ in parser.sections], ["Education"])


if __name__ == "__main__":
    unittest.main()
