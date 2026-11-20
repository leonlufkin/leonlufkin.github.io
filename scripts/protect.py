#!/usr/bin/env python3
"""Build an encrypted, deployable copy of the site under dist/.

Each page's <body> content is encrypted with AES-256-CBC (key = PBKDF2-SHA256
of the password) so the plaintext is NOT present in the deployed source; the
browser gate (assets/js/gate.js) prompts for the password and decrypts it.

Local editing is unaffected: the working-tree *.html stay plaintext. Run this
only to produce a deploy build, then push dist/ to the deploy branch.

Usage:
    GATE_PASSWORD=yourpassword python3 scripts/protect.py
    # or run without the env var and it will prompt.

Crypto: PBKDF2-HMAC-SHA256 (200k iters) → 32-byte key; AES-256-CBC with a
random per-page IV and manual PKCS7 padding (openssl -nopad). WebCrypto on the
browser derives the identical key and strips PKCS7 automatically.
"""
import os, re, sys, json, base64, hashlib, shutil, getpass, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PAGES = ["index.html", "research.html", "cv.html", "404.html"]
ITERS = 200000
MARKER = b"GATE1\n"


def aes_cbc_encrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    pad = 16 - (len(data) % 16)
    data = data + bytes([pad]) * pad  # PKCS7
    p = subprocess.run(
        ["openssl", "enc", "-aes-256-cbc", "-nopad",
         "-K", key.hex(), "-iv", iv.hex()],
        input=data, capture_output=True)
    if p.returncode != 0:
        raise SystemExit("openssl failed: " + p.stderr.decode())
    return p.stdout


def main():
    pw = os.environ.get("GATE_PASSWORD") or getpass.getpass("Site password: ")
    if not pw:
        raise SystemExit("empty password")
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITERS, 32)

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    for page in PAGES:
        src = open(os.path.join(ROOT, page), encoding="utf-8").read()
        # drop dev-only tooling from the deploy
        src = re.sub(r'\s*<!-- TEMPORARY[^\n]*-->', '', src)
        src = re.sub(r'\s*<script src="[^"]*switcher\.js[^"]*"[^>]*></script>', '', src)
        # keep it out of search engines
        src = src.replace("<head>",
                          '<head>\n  <meta name="robots" content="noindex, nofollow">', 1)
        # scrub identifying metadata from the (unencrypted) head
        src = re.sub(r'<title>.*?</title>', '<title>Private</title>', src, flags=re.S)
        src = re.sub(r'\s*<meta name="description"[^>]*>', '', src)

        m = re.search(r'(<body[^>]*>)(.*)(</body>)', src, re.S)
        if not m:
            raise SystemExit("no <body> in " + page)
        before, body_open, body_inner, after = src[:m.start(1)], m.group(1), m.group(2), src[m.end(3):]

        iv = os.urandom(16)
        ct = aes_cbc_encrypt(key, iv, MARKER + body_inner.encode("utf-8"))
        payload = {
            "s": base64.b64encode(salt).decode(),
            "i": ITERS,
            "iv": base64.b64encode(iv).decode(),
            "ct": base64.b64encode(ct).decode(),
        }
        new_inner = '\n  <script id="gate" type="application/json">' + json.dumps(payload) + "</script>\n"
        open(os.path.join(DIST, page), "w", encoding="utf-8").write(
            before + body_open + new_inner + m.group(3) + after)

    # copy assets and deploy extras
    shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(DIST, "assets"))
    # drop dev tooling and large legacy originals the redesign doesn't use
    # note: assets/cv.pdf ships in the deploy so visitors' print-to-PDF works;
    # it is fetchable without the password (the gate covers pages, not assets)
    prune = ["assets/js/switcher.js",
             "assets/images/IMG_7220.png", "assets/images/IMG_7220_cropped.png",
             "assets/images/IMG_7220.HEIC", "assets/images/headshot.png",
             "assets/images/headshot_full.png"]
    for rel in prune:
        fp = os.path.join(DIST, rel)
        if os.path.exists(fp):
            os.remove(fp)
    if os.path.exists(os.path.join(ROOT, ".nojekyll")):
        shutil.copy(os.path.join(ROOT, ".nojekyll"), DIST)
    # the offline cache worker has to sit at the site root to cover every page
    shutil.copy(os.path.join(ROOT, "sw.js"), DIST)
    open(os.path.join(DIST, "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")

    size = subprocess.run(["du", "-sh", DIST], capture_output=True, text=True).stdout.split()[0]
    print("Built dist/ — %d encrypted pages, %s total." % (len(PAGES), size))
    print("Deploy the contents of dist/. Password is baked into the ciphertext;")
    print("re-run this script to change content or password.")


if __name__ == "__main__":
    main()
