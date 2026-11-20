// Run with: node --test scripts/test-backgrounds.cjs
// Exercise the real browser scripts with a small DOM/storage fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

function browser({ width = 1440, height = 900, theme = 'light', pick, preview, coarse = false,
  hostname = 'localhost', search = '', selectedSets, rowLoader, page = 'index.html', boxBounds } = {}) {
  const nodes = new Map(), listeners = new Map(), timers = new Map();
  const mediaListeners = new Map();
  const frames = new Map(), observers = new Set();
  let nextTimer = 0, fetchError = null;
  const requests = [];
  let context;
  function style() {
    const values = new Map(), writes = new Map();
    return { writes,
      setProperty(k, v) { writes.set(k, (writes.get(k) || 0) + 1); values.set(k, v); },
      getPropertyValue: k => values.get(k) || '',
      removeProperty(k) { writes.set(k, (writes.get(k) || 0) + 1); return values.delete(k); } };
  }
  function element(tag) {
    const el = { tag, children: [], className: '', style: style(), events: {}, attributes: {},
      appendChild(child) { if (child.parent) child.parent.removeChild(child);
        this.children.push(child); child.parent = this; return child; },
      removeChild(child) { this.children = this.children.filter(e => e !== child); child.parent = null; return child; },
      focus() { context.document.activeElement = this; },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      querySelectorAll(selector) {
        const found = [];
        for (const child of this.children) {
          const match = selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1))
            : selector.includes('button:') ? ['button', 'input'].includes(child.tag) && !child.disabled
            : child.tag === selector;
          if (match) found.push(child);
          found.push(...child.querySelectorAll(selector));
        }
        return found;
      },
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k] ?? null; },
      addEventListener(k, fn) { (this.events[k] ||= []).push(fn); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this);
        if (this.id) nodes.delete(this.id); },
      fire(k, event = {}) { this['on' + k]?.(event); (this.events[k] || []).forEach(fn => fn(event)); } };
    el.classList = {
      contains: k => el.className.split(' ').includes(k),
      add(k) { if (!this.contains(k)) el.className += ' ' + k; },
      remove(k) { el.className = el.className.split(' ').filter(v => v !== k).join(' '); },
      toggle(k, on) { on = on === undefined ? !this.contains(k) : on;
        if (on) this.add(k); else this.remove(k); return on; }
    };
    Object.defineProperty(el, 'firstChild', { get() { return this.children[0] || null; } });
    Object.defineProperty(el, 'id', { get() { return this._id; },
      set(id) { this._id = id; nodes.set(id, this); } });
    Object.defineProperty(el, 'innerHTML', { get() { return this._html || ''; },
      set(html) { this._html = html;
        for (const match of html.matchAll(/id="([^"]+)"/g)) {
          if (!nodes.has(match[1])) { const child = element('span'); child.id = match[1]; }
        }
      } });
    return el;
  }
  function storage(initial) {
    const values = new Map(Object.entries(initial));
    return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v),
      removeItem: k => values.delete(k) };
  }
  function navigation(page) {
    const nav = element('nav');
    const markup = source(page).match(/<nav>([\s\S]*?)<\/nav>/)[1];
    function attributes(el, markup) {
      for (const [, key, value] of markup.matchAll(/([\w-]+)="([^"]*)"/g)) {
        el.setAttribute(key, value);
        if (key === 'class') el.className = value;
        if (key === 'type') el.type = value;
      }
    }
    for (const [, attrs, contents] of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const button = element('button');
      attributes(button, attrs);
      for (const [, iconAttrs, glyph] of contents.matchAll(/<span\b([^>]*)>([^<]*)<\/span>/g)) {
        const icon = element('span');
        attributes(icon, iconAttrs);
        icon.textContent = glyph;
        button.appendChild(icon);
      }
      nav.appendChild(button);
    }
    return nav;
  }
  const html = element('html'), body = element('body'), head = element('head');
  let nav = navigation(page);
  let box;
  function mountBox(page) {
    if (box) box.remove();
    body.classList.toggle('home', page === 'index.html');
    box = element(page === 'index.html' ? 'section' : 'main');
    box.className = page === 'index.html' ? 'intro' : '';
    box.getBoundingClientRect = () => {
      const width = Math.min(760, context.innerWidth - 32);
      return boxBounds || { left: (context.innerWidth - width) / 2,
        right: (context.innerWidth + width) / 2, top: 140, bottom: 940, width, height: 800 };
    };
    body.appendChild(box);
  }
  body.appendChild(nav);
  mountBox(page);
  context = {
    innerWidth: width, innerHeight: height,
    document: { documentElement: html, body, head, createElement: element,
      getElementById: id => nodes.get(id) || null,
      querySelector: selector => selector === 'nav' ? nav
        : selector === '.intro' ? (body.classList.contains('home') ? box : null)
        : selector === 'body:not(.home) main' ? (body.classList.contains('home') ? null : box) : null,
      addEventListener() {} },
    localStorage: storage({ theme, ...(preview ? { 'stylePreview-v9': JSON.stringify(preview) } : {}) }),
    sessionStorage: storage(pick ? { bg: JSON.stringify(pick) } : {}),
    matchMedia: query => ({ get matches() { return query === '(pointer: coarse)' ? coarse
      : query === '(prefers-color-scheme: dark)' ? theme === 'dark' : false; },
      addEventListener(type, fn) { mediaListeners.set(query, fn); } }),
    addEventListener(k, fn) { if (!listeners.has(k)) listeners.set(k, []); listeners.get(k).push(fn); },
    dispatchEvent(event) { (listeners.get(event.type) || []).forEach(fn => fn(event)); },
    Event: function (type) { this.type = type; }, Image: function () { return element('img'); },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id), requestIdleCallback() {},
    requestAnimationFrame(fn) { const id = ++nextTimer; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    },
    history: {}, location: { hostname, origin: 'http://' + hostname + ':4000', pathname: '/', search,
      href: 'http://' + hostname + ':4000/' + search },
    fetch(url, options) {
      requests.push({ url, options });
      return Promise.resolve({ ok: !fetchError,
        json: () => Promise.resolve(fetchError ? { error: fetchError } : JSON.parse(options.body)) });
    },
    console,
  };
  context.window = context;
  if (rowLoader) context.BackgroundRows = { get: rowLoader };
  vm.createContext(context);
  function run(name) { vm.runInContext(source(name), context, { filename: name }); }
  run('assets/js/backgrounds.js');
  run('assets/js/background-defaults.js');
  run('assets/js/background-selections.js');
  if (selectedSets) {
    const catalog = context.BACKGROUNDS.light.concat(context.BACKGROUNDS.dark);
    context.BACKGROUND_SELECTIONS = typeof selectedSets === 'function' ? selectedSets(catalog) : selectedSets;
  }
  run('assets/js/site.js');
  return { context, nodes, get nav() { return nav; }, html, run, requests, api: context.SiteBackgrounds,
    get box() { return box; },
    observedBoxes() { return [...observers].flatMap(observer => [...observer.targets]); },
    pendingFrames() { return frames.size; },
    flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    setBox(bounds) { boxBounds = bounds; this.notifyBox(); },
    scrollBox(bounds) { boxBounds = bounds; this.emit('scroll'); },
    notifyBox() { for (const observer of observers) {
      if (observer.targets.has(box)) observer.callback([{ target: box }]);
    } },
    swap(page, bounds) { nav.remove(); nav = navigation(page); body.appendChild(nav);
      boxBounds = bounds; mountBox(page); this.emit('pageswap'); },
    failSaves(message) { fetchError = message; },
    systemTheme(mode) { theme = mode; context.localStorage.removeItem('theme');
      mediaListeners.get('(prefers-color-scheme: dark)')?.({ matches: mode === 'dark' }); },
    emit(type) { context.dispatchEvent({ type }); },
    resize(w, h) { context.innerWidth = w; context.innerHeight = h; this.emit('resize');
      this.flushFrames();
      const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    previewState() { return JSON.parse(context.localStorage.getItem('stylePreview-v9')); } };
}

const plain = value => JSON.parse(JSON.stringify(value));
const allSelected = entries => {
  const urls = entries.map(e => e.u);
  return { laptop: urls, mobile: urls };
};

function subjectBounds(b, entry, layout = b.api.layout(entry)) {
  const scale = layout.width / entry.width;
  return { left: layout.left + entry.subject.x * scale,
    right: layout.left + (entry.subject.x + entry.subject.width) * scale,
    top: layout.top + entry.subject.y * scale,
    bottom: layout.top + (entry.subject.y + entry.subject.height) * scale };
}

function assertSubjectReveal(b, entry) {
  const layout = b.api.layout(entry), bounds = subjectBounds(b, entry);
  const { innerWidth: width, innerHeight: height } = b.context;
  const box = b.box.getBoundingClientRect(), epsilon = 0.000001;
  const scale = Math.min(width / entry.width, height / entry.height);
  assert(Math.abs(layout.width - entry.width * scale) < epsilon, 'contain scale is unchanged');
  assert(Math.abs(layout.height - entry.height * scale) < epsilon, 'contain height is unchanged');
  assert(bounds.left >= 4 - epsilon && bounds.right <= width - 4 + epsilon, 'the whole disc stays on screen');
  assert(bounds.top >= 4 - epsilon && bounds.bottom <= height - 4 + epsilon, 'the whole disc stays vertically on screen');
  const half = (bounds.right - bounds.left) / 2;
  const center = Math.max(4 + half, Math.min(width - 4 - half, (box.left + box.right) / 2));
  assert(Math.abs((bounds.left + bounds.right) / 2 - center) < epsilon,
    'the moon stays horizontally centered on the box, clamped only to keep the disc on screen');
  const topCap = Math.min(32, (bounds.bottom - bounds.top) / 4, box.top - 4);
  const bottomCap = Math.min(32, (bounds.bottom - bounds.top) / 4, height - box.bottom - 4);
  if (topCap > 0 || bottomCap > 0) {
    assert(topCap > 0 && bounds.top <= box.top - topCap + epsilon ||
      bottomCap > 0 && bounds.bottom >= box.bottom + bottomCap - epsilon,
    'a cap remains above or below the opaque content box');
  } else {
    assert.equal(layout.top, (height - layout.height) / 2, 'a fully occluding long box has no side fallback');
  }
  const offsetX = Number.parseFloat(b.html.style.getPropertyValue('--photo-offset-x')) || 0;
  const offsetY = Number.parseFloat(b.html.style.getPropertyValue('--photo-offset-y')) || 0;
  assert(Math.abs(layout.left - ((width - layout.width) / 2 + offsetX)) < epsilon &&
    Math.abs(layout.top - ((height - layout.height) / 2 + offsetY)) < epsilon,
  'reported layout agrees with both applied CSS translations');
  assert.equal(b.html.style.getPropertyValue('--sky'),
    entry.edge[width / height >= entry.width / entry.height ? 'sides' : 'caps']);
  assertRowPair(b, null);
}

test('initial navigation controls are enhanced in place on every page and after repeated page swaps', () => {
  const pages = ['index.html', 'research.html', 'cv.html', '404.html'];
  for (const page of pages) {
    const b = browser({ page });
    const initial = b.nav.children.slice();
    b.run('assets/js/gallery.js');
    assert.deepEqual(b.nav.children, initial, 'enhancement does not append controls');
    for (const next of [null, ...pages]) {
      if (next) b.swap(next);
      b.emit('pageswap'); b.emit('pageswap');
      assert.equal(b.nav.children.length, 2);
      const theme = b.nav.querySelector('.theme-toggle');
      const gallery = b.nav.querySelector('.gallery-btn');
      assert.equal(theme.type, 'button');
      assert.equal(gallery.type, 'button');
      // The website's text glyphs, present before any script runs; the sun
      // carries the text variation selector so phones never substitute emoji.
      assert.equal(theme.querySelector('.theme-icon-sun').textContent, '\u2600\uFE0E');
      assert.equal(theme.querySelector('.theme-icon-moon').textContent, '\u263E');
      assert.equal(gallery.querySelector('.theme-icon').textContent, '\u25A6');
      for (const icon of b.nav.querySelectorAll('.theme-icon')) {
        assert.equal(icon.getAttribute('aria-hidden'), 'true');
      }
      const before = b.context.localStorage.getItem('theme');
      theme.fire('click');
      const after = before === 'dark' ? 'light' : 'dark';
      assert.equal(b.context.localStorage.getItem('theme'), after, 'one click toggles exactly once');
      assert.equal(theme.getAttribute('aria-label'), `Switch to ${before} mode`);
      gallery.fire('click');
      assert.equal(gallery.getAttribute('aria-expanded'), 'true');
      assert.equal(b.nodes.get('gallery').getAttribute('aria-hidden'), 'false');
      b.nodes.get('gallery').querySelector('.gallery-close').fire('click');
      assert.equal(gallery.getAttribute('aria-expanded'), 'false');
      assert.equal(b.context.document.activeElement, gallery);
      assert.equal(b.nodes.get('bg-label'), undefined);
    }
    b.api.preview(b.api.all()[0]);
    b.resize(390, 844);
    b.systemTheme('dark');
    assert.equal(b.nodes.get('bg-label'), undefined, 'background changes never create a location label');
    assert.equal(b.nav.querySelector('.theme-toggle').getAttribute('aria-label'), 'Switch to light mode');
  }
});

test('phones, laptops, desktops, square windows and ultrawides choose the closest photo shapes in both themes', () => {
  for (const [width, height, shape] of [[390, 844, 'portrait'], [844, 390, 'landscape'],
    [1440, 900, 'landscape'], [1920, 1080, 'landscape'], [1024, 1024, 'either'],
    [3440, 1440, 'panorama'], [5120, 1440, 'panorama']]) {
    for (const theme of ['light', 'dark']) {
      const b = browser({ width, height, theme,
        selectedSets: entries => allSelected(entries.filter(e => !e.layers)) });
      b.api.roll(true);
      const pool = b.api.pool();
      assert(pool.length > 0, `${width}×${height} ${theme} has candidates`);
      for (const e of pool) {
        if (shape === 'portrait') assert(e.width < e.height);
        if (shape === 'landscape') assert(e.width > e.height && e.width / e.height < 2);
        if (shape === 'panorama') assert(e.width / e.height > 3);
      }
      assert(pool.some(e => e.u === b.api.current().u));
      console.log(`${width}×${height} ${theme}: ${pool.length} candidates`);
    }
  }
});

test('layered artwork remains selectable through Random when explicitly curated on either device', () => {
  const url = '/assets/images/skydiving.svg';
  for (const [width, height] of [[390, 844], [844, 390], [1440, 900], [3440, 1440]]) {
    const b = browser({ width, height, selectedSets: { laptop: [url], mobile: [url] } });
    b.api.roll(true);
    assert.equal(b.api.current().u, url);
    assert.equal(b.api.current().default, false);
    assert.equal(b.api.current().layered, true);
    assert.equal(b.api.current().manual, false);
    assert(b.html.classList.contains('has-landscape'));
    assert.equal(browser({ width, height, pick: b.api.current(),
      selectedSets: b.api.selections() }).api.current().u, url);
  }
});

test('rotation replaces an unsuitable photo; small resizes and navigation keep the current one', () => {
  const b = browser();
  b.api.roll(true);
  const first = b.api.current().u;
  b.resize(1420, 900);
  assert.equal(b.api.current().u, first);
  const restored = browser({ width: 1420, height: 900, pick: b.api.current() });
  assert.equal(restored.api.current().u, first);
  b.resize(390, 844);
  assert.notEqual(b.api.current().u, first);
  assert(b.api.current().width < b.api.current().height);
});

test('cached photos are revalidated, metadata refreshed, and legacy zoom discarded', () => {
  const b = browser({ width: 390, height: 844, pick: { m: 'l', u: '/assets/backgrounds/light/thun_schlosssommer.jpg',
    c: 'wrong', w: 'old-wide.jpg', s: 116.5, y: 19.7 } });
  const p = b.api.current();
  assert.equal(p.v, 7);
  assert.equal(p.c, b.api.all().find(e => e.u === p.u).edge.caps);
  assert.equal(p.device, 'mobile');
  assert(p.width > 0 && p.height > 0);
  assert.equal(p.s, undefined);
  for (const key of ['--bg-size', '--bg-pos', '--bg-wide']) assert.equal(b.html.style.getPropertyValue(key), '');
  assert.equal(browser({ pick: p }).api.current().u, p.u);
});

test('curated exclusions constrain Random without restricting defaults or manual choices', () => {
  const b = browser({ theme: 'dark' });
  const old = b.api.current();
  const light = b.context.BACKGROUNDS.light.filter(e => e.width > e.height && e.width / e.height < 2);
  const mobile = b.api.all().find(e => e.width < e.height);
  const allowed = [light[0].u, light[1].u];
  b.api.setSelections({ laptop: allowed, mobile: [mobile.u] });
  assert.deepEqual(plain(b.api.pool().map(e => e.u)).sort(), allowed.slice().sort());
  for (let i = 0; i < 20; i++) {
    b.api.roll(true);
    assert(allowed.includes(b.api.current().u));
  }
  assert.equal(b.api.choose(old), true);
  const reload = browser({ theme: 'dark', pick: old, selectedSets: b.api.selections() });
  assert.equal(reload.api.current().u, old.u);
});

test('Laptop and Mobile sets remain independent, including landscape phones with coarse pointers', () => {
  const initial = browser();
  const landscape = initial.api.all().find(e => e.width > e.height);
  const portrait = initial.api.all().find(e => e.width < e.height);
  const selectedSets = { laptop: [landscape.u], mobile: [portrait.u] };
  const laptop = browser({ selectedSets });
  laptop.api.roll(true);
  assert.equal(laptop.api.device(), 'laptop');
  assert.equal(laptop.api.current().u, landscape.u);
  const phone = browser({ width: 844, height: 390, coarse: true, selectedSets });
  phone.api.roll(true);
  assert.equal(phone.api.device(), 'mobile');
  assert.equal(phone.api.current().u, portrait.u);
  phone.resize(390, 844);
  assert.equal(phone.api.device(), 'mobile');
  assert.equal(phone.api.current().u, portrait.u);
  assert.deepEqual(plain(phone.api.selections()), selectedSets);
  const returned = phone.api.selections(); returned.laptop.length = 0;
  assert.equal(phone.api.selections().laptop.length, 1);
});

test('any original can be previewed without changing good sets, and saving resets the preview', () => {
  const b = browser();
  const before = plain(b.api.selections());
  const excluded = b.api.all().find(e => !before.laptop.includes(e.u));
  assert(excluded);
  assert.equal(b.api.choose(excluded), true);
  assert.equal(b.api.preview(excluded), true);
  assert.equal(b.api.current().preview, true);
  assert.equal(b.api.current().u, excluded.u);
  b.api.roll(false);
  assert.equal(b.api.current().u, excluded.u);
  assert.deepEqual(plain(b.api.selections()), before);
  b.api.setSelections(before);
  assert.equal(b.api.current().preview, false);
  assert.equal(b.api.current().default, true);
  assert.equal(browser({ pick: { ...b.api.current(), u: excluded.u, preview: true } }).api.current().preview, false);
});

test('legacy style indices retain catalog identity and manual cross-shape choices survive styling', () => {
  const b = browser({ width: 390, height: 844, preview: { i: 1, f: 2 } });
  b.run('assets/js/switcher.js');
  assert.equal(b.api.current().u, '/assets/backgrounds/light/aoujeft_oasis.jpg');
  assert.equal(b.previewState().f, 2);
  const darkPortrait = b.api.galleryPool().find(e => e.u.includes('/dark/'));
  assert.equal(b.api.choose(darkPortrait), true);
  b.api.roll(false); b.emit('pageswap');
  b.nodes.get('style-switcher').fire('click', { target: { getAttribute: k => k === 'data-k' ? 'f' : '1' } });
  assert.equal(b.api.current().u, darkPortrait.u);
  assert.equal(b.api.current().preview, false);
  assert.equal(browser({ width: 390, height: 844, pick: b.api.current() }).api.current().u, darkPortrait.u);
  b.resize(1440, 900);
  assert.equal(b.api.current().u, darkPortrait.u);
  assert.equal(b.previewState().imageUrl, darkPortrait.u);
});

test('gallery clicks preview separately from Good checkboxes and save both device sets', async () => {
  const b = browser({ preview: { i: 1, f: 2 } });
  b.run('assets/js/switcher.js');
  b.run('assets/js/gallery.js');
  assert.equal(b.previewState().f, 2);
  const button = b.nav.children.find(e => e.className.includes('gallery-btn'));
  button.fire('click');
  const gallery = b.nodes.get('gallery'), grid = b.nodes.get('gallery-grid');
  assert.equal(grid.children.length, b.api.all().length);
  const before = plain(b.api.selections());
  const entries = b.api.all();
  const index = entries.findIndex(e => !before.laptop.includes(e.u));
  const figure = grid.children[index];
  figure.querySelector('.gallery-preview').fire('click');
  assert.equal(b.api.current().u, entries[index].u);
  assert.equal(b.api.current().preview, true);
  assert.deepEqual(plain(b.api.selections()), before);
  assert.equal(b.html.classList.contains('gallery-open'), false);
  b.nodes.get('style-switcher').fire('click', { target: { getAttribute: k => k === 'data-k' ? 'f' : '1' } });
  assert.equal(b.api.current().u, entries[index].u);
  button.fire('click');
  const checkbox = figure.querySelector('input');
  assert.equal(checkbox.checked, false);
  checkbox.checked = true; checkbox.fire('change');
  assert.deepEqual(plain(b.api.selections()), before); // draft only until Save
  const tabs = gallery.querySelectorAll('.gallery-tab');
  tabs[1].fire('click'); tabs[0].fire('click');
  assert.equal(checkbox.checked, true);
  gallery.querySelector('.gallery-save').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].url, '/__background-selection');
  assert.equal(b.requests[0].options.method, 'PUT');
  assert(b.api.selections().laptop.includes(entries[index].u));
  assert.deepEqual(plain(b.api.selections().mobile), before.mobile);
  assert.equal(b.api.current().preview, false);
  assert.equal(b.context.localStorage.getItem('background-gallery-draft-v1'), null);
  assert.equal(gallery.querySelector('.gallery-status').textContent, 'Saved for laptop and mobile.');
});

test('gallery previews keep the full photo and choose margin colors for the exposed edges', () => {
  const b = browser();
  b.run('assets/js/switcher.js');
  b.run('assets/js/gallery.js');
  const before = plain(b.api.selections());
  const thun = b.api.all().find(e => e.u === '/assets/backgrounds/light/thun_schlosssommer.jpg');
  assert.match(thun.edge.sides, /^#[0-9a-f]{6}$/i);
  assert.match(thun.edge.caps, /^#[0-9a-f]{6}$/i);
  b.nav.children.find(e => e.className.includes('gallery-btn')).fire('click');
  const index = b.api.all().findIndex(e => e.u === thun.u);
  b.nodes.get('gallery-grid').children[index].querySelector('.gallery-preview').fire('click');

  function checkFullPhoto(width, height, expectedColor) {
    const p = b.api.current();
    assert.equal(p.u, thun.u, 'the original identity is retained for gallery selections');
    assert.equal(p.preview, true);
    assert.equal(p.c, expectedColor);
    assert.equal(b.html.style.getPropertyValue('--sky'), expectedColor);
    assert.equal(p.outpaint, undefined);
    assert.equal(b.html.classList.contains('has-outpaint'), false);
    assert.equal(b.nodes.get('bg-outpaint'), undefined);
    assert(b.html.style.getPropertyValue('--bg-image').includes(thun.u));
    assert.equal(Number(b.html.style.getPropertyValue('--photo-ratio')), thun.width / thun.height);
    assert.equal(Number(b.html.style.getPropertyValue('--photo-inverse')), thun.height / thun.width);
    const seam = b.html.style.getPropertyValue('--photo-seam');
    if (Math.abs(width / height - thun.width / thun.height) < 0.000001) assert.equal(seam, 'none');
    else assert(seam.includes(width / height > thun.width / thun.height ? 'to right' : 'to bottom'),
      'only the boundary adjoining a margin is softened');
    const layout = b.api.layout(thun);
    const scale = Math.min(width / thun.width, height / thun.height);
    const near = (actual, expected, description) => assert(Math.abs(actual - expected) < 0.001,
      `${description}: ${actual} should equal ${expected}`);
    near(layout.width, thun.width * scale, 'full photo width');
    near(layout.height, thun.height * scale, 'full photo height');
    near(layout.left, (width - layout.width) / 2, 'centered horizontal position');
    near(layout.top, (height - layout.height) / 2, 'centered vertical position');
    assert(layout.left >= 0 && layout.top >= 0, 'no original edge is outside the viewport');
    assert(layout.left + layout.width <= width + 0.001);
    assert(layout.top + layout.height <= height + 0.001);
    assert.deepEqual(plain(b.api.selections()), before, 'preview never changes the good sets');
  }

  checkFullPhoto(1440, 900, thun.edge.sides);
  b.nodes.get('style-switcher').fire('click', { target: { getAttribute: k => k === 'data-k' ? 'f' : '1' } });
  b.emit('pageswap');
  checkFullPhoto(1440, 900, thun.edge.sides);
  for (const [width, height, edge] of [[1920, 1080, 'sides'], [3440, 1440, 'sides'],
    [1024, 1024, 'sides'], [390, 844, 'caps'], [844, 390, 'sides'], [750, 1000, 'sides']]) {
    b.resize(width, height);
    checkFullPhoto(width, height, thun.edge[edge]);
  }
});

test('every photo preserves contain scale and keeps its non-black subject on screen', () => {
  const b = browser();
  const entries = b.api.all().filter(e => !e.layers);
  for (const entry of entries) {
    assert.equal(entry.outpaint, undefined);
    assert.match(entry.edge.sides, /^#[0-9a-f]{6}$/i);
    assert.match(entry.edge.caps, /^#[0-9a-f]{6}$/i);
    for (const [width, height] of [[1440, 900], [3440, 1440], [1024, 1024], [390, 844]]) {
      b.resize(width, height);
      b.api.preview(entry);
      const layout = b.api.layout(entry);
      assert(layout.width <= width + 0.001 && layout.height <= height + 0.001);
      if (entry.subject) assertSubjectReveal(b, entry);
      else {
        assert(layout.left >= -0.001 && layout.top >= -0.001);
        assert(layout.left + layout.width <= width + 0.001);
        assert(layout.top + layout.height <= height + 0.001);
      }
      assert(Math.abs(layout.width / layout.height - entry.width / entry.height) < 0.001,
        'the image aspect ratio remains unchanged');
      assert(Math.abs(layout.width - width) < 0.001 || Math.abs(layout.height - height) < 0.001,
        'the photo fits as large as possible without cropping');
      assert.equal(b.api.current().outpaint, undefined);
    }
  }
  const fallback = entries[0];
  delete fallback.edge;
  b.api.preview(fallback);
  assert.equal(b.api.current().c, fallback.c, 'older entries without edge samples retain their color fallback');
});

test('the Sossusvlei gallery card shows soft surroundings without altering the original or good sets', () => {
  const b = browser();
  b.run('assets/js/switcher.js');
  b.run('assets/js/gallery.js');
  const sets = plain(b.api.selections());
  const entries = b.api.all();
  const url = '/assets/backgrounds/light/sossusvlei_dune2.jpg';
  const entry = entries.find(e => e.u === url);
  assert.equal(entry.width, 1200);
  assert.equal(entry.height, 1600, 'the original has portrait orientation');
  assert(entry.extension);
  assert(fs.existsSync(path.join(root, entry.extension.u)), 'the configured extension file exists');
  assert.equal(entry.extension.width, 1585);
  assert.equal(entry.extension.height, 992);
  assert.equal(entries.filter(e => e.extension).length, 1, 'the trial affects only this photo');
  b.nav.children.find(e => e.className.includes('gallery-btn')).fire('click');
  const card = b.nodes.get('gallery-grid').children[entries.findIndex(e => e.u === url)];
  assert.equal(card.querySelector('figcaption').textContent, 'Sossusvlei · Soft extension');
  card.querySelector('.gallery-preview').fire('click');

  function active(width, height) {
    const pick = b.api.current();
    assert.equal(pick.u, url, 'selection identity remains the original photograph');
    assert.equal(pick.preview, true);
    assert.deepEqual(plain(pick.extension), plain(entry.extension));
    assert(b.html.classList.contains('has-extension'));
    assert.equal(b.nodes.get('bg-extension').getAttribute('aria-hidden'), 'true');
    assert(b.html.style.getPropertyValue('--bg-image').includes(url));
    assert(b.html.style.getPropertyValue('--bg-extension').includes(entry.extension.u));
    const photo = b.api.layout(pick);
    assert(photo.width <= width + 0.001 && photo.height <= height + 0.001);
    assert(Math.abs(photo.width / photo.height - 0.75) < 0.001);
    assert.equal(parseFloat(b.html.style.getPropertyValue('--extension-height')), photo.height);
    assert(Math.abs(parseFloat(b.html.style.getPropertyValue('--extension-width'))
      - photo.height * entry.extension.width / entry.extension.height) < 0.001);
    assert.deepEqual(plain(b.api.selections()), sets);
  }

  active(1440, 900);
  b.nodes.get('style-switcher').fire('click', { target: { getAttribute: k => k === 'data-k' ? 'f' : '1' } });
  b.emit('pageswap');
  active(1440, 900);
  b.resize(3440, 1440);
  active(3440, 1440);
  for (const [width, height] of [[390, 844], [750, 1000]]) {
    b.resize(width, height);
    assert.equal(b.api.current().u, url);
    assert.equal(b.html.classList.contains('has-extension'), false);
    for (const variable of ['--bg-extension', '--extension-width', '--extension-height']) {
      assert.equal(b.html.style.getPropertyValue(variable), '', 'no extension where there are no side margins');
    }
    assert.deepEqual(plain(b.api.selections()), sets);
  }
  b.resize(1920, 1080);
  active(1920, 1080);
  b.api.preview(entries.find(e => !e.extension));
  assert.equal(b.html.classList.contains('has-extension'), false);
  assert.equal(b.html.style.getPropertyValue('--bg-extension'), '');
  assert.deepEqual(plain(b.api.selections()), sets);
});

test('a direct photo review link starts a temporary preview without changing curated sets', () => {
  const normal = browser();
  const sets = plain(normal.api.selections());
  const focused = browser({ search: '?photo=sossusvlei_dune2', selectedSets: sets });
  assert.equal(focused.api.current().u, '/assets/backgrounds/light/sossusvlei_dune2.jpg');
  assert.equal(focused.api.current().preview, true);
  assert(focused.html.classList.contains('has-extension'));
  assert.deepEqual(plain(focused.api.selections()), sets);
  const unknown = browser({ search: '?photo=unknown_photo', selectedSets: sets });
  assert.equal(unknown.api.current().preview, false);
  assert.deepEqual(plain(unknown.api.selections()), sets);
});

test('SVG review links select the layered scene without changing curation', () => {
  const b = browser({ theme: 'dark', search: '?photo=skydiving' });
  assert.equal(b.api.current().u, '/assets/images/skydiving.svg');
  assert.equal(b.api.current().preview, true);
  assert.equal(b.api.current().layered, true);
  assert(b.html.classList.contains('has-landscape'));
});

test('failed gallery saves keep the draft and public gallery does not expose editing', async () => {
  const b = browser(); b.run('assets/js/gallery.js');
  b.nav.children.find(e => e.className.includes('gallery-btn')).fire('click');
  const gallery = b.nodes.get('gallery');
  const checkbox = gallery.querySelector('input');
  checkbox.checked = !checkbox.checked; checkbox.fire('change');
  b.failSaves('Cannot save right now');
  gallery.querySelector('.gallery-save').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gallery.querySelector('.gallery-status').textContent, 'Cannot save right now');
  assert(b.context.localStorage.getItem('background-gallery-draft-v1'));
  const publicSite = browser({ hostname: 'preview.example.ts.net', width: 390, height: 844 });
  publicSite.run('assets/js/gallery.js');
  publicSite.nav.children.find(e => e.className.includes('gallery-btn')).fire('click');
  const publicGallery = publicSite.nodes.get('gallery');
  assert.equal(publicGallery.querySelectorAll('input').length, 0);
  assert.equal(publicGallery.querySelectorAll('.gallery-tab').length, 0);
  assert.equal(publicGallery.querySelector('.gallery-save'), null);
  const cards = publicSite.nodes.get('gallery-grid').children;
  assert.equal(cards.length, 46);
  assert.equal(cards.length, publicSite.api.all().length);
  const landscapeIndex = publicSite.api.all().findIndex(e => e.width > e.height && !e.layers);
  cards[landscapeIndex].querySelector('button').fire('click');
  const chosen = publicSite.api.current();
  assert.equal(chosen.manual, true);
  assert.equal(chosen.u, publicSite.api.all()[landscapeIndex].u);
  publicSite.resize(1440, 900);
  assert.equal(publicSite.api.current().u, chosen.u);
  assert.equal(browser({ pick: chosen, width: 390, height: 844 }).api.current().u, chosen.u);
});

test('empty or malformed catalog entries cannot become candidates or saved selections', () => {
  const b = browser();
  assert.throws(() => b.api.setSelections({ laptop: [], mobile: ['bad.jpg'] }));
  b.context.BACKGROUNDS.light = [{ u: 'bad.jpg' }, { width: 1, height: 0 }, { width: -1, height: 4 }];
  b.context.BACKGROUNDS.dark = [];
  assert.equal(b.api.pool().length, 0);
  assert.doesNotThrow(() => b.api.roll(true));
});

test('theme changes select the device default and keep preview controls in sync', () => {
  const b = browser({ width: 390, height: 844 });
  b.run('assets/js/switcher.js');
  b.api.choose(b.api.pool('light')[0]);
  b.nav.children.find(e => e.className === 'theme-toggle').fire('click');
  assert.equal(b.api.current().m, 'd');
  assert(b.api.current().u.includes('/dark/'));
  assert.equal(b.api.current().manual, false);
  assert.equal(b.api.current().u, '/assets/backgrounds/dark/home_moon2.jpg');
  assert.equal(b.api.current().default, true);
  assert.equal(b.previewState().imageUrl, null);
});

test('all four pre-paint bootstraps migrate old automatic choices and reject temporary previews', () => {
  for (const page of ['index.html', 'research.html', 'cv.html', '404.html']) {
    const b = browser();
    const script = source(page).match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const pick of [b.api.current(), { ...b.api.current(), preview: true },
      { v: 3, m: 'l', u: '/old.jpg', s: 116.5 }]) {
      b.context.sessionStorage.setItem('bg', JSON.stringify(pick));
      b.html.style.removeProperty('--bg-image');
      vm.runInContext(script, b.context);
      assert(b.html.style.getPropertyValue('--bg-image').includes('/assets/images/skydiving.svg'));
      assert(b.html.classList.contains('has-landscape'));
      assert.equal(b.html.style.getPropertyValue('--bg-size'), '');
    }
    b.context.localStorage.setItem('theme', 'dark');
    b.context.innerWidth = 390; b.context.innerHeight = 844;
    b.context.sessionStorage.setItem('bg', JSON.stringify({
      ...b.api.all().find(e => e.u.includes('home_moon1')),
      v: 7, m: 'd', default: true, manual: false, device: 'mobile', viewport: 390 / 844
    }));
    vm.runInContext(script, b.context);
    assert(b.html.style.getPropertyValue('--bg-image').includes('/assets/backgrounds/dark/home_moon2.jpg'));
    assert.equal(b.html.classList.contains('has-landscape'), false);
  }
});

test('cached outpainting is discarded and all page bootstraps restore the current photo and solid margin color', () => {
  const url = '/assets/backgrounds/light/thun_schlosssommer.jpg';
  const selectedSets = { laptop: [url], mobile: [url] };
  const initial = browser({ selectedSets, pick: { v: 3, m: 'l', u: url, c: '#000000',
    outpaint: { u: '/old-outpaint.png', width: 1586, height: 992 }, manual: true } });
  const pick = plain(initial.api.current());
  assert.equal(pick.u, url);
  assert.equal(pick.outpaint, undefined);
  assert.equal(pick.c, initial.api.all().find(e => e.u === url).edge.sides);
  for (const page of ['index.html', 'research.html', 'cv.html', '404.html']) {
    const script = source(page).match(/<script>([\s\S]*?)<\/script>/)[1];
    initial.html.style.removeProperty('--bg-image');
    initial.html.style.removeProperty('--sky');
    vm.runInContext(script, initial.context);
    assert(initial.html.style.getPropertyValue('--bg-image').includes(url));
    assert.equal(initial.html.style.getPropertyValue('--sky'), pick.c);
    assert.equal(Number(initial.html.style.getPropertyValue('--photo-ratio')), pick.width / pick.height);
    assert(initial.html.style.getPropertyValue('--photo-seam').includes('to right'));
  }
  const reloaded = browser({ pick, selectedSets });
  assert.equal(reloaded.api.current().u, url);
  assert.equal(reloaded.html.classList.contains('has-outpaint'), false);
  assert.equal(reloaded.api.layout(reloaded.api.current()).height, 900);
  assert.equal(reloaded.api.layout(reloaded.api.current()).width, 675);
});

test('the renderer feathers only the contained photo boundary over the matching fill', () => {
  const css = source('assets/css/style.css');
  const fill = css.match(/body::before\s*\{([^}]+)\}/)[1];
  const photo = css.match(/body::after\s*\{([^}]+)\}/)[1];
  assert.match(fill, /var\(--sky/);
  assert.match(fill, /var\(--bg-rows-left[^\n]+left[^\n]+50%\s+100%/);
  assert.match(fill, /var\(--bg-rows-right[^\n]+right[^\n]+50%\s+100%/);
  assert.doesNotMatch(fill, /--bg-image/);
  assert.match(photo, /center\s*\/\s*contain\s+no-repeat/);
  assert.match(photo, /mask-image:\s*var\(--photo-seam,\s*none\)/);
  // The gradient is defined on html: its dependencies must resolve there,
  // before inheritance. A width defined only on ::after invalidates the mask.
  const rootStyle = source('assets/css/style.css').match(/:root\s*\{([^}]+)\}/)[1];
  assert.match(rootStyle, /--photo-feather:\s*var\(--photo-blend-width,\s*12%\)/);
  assert.doesNotMatch(photo, /filter:|cover|--bg-size|--bg-wide|outpaint/);
  assert.match(css, /@media print[\s\S]*body::before,\s*body::after,/);
  assert.match(source('assets/js/switcher.js'), /Math\.min\(W\s*\/\s*img\.naturalWidth,\s*H\s*\/\s*img\.naturalHeight\)/);
});

function deferredRows() {
  const pending = new Map();
  return {
    pending,
    get(url) {
      if (!pending.has(url)) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        pending.set(url, { promise, resolve });
      }
      return pending.get(url).promise;
    },
  };
}

const settleRows = () => new Promise(resolve => setImmediate(resolve));
const rowPair = name => ({
  left: 'data:image/png;base64,' + Buffer.from(name + '-left').toString('base64'),
  right: 'data:image/png;base64,' + Buffer.from(name + '-right').toString('base64'),
});
function assertRowPair(b, pair) {
  for (const side of ['left', 'right']) {
    const value = b.html.style.getPropertyValue('--bg-rows-' + side);
    if (pair) assert(value.includes(pair[side]), `${side} uses its own profile`);
    else assert.equal(value, '', `${side} row fill is cleared`);
  }
}
function clearRowPair(b) {
  for (const side of ['left', 'right']) b.html.style.removeProperty('--bg-rows-' + side);
}

test('a late row pair cannot replace a newer gallery photo or change the good sets', async () => {
  const thun = '/assets/backgrounds/light/thun_schlosssommer.jpg';
  const oasis = '/assets/backgrounds/light/aoujeft_oasis.jpg';
  const rows = deferredRows();
  const b = browser({ selectedSets: { laptop: [thun], mobile: [thun] }, rowLoader: rows.get.bind(rows) });
  b.api.choose(b.api.all().find(e => e.u === thun));
  const sets = plain(b.api.selections());
  const second = b.api.all().find(e => e.u === oasis);
  b.api.preview(second);
  const secondData = rowPair('second');
  rows.pending.get(oasis).resolve(secondData);
  await settleRows();
  assertRowPair(b, secondData);
  rows.pending.get(thun).resolve(rowPair('old'));
  await settleRows();
  assertRowPair(b, secondData);
  assert.equal(b.api.current().u, oasis);
  assert.deepEqual(plain(b.api.selections()), sets);
});

test('both row fills follow horizontal margins and a delayed load cannot restore them after rotation', async () => {
  const thun = '/assets/backgrounds/light/thun_schlosssommer.jpg';
  const rows = deferredRows();
  const b = browser({ selectedSets: { laptop: [thun], mobile: [thun] }, rowLoader: rows.get.bind(rows) });
  const entry = b.api.all().find(e => e.u === thun);
  b.api.preview(entry);
  b.resize(390, 844);
  assertRowPair(b, null);
  assert.equal(b.api.current().c, entry.edge.caps);
  const data = rowPair('rows');
  rows.pending.get(thun).resolve(data);
  await settleRows();
  assertRowPair(b, null);
  b.resize(1920, 1080);
  await settleRows();
  assertRowPair(b, data);
  assert.equal(rows.pending.size, 1, 'the same source pair can be reused after rotation');
  assert.equal(b.api.layout(entry).height, 1080);
  assert.equal(b.api.current().c, entry.edge.sides);
  b.resize(750, 1000); // Exact photo aspect ratio has no side margins.
  await settleRows();
  assertRowPair(b, null);
});

test('a failed row pair leaves the solid fallback and uncropped photo intact', async () => {
  const thun = '/assets/backgrounds/light/thun_schlosssommer.jpg';
  const b = browser({ selectedSets: { laptop: [thun], mobile: [thun] }, rowLoader: () => Promise.resolve(null) });
  b.api.choose(b.api.all().find(e => e.u === thun));
  await settleRows();
  assertRowPair(b, null);
  assert(b.html.style.getPropertyValue('--bg-image').includes(thun));
  assert.equal(b.api.layout(b.api.current()).height, 900);
  assert.equal(b.html.style.getPropertyValue('--sky'), b.api.current().edge.sides);
});

test('all pages restore complete row pairs before paint only when side margins are present', async () => {
  const thun = '/assets/backgrounds/light/thun_schlosssommer.jpg';
  const data = rowPair('rows');
  const b = browser({ selectedSets: { laptop: [thun], mobile: [thun] }, rowLoader: () => Promise.resolve(data) });
  b.api.choose(b.api.all().find(e => e.u === thun));
  await settleRows();
  const pick = plain(b.api.current());
  assert.deepEqual(pick.rows, data, 'both finished profiles are retained in this tab');
  for (const file of ['index.html', 'research.html', 'cv.html', '404.html']) {
    const html = source(file);
    assert(html.indexOf('assets/js/background-rows.js?') < html.indexOf('assets/js/site.js?'),
      `${file} loads the sampler before the background renderer`);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    b.context.innerWidth = 1440; b.context.innerHeight = 900;
    b.context.sessionStorage.setItem('bg', JSON.stringify(pick));
    clearRowPair(b);
    vm.runInContext(script, b.context);
    assertRowPair(b, data);
    clearRowPair(b);
    b.context.sessionStorage.setItem('bg', JSON.stringify({ ...pick, preview: true }));
    vm.runInContext(script, b.context);
    assertRowPair(b, null);
    for (const invalid of ['data:image/png;base64,bGVnYWN5',
      { left: data.left }, { left: data.left, right: 'https://unrelated.example/image.png' }]) {
      b.context.sessionStorage.setItem('bg', JSON.stringify({ ...pick, rows: invalid }));
      vm.runInContext(script, b.context);
      assertRowPair(b, null);
    }
    b.context.innerWidth = 390; b.context.innerHeight = 844;
    b.context.sessionStorage.setItem('bg', JSON.stringify({ ...pick, viewport: 390 / 844 }));
    vm.runInContext(script, b.context);
    assertRowPair(b, null); // Top/bottom margins retain their solid fill.
  }
});

test('legacy shared row colors are discarded and recomputed as independent sides', async () => {
  const url = '/assets/backgrounds/light/thun_schlosssommer.jpg';
  const rows = deferredRows();
  const b = browser({ selectedSets: { laptop: [url], mobile: [url] }, rowLoader: rows.get.bind(rows),
    pick: { v: 3, m: 'l', u: url, manual: true, rows: 'data:image/png;base64,bGVnYWN5' } });
  assertRowPair(b, null);
  assert.equal(b.api.current().rows, undefined);
  const pair = rowPair('replacement');
  rows.pending.get(url).resolve(pair);
  await settleRows();
  assertRowPair(b, pair);
  assert.deepEqual(plain(b.api.current().rows), pair);
});

function rowSampler({ unreadable = false } = {}) {
  const images = [], outputs = [];
  const context = {
    Image: function () { images.push(this); },
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0 };
      let pixels;
      function data() { return pixels ||= new Uint8ClampedArray(canvas.width * canvas.height * 4); }
      canvas.getContext = () => ({
        drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
          for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
            const sourceX = Math.min(image.naturalWidth - 1, Math.floor(sx + (x + 0.5) * sw / dw));
            const sourceY = Math.min(image.naturalHeight - 1, Math.floor(sy + (y + 0.5) * sh / dh));
            const rgb = image.pixel(sourceX, sourceY);
            data().set([...rgb, 255], ((dy + y) * canvas.width + dx + x) * 4);
          }
        },
        getImageData() {
          if (unreadable) throw new Error('Canvas pixels unavailable');
          return { data: data() };
        },
        createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
        putImageData(image) { pixels = image.data; },
      });
      canvas.toDataURL = () => {
        outputs.push({ width: canvas.width, height: canvas.height, pixels: Array.from(data()) });
        return 'data:image/png;base64,' + Buffer.from(data()).toString('base64');
      };
      return canvas;
    } },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source('assets/js/background-rows.js'), context, { filename: 'assets/js/background-rows.js' });
  return { api: context.BackgroundRows, images, outputs,
    load(url, width, height, pixel) {
      const image = images.find(image => image.src === url);
      Object.assign(image, { naturalWidth: width, naturalHeight: height, pixel });
      image.onload();
    } };
}

test('row sampling keeps opposite edges independent while smoothing only vertically', async () => {
  const sampler = rowSampler();
  const first = sampler.api.get('/synthetic.jpg');
  assert.equal(sampler.api.get('/synthetic.jpg'), first, 'repeated requests reuse the in-flight decode');
  sampler.load('/synthetic.jpg', 100, 75, (x, y) => {
    if (x >= 3 && x < 97) return [255, 0, 255]; // Unrelated interior must not leak into either margin.
    const right = x >= 97;
    if (y < 25) return right ? [220, 30, 0] : [0, 0, 180];
    if (y < 50) return right ? [140, 100, 0] : [0, 100, 0];
    return right ? [0, 0, 140] : [180, 0, 0];
  });
  const pair = await first;
  assert.match(pair.left, /^data:image\/png;base64,/);
  assert.match(pair.right, /^data:image\/png;base64,/);
  assert.notEqual(pair.left, pair.right, 'different edges must not receive the same averaged colors');
  assert.equal(sampler.outputs.length, 2);
  function outputFor(url) {
    return sampler.outputs.find(output =>
      'data:image/png;base64,' + Buffer.from(output.pixels).toString('base64') === url);
  }
  const left = outputFor(pair.left), right = outputFor(pair.right);
  for (const output of [left, right]) {
    assert.equal(output.width, 1, 'one color spans each corresponding side margin');
    assert.equal(output.height, 75, 'each source row has its own color');
  }
  const row = (output, y) => output.pixels.slice(y * 4, y * 4 + 4);
  assert.deepEqual(row(left, 12), [0, 0, 180, 255]);
  assert.deepEqual(row(left, 37), [0, 100, 0, 255]);
  assert.deepEqual(row(left, 62), [180, 0, 0, 255]);
  assert.deepEqual(row(right, 12), [220, 30, 0, 255]);
  assert.deepEqual(row(right, 37), [140, 100, 0, 255]);
  assert.deepEqual(row(right, 62), [0, 0, 140, 255]);
  assert(row(left, 24)[1] > 0 && row(left, 24)[2] > 0, 'neighboring rows blend within the left side');
  assert(row(left, 22)[2] > row(left, 24)[2] && row(left, 24)[2] > row(left, 26)[2]);
  assert(row(right, 24)[0] < 220 && row(right, 24)[0] > 140, 'neighboring rows blend within the right side');
  assert.equal(await sampler.api.get('/synthetic.jpg'), pair);
  assert.equal(sampler.images.length, 1, 'both completed profiles share one cached image decode');
});

test('row sampling fails safely when image loading or pixel access is unavailable', async () => {
  const failed = rowSampler();
  const pending = failed.api.get('/missing.jpg');
  failed.images[0].onerror();
  assert.equal(await pending, null);
  assert.equal(await failed.api.get('/missing.jpg'), null);
  assert.equal(failed.images.length, 1, 'a failed image is not fetched repeatedly');
  assert.equal(await failed.api.get(''), null);
  const unreadable = rowSampler({ unreadable: true });
  const inaccessible = unreadable.api.get('/inaccessible.jpg');
  unreadable.load('/inaccessible.jpg', 100, 10, () => [20, 30, 40]);
  assert.equal(await inaccessible, null);
});


test('fresh defaults ignore curation and aspect and use the same moon on every device', () => {
  const light = '/assets/images/skydiving.svg';
  for (const [width, height, coarse, device] of [[1440, 900, false, 'laptop'],
    [390, 844, false, 'mobile'], [844, 390, true, 'mobile'], [5120, 1440, false, 'laptop']]) {
    for (const theme of ['light', 'dark']) {
      const b = browser({ width, height, coarse, theme, selectedSets: entries => {
        const excludedDefault = entries.find(e => e.u.includes('aoujeft_oasis'));
        return { laptop: [excludedDefault.u], mobile: [excludedDefault.u] };
      } });
      const expected = theme === 'light' ? light : '/assets/backgrounds/dark/home_moon2.jpg';
      assert.equal(b.api.current().u, expected);
      assert.equal(b.api.current().default, true);
      assert.equal(b.api.current().manual, false);
      assert.equal(b.api.current().device, device);
      assert.equal(b.api.current().layered, theme === 'light');
    }
  }
  const b = browser({ theme: 'dark' });
  b.resize(390, 844);
  assert.equal(b.api.current().u, '/assets/backgrounds/dark/home_moon2.jpg');
  b.resize(1440, 900);
  assert.equal(b.api.current().u, '/assets/backgrounds/dark/home_moon2.jpg');
  b.api.choose(b.api.all().find(e => e.u.includes('home_moon1')));
  b.resize(1920, 1080);
  assert.equal(b.api.current().u, '/assets/backgrounds/dark/home_moon1.jpg');
  const oldMobileDefault = {
    ...b.api.all().find(e => e.u.includes('home_moon1')),
    v: 7, m: 'd', default: true, manual: false, device: 'mobile', viewport: 390 / 844
  };
  assert.equal(browser({ theme: 'dark', width: 390, height: 844, pick: oldMobileDefault }).api.current().u,
    '/assets/backgrounds/dark/home_moon2.jpg');
});

test('old automatic caches migrate while manual choices and current Random survive navigation', () => {
  const url = '/assets/backgrounds/light/aoujeft_oasis.jpg';
  for (const v of [undefined, 3, 6]) {
    const old = { v, m: 'l', u: url, c: 'stale' };
    assert.equal(browser({ pick: old }).api.current().u, '/assets/images/skydiving.svg');
    const manual = browser({ pick: { ...old, manual: true } });
    assert.equal(manual.api.current().u, url);
    assert.equal(manual.api.current().v, 7);
    assert.equal(manual.api.current().default, false);
    assert.notEqual(manual.api.current().c, 'stale');
  }
  const random = browser();
  random.api.roll(true);
  const pick = random.api.current();
  assert.equal(pick.default, false);
  assert.equal(pick.manual, false);
  assert(random.api.pool().some(e => e.u === pick.u));
  assert.equal(browser({ pick }).api.current().u, pick.u);
  random.resize(390, 844);
  assert.equal(random.api.current().default, false);
  assert(random.api.pool().some(e => e.u === random.api.current().u));
});

test('system theme transitions clear temporary previews and choose deterministic defaults', () => {
  const b = browser({ theme: '' });
  b.api.preview(b.api.all().find(e => e.u.includes('sossusvlei_dune2')));
  b.systemTheme('dark');
  assert.equal(b.api.current().u, '/assets/backgrounds/dark/home_moon2.jpg');
  assert.equal(b.api.current().preview, false);
  assert.equal(b.api.current().default, true);
  b.systemTheme('light');
  assert.equal(b.api.current().u, '/assets/images/skydiving.svg');
});

test('layered transitions remove photo rows and extensions and ignore late photo sampling', async () => {
  const rows = deferredRows();
  const b = browser({ rowLoader: rows.get.bind(rows) });
  assert.equal(rows.pending.size, 0, 'Monterey never enters the photo sampler');
  const photo = b.api.all().find(e => e.extension);
  b.api.choose(photo);
  assert(b.html.classList.contains('has-extension'));
  assert.equal(b.html.classList.contains('has-landscape'), false);
  assert(b.html.style.getPropertyValue('--photo-seam').includes('to right'));
  b.api.choose(b.api.all().find(e => e.layers));
  assert(b.html.classList.contains('has-landscape'));
  assert.equal(b.html.classList.contains('has-extension'), false);
  assert.equal(b.html.style.getPropertyValue('--photo-seam'), 'none');
  rows.pending.get(photo.u).resolve(rowPair('obsolete'));
  await settleRows();
  assertRowPair(b, null);
  assert.equal(b.api.current().rows, undefined);
  b.api.choose(photo);
  await settleRows();
  assertRowPair(b, rowPair('obsolete'));
  assert.equal(b.html.classList.contains('has-landscape'), false);
});

test('photo export retains the complete layered entry first without changing its metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'background-export-'));
  try {
    for (const folder of ['scripts', 'bin', 'backgrounds/light', 'backgrounds/dark', 'assets/js']) {
      fs.mkdirSync(path.join(directory, folder), { recursive: true });
    }
    fs.copyFileSync(path.join(root, 'scripts/export-backgrounds.sh'), path.join(directory, 'scripts/export-backgrounds.sh'));
    fs.copyFileSync(path.join(root, 'backgrounds/layered.json'), path.join(directory, 'backgrounds/layered.json'));
    fs.writeFileSync(path.join(directory, 'backgrounds/light/example.jpg'), '');
    fs.writeFileSync(path.join(directory, 'backgrounds/dark/night.jpg'), '');
    fs.writeFileSync(path.join(directory, 'backgrounds/labels.txt'), 'example\tExample\nnight\tNight\n');
    // Isolate native image tools; exercise the real exporter and durable merge.
    const tools = {
      sips: '#!/bin/sh\nprintf "pixelWidth: 1600\\npixelHeight: 1200\\n"\n',
      osascript: '#!/bin/sh\nprintf "#123456\\n"\n',
      uv: '#!/bin/sh\nexit 0\n'
    };
    for (const [name, contents] of Object.entries(tools)) {
      fs.writeFileSync(path.join(directory, 'bin', name), contents, { mode: 0o755 });
    }
    execFileSync('bash', ['scripts/export-backgrounds.sh'], { cwd: directory,
      env: { ...process.env, PATH: path.join(directory, 'bin') + path.delimiter + process.env.PATH } });
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(directory, 'assets/js/backgrounds.js'), 'utf8'), context);
    const exported = plain(context.window.BACKGROUNDS);
    const layered = JSON.parse(source('backgrounds/layered.json'));
    assert.deepEqual(exported.light[0], layered.light[0]);
    assert.deepEqual(plain(browser().context.BACKGROUNDS.light[0]), layered.light[0]);
    assert.equal(exported.light[1].u, '/assets/backgrounds/light/example.jpg');
    assert.equal(exported.dark[0].u, '/assets/backgrounds/dark/night.jpg');
    assert.equal(browser().api.all().filter(e => !e.layers).length, 45);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('old-version row pairs are not reused even when a valid manual photo survives', () => {
  const url = '/assets/backgrounds/light/thun_schlosssommer.jpg';
  const pending = deferredRows();
  const b = browser({ pick: { v: 6, m: 'l', u: url, manual: true, rows: rowPair('old-version') },
    rowLoader: pending.get.bind(pending) });
  assert.equal(b.api.current().u, url);
  assert.equal(b.api.current().v, 7);
  assert.equal(b.api.current().rows, undefined);
  assertRowPair(b, null);
  assert(pending.pending.has(url));
});

test('both moon subjects remain revealed at desktop, mobile, ultrawide and narrow sizes', () => {
  const b = browser({ theme: 'dark' });
  const moons = b.api.all().filter(entry => entry.subject);
  assert.equal(moons.length, 2);
  for (const moon of moons) {
    b.api.choose(moon);
    for (const [width, height] of [[1440, 900], [1920, 1080], [3440, 1440], [1024, 1024],
      [320, 568], [360, 800], [390, 844], [844, 390], [280, 900]]) {
      b.resize(width, height);
      assert.equal(b.api.current().u, moon.u, 'manual moon survives responsive default changes');
      assert.deepEqual(plain(b.api.current().subject), plain(moon.subject), 'session picks retain source-space bounds');
      assertSubjectReveal(b, moon);
    }
  }
});

test('subject placement uses the nearest vertical opening and leaves an already exposed vertical cap in place', () => {
  const b = browser({ width: 1440, height: 900 });
  for (const moon of b.api.all().filter(entry => entry.subject)) {
    const natural = b.api.layout({ ...moon, subject: undefined });
    const bounds = subjectBounds(b, moon, natural);
    for (const side of ['top', 'bottom']) {
      b.setBox(side === 'top'
        ? { left: 400, right: 1040, top: bounds.top - 20, bottom: bounds.bottom + 100 }
        : { left: 400, right: 1040, top: bounds.top - 100, bottom: bounds.bottom + 20 });
      b.api.choose(moon);
      b.flushFrames();
      assertSubjectReveal(b, moon);
      const placed = subjectBounds(b, moon), box = b.box.getBoundingClientRect();
      const offset = b.api.layout(moon).top - natural.top;
      assert(side === 'top' ? offset < 0 : offset > 0, 'the nearer vertical edge wins');
      const cap = Math.min(32, (bounds.bottom - bounds.top) / 4);
      assert(Math.abs((side === 'top' ? box.top - placed.top : placed.bottom - box.bottom) - cap) < 0.000001,
        'translation stops as soon as the requested cap is exposed');

      b.setBox(side === 'top'
        ? { left: 400, right: 1040, top: bounds.bottom + 32, bottom: 896 }
        : { left: 400, right: 1040, top: 4, bottom: bounds.top - 32 });
      b.flushFrames();
      assert.equal(b.api.layout(moon).top, natural.top, 'a natural vertical cap is left in place');
      assert.equal(b.html.style.getPropertyValue('--photo-offset-y'), '');
      assertSubjectReveal(b, moon);
    }
  }
});

test('scrolling long boxes, observer changes and page swaps preserve the same centered moon without resampling', () => {
  const rows = deferredRows();
  const b = browser({ theme: 'dark', width: 1440, height: 900, rowLoader: rows.get.bind(rows) });
  const moon = b.api.all().find(entry => entry.u.includes('home_moon1'));
  b.api.preview(moon);
  assertSubjectReveal(b, moon);
  const pick = b.context.sessionStorage.getItem('bg');
  const offsetX = b.html.style.getPropertyValue('--photo-offset-x');
  assert.notEqual(b.html.style.getPropertyValue('--photo-offset-y'), '');
  const box = b.box.getBoundingClientRect();
  b.setBox({ ...box, top: -3000, bottom: 6000, height: 9000 });
  b.emit('scroll');
  b.emit('resize');
  assert.equal(b.pendingFrames(), 1, 'scroll, resize and observation share a single animation frame');
  b.flushFrames();
  assertSubjectReveal(b, moon);
  assert.equal(b.html.style.getPropertyValue('--photo-offset-x'), offsetX, 'no horizontal escape from a long box');
  assert.equal(b.html.style.getPropertyValue('--photo-offset-y'), '', 'no vertical opening retains natural height');
  const writes = b.html.style.writes.get('--photo-offset-y');
  b.emit('scroll');
  b.flushFrames();
  assert.equal(b.html.style.writes.get('--photo-offset-y'), writes, 'unchanged placement is not rewritten');
  b.scrollBox({ ...box, top: -3000, bottom: 700 });
  b.flushFrames();
  assertSubjectReveal(b, moon);
  assert(subjectBounds(b, moon).bottom > 700, 'scrolling the bottom edge into view exposes a bottom cap');
  b.setBox({ left: 50, right: 700, top: 100, bottom: 3000 });
  b.flushFrames();
  assertSubjectReveal(b, moon);
  assert(subjectBounds(b, moon).top < 100, 'an available top edge exposes a top cap');
  const oldBox = b.box;
  b.swap('research.html', { left: 400, right: 1040, top: 100, bottom: 5000 });
  assert.deepEqual(b.observedBoxes(), [b.box]);
  assert(!b.observedBoxes().includes(oldBox), 'replaced intro is disconnected');
  assertSubjectReveal(b, moon);
  b.swap('index.html');
  assert.deepEqual(b.observedBoxes(), [b.box], 'home swaps observe the new intro');
  assertSubjectReveal(b, moon);
  assert.equal(b.context.sessionStorage.getItem('bg'), pick, 'geometry never replaces the selected moon or preview');
  assert.equal(rows.pending.size, 0, 'uniform black never enters the row sampler');
});

test('ordinary photos and layered artwork clear moon placement and stop observing the box', () => {
  const b = browser({ theme: 'dark' });
  const moon = b.api.all().find(entry => entry.u.includes('home_moon1'));
  for (const next of [b.api.all().find(entry => !entry.subject && !entry.layers),
    b.api.all().find(entry => entry.layers)]) {
    b.api.choose(moon);
    assert.notEqual(b.html.style.getPropertyValue('--photo-offset-x'), '');
    assert.notEqual(b.html.style.getPropertyValue('--photo-offset-y'), '');
    b.notifyBox();
    b.api.choose(next);
    assert.equal(b.html.style.getPropertyValue('--photo-offset-x'), '');
    assert.equal(b.html.style.getPropertyValue('--photo-offset-y'), '');
    assert.deepEqual(b.observedBoxes(), []);
    b.flushFrames();
    b.notifyBox();
    assert.equal(b.pendingFrames(), 0);
    assert.equal(b.html.style.getPropertyValue('--photo-offset-x'), '', 'queued moon work cannot restore its offset');
    assert.equal(b.html.style.getPropertyValue('--photo-offset-y'), '', 'queued moon work cannot restore vertical placement');
    assert.equal(b.api.current().subject, undefined);
    const layout = b.api.layout(next);
    assert.equal(layout.left, (b.context.innerWidth - layout.width) / 2, 'other backgrounds retain centered contain geometry');
    assert.equal(b.html.classList.contains('has-landscape'), !!next.layers);
  }
});

test('moon picks discard stale cached rows and ignore late sampling from an earlier photo', async () => {
  const rows = deferredRows();
  const b = browser({ rowLoader: rows.get.bind(rows) });
  const photo = b.api.all().find(entry => entry.u.includes('thun_schlosssommer'));
  const moon = b.api.all().find(entry => entry.u.includes('home_moon2'));
  b.api.choose(photo);
  b.api.choose(moon);
  const saved = b.context.sessionStorage.getItem('bg');
  assert(!rows.pending.has(moon.u));
  rows.pending.get(photo.u).resolve(rowPair('late-photo'));
  await settleRows();
  assertSubjectReveal(b, moon);
  assert.equal(b.context.sessionStorage.getItem('bg'), saved, 'late rows cannot contaminate the moon cache');
  assert.equal(b.api.current().rows, undefined);

  const cached = { ...plain(b.api.current()), rows: rowPair('stale-moon') };
  delete cached.subject; // A pre-metadata manual cache must also be refreshed.
  const reloaded = browser({ pick: cached, rowLoader: rows.get.bind(rows) });
  assert.deepEqual(plain(reloaded.api.current().subject), plain(moon.subject));
  assert.equal(reloaded.api.current().rows, undefined);
  assert(!rows.pending.has(moon.u), 'neither fresh nor cached subject picks request a strip');
  assertSubjectReveal(reloaded, moon);
  for (const page of ['index.html', 'research.html', 'cv.html', '404.html']) {
    reloaded.context.sessionStorage.setItem('bg', JSON.stringify({ ...reloaded.api.current(), rows: rowPair('stale') }));
    const script = source(page).match(/<script>([\s\S]*?)<\/script>/)[1];
    vm.runInContext(script, reloaded.context);
    assertRowPair(reloaded, null);
    const pick = reloaded.api.current();
    assert.equal(reloaded.html.style.getPropertyValue('--sky'), pick.c);
  }
});
