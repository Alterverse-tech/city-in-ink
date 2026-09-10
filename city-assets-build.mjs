import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';

const ASSET_OPEN = '<script id="sf-city-assets" type="application/json">';
const INLINE_FETCH = `(() => {
    const assets = JSON.parse(document.getElementById('sf-city-assets').textContent);
    document.getElementById('sf-city-assets').remove();
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let pathname = href;
      try { pathname = new URL(href, window.location.href).pathname; } catch {}
      const encoded = assets[pathname];
      if (!encoded) return nativeFetch(input, init);
      const binary = atob(encoded);
      const compressed = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) compressed[index] = binary.charCodeAt(index);
      const bytes = window.__sfGunzip(compressed);
      const type = pathname.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      return Promise.resolve(new Response(bytes, { status: 200, headers: { 'Content-Type': type } }));
    };
  })();`;

// Only topology indices use delta coding. Every position, normal, facade and
// height buffer retains its original gzip bytes; no floating-point quantization.
const INDEX_PATHS = new Set([
  '/data/buildings-refined-index.u32',
  '/data/marin-north-index.u32',
  '/data/roads-index.u32',
]);

// Self-contained: this exact decoder is serialized into the browser fetch shim.
export function decodeCityIndices(bytes, metadata) {
  const count = metadata.count;
  if (metadata.codec !== 'u32-dzv' || !Number.isSafeInteger(count) || count < 0 || count > 32 * 1024 * 1024 || count > bytes.length) throw new Error('Invalid city index metadata');
  const out = new Uint32Array(count);
  let offset = 0, previous = 0;
  for (let index = 0; index < count; index += 1) {
    let value = 0, shift = 0, byte;
    do {
      if (offset >= bytes.length || shift > 28) throw new Error('Truncated or oversized city index varint');
      byte = bytes[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    // Canonical zigzag encoding of a signed 32-bit delta, up to five bytes.
    if (value > 0xffffffff || (shift > 7 && byte === 0)) throw new Error('Invalid city index delta');
    const delta = value % 2 === 0 ? value / 2 : -(value + 1) / 2;
    previous += delta;
    if (previous < 0 || previous > 0xffffffff) throw new Error('City index out of range');
    out[index] = previous;
  }
  if (offset !== bytes.length) throw new Error('Unexpected trailing city index bytes');
  return new Uint8Array(out.buffer);
}

function packCityIndices(original) {
  const raw = gunzipSync(original);
  if (raw.length % 4) throw new Error('Invalid city index byte length');
  const indices = new Uint32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const encoded = new Uint8Array(indices.length * 5);
  let offset = 0, previous = 0;
  for (const index of indices) {
    const delta = index - previous;
    if (delta < -0x80000000 || delta > 0x7fffffff) throw new Error('City index delta exceeds signed 32-bit range');
    let value = delta >= 0 ? delta * 2 : -delta * 2 - 1;
    while (value >= 0x80) { encoded[offset++] = (value & 0x7f) | 0x80; value = Math.floor(value / 128); }
    encoded[offset++] = value;
    previous = index;
  }
  const metadata = { codec: 'u32-dzv', count: indices.length };
  const compressed = gzipSync(encoded.subarray(0, offset), { level: 9 });
  // Fail closed before publishing: reconstructed topology must match every byte.
  const decoded = decodeCityIndices(gunzipSync(compressed), metadata);
  if (!Buffer.from(decoded).equals(raw)) throw new Error('City index lossless roundtrip failed');
  return compressed.length < original.length ? { compressed, metadata } : null;
}

// Runs in the game document. Existing scene fetches still receive precisely the
// same decompressed bytes; only delivery changes from base64 to binary requests.
export function installCityAssetFetch(decodeIndices = decodeCityIndices) {
  const node = document.getElementById('sf-city-assets');
  const assets = JSON.parse(node.textContent);
  node.remove();
  const nativeFetch = window.fetch.bind(window), requests = new Map();
  window.fetch = (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let pathname = href;
    try { pathname = new URL(href, window.location.href).pathname; } catch {}
    const entry = assets[pathname];
    if (!entry) return nativeFetch(input, init);
    const file = typeof entry === 'string' ? entry : entry.file;
    // Resolve against this entry's versioned directory, never the site's /data/.
    // Reuse compressed bytes without sharing a consumed Response body. Failed
    // requests are evicted so the game's existing retry can fetch them again.
    if (!requests.has(pathname)) {
      const pending = nativeFetch(new URL(file, document.baseURI)).then(async response => {
        if (!response.ok) throw new Error(`City asset ${response.status}: ${pathname}`);
        return new Uint8Array(await response.arrayBuffer());
      }).catch(error => { requests.delete(pathname); throw error; });
      requests.set(pathname, pending);
    }
    return requests.get(pathname).then(compressed => {
      const inflated = window.__sfGunzip(compressed);
      const bytes = typeof entry === 'string' ? inflated : decodeIndices(inflated, entry);
      const type = pathname.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      return new Response(bytes, { status: 200, headers: { 'Content-Type': type } });
    });
  };
}

export function splitCityAssets(source) {
  const start = source.indexOf(ASSET_OPEN), contentStart = start + ASSET_OPEN.length;
  const end = source.indexOf('</script>', contentStart);
  if (start < 0 || end < contentStart || source.split(ASSET_OPEN).length !== 2) throw new Error('City asset map changed');
  if (source.split(INLINE_FETCH).length !== 2) throw new Error('City asset fetch patch target changed');
  const inline = JSON.parse(source.slice(contentStart, end));
  if (!inline || typeof inline !== 'object' || Array.isArray(inline) || !Object.keys(inline).length) throw new Error('City asset map is empty');
  const paths = {}, files = new Map();
  for (const [path, encoded] of Object.entries(inline)) {
    if (!/^\/data\/[a-zA-Z0-9_.-]+$/.test(path) || typeof encoded !== 'string') throw new Error('Invalid city asset: ' + path);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('City asset is not canonical gzip/base64: ' + path);
    const packed = INDEX_PATHS.has(path) ? packCityIndices(bytes) : null;
    const delivered = packed?.compressed || bytes;
    const hash = createHash('sha256').update(delivered).digest('hex');
    // .bin avoids transparent HTTP gzip decoding; our shim inflates exactly once.
    const file = `city-assets/${hash}.bin`;
    paths[path] = packed ? { file: './' + file, ...packed.metadata } : './' + file;
    files.set(file, delivered);
  }
  const html = (source.slice(0, contentStart) + JSON.stringify(paths) + source.slice(end))
    .replace(INLINE_FETCH, `(${installCityAssetFetch.toString()})(${decodeCityIndices.toString()});`);
  return { html, files, assetCount: Object.keys(paths).length };
}

export async function writeCityAssets(files, directory) {
  await mkdir(new URL('./city-assets/', directory), { recursive: true });
  await Promise.all([...files].map(([path, bytes]) => writeFile(new URL(path, directory), bytes)));
}
