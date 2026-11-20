#!/usr/bin/env python3
"""Local preview of the site.

Usage: python3 scripts/serve.py [port] [directory]
The server binds only to loopback. Pages and assets are revalidated on every
load, so edits show up at once; SVGs are sent gzip-compressed.
"""
import argparse
import datetime
import email.utils
import functools
import gzip
import http.server
import io
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit


SVG_CACHE = {}
SVG_CACHE_LOCK = threading.Lock()


def encoding_quality(headers):
    qualities = {}
    for entry in ",".join(headers.get_all("Accept-Encoding", [])).split(","):
        coding, *parameters = entry.strip().lower().split(";")
        quality = 1.0
        for parameter in parameters:
            name, separator, value = parameter.strip().partition("=")
            if name.strip() == "q":
                value = value.strip()
                quality = (float(value) if separator and
                           re.fullmatch(r"(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)", value)
                           else 0.0)
        qualities[coding] = min(quality, qualities.get(coding, 1.0))
    wildcard = qualities.get("*")
    return (qualities.get("gzip", wildcard or 0.0),
            qualities.get("identity", 0.0 if wildcard == 0.0 else 1.0))


def compressed_svg(source, stat):
    # Keep only the current representation per file; serialize first compression.
    signature = (stat.st_dev, stat.st_ino, stat.st_size,
                 stat.st_mtime_ns, stat.st_ctime_ns)
    with SVG_CACHE_LOCK:
        cached = SVG_CACHE.get(source.name)
        if cached is None or cached[0] != signature:
            cached = (signature, gzip.compress(source.read(), mtime=0))
            SVG_CACHE[source.name] = cached
        return cached[1]


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        p = urlsplit(self.path).path
        if self.translate_path(self.path).lower().endswith(".svg"):
            self.send_header("Vary", "Accept-Encoding")
        # Preview assets change in place, even when a URL has a version query.
        # Revalidate them rather than caching old code as immutable for a year.
        if "/assets/fonts/" in p:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def translate_path(self, path):
        result = super().translate_path(path)
        if not Path(result).exists() and Path(result + ".html").is_file():
            return result + ".html"
        return result

    def send_head(self):
        path = self.translate_path(self.path)
        if not path.lower().endswith(".svg") or not os.path.isfile(path):
            return super().send_head()
        gzip_quality, identity_quality = encoding_quality(self.headers)
        if not gzip_quality or identity_quality > gzip_quality:
            if identity_quality:
                return super().send_head()
            self.send_error(406, "No acceptable SVG encoding")
            return None
        try:
            source = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        with source:
            stat = os.fstat(source.fileno())
            # Match SimpleHTTPRequestHandler's conditional request precedence.
            if ("If-Modified-Since" in self.headers and
                    "If-None-Match" not in self.headers):
                try:
                    modified_since = email.utils.parsedate_to_datetime(
                        self.headers["If-Modified-Since"])
                    if modified_since.tzinfo is None:
                        modified_since = modified_since.replace(tzinfo=datetime.timezone.utc)
                    last_modified = datetime.datetime.fromtimestamp(
                        stat.st_mtime, datetime.timezone.utc).replace(microsecond=0)
                    if (modified_since.tzinfo is datetime.timezone.utc and
                            last_modified <= modified_since):
                        self.send_response(304)
                        self.end_headers()
                        return None
                except (TypeError, IndexError, OverflowError, ValueError):
                    pass
            body = compressed_svg(source, stat)
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml")
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        return io.BytesIO(body)

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", type=int, default=8000)
    parser.add_argument("directory", nargs="?", default=".")
    args = parser.parse_args()
    handler = functools.partial(Handler, directory=args.directory)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print("serving %s on http://127.0.0.1:%d (HTTP/1.1, cached assets)" %
          (args.directory, server.server_address[1]))
    server.serve_forever()
