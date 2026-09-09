// `npm run build:artifact` — a single-file preview of the game for hosts that
// can serve exactly one HTML file with no network (claude.ai Artifacts, a
// pasted-into-CMS page, an e-mail attachment).
//
//   dist-artifact/index.html               complete document (open from any static server)
//   dist-artifact/city-in-ink.artifact.html the same page minus <html>/<head>/<body>,
//                                          which the Artifact publisher adds itself
//
// Same source reassembly and add-on wiring as build-local.mjs, then:
//   • the 23 MB embedded geometry is re-encoded (planar delta + zigzag varint,
//     positions quantised to 2 cm steps (max error 1 cm)) — artifact-assets.js
//     expands it back to the original typed arrays in the browser, the game
//     bundle is untouched;
//   • data/tech-week-enriched.json (the full event snapshot) is embedded and
//     served through the same in-page fetch shim, also as /events.json so the
//     event feed and gull routes see the whole calendar without a server;
//   • events-sync.js and gull-cluster-route.mjs are inlined;
//   • multiplayer.js is left out: single-file hosts block WebSocket and the
//     third-party sign-in, so the preview is solo flight only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { renderGame } from './build.mjs';
import { FEATURED_EVENT, HEAT_MIN } from './tuning-build.mjs';

const url = path => new URL(path, import.meta.url);
const POSITION_SCALE = 0.02; // metres — positions quantised to 2 cm steps (max error 1 cm)

// ---- compact encoders ---------------------------------------------------
class ByteSink {
  constructor(capacity) { this.buf = new Uint8Array(capacity); this.length = 0; }
  push(u) { // LEB128 varint of a non-negative safe integer
    while (u >= 0x80) { this.buf[this.length++] = (u & 0x7f) | 0x80; u = Math.floor(u / 128); }
    this.buf[this.length++] = u;
  }
  bytes() { return this.buf.subarray(0, this.length); }
}
const zigzag = v => v >= 0 ? v * 2 : -v * 2 - 1;

// values: numeric array (interleaved, n × c) → planar delta zigzag varints
function encodeDzv(values, n, c, o, s) {
  const sink = new ByteSink(n * c * 5 + 16);
  for (let k = 0; k < c; k += 1) {
    let previous = 0;
    for (let i = 0; i < n; i += 1) {
      const v = values[i * c + k];
      sink.push(zigzag(v - previous));
      previous = v;
    }
  }
  const meta = { t: 'dzv', n, c, o };
  if (s != null) meta.s = s;
  meta.b = gzipSync(sink.bytes(), { level: 9 }).toString('base64');
  return meta;
}
const view = (buffer, Type) => new Type(buffer.buffer, buffer.byteOffset, buffer.byteLength / Type.BYTES_PER_ELEMENT);
const encoders = {
  f32: (raw, c) => { const a = view(raw, Float32Array); const q = new Int32Array(a.length); for (let i = 0; i < a.length; i += 1) q[i] = Math.round(a[i] / POSITION_SCALE); return encodeDzv(q, a.length / c, c, 'f32', POSITION_SCALE); },
  u32: (raw, c) => { const a = view(raw, Uint32Array); return encodeDzv(a, a.length / c, c, 'u32'); },
  u16: (raw, c) => { const a = view(raw, Uint16Array); return encodeDzv(a, a.length / c, c, 'u16'); },
  i16: (raw, c) => { const a = view(raw, Int16Array); return encodeDzv(a, a.length / c, c, 'i16'); },
  i8: (raw, c) => { const a = view(raw, Int8Array); return encodeDzv(a, a.length / c, c, 'i8'); },
};
// Buffers that get the compact encoding (components per vertex). The rest keep
// their original gzip+base64 form — they are small, or compress better as-is
// (the building normals).
const plan = {
  '/data/buildings-refined-position.f32': ['f32', 3],
  '/data/buildings-refined-index.u32': ['u32', 1],
  '/data/buildings-refined-facade.u16': ['u16', 4],
  '/data/marin-north-position.f32': ['f32', 3],
  '/data/marin-north-index.u32': ['u32', 1],
  '/data/marin-north-normal.i8': ['i8', 3],
  '/data/marin-north-heights.i16': ['i16', 1],
  '/data/roads-position.i16': ['i16', 3],
  '/data/roads-index.u32': ['u32', 1],
  '/data/terrain-heights.i16': ['i16', 1],
};

// ---- posters for the single-file preview ---------------------------------
// A single-file host blocks every external origin, so a remote cover URL can
// never load there. For the events that actually appear on the map we fetch
// the cover once at build time, shrink it and inline it as a data URI; the
// rest keep their remote URL and fall back to the drawn ink poster.
async function withEmbeddedPosters(feed) {
  if (process.env.SKIP_POSTERS) return feed;
  const heatOf = e => (Number.isFinite(e.heatCount) ? e.heatCount : (e.rsvp || 0) + (e.interested || 0));
  const wanted = feed.events.filter(e => e.image && (heatOf(e) > HEAT_MIN || `${e.url || ''}`.includes(FEATURED_EVENT)));
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'tw-posters-'));
  let ok = 0, bytes = 0;
  await Promise.all(wanted.map(async (event, index) => {
    try {
      const response = await fetch(event.image, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const raw = join(dir, `p${index}`), out = join(dir, `p${index}.jpg`);
      await writeFile(raw, Buffer.from(await response.arrayBuffer()));
      // 360 px wide is plenty for a banner texture and a card thumbnail.
      await run('convert', [raw, '-auto-orient', '-resize', '360x520>', '-quality', '72', '-strip', out]);
      const jpeg = await readFile(out);
      if (jpeg.length > 260000) throw new Error('cover too large');
      event.image = 'data:image/jpeg;base64,' + jpeg.toString('base64');
      ok += 1; bytes += jpeg.length;
    } catch { /* keep the remote URL; the drawn poster is the fallback */ }
  }));
  await rm(dir, { recursive: true, force: true });
  console.log(`embedded ${ok}/${wanted.length} event posters (${(bytes / 1024).toFixed(0)} KB)`);
  return feed;
}

// ---- reassemble the original and apply the standard add-on wiring ---------
const manifest = JSON.parse(await readFile(url('./source/manifest.json'), 'utf8'));
const original = (await Promise.all(manifest.parts.map(part => readFile(url('./source/' + part), 'utf8')))).join('');
if (createHash('sha256').update(original).digest('hex') !== manifest.sha256) throw new Error('Source bytes changed. Run `node build-hosted.mjs --accept-source-update` first to refresh the manifest.');
const html = renderGame(original);

// ---- swap the asset map and its shim -------------------------------------
const assetsOpen = '<script id="sf-city-assets" type="application/json">';
const a0 = html.indexOf(assetsOpen);
const a1 = html.indexOf('</script>', a0);
if (a0 < 0 || a1 < 0) throw new Error('Embedded asset map not found');
const assets = JSON.parse(html.slice(a0 + assetsOpen.length, a1));

const compact = {};
let before = 0, after = 0;
for (const [key, encoded] of Object.entries(assets)) {
  const raw = gunzipSync(Buffer.from(encoded, 'base64'));
  const spec = plan[key];
  compact[key] = spec ? encoders[spec[0]](raw, spec[1]) : encoded;
  const size = spec ? compact[key].b.length : encoded.length;
  before += encoded.length; after += size;
  console.log(`${key.padEnd(44)} ${String(encoded.length).padStart(10)} → ${String(size).padStart(10)}${spec ? '  (' + spec[0] + ' dzv)' : ''}`);
}
for (const file of ['tech-week-enriched.json', 'tech-week-first.json']) {
  let bytes = await readFile(url('./data/' + file));
  if (file === 'tech-week-enriched.json') bytes = Buffer.from(JSON.stringify(await withEmbeddedPosters(JSON.parse(bytes))));
  compact['/data/' + file] = gzipSync(bytes, { level: 9 }).toString('base64');
  after += compact['/data/' + file].length;
  console.log(`data/${file} ${bytes.length} → ${compact['/data/' + file].length}`);
}
// The feed URL every add-on polls (/events.json locally, chrona.world when hosted)
// resolves to the saved snapshot: there is no calendar service behind a single file.
compact['/events.json'] = { t: 'alias', to: '/data/tech-week-enriched.json' };
console.log(`asset text: ${before} → ${after} bytes`);

const shimOpen = html.indexOf('<script>', a1);
const shimClose = html.indexOf('</script>', shimOpen);
if (!html.slice(shimOpen, shimClose).includes("document.getElementById('sf-city-assets')")) throw new Error('Original asset shim not found');
const decoder = await readFile(url('./artifact-assets.js'), 'utf8');
let page = html.slice(0, a0 + assetsOpen.length) + JSON.stringify(compact) + '</script>\n  <script>\n' + decoder + '\n  </script>' + html.slice(shimClose + '</script>'.length);

// ---- inline the add-on modules and styles (no multiplayer) ----------------
const imports = 'import "./events-sync.js";\nimport "./multiplayer.js";\nimport "./gull-cluster-route.mjs";\nimport "./city-extras.mjs";\n';
if (page.split(imports).length !== 2) throw new Error('Add-on import block not found; keep build.mjs and build-artifact.mjs in step.');
let inline = '';
for (const name of ['events-sync.js', 'gull-cluster-route.mjs', 'city-extras.mjs']) {
  const code = await readFile(url('./' + name), 'utf8');
  if (/^\s*import\s/m.test(code)) throw new Error(`${name} imports another module; extend the inliner.`);
  inline += `<script type="module">\n${code}\n</script>\n`;
}
page = page.replace('<script type="module">\n' + imports, inline + '<script type="module">\n');
const links = '  <link rel="stylesheet" href="./multiplayer.css">\n  <link rel="stylesheet" href="./events-sync.css">\n';
if (page.split(links).length !== 2) throw new Error('Stylesheet links not found');
page = page.replace(links, '  <style id="events-sync-css">\n' + await readFile(url('./events-sync.css'), 'utf8') + '\n  </style>\n');

await mkdir(url('./dist-artifact/'), { recursive: true });
await writeFile(url('./dist-artifact/index.html'), page);

// The Artifact publisher supplies doctype/html/head/body: hand it head + body content only.
const head = page.slice(page.indexOf('<head>') + 6, page.indexOf('</head>'))
  .replace(/\s*<meta charset="utf-8">/, '')
  .replace(/\s*<meta name="viewport"[^>]*>/, '')
  .replace(/\s*<link rel="icon"[^>]*>/, '');
const body = page.slice(page.indexOf('<body>') + 6, page.lastIndexOf('</body>'));
const artifact = head.trim() + '\n' + body.trim() + '\n';
await writeFile(url('./dist-artifact/city-in-ink.artifact.html'), artifact);
console.log(`dist-artifact/index.html ${Buffer.byteLength(page)} bytes · city-in-ink.artifact.html ${Buffer.byteLength(artifact)} bytes`);
