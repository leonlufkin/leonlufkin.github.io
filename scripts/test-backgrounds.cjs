// Run with: node --test scripts/test-backgrounds.cjs
// Exercise the real browser scripts with a small DOM/storage fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

function browser({ width = 1440, height = 900, theme = 'light', pick, preview, coarse = false,
  hostname = 'localhost', search = '', selectedSets, rowLoader } = {}) {
  const nodes = new Map(), listeners = new Map(), timers = new Map();
  let nextTimer = 0, fetchError = null;
  const requests = [];
  let context;
  function style() {
    const values = new Map();
    return { setProperty: (k, v) => values.set(k, v),
      getPropertyValue: k => values.get(k) || '', removeProperty: k => values.delete(k) };
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
      fire(k, event = {}) { (this.events[k] || []).forEach(fn => fn(event)); } };
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
  const html = element('html'), body = element('body'), head = element('head');
  const nav = element('nav'), intro = element('section');
  body.appendChild(nav); body.appendChild(intro);
  context = {
    innerWidth: width, innerHeight: height,
    document: { documentElement: html, body, head, createElement: element,
      getElementById: id => nodes.get(id) || null,
      querySelector: selector => selector === 'nav' ? nav : selector === '.intro' ? intro : null,
      addEventListener() {} },
    localStorage: storage({ theme, ...(preview ? { 'stylePreview-v9': JSON.stringify(preview) } : {}) }),
    sessionStorage: storage(pick ? { bg: JSON.stringify(pick) } : {}),
    matchMedia: query => ({ matches: query === '(pointer: coarse)' ? coarse
      : query === '(prefers-color-scheme: dark)' ? theme === 'dark' : false, addEventListener() {} }),
    addEventListener(k, fn) { if (!listeners.has(k)) listeners.set(k, []); listeners.get(k).push(fn); },
    dispatchEvent(event) { (listeners.get(event.type) || []).forEach(fn => fn(event)); },
    Event: function (type) { this.type = type; }, Image: function () { return element('img'); },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id), requestIdleCallback() {},
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
  run('assets/js/background-selections.js');
  if (selectedSets) {
    const catalog = context.BACKGROUNDS.light.concat(context.BACKGROUNDS.dark);
    context.BACKGROUND_SELECTIONS = typeof selectedSets === 'function' ? selectedSets(catalog) : selectedSets;
  }
  run('assets/js/site.js');
  return { context, nodes, nav, html, run, requests, api: context.SiteBackgrounds,
    failSaves(message) { fetchError = message; },
    emit(type) { context.dispatchEvent({ type }); },
    resize(w, h) { context.innerWidth = w; context.innerHeight = h; this.emit('resize');
      const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    previewState() { return JSON.parse(context.localStorage.getItem('stylePreview-v9')); } };
}

const plain = value => JSON.parse(JSON.stringify(value));
const allSelected = entries => {
  const urls = entries.map(e => e.u);
  return { laptop: urls, mobile: urls };
};

test('phones, laptops, desktops, square windows and ultrawides choose the closest photo shapes in both themes', () => {
  for (const [width, height, shape] of [[390, 844, 'portrait'], [844, 390, 'landscape'],
    [1440, 900, 'landscape'], [1920, 1080, 'landscape'], [1024, 1024, 'either'],
    [3440, 1440, 'panorama'], [5120, 1440, 'panorama']]) {
    for (const theme of ['light', 'dark']) {
      const b = browser({ width, height, theme, selectedSets: allSelected });
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

test('rotation replaces an unsuitable photo; small resizes and navigation keep the current one', () => {
  const b = browser();
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
  assert.equal(p.v, 3);
  assert.equal(p.c, b.api.all().find(e => e.u === p.u).edge.caps);
  assert.equal(p.device, 'mobile');
  assert(p.width > 0 && p.height > 0);
  assert.equal(p.s, undefined);
  for (const key of ['--bg-size', '--bg-pos', '--bg-wide']) assert.equal(b.html.style.getPropertyValue(key), '');
  assert.notEqual(browser({ pick: p }).api.current().u, p.u);
});

test('curated exclusions never return through random selection, a cached choice, or theme fallback', () => {
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
  assert.equal(b.api.choose(old), false);
  const reload = browser({ theme: 'dark', pick: old, selectedSets: b.api.selections() });
  assert(allowed.includes(reload.api.current().u));
});

test('Laptop and Mobile sets remain independent, including landscape phones with coarse pointers', () => {
  const initial = browser();
  const landscape = initial.api.all().find(e => e.width > e.height);
  const portrait = initial.api.all().find(e => e.width < e.height);
  const selectedSets = { laptop: [landscape.u], mobile: [portrait.u] };
  const laptop = browser({ selectedSets });
  assert.equal(laptop.api.device(), 'laptop');
  assert.equal(laptop.api.current().u, landscape.u);
  const phone = browser({ width: 844, height: 390, coarse: true, selectedSets });
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
  assert.equal(b.api.choose(excluded), false);
  assert.equal(b.api.preview(excluded), true);
  assert.equal(b.api.current().preview, true);
  assert.equal(b.api.current().u, excluded.u);
  b.api.roll(false);
  assert.equal(b.api.current().u, excluded.u);
  assert.deepEqual(plain(b.api.selections()), before);
  b.api.setSelections(before);
  assert.equal(b.api.current().preview, false);
  assert(before.laptop.includes(b.api.current().u));
  assert.notEqual(browser({ pick: { ...b.api.current(), u: excluded.u, preview: true } }).api.current().u, excluded.u);
});

test('legacy style indices are not remapped and an eligible manual choice survives navigation and styling', () => {
  const b = browser({ width: 390, height: 844, preview: { i: 1, f: 2 } });
  b.run('assets/js/switcher.js');
  assert.equal(b.previewState().i, 0); // original index 1 was a landscape, now excluded
  assert.equal(b.previewState().f, 2);
  const darkPortrait = b.api.galleryPool().find(e => e.u.includes('/dark/'));
  assert.equal(b.api.choose(darkPortrait), true);
  b.api.roll(false); b.emit('pageswap');
  b.nodes.get('style-switcher').fire('click', { target: { getAttribute: k => k === 'data-k' ? 'f' : '1' } });
  assert.equal(b.api.current().u, darkPortrait.u);
  assert.equal(b.api.current().preview, false);
  assert.equal(browser({ width: 390, height: 844, pick: b.api.current() }).api.current().u, darkPortrait.u);
  b.resize(1440, 900);
  assert.notEqual(b.api.current().u, darkPortrait.u);
  assert.equal(b.previewState().imageUrl, null);
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

test('every photo stays uncropped on laptop, ultrawide, square and phone screens', () => {
  const b = browser();
  const entries = b.api.all();
  for (const entry of entries) {
    assert.equal(entry.outpaint, undefined);
    assert.match(entry.edge.sides, /^#[0-9a-f]{6}$/i);
    assert.match(entry.edge.caps, /^#[0-9a-f]{6}$/i);
    for (const [width, height] of [[1440, 900], [3440, 1440], [1024, 1024], [390, 844]]) {
      b.resize(width, height);
      b.api.preview(entry);
      const layout = b.api.layout(entry);
      assert(layout.width <= width + 0.001 && layout.height <= height + 0.001);
      assert(layout.left >= -0.001 && layout.top >= -0.001);
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
  const publicSite = browser({ hostname: 'leonlufkin.github.io' });
  publicSite.run('assets/js/gallery.js');
  publicSite.nav.children.find(e => e.className.includes('gallery-btn')).fire('click');
  const publicGallery = publicSite.nodes.get('gallery');
  assert.equal(publicGallery.querySelectorAll('input').length, 0);
  assert.equal(publicGallery.querySelectorAll('.gallery-tab').length, 0);
  assert.equal(publicGallery.querySelector('.gallery-save'), null);
  assert.equal(publicSite.nodes.get('gallery-grid').children.length, publicSite.api.galleryPool().length);
});

test('empty or malformed catalog entries cannot become candidates or saved selections', () => {
  const b = browser();
  assert.throws(() => b.api.setSelections({ laptop: [], mobile: ['bad.jpg'] }));
  b.context.BACKGROUNDS.light = [{ u: 'bad.jpg' }, { width: 1, height: 0 }, { width: -1, height: 4 }];
  b.context.BACKGROUNDS.dark = [];
  assert.equal(b.api.pool().length, 0);
  assert.doesNotThrow(() => b.api.roll(true));
});

test('theme changes select a fitting photo from the new mode and keep preview controls in sync', () => {
  const b = browser({ width: 390, height: 844 });
  b.run('assets/js/switcher.js');
  b.api.choose(b.api.pool('light')[0]);
  b.nav.children.find(e => e.className === 'theme-toggle').onclick();
  assert.equal(b.api.current().m, 'd');
  assert(b.api.current().u.includes('/dark/'));
  assert(b.api.current().width < b.api.current().height);
  assert.equal(b.api.current().manual, false);
  assert.equal(b.previewState().imageUrl, null);
});

test('all four pre-paint bootstraps restore only current geometry and never a temporary preview', () => {
  for (const page of ['index.html', 'research.html', 'cv.html', '404.html']) {
    const b = browser();
    const script = source(page).match(/<script>([\s\S]*?)<\/script>/)[1];
    b.html.style.removeProperty('--bg-image');
    vm.runInContext(script, b.context);
    assert(b.html.style.getPropertyValue('--bg-image').includes(b.api.current().u));
    b.html.style.removeProperty('--bg-image');
    b.context.sessionStorage.setItem('bg', JSON.stringify({ ...b.api.current(), preview: true }));
    vm.runInContext(script, b.context);
    assert.equal(b.html.style.getPropertyValue('--bg-image'), '');
    b.context.sessionStorage.setItem('bg', JSON.stringify({ ...b.api.current(), preview: false }));
    b.context.innerWidth = 390; b.context.innerHeight = 844;
    vm.runInContext(script, b.context);
    assert.equal(b.html.style.getPropertyValue('--bg-image'), '');
    b.context.sessionStorage.setItem('bg', JSON.stringify({ v: 2, m: 'l', u: '/old.jpg', s: 116.5 }));
    vm.runInContext(script, b.context);
    assert.equal(b.html.style.getPropertyValue('--bg-image'), '');
    assert.equal(b.html.style.getPropertyValue('--bg-size'), '');
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

