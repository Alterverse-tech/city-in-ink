// Resource hints for the hosted and local builds.
//
// Without them the browser learns about the city files late: the add-on
// modules are discovered when the parser reaches the module script under the
// 1 MB game bundle, multiplayer's own imports one script wave after that, and
// the city manifest only once the bundle has been evaluated and React has
// mounted the scene — the downtown tiles come another round trip later. The
// network sits idle through all of that. Announcing the same URLs ahead of
// time lets the browser fetch them while the document is still arriving or
// the bundle is still being evaluated; the game's fetch() calls then pick up
// the responses already in flight.
//
// Only the files the first frame needs are listed: the modules, the city
// manifest, terrain, roads, the downtown tiles and the saved event baseline.
// Background tiles, the north shore and the full event snapshot stay behind the
// game's own throttled queues, so they cannot crowd out the critical set.
// Measured on a throttled connection, the city files in <head> delayed the
// document by their own transfer time, which is why they sit after the bundle.
import { readFile } from 'node:fs/promises';

// After the stylesheets: on a plain HTTP/1.1 server the render-blocking CSS
// would otherwise queue behind the module requests and hold back the first paint.
const HEAD_MARKER = '  <link rel="stylesheet" href="./events-sync.css">\n</head>';
const BODY_MARKER = '<script id="tw-events-seed" type="application/json">';
const STATIC_IMPORT = /^\s*(?:import|export)\s[^'"`]*?['"](\.{1,2}\/[^'"]+)['"]/gm;

// The manifest, terrain and roads precede the tiles because the game needs
// the manifest before it can ask for anything else. The tiles are the bulk
// (about 1.2 MB) and are announced at low priority: the document, the modules
// and the manifest keep the bandwidth until they are in, and Chrome raises an
// in-flight preload to the game's own high priority the moment it asks for it.
export function criticalCityAssets(cityAssets) {
  const file = entry => (typeof entry === 'string' ? entry : entry.file);
  const assets = ['/data/city-manifest.json', '/data/terrain-heights.i16', '/data/terrain-land.u8',
    '/data/roads-position.i16', '/data/roads-normal.i8', '/data/roads-tone.u8', '/data/roads-index.u32']
    .map(path => {
      if (!cityAssets.paths[path]) throw new Error('Critical city asset missing from the asset map: ' + path);
      return { href: file(cityAssets.paths[path]) };
    });
  if (cityAssets.manifest.buildings.roofPoints) assets.push({ href: cityAssets.manifest.buildings.roofPoints.url, priority: 'low' });
  for (const tile of cityAssets.tiles) if (tile.priority === 'critical') assets.push({ href: tile.url, priority: 'low' });
  for (const { href } of assets) if (!cityAssets.files.has(href.slice(2))) throw new Error('Critical city asset is not an output file: ' + href);
  return assets;
}

// Static imports of the add-on modules, followed depth-first, so a dependency
// such as chrona/chrona-connect.js is announced with the module that needs it
// instead of one script wave later. Dynamic import() calls are left alone.
export async function collectStaticImports(root, entries) {
  const seen = [];
  const visit = async specifier => {
    const url = new URL(specifier, root), name = './' + url.href.slice(root.href.length);
    if (seen.includes(name)) return;
    seen.push(name);
    const text = await readFile(url, 'utf8');
    for (const match of text.matchAll(STATIC_IMPORT)) await visit(new URL(match[1], url).href);
  };
  for (const entry of entries) await visit(entry);
  return seen;
}

// assets: relative URLs, or { href, priority: 'low' } for the bulk that must
// not hold up anything else.
//
// The modules go at the end of <head>: every byte of them sits between the
// end of the document and the first line of the bundle, so they are fetched
// while the document is still arriving. The city files go at the end of
// <body>, after the bundle: the preload scanner reaches them once the document
// is in, so they never take bandwidth from it (a plain HTTP/1.1 server shares
// evenly), and they still start a script wave, a React mount and a manifest
// round trip before the game would have asked for them.
export function wirePreloads(html, { modules = [], assets = [] } = {}) {
  if (html.slice(0, html.indexOf('</head>')).includes('rel="modulepreload"') || html.includes('<link rel="preload" as="fetch"')) throw new Error('Preloads were already wired');
  if (html.split(HEAD_MARKER).length !== 2) throw new Error('Preload head insertion point changed');
  if (html.split(BODY_MARKER).length !== 2) throw new Error('Preload body insertion point changed');
  const entries = assets.map(asset => (typeof asset === 'string' ? { href: asset } : asset));
  const hrefs = [...modules, ...entries.map(entry => entry.href)];
  for (const href of hrefs) {
    if (!/^\.\/[\w./-]+$/.test(href)) throw new Error('Preload URL must be a relative path without query or escapes: ' + href);
  }
  if (new Set(hrefs).size !== hrefs.length) throw new Error('Duplicate preload URL');
  for (const { priority } of entries) if (priority !== undefined && priority !== 'low') throw new Error('Preload priority must be low or omitted');
  const head = modules.map(href => `  <link rel="modulepreload" href="${href}">\n`).join('');
  // fetch() defaults to CORS mode with same-origin credentials; a preload
  // only matches that request when it says `crossorigin` too.
  const body = entries.map(({ href, priority }) => `  <link rel="preload" as="fetch" crossorigin${priority ? ` fetchpriority="${priority}"` : ''} href="${href}">\n`).join('');
  return html.replace(HEAD_MARKER, HEAD_MARKER.replace('</head>', head + '</head>')).replace(BODY_MARKER, body + BODY_MARKER);
}
