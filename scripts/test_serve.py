"""Behavioral tests for compressed SVG delivery and preview editor isolation."""
import functools
import gzip
import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

import serve


class ServerTestCase(unittest.TestCase):
    def start_server(self, directory, **options):
        handler = functools.partial(serve.Handler, directory=str(directory))
        server = serve.PreviewServer(("127.0.0.1", 0), handler, **options)
        server.daemon_threads = False
        self.addCleanup(server.server_close)
        thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.01}
        )
        thread.start()
        self.addCleanup(self.stop_server, server, thread)
        connection = http.client.HTTPConnection(*server.server_address, timeout=5)
        self.addCleanup(connection.close)
        return server, connection

    @staticmethod
    def stop_server(server, thread):
        server.shutdown()
        thread.join()


class SvgDeliveryTests(ServerTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.source = Path(temporary.name) / "artwork.svg"
        self.svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
            '<rect width="10" height="10" fill="red"/></svg>'
        ).encode("utf-8")
        self.source.write_bytes(self.svg)

        cache = mock.patch.dict(serve.SVG_CACHE, clear=True)
        cache.start()
        self.addCleanup(cache.stop)
        self.server, self.connection = self.start_server(temporary.name, read_only=True)

    def request(self, encoding="gzip", method="GET", headers=None):
        request_headers = {"Accept-Encoding": encoding}
        request_headers.update(headers or {})
        self.connection.request(method, "/artwork.svg", headers=request_headers)
        response = self.connection.getresponse()
        body = response.read()
        return response, body

    def assert_svg_headers(self, response, length, encoding=None):
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "image/svg+xml")
        self.assertEqual(response.getheader("Content-Length"), str(length))
        self.assertEqual(response.getheader("Content-Encoding"), encoding)
        self.assert_vary(response)

    def assert_vary(self, response):
        vary = {
            token.strip().lower()
            for token in response.getheader("Vary", "").split(",")
        }
        self.assertIn("accept-encoding", vary)

    def test_gzip_representation_round_trips(self):
        response, body = self.request()
        self.assert_svg_headers(response, len(body), "gzip")
        self.assertEqual(gzip.decompress(body), self.svg)

    def test_identity_preferences_and_gzip_exclusion(self):
        for encoding in (
            "identity",
            "gzip;q=0",
            "gzip;q=0.5, identity;q=1",
            "gzip;q=0, *;q=1",
            "*;q=0, identity;q=1",
        ):
            with self.subTest(encoding=encoding):
                response, body = self.request(encoding)
                self.assert_svg_headers(response, len(self.svg))
                self.assertEqual(body, self.svg)

    def test_wildcard_accepts_gzip(self):
        response, body = self.request("*")
        self.assert_svg_headers(response, len(body), "gzip")
        self.assertEqual(gzip.decompress(body), self.svg)

    def test_head_has_get_headers_without_body(self):
        for encoding in ("gzip", "identity"):
            with self.subTest(encoding=encoding):
                get_response, get_body = self.request(encoding)
                response, body = self.request(encoding, method="HEAD")
                self.assert_svg_headers(
                    response, len(get_body), get_response.getheader("Content-Encoding")
                )
                self.assertEqual(body, b"")

    def test_conditional_request_has_no_body_and_varies_by_encoding(self):
        original, _ = self.request()
        modified = original.getheader("Last-Modified")
        self.assertIsNotNone(modified)
        for encoding in ("gzip", "identity"):
            for method in ("GET", "HEAD"):
                with self.subTest(encoding=encoding, method=method):
                    response, body = self.request(
                        encoding, method=method, headers={"If-Modified-Since": modified}
                    )
                    self.assertEqual(response.status, 304)
                    self.assertEqual(body, b"")
                    self.assert_vary(response)

    def test_persistent_connection_does_not_leak_gzip_headers(self):
        compressed, compressed_body = self.request()
        self.assert_svg_headers(compressed, len(compressed_body), "gzip")
        socket = self.connection.sock
        self.assertIsNotNone(socket)
        response, body = self.request("identity")
        self.assertIs(self.connection.sock, socket)
        self.assert_svg_headers(response, len(self.svg))
        self.assertEqual(body, self.svg)

    def test_compression_is_reused_until_source_changes(self):
        with mock.patch.object(serve.gzip, "compress", wraps=gzip.compress) as compress:
            first, first_body = self.request()
            self.assert_svg_headers(first, len(first_body), "gzip")
            self.assertEqual(gzip.decompress(first_body), self.svg)
            second, second_body = self.request()
            self.assert_svg_headers(second, len(second_body), "gzip")
            self.assertEqual(second_body, first_body)
            self.assertEqual(compress.call_count, 1)

            # Keep the size unchanged and advance mtime explicitly: no clock sleeps.
            previous = self.source.stat()
            updated = self.svg.replace(b'fill="red"', b'fill="tan"')
            self.source.write_bytes(updated)
            os.utime(
                self.source,
                ns=(previous.st_atime_ns, previous.st_mtime_ns + 2_000_000_000),
            )
            changed, changed_body = self.request()
            self.assert_svg_headers(changed, len(changed_body), "gzip")
            self.assertNotEqual(changed_body, first_body)
            self.assertEqual(gzip.decompress(changed_body), updated)
            self.assertEqual(compress.call_count, 2)

            _, cached_body = self.request()
            self.assertEqual(cached_body, changed_body)
            self.assertEqual(compress.call_count, 2)
            identity, identity_body = self.request("identity")
            self.assert_svg_headers(identity, len(updated))
            self.assertEqual(identity_body, updated)


class EditorModeTests(ServerTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        scripts = self.root / "assets/js"
        scripts.mkdir(parents=True)
        (scripts / "backgrounds.js").write_text(
            'window.BACKGROUNDS = [\n'
            '{"u":"/first.jpg"},\n'
            '{"u":"/second.jpg"}\n'
            '];\n', encoding="utf-8"
        )
        self.selection = self.root / serve.SELECTION_PATH
        self.initial = {"laptop": ["/first.jpg"], "mobile": ["/first.jpg"]}
        self.updated = {"laptop": ["/second.jpg"], "mobile": ["/second.jpg"]}
        self.selection.write_text(
            "window.BACKGROUND_SELECTIONS = " + json.dumps(self.initial) + ";\n",
            encoding="utf-8"
        )
        self.original_bytes = self.selection.read_bytes()
        self.html = b"<!doctype html><title>Preview</title>"
        (self.root / "index.html").write_bytes(self.html)
        # Both modes coexist in one process and directory: neither may set a
        # process-wide mode that changes the other server's editor behavior.
        self.readonly_server, self.readonly = self.start_server(self.root, read_only=True)
        self.editable_server, self.editable = self.start_server(self.root)

    @staticmethod
    def request(connection, method, path=serve.API_PATH, body=None, headers=None):
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response, response.read()

    def put(self, connection, headers=None):
        request_headers = {"Content-Type": "application/json"}
        request_headers.update(headers or {})
        return self.request(
            connection, "PUT", body=json.dumps(self.updated), headers=request_headers
        )

    def test_readonly_static_files_remain_available(self):
        response, body = self.request(self.readonly, "GET", "/")
        self.assertEqual(response.status, 200)
        self.assertEqual(body, self.html)
        response, body = self.request(self.readonly, "GET", "/" + serve.SELECTION_PATH)
        self.assertEqual(response.status, 200)
        self.assertEqual(body, self.original_bytes)
        self.assertEqual(response.getheader("Cache-Control"), "no-cache")

    def test_readonly_hides_editor_api(self):
        for method in ("GET", "HEAD"):
            with self.subTest(method=method):
                response, _ = self.request(self.readonly, method)
                self.assertEqual(response.status, 404)
        self.assertEqual(self.selection.read_bytes(), self.original_bytes)

    def test_readonly_rejects_valid_put_with_spoofed_loopback_host(self):
        port = self.readonly_server.server_address[1]
        for host in ("127.0.0.1", "localhost", "[::1]"):
            with self.subTest(host=host):
                # A reverse proxy can supply a loopback peer and Host, with no
                # Origin at all. The mode must reject this otherwise-valid edit.
                response, _ = self.put(self.readonly, {"Host": f"{host}:{port}"})
                self.assertEqual(response.status, 403)
                self.assertEqual(self.selection.read_bytes(), self.original_bytes)

    def test_default_local_editor_remains_writable_and_modes_are_isolated(self):
        response, body = self.request(self.editable, "GET")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), self.initial)
        port = self.editable_server.server_address[1]
        response, body = self.put(self.editable, {"Origin": f"http://127.0.0.1:{port}"})
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), self.updated)
        self.assertEqual(serve.read_selection(self.root), self.updated)
        saved_bytes = self.selection.read_bytes()
        response, _ = self.put(self.readonly)
        self.assertEqual(response.status, 403)
        self.assertEqual(self.selection.read_bytes(), saved_bytes)
        response, body = self.request(self.editable, "GET")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), self.updated)

    def test_default_local_editor_accepts_no_origin(self):
        response, _ = self.put(self.editable)
        self.assertEqual(response.status, 200)
        self.assertEqual(serve.read_selection(self.root), self.updated)

    def test_local_editor_rejects_foreign_host_and_origin(self):
        port = self.editable_server.server_address[1]
        for headers in (
            {"Host": f"untrusted.example:{port}"},
            {"Origin": "http://untrusted.example"},
            {"Origin": "null"},
        ):
            with self.subTest(headers=headers):
                response, _ = self.put(self.editable, headers)
                self.assertEqual(response.status, 403)
                self.assertEqual(self.selection.read_bytes(), self.original_bytes)


if __name__ == "__main__":
    unittest.main()
