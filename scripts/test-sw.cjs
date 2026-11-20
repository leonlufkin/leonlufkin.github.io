// Run with: node --test scripts/test-sw.cjs
// Exercises sw.js (the offline cache worker) against a fake network and cache.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ORIGIN = 'https://leonlufkin.github.io';
const source = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');

const reply = (body, { status = 200, redirected = false } = {}) => ({ status, redirected, type: 'basic',
  clone: () => reply(body, { status, redirected }), text: async () => body });

// A worker with nothing cached yet. `site` maps paths to what the network answers:
// a body, a reply(), 'offline', or 'never' (a connection that never answers).
// Change it between requests to model the server.
function worker(site) {
  const handlers = {}, stored = new Map(), announced = [], removed = [], fetched = [];
  const windows = new Map(); // client id → how many more times it is asked for before it exists
  const keyOf = key => typeof key === 'string' ? key : key.url;
  const cache = {
    match: async key => stored.has(keyOf(key)) ? stored.get(keyOf(key)).clone() : undefined,
    put: async (key, response) => { stored.set(keyOf(key), response); },
    keys: async () => [...stored.keys()].map(url => ({ url })),
    delete: async key => stored.delete(keyOf(key)) };
  // Messages are copied, as postMessage does, so they compare as plain objects here.
  const open = id => ({ postMessage: message => announced.push({ to: id, ...message }) });
  const context = { URL, console,
    location: { origin: ORIGIN, href: ORIGIN + '/sw.js' },
    setTimeout: fn => setImmediate(fn),
    addEventListener(type, handler) { handlers[type] = handler; },
    skipWaiting() {},
    clients: { claim: async () => {},
      get: async id => { const waits = windows.get(id); if (waits > 0) { windows.set(id, waits - 1); return undefined; } return open(id); },
      matchAll: async () => [...windows].filter(([, waits]) => waits === 0).map(([id]) => open(id)) },
    caches: { open: async () => cache, keys: async () => ['site-v1', 'site-v0'], delete: async name => removed.push(name) },
    fetch(href, options = {}) {
      const url = new URL(href), answer = site[url.pathname + url.search];
      fetched.push({ path: url.pathname + url.search, revalidated: options.cache === 'no-cache' });
      if (answer === 'offline' || answer === undefined) return Promise.reject(new TypeError('Failed to fetch'));
      if (answer === 'never') return new Promise(() => {});
      return Promise.resolve(typeof answer === 'string' ? reply(answer) : answer);
    } };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'sw.js' });

  // Returns null when the worker leaves the request to the browser. `opening` is the
  // window a navigation is loading: { id, startsAfter } (asked that often before it exists).
  async function get(url, { method = 'GET', headers = {}, mode = 'no-cors', cache: cacheMode = 'default', opening } = {}) {
    let answer; const background = [];
    if (opening) windows.set(opening.id, opening.startsAfter || 0);
    handlers.fetch({ request: { url: url.startsWith('http') ? url : ORIGIN + url, method, mode, cache: cacheMode, headers: new Map(Object.entries(headers)) },
      resultingClientId: opening ? opening.id : '',
      respondWith(promise) { answer = promise; }, waitUntil(promise) { background.push(promise); } });
    if (!answer) return null;
    const response = await answer;
    return { status: response.status, body: await response.text(), settled: () => Promise.all(background) };
  }
  async function event(type, data) {
    const waits = [];
    handlers[type]({ data, waitUntil(promise) { waits.push(promise); } });
    await Promise.all(waits);
  }
  return { get, event, announced, removed, fetched, windows,
    paths: () => fetched.map(request => request.path),
    urls: () => [...stored.keys()].map(url => url.replace(ORIGIN, '')) };
}

test('a first request is answered by the network and kept; later ones never wait for the network', async () => {
  const site = { '/cv.html': 'cv', '/assets/css/style.css?v=1': 'css' };
  const sw = worker(site);
  assert.equal((await sw.get('/cv.html')).body, 'cv');
  assert.equal((await sw.get('/assets/css/style.css?v=1')).body, 'css');
  site['/cv.html'] = 'never'; site['/assets/css/style.css?v=1'] = 'never';
  assert.equal((await sw.get('/cv.html')).body, 'cv');
  assert.equal((await sw.get('/assets/css/style.css?v=1')).body, 'css');
});

test('the site opens offline once visited; a page never visited still needs the network', async () => {
  const site = { '/research.html': 'papers' };
  const sw = worker(site);
  await sw.get('/research.html');
  site['/research.html'] = 'offline';
  const offline = await sw.get('/research.html');
  assert.equal(offline.body, 'papers');
  await offline.settled(); // the failed background refresh is not an error
  await assert.rejects(sw.get('/cv.html'));
});

test('a cached copy is refreshed in the background, and a changed page is announced to open windows', async () => {
  const site = { '/research.html': 'old list' };
  const sw = worker(site);
  sw.windows.set('tab', 0);
  await sw.get('/research.html');
  site['/research.html'] = 'new list';
  const stale = await sw.get('/research.html');
  assert.equal(stale.body, 'old list', 'served at once from the cache');
  await stale.settled();
  assert.deepEqual(sw.announced, [{ to: 'tab', type: 'page-updated', path: '/research.html' }]);
  const next = await sw.get('/research.html');
  assert.equal(next.body, 'new list');
  await next.settled();
  assert.equal(sw.announced.length, 1, 'an unchanged page is not announced again');
});

test('the window that is still loading the old copy is told too, however fast the network answered', async () => {
  const site = { '/cv.html': 'old cv' };
  const sw = worker(site);
  await sw.get('/cv.html');
  site['/cv.html'] = 'new cv';
  const stale = await sw.get('/cv.html', { opening: { id: 'loading', startsAfter: 3 } });
  await stale.settled();
  assert.deepEqual(sw.announced, [{ to: 'loading', type: 'page-updated', path: '/cv.html' }]);
});

test('the home page is kept once, whichever address asks for it, so a reload shows the copy just found', async () => {
  const site = { '/index.html': 'home' };
  const sw = worker(site);
  sw.windows.set('tab', 0);
  assert.equal((await sw.get('/')).body, 'home');
  assert.equal((await sw.get('/index.html')).body, 'home');
  assert.equal((await sw.get('/?ref=talk')).body, 'home', 'a query string does not make a different page');
  assert.deepEqual(sw.urls(), ['/index.html']);

  // The page opens (/) and prefetches itself (index.html) while the server has a new copy.
  site['/index.html'] = 'new home';
  sw.fetched.length = 0;
  const [opened, prefetched] = await Promise.all([sw.get('/'), sw.get('/index.html')]);
  await Promise.all([opened.settled(), prefetched.settled()]);
  assert.deepEqual(sw.paths(), ['/index.html'], 'one request to the server');
  assert.equal(sw.announced.length, 1, 'one announcement');
  assert.equal((await sw.get('/')).body, 'new home', 'which the reload then finds');
});

test('requests for the same missing file share one download', async () => {
  const sw = worker({ '/assets/moon.jpg': 'moon' });
  const [image, again] = await Promise.all([sw.get('/assets/moon.jpg'), sw.get('/assets/moon.jpg')]);
  assert.equal(image.body, 'moon');
  assert.equal(again.body, 'moon');
  assert.deepEqual(sw.paths(), ['/assets/moon.jpg']);
});

test('pages are checked with the server on every visit; assets follow their HTTP caching', async () => {
  const sw = worker({ '/cv.html': 'cv', '/assets/moon.jpg': 'moon' });
  await sw.get('/cv.html');
  await sw.get('/assets/moon.jpg');
  assert.deepEqual(sw.fetched, [{ path: '/cv.html', revalidated: true }, { path: '/assets/moon.jpg', revalidated: false }]);
});

test('a changed asset is picked up quietly; a new ?v= replaces the copies under older ones', async () => {
  const site = { '/assets/js/site.js?v=1': 'one', '/assets/images/moon.jpg': 'moon' };
  const sw = worker(site);
  sw.windows.set('tab', 0);
  await sw.get('/assets/js/site.js?v=1');
  await sw.get('/assets/images/moon.jpg');
  site['/assets/images/moon.jpg'] = 'brighter moon';
  await (await sw.get('/assets/images/moon.jpg')).settled();
  assert.equal((await sw.get('/assets/images/moon.jpg')).body, 'brighter moon');
  assert.deepEqual(sw.announced, []);
  site['/assets/js/site.js?v=2'] = 'two';
  assert.equal((await sw.get('/assets/js/site.js?v=2')).body, 'two');
  assert.deepEqual(sw.urls().filter(url => url.includes('site.js')), ['/assets/js/site.js?v=2']);
});

test('failed, partial and redirected answers are passed on but never kept', async () => {
  const site = { '/missing.html': reply('not found', { status: 404 }), '/clip.mp4': reply('part', { status: 206 }),
    '/cv': reply('cv', { redirected: true }) };
  const sw = worker(site);
  assert.equal((await sw.get('/missing.html')).status, 404);
  assert.equal((await sw.get('/clip.mp4')).body, 'part');
  assert.equal((await sw.get('/cv')).body, 'cv');
  assert.deepEqual(sw.urls(), []);
});

test('other origins, writes, range requests and cache-only probes are left to the browser', async () => {
  const sw = worker({ '/index.html': 'home' });
  assert.equal(await sw.get('https://scholar.google.com/citations'), null);
  assert.equal(await sw.get('/', { method: 'POST' }), null);
  assert.equal(await sw.get('/assets/cv.pdf', { headers: { range: 'bytes=0-99' } }), null);
  assert.equal(await sw.get('/', { cache: 'only-if-cached', mode: 'no-cors' }), null);
  assert.deepEqual(sw.fetched, []);
});

test('after a first visit, the page can have the rest of the site stored, without refetching what is there', async () => {
  const site = { '/index.html': 'home', '/cv.html': 'cv', '/assets/moon.jpg': 'moon' };
  const sw = worker(site);
  sw.windows.set('tab', 0);
  await sw.get('/');
  sw.fetched.length = 0;
  const urls = ['/', '/index.html', '/cv.html', ORIGIN + '/assets/moon.jpg', '/gone.html', 'https://example.com/x.js'];
  // The page sends the list again as more of the site arrives; the lists overlap.
  await Promise.all([sw.event('message', { type: 'store', urls }), sw.event('message', { type: 'store', urls })]);
  assert.deepEqual(sw.urls().sort(), ['/assets/moon.jpg', '/cv.html', '/index.html']);
  assert.deepEqual(sw.paths().sort(), ['/assets/moon.jpg', '/cv.html', '/gone.html']);
  assert.deepEqual(sw.announced, []);
});

test('a new worker takes over at once and drops caches left by older versions', async () => {
  const sw = worker({});
  await sw.event('activate');
  assert.deepEqual(sw.removed, ['site-v0']);
});
