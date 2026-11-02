#!/usr/bin/env python3
"""Dev server tuned for snappiness.

Python's stock `http.server` speaks HTTP/1.0: one TCP connection per request
and zero cache headers, so a page with a dozen assets pays connection setup a
dozen times on every reload. This server:
  - uses HTTP/1.1 keep-alive (one connection, many requests)
  - marks ?v=-versioned assets and fonts immutable (cached until the version
    string changes — same scheme the site already uses for cache busting)
  - gives images an hour of cache, HTML no-cache (always fresh)

Usage: python3 scripts/serve.py [port] [directory]
"""
import functools
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        p = self.path
        if "?v=" in p or "/assets/fonts/" in p:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        elif "/assets/" in p:
            self.send_header("Cache-Control", "public, max-age=3600")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(Handler, directory=directory)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("serving %s on http://127.0.0.1:%d (HTTP/1.1, cached assets)" % (directory, port))
    server.serve_forever()
