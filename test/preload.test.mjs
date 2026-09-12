import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderGame, ADDON_MODULES } from '../build.mjs';
import { wireStartup } from '../startup-build.mjs';
import { splitStreamingCityAssets, wireCityStreaming } from '../city-streaming-build.mjs';
import { readInitialEventFeed, wireInitialEventSeed } from '../initial-event-feed.mjs';
import { wirePreloads, collectStaticImports, criticalCityAssets } from '../preload-build.mjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('source/manifest.json', root), 'utf8'));
const source = (await Promise.all(manifest.parts.map(name => readFile(new URL(`source/${name}`, root), 'utf8')))).join('');
const cityAssets = splitStreamingCityAssets(source);
const initialFeed = await readInitialEventFeed(new URL('data/', root));
const modules = await collectStaticImports(root, ['./city-streaming.js', ...ADDON_MODULES]);
const page = wirePreloads(wireStartup(wireCityStreaming(wireInitialEventSeed(renderGame(cityAssets.html), initialFeed))),
  { modules, assets: [...criticalCityAssets(cityAssets), './data/tech-week-first.json'] });
const head = page.slice(0, page.indexOf('</head>'));
const links = [...page.matchAll(/<link rel="(modulepreload|preload)"([^>]*)href="([^"]+)">/g)].map(([, rel, attrs, href]) => ({ rel, attrs, href }));

test('every add-on module and each of its static imports is announced before the game bundle', () => {
  const preloaded = links.filter(link => link.rel === 'modulepreload').map(link => link.href);
  for (const name of ['./city-streaming.js', ...ADDON_MODULES]) assert.ok(preloaded.includes(name), name);
  for (const name of ['./chrona/chrona-connect.js', './chrona/chrona-connect-ui.js', './network-pose.js', './public-world.js']) assert.ok(preloaded.includes(name), name);
  // Dynamic imports stay behind the code that needs them.
  assert.ok(!preloaded.some(name => /chrona-presence|chrona-worlds|amp\//.test(name)));
  // In the head, after the render-blocking stylesheets so those are requested first.
  assert.ok(head.lastIndexOf('<link rel="stylesheet"') < head.indexOf('rel="modulepreload"'), 'hints follow the stylesheets');
  assert.ok(page.indexOf('rel="modulepreload"') < page.indexOf('<script>'), 'hints precede every script');
  assert.equal(head.match(/rel="modulepreload"/g).length, preloaded.length, 'every module hint is in the head');
  const imports = [...page.matchAll(/^import "(\.\/[^"]+)";$/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['./city-time.mjs', './event-card.mjs', './city-streaming.js', './events-sync.js', './multiplayer.js', './gull-cluster-route.mjs', './city-extras.mjs']);
});

test('fetch preloads cover exactly the downtown set, as CORS requests the game fetch() can reuse', () => {
  const fetches = links.filter(link => link.rel === 'preload');
  for (const link of fetches) {
    assert.match(link.attrs, /as="fetch"/);
    assert.match(link.attrs, /\scrossorigin[\s>]/, 'a preload without crossorigin never matches fetch()');
  }
  // After the bundle, so they never share the document's bandwidth, and before
  // the layer that needs the event baseline.
  const first = page.indexOf('<link rel="preload" as="fetch"'), bundle = page.indexOf('(()=>{var G1=Object.create;');
  assert.ok(!head.includes('as="fetch"'), 'city files are not in the head');
  assert.ok(bundle > 0 && first > bundle && first < page.indexOf('<script id="tw-events-seed"'), 'city files follow the bundle and precede the layer');
  const hrefs = fetches.map(link => link.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  const file = entry => (typeof entry === 'string' ? entry : entry.file);
  assert.equal(hrefs[0], file(cityAssets.paths['/data/city-manifest.json']), 'the manifest comes first');
  for (const path of ['/data/terrain-heights.i16', '/data/terrain-land.u8', '/data/roads-position.i16', '/data/roads-normal.i8', '/data/roads-tone.u8', '/data/roads-index.u32']) {
    assert.ok(hrefs.includes(file(cityAssets.paths[path])), path);
  }
  for (const path of Object.keys(cityAssets.paths).filter(path => path.includes('marin-north'))) {
    assert.ok(!hrefs.includes(file(cityAssets.paths[path])), 'the north shore stays in the background');
  }
  const critical = cityAssets.tiles.filter(tile => tile.priority === 'critical'), background = cityAssets.tiles.filter(tile => tile.priority !== 'critical');
  assert.ok(critical.length >= 4 && background.length > critical.length);
  for (const tile of critical) assert.ok(hrefs.includes(tile.url), tile.id);
  for (const tile of background) assert.ok(!hrefs.includes(tile.url), tile.id);
  assert.ok(hrefs.includes(cityAssets.manifest.buildings.roofPoints.url));
  assert.equal(hrefs.at(-1), './data/tech-week-first.json');
  for (const href of hrefs) if (href.startsWith('./city-assets/')) assert.ok(cityAssets.files.has(href.slice(2)), href);
  // The bulk yields to the document: tiles are low priority, the manifest,
  // terrain, roads and the event baseline are not.
  for (const link of fetches) {
    const bulk = critical.some(tile => tile.url === link.href) || link.href === cityAssets.manifest.buildings.roofPoints.url;
    assert.equal(/fetchpriority="low"/.test(link.attrs), bulk, link.href);
  }
  const bytes = fetches.reduce((sum, link) => sum + (cityAssets.files.get(link.href.slice(2))?.length || 0), 0);
  assert.ok(bytes < 1_800_000, `downtown set stays small: ${bytes}`);
});

test('the wiring rejects duplicates, unsafe URLs, a moved head and a second application', () => {
  const html = '<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>x</title>\n  <link rel="stylesheet" href="./events-sync.css">\n</head>\n<body>\n<script id="tw-events-seed" type="application/json">{}</script>\n</body>\n</html>';
  assert.throws(() => wirePreloads(html, { modules: ['./a.js', './a.js'] }), /Duplicate preload URL/);
  assert.throws(() => wirePreloads(html, { assets: ['./a.bin?x=1'] }), /relative path/);
  assert.throws(() => wirePreloads(html, { assets: ['https://cdn.example/a.bin'] }), /relative path/);
  assert.throws(() => wirePreloads(html, { assets: ['./a.bin"><script>'] }), /relative path/);
  assert.throws(() => wirePreloads(html, { assets: [{ href: './a.bin', priority: 'high' }] }), /priority/);
  assert.throws(() => wirePreloads(html.replace('events-sync.css', 'events.css'), { modules: ['./a.js'] }), /head insertion point/);
  assert.throws(() => wirePreloads(html.replace('id="tw-events-seed"', 'id="seed"'), { modules: ['./a.js'] }), /body insertion point/);
  const once = wirePreloads(html, { modules: ['./a.js'], assets: ['./b.bin', { href: './c.bin', priority: 'low' }] });
  assert.ok(once.includes('  <link rel="stylesheet" href="./events-sync.css">\n  <link rel="modulepreload" href="./a.js">\n</head>'));
  assert.ok(once.includes('<body>\n  <link rel="preload" as="fetch" crossorigin href="./b.bin">\n  <link rel="preload" as="fetch" crossorigin fetchpriority="low" href="./c.bin">\n<script id="tw-events-seed"'));
  assert.throws(() => wirePreloads(once, { modules: ['./d.js'] }), /already wired/);
  assert.throws(() => wirePreloads(once, { assets: ['./d.bin'] }), /already wired/);
  // Strings inside the game bundle that merely mention preloads do not count.
  assert.doesNotThrow(() => wirePreloads(html.replace('<body>', '<body><script>const x = \'link[rel="modulepreload"][as="fetch"]\';</script>'), { modules: ['./a.js'] }));
});
