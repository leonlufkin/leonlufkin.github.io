/* Shared-password gate (client-side).
   Deployed (encrypted) pages carry their <header>/<main> as an AES-256-CBC
   blob in a <script id="gate" type="application/json"> tag; the plaintext
   content is NOT in the page source. This script prompts for the password,
   derives the key (PBKDF2-SHA256, matching the build), decrypts, injects the
   content, and caches the key in sessionStorage so navigation and sibling
   pages don't re-prompt within the tab.

   On a plaintext page (no #gate payload) this script is inert, so the same
   file works in local dev and in the encrypted deploy.

   Security note: this is obfuscation-grade, not a hard wall — the ciphertext
   is downloadable and a weak password is brute-forceable. Good for "share
   with friends, keep it off search engines," not for secrets. */

(function () {
  if (!window.crypto || !crypto.subtle) return; // needs a secure context
  var SS_KEY = "gate.key";
  var MARKER = "GATE1\n"; // prefix used to verify a correct password
  var encoder = new TextEncoder(), decoder = new TextDecoder();

  function b64ToBytes(b64) {
    var bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function bytesToB64(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function payloadFrom(doc) {
    var el = doc.getElementById("gate");
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function importRaw(raw) {
    return crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, true, ["decrypt"]);
  }

  function deriveKey(password, salt, iters) {
    return crypto.subtle
      .importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveKey"])
      .then(function (km) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: iters, hash: "SHA-256" },
          km, { name: "AES-CBC", length: 256 }, true, ["decrypt"]);
      });
  }

  function decryptWith(key, obj) {
    return crypto.subtle
      .decrypt({ name: "AES-CBC", iv: b64ToBytes(obj.iv) }, key, b64ToBytes(obj.ct))
      .then(function (buf) {
        var text = decoder.decode(new Uint8Array(buf));
        if (text.indexOf(MARKER) !== 0) throw new Error("bad password");
        return text.slice(MARKER.length);
      });
  }

  function cachedKey() {
    var b = null;
    try { b = sessionStorage.getItem(SS_KEY); } catch (e) {}
    if (!b) return Promise.resolve(null);
    return importRaw(b64ToBytes(b)).catch(function () { return null; });
  }

  function cacheKey(key) {
    return crypto.subtle.exportKey("raw", key).then(function (raw) {
      try { sessionStorage.setItem(SS_KEY, bytesToB64(raw)); } catch (e) {}
    });
  }

  // Decrypt a fetched sibling page's HTML → full HTML string (for instant-nav).
  // Plaintext pages pass through unchanged.
  function decryptDoc(text) {
    var doc = new DOMParser().parseFromString(text, "text/html");
    var obj = payloadFrom(doc);
    if (!obj) return Promise.resolve(text);
    return cachedKey().then(function (key) {
      if (!key) return Promise.reject(new Error("locked"));
      return decryptWith(key, obj);
    }).then(function (inner) {
      doc.body.innerHTML = inner;
      return "<!DOCTYPE html>" + doc.documentElement.outerHTML;
    });
  }

  window.SiteGate = { decryptDoc: decryptDoc };

  /* --- Current-page unlock ---------------------------------------------- */

  var obj = payloadFrom(document);
  if (!obj) return; // plaintext page: nothing to unlock

  function reveal(inner) {
    document.body.innerHTML = inner;
    try { window.dispatchEvent(new Event("pageswap")); } catch (e) {}
  }

  function showOverlay() {
    var style = document.createElement("style");
    style.textContent =
      "#gate-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:Georgia,'Times New Roman',serif}" +
      "#gate-form{max-width:20rem;padding:1.7rem 1.9rem;text-align:center;color:var(--text,#1a1a1a);background:var(--bg,#fff);border-radius:6px;box-shadow:0 0 34px 26px var(--bg,#fff)}" +
      "#gate-form p.t{margin:0 0 1rem;font-size:1rem}" +
      "#gate-pw{width:100%;box-sizing:border-box;padding:0.5rem 0.6rem;font:1rem Georgia,serif;color:var(--text,#1a1a1a);background:var(--bg,#fff);border:1px solid var(--line,#ccc);border-radius:4px}" +
      "#gate-form button{margin-top:0.8rem;padding:0.45rem 1.2rem;font:1rem Georgia,serif;color:var(--text,#1a1a1a);background:transparent;border:1px solid var(--text,#1a1a1a);border-radius:4px;cursor:pointer}" +
      "#gate-err{min-height:1.1em;margin:0.7rem 0 0;color:#b00020;font-size:0.85rem}";
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.id = "gate-overlay";
    wrap.innerHTML =
      '<form id="gate-form">' +
      '<p class="t">This site is private.</p>' +
      '<input id="gate-pw" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password">' +
      '<button type="submit">Enter</button>' +
      '<p id="gate-err"></p></form>';
    document.body.appendChild(wrap);

    var input = document.getElementById("gate-pw");
    input.focus();
    document.getElementById("gate-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = document.getElementById("gate-err");
      err.textContent = "";
      deriveKey(input.value, b64ToBytes(obj.s), obj.i)
        .then(function (key) {
          return decryptWith(key, obj).then(function (inner) {
            return cacheKey(key).then(function () { reveal(inner); });
          });
        })
        .catch(function () {
          err.textContent = "Incorrect password.";
          input.select();
        });
    });
  }

  // Auto-unlock if this tab already holds the key; otherwise prompt.
  cachedKey().then(function (key) {
    if (!key) return showOverlay();
    decryptWith(key, obj).then(reveal).catch(showOverlay);
  });
})();
