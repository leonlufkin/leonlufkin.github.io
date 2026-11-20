// Run with: node --test scripts/test-site.cjs
// Exercises each page's inline bootstrap and assets/js/site.js against a small
// DOM/storage fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const PAGES = ['index.html', 'research.html', 'cv.html', '404.html'];
const bootstrapOf = page => source(page).match(/<script>([\s\S]*?)<\/script>/)[1];
const MOON = '/assets/backgrounds/dark/home_moon2.jpg';

function element(tag) {
  const attributes = new Map(), styles = new Map(), listeners = new Map();
  const el = { tagName: tag.toUpperCase(), children: [], className: '', textContent: '', parent: null,
    isContentEditable: false,
    style: { setProperty: (k, v) => { styles.set(k, v); }, getPropertyValue: k => styles.get(k) || '',
      removeProperty: k => { styles.delete(k); }, snapshot: () => Object.fromEntries(styles) },
    setAttribute: (k, v) => { attributes.set(k, String(v)); }, getAttribute: k => attributes.has(k) ? attributes.get(k) : null,
    hasAttribute: k => attributes.has(k), removeAttribute: k => { attributes.delete(k); },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); },
    matches(selector) {
      if (selector.startsWith('[')) return attributes.has(selector.slice(1, -1));
      if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
      return this.tagName === selector.toUpperCase();
    },
    querySelectorAll(selector) {
      return this.children.flatMap(child => (child.matches(selector) ? [child] : []).concat(child.querySelectorAll(selector)));
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).concat(fn)); },
    fire(type, event = {}) { if (this['on' + type]) this['on' + type](event); (listeners.get(type) || []).forEach(fn => fn(event)); } };
  el.classList = {
    contains: k => el.className.split(' ').includes(k),
    add(k) { if (!this.contains(k)) el.className = (el.className + ' ' + k).trim(); },
    remove(k) { el.className = el.className.split(' ').filter(v => v !== k).join(' '); },
    toggle(k, on) { on = on === undefined ? !this.contains(k) : !!on; if (on) this.add(k); else this.remove(k); return on; } };
  return el;
}

// A browser window showing `page`, with the page's bootstrap already run.
function browser({ page = 'index.html', width = 1440, height = 900, ratio = 2, system = 'light', stored,
  hostname = 'leonlufkin.github.io', storageFails = false, worker = false, controlled = true } = {}) {
  const html = element('html'), head = element('head'), body = element('body');
  const windowListeners = new Map(), documentListeners = new Map(), mediaListeners = [];
  const frames = [], idle = [], requests = [], images = [];
  const registrations = [], workerListeners = new Map(), posted = [], session = new Map(), pictures = [];
  const fetched = ['https://' + hostname + '/assets/css/style.css?v=1'];
  const storage = new Map(stored ? [['theme', stored]] : []);
  let nav, box, reloads = 0;

  function mountPage(name) {
    if (nav) nav.remove();
    if (box) box.remove();
    nav = element('nav');
    const theme = nav.appendChild(element('button')); theme.className = 'theme-toggle';
    box = element(name === 'index.html' ? 'section' : 'main');
    // Each page's text box sits somewhere else; the background must not care.
    const top = 140 + 60 * PAGES.indexOf(name), height = 400 + 300 * PAGES.indexOf(name);
    box.getBoundingClientRect = () => ({ left: 368, right: 1072, top, bottom: top + height, width: 704, height });
    for (const [tag, encoded] of name === 'cv.html' ? [['span', 'bHVma2luQHN0YW5mb3JkLmVkdQ=='], ['a', 'bGVvbkB6eXBocmEuY29t']] : []) {
      const address = box.appendChild(element(tag));
      address.className = 'email-rev'; address.textContent = 'reversed fallback';
      address.setAttribute('data-email', encoded);
    }
    body.className = name === 'index.html' ? 'home' : '';
    body.appendChild(nav); body.appendChild(box);
  }
  mountPage(page);

  const context = {
    innerWidth: width, innerHeight: height, devicePixelRatio: ratio,
    document: { documentElement: html, head, body, hidden: false,
      createElement(tag) { const made = element(tag); if (tag === 'picture') pictures.push(made); return made; },
      importNode: node => { const copy = element(node.tagName); copy.setAttribute('srcset', node.getAttribute('srcset')); return copy; },
      querySelector: selector => selector === 'nav' ? nav : body.querySelector(selector),
      querySelectorAll: selector => body.querySelectorAll(selector),
      addEventListener(type, fn) { documentListeners.set(type, (documentListeners.get(type) || []).concat(fn)); } },
    localStorage: {
      getItem(k) { if (storageFails) throw new Error('denied'); return storage.has(k) ? storage.get(k) : null; },
      setItem(k, v) { if (storageFails) throw new Error('denied'); storage.set(k, String(v)); },
      removeItem(k) { storage.delete(k); } },
    matchMedia: () => ({ get matches() { return system === 'dark'; },
      addEventListener(type, fn) { mediaListeners.push(fn); } }),
    addEventListener(type, fn) { windowListeners.set(type, (windowListeners.get(type) || []).concat(fn)); },
    dispatchEvent(event) { (windowListeners.get(event.type) || []).forEach(fn => fn(event)); },
    Event: function (type) { this.type = type; },
    Image: function () { const image = {}; images.push(image); return image; },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    requestIdleCallback(fn) { idle.push(fn); },
    setTimeout(fn) { idle.push(fn); },
    history: {}, scrollTo() {},
    navigator: worker ? { serviceWorker: {
      controller: controlled ? {} : null,
      register(url) { registrations.push(url); return Promise.resolve(); },
      addEventListener(type, fn) { workerListeners.set(type, (workerListeners.get(type) || []).concat(fn)); },
      ready: Promise.resolve({ active: { postMessage(message) { posted.push(message); } } }) } } : {},
    sessionStorage: { getItem: k => session.has(k) ? session.get(k) : null, setItem: (k, v) => { session.set(k, String(v)); } },
    performance: { getEntriesByType: () => fetched.map(name => ({ name })) },
    location: { hostname, origin: 'https://' + hostname, pathname: '/' + (page === 'index.html' ? '' : page),
      href: 'https://' + hostname + '/' + (page === 'index.html' ? '' : page), reload() { reloads++; } },
    // The home page is the one with a picture: the headshot, as WebP with a JPEG fallback.
    fetch(url, options) { requests.push({ url, options });
      return Promise.resolve({ ok: true, text: () => Promise.resolve(url === 'index.html' ? '<picture>headshot</picture>' : '<main></main>') }); },
    DOMParser: class { parseFromString(text) {
      const source = element('source'); source.setAttribute('srcset', 'headshot.webp 2x');
      const frame = element('picture'); frame.appendChild(source);
      const image = frame.appendChild(element('img')); image.setAttribute('src', 'headshot.jpg');
      image.closest = () => frame;
      return { querySelectorAll: () => text.includes('<picture>') ? [image] : [] }; } },
    atob: text => Buffer.from(text, 'base64').toString('latin1'), URL, console,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(bootstrapOf(page), context, { filename: page });

  const b = { context, html, head, requests, images, registrations, posted, fetched,
    // The warmed pictures finish downloading.
    loadPictures() { pictures.forEach(p => p.children.forEach(c => c.onload && c.onload())); },
    get nav() { return nav; }, get box() { return box; }, get reloads() { return reloads; },
    // What each warmed picture would make the browser fetch: its sources, then the image's own address.
    pictures: () => pictures.map(p => p.children.map(c => c.tagName + ':' + (c.getAttribute('srcset') || c.getAttribute('src')))),
    workerEvent(type, event = {}) { (workerListeners.get(type) || []).forEach(fn => fn(event)); },
    workerMessage(data) { b.workerEvent('message', { data }); },
    get themeButton() { return nav.querySelector('.theme-toggle'); },
    theme: () => storage.has('theme') ? storage.get('theme') : null,
    loadSite() { vm.runInContext(source('assets/js/site.js'), context, { filename: 'site.js' }); return b; },
    emit(type) { context.dispatchEvent({ type }); },
    key(key, event = {}) {
      (documentListeners.get('keydown') || []).forEach(fn => fn({ key, target: body, preventDefault() {}, ...event }));
    },
    documentEvent(type) { (documentListeners.get(type) || []).forEach(fn => fn({ type })); },
    swap(name) { mountPage(name); b.emit('pageswap'); },
    resize(w, h) { context.innerWidth = w; context.innerHeight = h; b.emit('resize'); frames.splice(0).forEach(fn => fn()); },
    system(mode) { system = mode; mediaListeners.forEach(fn => fn({ matches: mode === 'dark' })); },
    runIdle() { idle.splice(0).forEach(fn => fn()); },
    preloads: () => head.children.filter(e => e.rel === 'preload').map(e => e.href),
    background: () => ({ classes: html.className.split(' ').filter(c => c.startsWith('has-')).sort(), style: html.style.snapshot() }) };
  return b;
}

test('every page carries the same bootstrap', () => {
  assert.equal(new Set(PAGES.map(bootstrapOf)).size, 1);
});

test('the theme alone picks the background before first paint: the bay in light, the moon in dark', () => {
  const light = browser();
  assert.deepEqual(light.background().classes, ['has-landscape']);
  assert.equal(light.html.style.getPropertyValue('--bg-image'), '', 'no photo is handed to CSS behind the layered scene');
  assert.deepEqual(light.preloads(), ['sky', 'coast', 'diver'].map(n => `/assets/images/skydiving-${n}-2x.webp`));

  const dark = browser({ system: 'dark' });
  assert.deepEqual(dark.background().classes, ['has-photo']);
  assert(dark.html.style.getPropertyValue('--bg-image').includes(MOON));
  assert.deepEqual(dark.preloads(), [MOON]);
});

test('a saved theme beats the system setting; anything else in storage is ignored', () => {
  const forcedDark = browser({ system: 'light', stored: 'dark' });
  assert(forcedDark.html.classList.contains('dark'));
  assert.deepEqual(forcedDark.background().classes, ['has-photo']);

  const forcedLight = browser({ system: 'dark', stored: 'light' });
  assert(forcedLight.html.classList.contains('light'));
  assert.deepEqual(forcedLight.background().classes, ['has-landscape']);

  const junk = browser({ system: 'dark', stored: 'sepia' });
  assert.equal(junk.html.classList.contains('dark') || junk.html.classList.contains('light'), false);
  assert.deepEqual(junk.background().classes, ['has-photo']);

  assert.deepEqual(browser({ system: 'dark', storageFails: true }).background().classes, ['has-photo']);
});

test('phones and small windows load the 1x layers, larger or denser screens the 2x layers', () => {
  const set = options => browser(options).preloads()[0].match(/-(\d)x\.webp$/)[1];
  assert.equal(set({ width: 390, height: 844, ratio: 3 }), '1');
  assert.equal(set({ width: 844, height: 390, ratio: 3 }), '1');
  assert.equal(set({ width: 1280, height: 720, ratio: 1 }), '1');
  assert.equal(set({ width: 1440, height: 900, ratio: 2 }), '2');
  assert.equal(set({ width: 2560, height: 1440, ratio: 1 }), '2');
});

test('the background never changes with the page in front of it', () => {
  for (const system of ['light', 'dark']) {
    const b = browser({ system }).loadSite();
    const home = b.background();
    for (const page of ['research.html', 'cv.html', '404.html', 'index.html']) {
      b.swap(page);
      b.emit('scroll');
      assert.deepEqual(b.background(), home, `${system}: ${page}`);
    }
    for (const page of PAGES) {
      assert.deepEqual(browser({ system, page }).background(), home, `${system}: opened on ${page}`);
    }
  }
});

test('the theme button switches once per click, remembers the choice and relabels itself', () => {
  for (const page of PAGES) {
    const b = browser({ page }).loadSite();
    let changes = 0;
    b.context.addEventListener('themechange', () => { changes++; });
    assert.equal(b.themeButton.getAttribute('aria-label'), 'Switch to dark mode');
    b.themeButton.fire('click');
    assert.equal(b.theme(), 'dark');
    assert.deepEqual(b.background().classes, ['has-photo']);
    assert.equal(b.themeButton.getAttribute('aria-label'), 'Switch to light mode');
    b.swap('cv.html');
    b.themeButton.fire('click');
    assert.equal(b.theme(), 'light');
    assert.deepEqual(b.background().classes, ['has-landscape']);
    assert.equal(changes, 2, 'the landscape renderer hears each switch');
  }
});

test('the system theme is followed until the visitor has chosen one', () => {
  const b = browser().loadSite();
  b.system('dark');
  assert.deepEqual(b.background().classes, ['has-photo']);
  assert.equal(b.theme(), null);
  b.themeButton.fire('click');
  assert.equal(b.theme(), 'light');
  b.system('light'); b.system('dark');
  assert.deepEqual(b.background().classes, ['has-landscape'], 'an explicit choice outlives system changes');
});

test('D switches the theme, but never while typing, with a modifier, or on key repeat', () => {
  const b = browser().loadSite();
  b.key('d');
  assert.equal(b.theme(), 'dark');
  b.key('D');
  assert.equal(b.theme(), 'light');
  for (const event of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { repeat: true }, { defaultPrevented: true },
    { target: { tagName: 'INPUT' } }, { target: { tagName: 'TEXTAREA' } }, { target: { tagName: 'DIV', isContentEditable: true } }]) {
    b.key('d', event);
    assert.equal(b.theme(), 'light', JSON.stringify(event));
  }
  b.key('s');
  assert.equal(b.theme(), 'light');
});

test('Esc hides the text box and shows it again; a new page or a theme switch brings the text back', () => {
  for (const page of PAGES) {
    const b = browser({ page }).loadSite();
    const hidden = () => b.html.classList.contains('content-hidden');
    assert.equal(hidden(), false);
    b.key('Escape');
    assert.equal(hidden(), true);
    b.key('Escape');
    assert.equal(hidden(), false);
    b.key('Escape');
    b.swap('research.html');
    assert.equal(hidden(), false, 'a new page arrives with its text');
    b.key('Escape');
    assert.equal(hidden(), true);
    b.themeButton.fire('click');
    assert.equal(hidden(), false, 'the theme button brings the text back');
    b.key('Escape');
    b.key('d');
    assert.equal(hidden(), false, 'so does the D key');
    for (const event of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { repeat: true }, { defaultPrevented: true },
      { target: { tagName: 'INPUT' } }, { target: { tagName: 'TEXTAREA' } }, { target: { tagName: 'DIV', isContentEditable: true } }]) {
      b.key('Escape', event);
      assert.equal(hidden(), false, 'ignored: ' + JSON.stringify(event));
    }
  }
});

test('resizing re-fits the background to the window without touching the theme', () => {
  const b = browser({ system: 'dark' }).loadSite();
  const seam = () => b.html.style.getPropertyValue('--photo-seam');
  assert.match(seam(), /to right/, 'a wide window feathers the photo into its side margins');
  b.resize(390, 844);
  assert.match(seam(), /to bottom/, 'a tall window feathers it into the top and bottom margins');
  assert.deepEqual(b.background().classes, ['has-photo']);
  assert.equal(b.theme(), null);
});

test('e-mail addresses reach the page only through the script, as text and mailto links', () => {
  const b = browser({ page: 'cv.html' }).loadSite();
  const [plain, link] = b.box.children;
  assert.equal(plain.textContent, 'lufkin@stanford.edu');
  assert.equal(plain.getAttribute('href'), null, 'a span stays plain text');
  assert.equal(link.textContent, 'leon@zyphra.com');
  assert.equal(link.getAttribute('href'), 'mailto:leon@zyphra.com');
  assert.equal(link.classList.contains('email-rev'), false, 'the reversed fallback styling is lifted');

  // Addresses arriving with a swapped-in page are decoded too.
  const later = browser().loadSite();
  later.swap('cv.html');
  assert.equal(later.box.children[1].getAttribute('href'), 'mailto:leon@zyphra.com');
});

test('no page source contains a harvestable address', () => {
  for (const page of PAGES) {
    const html = source(page);
    assert.doesNotMatch(html, /mailto:/i, page);
    assert.doesNotMatch(html, /[\w.+-]+@[\w-]+\.[\w.-]+/, page);
    assert.doesNotMatch(html, /&#(?:64|x40);|&commat;/i, page);
  }
  const encoded = [...source('cv.html').matchAll(/data-email="([^"]+)"/g)].map(m => Buffer.from(m[1], 'base64').toString());
  assert.deepEqual([...new Set(encoded)].sort(), ['leon@zyphra.com', 'lufkin@stanford.edu']);
});

test('pages are prefetched once at idle; only a local preview refetches them when the tab returns', () => {
  const live = browser().loadSite();
  live.runIdle();
  assert.deepEqual(live.requests.map(r => r.url), ['index.html', 'research.html', 'cv.html']);
  live.emit('focus'); live.documentEvent('visibilitychange');
  assert.equal(live.requests.length, 3, 'a deployed site makes no requests on tab focus');

  const local = browser({ hostname: 'localhost' }).loadSite();
  local.emit('focus');
  assert.deepEqual(local.requests.map(r => r.options && r.options.cache), ['no-cache', 'no-cache', 'no-cache']);
});

test('while the bay is showing, the moon is fetched once the page has loaded, for an instant first switch', () => {
  const light = browser().loadSite();
  light.runIdle();
  assert.deepEqual(light.images, [], 'not while the page is still loading what it shows');
  light.emit('load'); light.runIdle();
  assert.deepEqual(light.images.map(image => image.src), [MOON]);

  const dark = browser({ system: 'dark' }).loadSite();
  dark.emit('load'); dark.runIdle();
  assert.deepEqual(dark.images, [], 'already on screen in dark mode');
});
