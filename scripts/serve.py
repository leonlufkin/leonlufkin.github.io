#!/usr/bin/env python3
"""Local preview with a same-origin endpoint for saving background selections.

Usage: python3 scripts/serve.py [port] [directory]
The server binds only to loopback. GitHub Pages serves the saved selections
as a static asset; the write endpoint exists only during local preview.
"""
import functools
import datetime
import email.utils
import gzip
import http.server
import ipaddress
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
from urllib.parse import urlsplit


SELECTION_PATH = "assets/js/background-selections.js"
API_PATH = "/__background-selection"
SAVE_LOCK = threading.Lock()
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


def background_entries(directory):
    source = (Path(directory) / "assets/js/backgrounds.js").read_text(encoding="utf-8")
    return [json.loads(match.group(1)) for match in
            re.finditer(r"^\s*(\{[^\n]+\}),?\s*$", source, re.MULTILINE)]


def validate_selection(data, directory):
    if not isinstance(data, dict) or set(data) != {"laptop", "mobile"}:
        raise ValueError("Provide Laptop and Mobile photo sets.")
    known = {entry["u"] for entry in background_entries(directory)}
    for device in ("laptop", "mobile"):
        urls = data[device]
        if not isinstance(urls, list) or not urls:
            raise ValueError(f"Choose at least one photo for {device.title()}.")
        if any(not isinstance(url, str) or url not in known for url in urls):
            raise ValueError(f"The {device.title()} set contains an unknown photo.")
        if len(set(urls)) != len(urls):
            raise ValueError(f"The {device.title()} set contains duplicate photos.")
    return data


def read_selection(directory):
    source = (Path(directory) / SELECTION_PATH).read_text(encoding="utf-8")
    match = re.search(r"window\.BACKGROUND_SELECTIONS\s*=\s*(\{.*\})\s*;", source, re.DOTALL)
    if not match:
        raise ValueError("The saved background selection could not be read.")
    return validate_selection(json.loads(match.group(1)), directory)


def save_selection(data, directory):
    destination = Path(directory) / SELECTION_PATH
    source = ("// Curated in the local photo gallery. Commit this file to publish the sets.\n"
              "window.BACKGROUND_SELECTIONS = " + json.dumps(data, indent=2) + ";\n")
    with SAVE_LOCK:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                             prefix=".background-selections-", delete=False) as stream:
                temporary = stream.name
                stream.write(source)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, destination.stat().st_mode & 0o777 if destination.exists() else 0o644)
            os.replace(temporary, destination)
            temporary = None
        finally:
            if temporary:
                os.unlink(temporary)


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

    def local_request(self):
        """Reject cross-origin writes and Host-based DNS rebinding."""
        try:
            if not ipaddress.ip_address(self.client_address[0]).is_loopback:
                return False
            host = urlsplit("//" + self.headers.get("Host", ""))
            port = host.port or 80
            if (host.hostname not in ("localhost", "127.0.0.1", "::1") or
                    port != self.server.server_address[1] or host.username or host.password):
                return False
            origin = self.headers.get("Origin")
            if origin is not None:
                parsed = urlsplit(origin)
                if (parsed.scheme != "http" or parsed.hostname != host.hostname or
                        (parsed.port or 80) != port or parsed.username or parsed.password or
                        parsed.path or parsed.query or parsed.fragment):
                    return False
            return True
        except ValueError:
            return False

    def json_response(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Error responses may precede reading a rejected request body.
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlsplit(self.path).path != API_PATH:
            return super().do_GET()
        if not self.local_request():
            return self.json_response(403, {"error": "Open this gallery from the local preview to edit it."})
        try:
            self.json_response(200, read_selection(self.directory))
        except (OSError, ValueError) as error:
            self.json_response(500, {"error": str(error)})

    def do_PUT(self):
        if urlsplit(self.path).path != API_PATH:
            return self.json_response(404, {"error": "Unknown save endpoint."})
        if not self.local_request():
            return self.json_response(403, {"error": "Saving is only available from this local preview."})
        if self.headers.get_content_type() != "application/json":
            return self.json_response(415, {"error": "Send the photo sets as JSON."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 65536:
            return self.json_response(413, {"error": "The photo selection request has an invalid size."})
        try:
            data = json.loads(self.rfile.read(length))
            validate_selection(data, self.directory)
            save_selection(data, self.directory)
        except (ValueError, UnicodeError) as error:
            return self.json_response(400, {"error": str(error)})
        except OSError:
            return self.json_response(500, {"error": "Could not save the photo sets. Check the local file permissions."})
        self.json_response(200, data)

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(Handler, directory=directory)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("serving %s on http://127.0.0.1:%d (HTTP/1.1, cached assets)" % (directory, port))
    server.serve_forever()
