import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { splitCityAssets, installCityAssetFetch, decodeCityIndices } from '../city-assets-build.mjs';

const root = new URL('../', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(new URL('source/manifest.json', root), 'utf8'));
const source = (await Promise.all(manifest.parts.map(path => readFile(new URL('source/' + path, root), 'utf8')))).join('');
const mapPattern = /<script id="sf-city-assets" type="application\/json">([\s\S]*?)<\/script>/;
const inlineAssets = JSON.parse(source.match(mapPattern)[1]);
const packed = splitCityAssets(source), paths = JSON.parse(packed.html.match(mapPattern)[1]);
const filePath = entry => typeof entry === 'string' ? entry : entry.file;
const decodedBytes = (bytes, entry) => typeof entry === 'string' ? gunzipSync(bytes) : decodeCityIndices(gunzipSync(bytes), entry);

test('all 18 decoded city resources stay exact, with lossless compression limited to three u32 index arrays', () => {
  assert.equal(digest(source), manifest.sha256);
  assert.equal(packed.assetCount, 18);
  assert.equal(packed.files.size, 18);
  assert.deepEqual(Object.keys(paths), Object.keys(inlineAssets));
  for (const [path, encoded] of Object.entries(inlineAssets)) {
    const before = Buffer.from(encoded, 'base64'), entry = paths[path], after = packed.files.get(filePath(entry).slice(2));
    if (typeof entry === 'string') assert.deepEqual(after, before, path);
    else {
      assert.match(path, /^\/data\/(?:buildings-refined|marin-north|roads)-index\.u32$/);
      assert.equal(entry.codec, 'u32-dzv');
      assert.ok(after.length < before.length, path);
    }
    assert.equal(digest(decodedBytes(after, entry)), digest(gunzipSync(before)), path);
    assert.equal(filePath(entry), `./city-assets/${digest(after)}.bin`);
  }
  assert.equal(Object.values(paths).filter(entry => typeof entry !== 'string').length, 3);
  assert.ok([...packed.files.values()].reduce((total, bytes) => total + bytes.length, 0) < 12_100_000);
  const assetsEnd = html => html.indexOf('</script>', html.indexOf('<script id="sf-city-assets"')) + '</script>'.length;
  const afterShim = html => html.slice(html.indexOf('</script>', assetsEnd(html)) + '</script>'.length);
  assert.equal(afterShim(packed.html), afterShim(source), 'all scene, gameplay and UI code after the fetch shim stays byte-identical');
  assert.ok(packed.html.startsWith(source.slice(0, source.indexOf('<script id="sf-city-assets"'))));
})

function fetchHarness({ deferred = false } = {}) {
  const calls = [], queued = [], window = { location: { href: 'https://chrona.world/project-runtime/world/37/access-key/index.html' },
    __sfGunzip: compressed => new Uint8Array(gunzipSync(compressed)) };
  let removed = false;
  window.fetch = (url, init) => {
    calls.push({ url, init });
    if (!String(url).includes('/city-assets/')) return Promise.resolve(new Response('pass-through'));
    const file = String(url).split('/access-key/')[1];
    const serve = status => new Response(status === 200 ? packed.files.get(file) : 'Missing', { status });
    return deferred ? new Promise(resolve => queued.push(status => resolve(serve(status)))) : Promise.resolve(serve(200));
  };
  const context = { window, URL, Response, Uint8Array, AbortController, setTimeout, clearTimeout, document: { baseURI: window.location.href,
    getElementById: () => ({ textContent: JSON.stringify(paths), remove() { removed = true; } }) } };
  runInNewContext(`(${installCityAssetFetch.toString()})(${decodeCityIndices.toString()})`, context);
  return { calls, queued, fetch: window.fetch, removed: () => removed };
}

test('the extracted fetch adapter returns the original response bytes and MIME for every city resource', async () => {
  const h = fetchHarness();
  assert.equal(h.removed(), true);
  for (const [path, encoded] of Object.entries(inlineAssets)) {
    const response = await h.fetch(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), path.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(gunzipSync(Buffer.from(encoded, 'base64'))));
    assert.equal(String(h.calls.at(-1).url), 'https://chrona.world/project-runtime/world/37/access-key/' + filePath(paths[path]).slice(2));
  }
})

test('independent resources start together and duplicate reads get fresh response bodies', async () => {
  const h = fetchHarness({ deferred: true }), first = '/data/buildings-refined-index.u32', second = '/data/buildings-refined-position.f32';
  const a = h.fetch(first), b = h.fetch(new URL(second, 'https://chrona.world')), again = h.fetch({ url: 'https://chrona.world' + first });
  assert.equal(h.calls.length, 2, 'both network fetches start before either response arrives; duplicate fetch shares the request');
  h.queued.shift()(200);
  h.queued.shift()(200);
  const [one, two, duplicate] = await Promise.all([a, b, again]);
  assert.notEqual(one, duplicate);
  assert.equal(digest(Buffer.from(await one.arrayBuffer())), digest(Buffer.from(await duplicate.arrayBuffer())));
  assert.equal(digest(Buffer.from(await two.arrayBuffer())), digest(gunzipSync(Buffer.from(inlineAssets[second], 'base64'))));
  await h.fetch(first);
  assert.equal(h.calls.length, 2, 'compressed bytes are reused within this frame');
})

test('a failed asset request can retry and unrelated network requests remain unchanged', async () => {
  const h = fetchHarness({ deferred: true }), path = '/data/roads-index.u32';
  const failed = h.fetch(path);
  h.queued.shift()(503);
  await assert.rejects(failed, /City asset 503/);
  const retry = h.fetch(path);
  assert.equal(h.calls.length, 2);
  h.queued.shift()(200);
  assert.equal((await retry).status, 200);
  const input = { url: 'https://chrona.world/integrations/city-in-ink/events.json' }, init = { cache: 'no-store', headers: { 'X-Test': 'retained' } };
  const other = await h.fetch(input, init);
  assert.equal(await other.text(), 'pass-through');
  assert.equal(h.calls.at(-1).url, input);
  assert.equal(h.calls.at(-1).init, init);
})

test('packaging fails clearly if the source map or its fetch adapter changes', () => {
  assert.throws(() => splitCityAssets(source.replace('const nativeFetch = window.fetch.bind(window);', 'const nativeFetch = fetch;')), /patch target changed/);
  assert.throws(() => splitCityAssets(source.replace('id="sf-city-assets"', 'id="renamed-assets"')), /map changed/);
  const corrupted = source.replace(mapPattern, '<script id="sf-city-assets" type="application/json">{"/data/city-manifest.json":"not-gzip"}</script>');
  assert.throws(() => splitCityAssets(corrupted), /not canonical gzip\/base64/);
})


test('integer decoding preserves signed-delta boundaries and rejects malformed or oversized payloads', () => {
  const read = (bytes, count, codec = 'u32-dzv') => decodeCityIndices(Uint8Array.from(bytes), { codec, count });
  const largestPositive = [0xfe, 0xff, 0xff, 0xff, 0x0f];
  const smallestNegative = [0xff, 0xff, 0xff, 0xff, 0x0f];
  const actual = read([...largestPositive, 2, ...smallestNegative], 3);
  assert.deepEqual([...new Uint32Array(actual.buffer)], [0x7fffffff, 0x80000000, 0]);
  for (const [bytes, count] of [
    [[], 1],                         // declared count exceeds available bytes
    [[0], -1], [[0], 1.5], [[0], 33 * 1024 * 1024],
    [[0x80], 1],                    // truncated continuation
    [[0x80, 0], 1],                 // non-canonical overlong zero
    [[0xff, 0xff, 0xff, 0xff, 0x1f], 1], // delta exceeds signed 32-bit range
    [[0x80, 0x80, 0x80, 0x80, 0x80, 0], 1], // more than five bytes
    [[1], 1],                       // accumulating -1 underflows uint32
    [[0, 0], 1],                    // trailing bytes
    [[...largestPositive, ...largestPositive, 4], 3], // uint32 overflow
  ]) assert.throws(() => read(bytes, count), /city index|City index/);
  assert.throws(() => read([0], 1, 'unknown'), /metadata/);
});

test('compression retains original gzip if delta encoding is not smaller and fails on invalid input', () => {
  const path = '/data/roads-index.u32';
  const replace = bytes => source.replace(mapPattern, `<script id="sf-city-assets" type="application/json">${JSON.stringify({ [path]: gzipSync(bytes).toString('base64') })}</script>`);
  const raw = Buffer.from(new Uint32Array([0x12345678]).buffer);
  const result = splitCityAssets(replace(raw));
  const entry = JSON.parse(result.html.match(mapPattern)[1])[path];
  assert.equal(typeof entry, 'string');
  assert.deepEqual(result.files.get(entry.slice(2)), gzipSync(raw));
  assert.throws(() => splitCityAssets(replace(Buffer.from([1, 2, 3]))), /byte length/);
  assert.throws(() => splitCityAssets(replace(Buffer.from(new Uint32Array([0xffffffff]).buffer))), /signed 32-bit/);
});

test('hosted and standalone builds emit small entries and identical binary geometry without changing source', async () => {
  const beforeManifest = await readFile(new URL('source/manifest.json', root));
  for (const [script, directory] of [['build-hosted.mjs', 'dist'], ['build-local.mjs', 'dist-local']]) {
    execFileSync(process.execPath, [script], { cwd: fileURLToPath(root), stdio: 'pipe' });
    const html = await readFile(new URL(`${directory}/index.html`, root), 'utf8');
    assert.ok(Buffer.byteLength(html) < 1_250_000, `${directory} entry must not contain the 23 MB base64 asset payload`);
    assert.ok(gzipSync(html, { level: 6 }).length < 400_000);
    const builtPaths = JSON.parse(html.match(mapPattern)[1]);
    assert.equal(Object.keys(builtPaths).length, 13);
    for (const [path, entry] of Object.entries(builtPaths)) {
      if (path === '/data/city-manifest.json') continue;
      const bytes = await readFile(new URL(`${directory}/${filePath(entry).slice(2)}`, root));
      assert.equal(digest(decodedBytes(bytes, entry)), digest(gunzipSync(Buffer.from(inlineAssets[path], 'base64'))));
    }
    const city = JSON.parse(gunzipSync(await readFile(new URL(`${directory}/${builtPaths['/data/city-manifest.json'].slice(2)}`, root))));
    assert.equal(city.buildings.streamingVersion, 1);
    assert.equal(city.buildings.tiles.reduce((n,tile)=>n+tile.triangles,0), 1_489_361);
    assert.ok(city.buildings.tiles.filter(tile=>tile.priority==='critical').reduce((n,tile)=>n+tile.bytes,0)<1_500_000);
    const preload=JSON.parse(await readFile(new URL(`${directory}/city-assets/preload.json`, root)));
    assert.equal(preload.version,1);
    for(const asset of preload.assets)assert.equal((await readFile(new URL(`${directory}/${asset.url.slice(2)}`,root))).length,asset.bytes);
    assert.equal(html.includes('window.__SF_HOST_READY__ = import("./hosted-bootstrap.js")'), directory === 'dist');
  }
  assert.deepEqual(await readFile(new URL('source/manifest.json', root)), beforeManifest);
})

test('published asset CDN uses identical versioned paths and one failure switches later requests to origin', async () => {
  const calls=[];
  const first='/data/roads-position.i16', second='/data/roads-tone.u8';
  const base='https://chrona.world/project-runtime/world/37/access-key/index.html';
  const window={location:{href:base},__CHRONA_ASSET_BASE__:'https://assets.chrona.world/versions/build-37/',__sfGunzip:bytes=>new Uint8Array(gunzipSync(bytes))};
  window.fetch=async url=>{
    calls.push(String(url));
    if(url.hostname==='assets.chrona.world')return new Response('cdn down',{status:503});
    const file=url.pathname.split('/access-key/')[1];
    return new Response(packed.files.get(file));
  };
  const document={baseURI:base,getElementById:()=>({textContent:JSON.stringify(paths),remove(){}})};
  runInNewContext(`(${installCityAssetFetch.toString()})(${decodeCityIndices.toString()})`,{window,document,URL,Response,Uint8Array,AbortController,setTimeout,clearTimeout});
  assert.equal(digest(Buffer.from(await(await window.fetch(first)).arrayBuffer())),digest(gunzipSync(Buffer.from(inlineAssets[first],'base64'))));
  await window.fetch(second);
  assert.equal(calls.length,3);
  assert.ok(calls[0].startsWith('https://assets.chrona.world/versions/build-37/city-assets/'));
  assert.ok(calls[1].startsWith('https://chrona.world/project-runtime/world/37/access-key/city-assets/'));
  assert.ok(calls[2].startsWith('https://chrona.world/project-runtime/world/37/access-key/city-assets/'));
});

test('origin asset timeout includes a stalled response body and cancels its network request',async()=>{
  const timers=[],base='https://chrona.world/project-runtime/world/37/access-key/index.html';
  let aborted=false;
  const window={location:{href:base},fetch:async(url,init)=>({ok:true,status:200,headers:new Headers(),arrayBuffer:()=>new Promise((resolve,reject)=>{const abort=()=>{aborted=true;reject(new Error('aborted body'));};if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});})})};
  const document={baseURI:base,getElementById:()=>({textContent:JSON.stringify(paths),remove(){}})};
  runInNewContext(`(${installCityAssetFetch.toString()})(${decodeCityIndices.toString()})`,{window,document,URL,Response,Uint8Array,AbortController,setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});
  const request=window.__sfFetchCityAsset('./city-assets/test.bin');
  const rejected=assert.rejects(request,/aborted body/);
  await Promise.resolve();await Promise.resolve();
  assert.equal(timers[0].ms,30000);timers[0].fn();await rejected;assert.equal(aborted,true);
});
