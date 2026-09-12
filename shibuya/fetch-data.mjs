// Downloads the public data the Shibuya world is generated from into
// shibuya/.cache/ (gitignored) and writes shibuya/.cache/world-data.json in the
// world-kit format (world-kit/README.md). Re-run to refresh; a sub-box or tile
// that is already in the cache is not downloaded again, so an interrupted run
// resumes where it stopped.
//
//   node shibuya/fetch-data.mjs
//
// Sources: OpenStreetMap through Overpass (buildings, streets, water — ODbL)
// and the GSI 地理院タイル elevation text tiles (標高タイル, DEM10B, 10 m mesh).
// Node built-ins only. When fetch cannot reach a host this script falls back
// to curl, which reads the proxy variables Node ignores.
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BOX, SOURCES, METERS_LAT } from './config.mjs';

const run = promisify(execFile);
const cache = new URL('./.cache/', import.meta.url);
await mkdir(new URL('overpass/', cache), { recursive: true });
await mkdir(new URL('gsi/', cache), { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fmt = n => n.toLocaleString('en-US');

/* ------------------------------------------------------------ transport */

// overpass.openstreetmap.fr answers 403 to browser-like and bare user agents;
// a curl-style one (which this script really falls back to) is admitted.
const USER_AGENT = 'curl/8.5.0 city-in-ink-shibuya-fetch';

// GET or form-POST with retries. 429 and 5xx back off (honouring Retry-After);
// other 4xx are fatal for that URL; a transport error also tries curl.
async function download(url, { form = null, attempts = 6, timeout = 240000, binary = false, allow404 = false } = {}) {
  let delay = 3000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retryAfter = 0;
    try {
      const init = { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': USER_AGENT } };
      if (form !== null) { init.method = 'POST'; init.body = 'data=' + encodeURIComponent(form); init.headers['content-type'] = 'application/x-www-form-urlencoded'; }
      const response = await fetch(url, init);
      if (allow404 && response.status === 404) return null;
      if (response.status === 429 || response.status >= 500) {
        retryAfter = Number(response.headers.get('retry-after')) * 1000 || 0;
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { fatal: true });
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (caught) {
      if (caught.fatal) throw caught;
      const error = new Error(caught.message || String(caught));   // a DOMException's message is read-only
      const status = /HTTP (\d+)/.exec(error.message)?.[1];
      if (!status) {
        // Node's fetch may ignore the proxy variables; curl does not.
        try {
          const args = ['-sS', '-f', '--max-time', String(Math.round(timeout / 1000)), '-A', USER_AGENT];
          if (form !== null) args.push('--data-urlencode', 'data=' + form);
          const { stdout } = await run('curl', [...args, url], { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 512 * 1024 * 1024 });
          return stdout;
        } catch (curlError) {
          if (allow404 && /error: 404/.test(curlError.message)) return null;
          error.message += `; curl: ${curlError.message.split('\n')[0]}`;
        }
      }
      if (attempt === attempts) throw new Error(`${url}: ${error.message}`);
      const wait = Math.max(delay, retryAfter);
      console.log(`  retry ${attempt}/${attempts} in ${Math.round(wait / 1000)}s — ${error.message}`);
      await sleep(wait); delay = Math.min(delay * 2, 90000);
    }
  }
}

async function fresh(name) {
  try { const info = await stat(new URL(name, cache)); return info.size > 0; } catch { return false; }
}

/* ------------------------------------------------------------ Overpass */

const ENDPOINTS = [SOURCES.osm.api, ...(SOURCES.osm.fallbacks || [])];
// Sequential and polite: one query at a time, a pause between them, the
// primary endpoint retried with backoff before a fallback is tried at all.
async function overpass(query, label) {
  let lastError;
  for (const [index, endpoint] of ENDPOINTS.entries()) {
    try {
      const text = await download(endpoint, { form: query, attempts: index === 0 ? 6 : 2, timeout: index === 0 ? 300000 : 90000 });
      const data = JSON.parse(text);
      if (!Array.isArray(data.elements)) throw new Error('no elements array');
      if (data.remark && /runtime error|out of memory|timed out/i.test(data.remark)) throw new Error(data.remark);
      return data;
    } catch (error) {
      lastError = error;
      console.log(`  ${label}: ${endpoint} failed — ${error.message.split('\n')[0].slice(0, 160)}`);
    }
  }
  throw lastError;
}

const bbox = ({ south, west, north, east }) => `(${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)})`;
const QUERIES = {
  buildings: box => `[out:json][timeout:240];(way["building"]["building"!="no"]${bbox(box)};relation["building"]["building"!="no"]${bbox(box)};);out body geom;`,
  roads: box => `[out:json][timeout:240];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service)$"]${bbox(box)};out body geom;`,
  water: box => `[out:json][timeout:240];(nwr["natural"="water"]${bbox(box)};way["waterway"="riverbank"]${bbox(box)};relation["waterway"="riverbank"]${bbox(box)};);out body geom;`,
};

function grid(n) {
  const cells = [];
  const dLat = (BOX.north - BOX.south) / n, dLon = (BOX.east - BOX.west) / n;
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) {
    cells.push({ name: `r${r}c${c}`, south: BOX.south + r * dLat, north: BOX.south + (r + 1) * dLat, west: BOX.west + c * dLon, east: BOX.west + (c + 1) * dLon });
  }
  return cells;
}

// Fetch one category over a grid of sub-boxes; a sub-box whose file exists is
// read from the cache. Returns every element, deduplicated by type/id.
async function fetchCategory(category, cells) {
  const seen = new Map();
  let downloaded = 0;
  for (const cell of cells) {
    const file = `overpass/${category}-${cell.name}.json`;
    let data = null;
    if (await fresh(file)) {
      try { data = JSON.parse(await readFile(new URL(file, cache), 'utf8')); if (!Array.isArray(data.elements)) data = null; } catch { data = null; }
    }
    if (!data) {
      console.log(`${category} ${cell.name}: ${bbox(cell)}`);
      data = await overpass(QUERIES[category](cell), `${category} ${cell.name}`);
      await writeFile(new URL(file, cache), JSON.stringify(data));
      downloaded += 1;
      await sleep(1500);
    }
    let fresh_ = 0;
    for (const element of data.elements) {
      const key = `${element.type}/${element.id}`;
      if (!seen.has(key)) { seen.set(key, element); fresh_ += 1; }
    }
    console.log(`${category} ${cell.name}: ${fmt(data.elements.length)} elements, ${fmt(fresh_)} new`);
  }
  console.log(`${category}: ${fmt(seen.size)} unique elements (${downloaded} sub-boxes downloaded, ${cells.length - downloaded} from cache)`);
  return [...seen.values()];
}

/* ------------------------------------------------------------ tags */

const FEET = 0.3048;
// "12", "12 m", "12.5m", "40 ft", "40'", "12,5" → metres; anything else null.
function metres(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(',', '.');
  const m = /^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?\.?$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /^(ft|feet|')$/i.test(m[2] || '') ? +(n * FEET).toFixed(2) : n;
}
function integer(value) {
  if (value == null) return null;
  const m = /^\s*(\d+)/.exec(String(value));
  return m ? Number(m[1]) : null;
}
function year(value) {
  if (value == null) return null;
  const m = /(1[0-9]{3}|20[0-9]{2})/.exec(String(value));
  return m ? Number(m[1]) : null;
}
const flag = value => value != null && value !== 'no';

// building=yes says nothing about use; the shop/office/amenity tags often do.
function kindOf(tags) {
  const b = tags.building;
  if (b && b !== 'yes') return b;
  if (tags.shop) return 'retail';
  if (tags.office) return 'office';
  if (/^(school|college|kindergarten|university|hospital|place_of_worship|townhall|police|fire_station|library)$/.test(tags.amenity || '')) return tags.amenity === 'place_of_worship' ? (tags.religion === 'shinto' ? 'shrine' : 'temple') : tags.amenity;
  if (tags.tourism === 'hotel') return 'hotel';
  if (tags.railway === 'station' || tags.public_transport === 'station') return 'train_station';
  return b || 'yes';
}

/* ------------------------------------------------------------ geometry */

const key = p => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const closed = ring => ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1]);
const toPoints = geometry => (geometry || []).filter(g => g && Number.isFinite(g.lon) && Number.isFinite(g.lat)).map(g => [g.lon, g.lat]);

// Stitch way segments into rings by matching endpoints (either direction).
function stitch(segments, stats) {
  const pool = segments.map(s => s.slice()).filter(s => s.length >= 2);
  const rings = [];
  while (pool.length) {
    const ring = pool.shift();
    while (!closed(ring)) {
      const end = key(ring[ring.length - 1]);
      let found = -1, reverse = false;
      for (let i = 0; i < pool.length; i += 1) {
        if (key(pool[i][0]) === end) { found = i; break; }
        if (key(pool[i][pool[i].length - 1]) === end) { found = i; reverse = true; break; }
      }
      if (found < 0) break;
      const segment = pool.splice(found, 1)[0];
      if (reverse) segment.reverse();
      ring.push(...segment.slice(1));
    }
    if (closed(ring)) rings.push(ring.slice(0, -1));
    else if (ring.length >= 3) { rings.push(ring); stats.open += 1; }   // a gap; the kit closes it
    else stats.dropped += 1;
  }
  return rings;
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A multipolygon relation → one { rings } per outer ring, holes attached to
// the outer that contains them.
function relationPolygons(relation, stats) {
  const outers = [], inners = [];
  for (const member of relation.members || []) {
    if (member.type !== 'way' || !member.geometry) continue;
    (member.role === 'inner' ? inners : outers).push(toPoints(member.geometry));
  }
  const outerRings = stitch(outers, stats), innerRings = stitch(inners, stats);
  const polygons = outerRings.map(ring => ({ rings: [ring] }));
  for (const hole of innerRings) {
    const host = polygons.length === 1 ? polygons[0] : polygons.find(poly => pointInRing(hole[0], poly.rings[0]));
    if (host) host.rings.push(hole); else stats.orphanHoles += 1;
  }
  return polygons;
}

/* ------------------------------------------------------------ 1. buildings */

const buildingStats = { open: 0, dropped: 0, orphanHoles: 0, relations: 0, memberWaysSkipped: 0, withHeight: 0, withLevels: 0, withYear: 0 };
const buildings = [];
{
  const elements = await fetchCategory('buildings', grid(4));
  const memberWays = new Set();
  for (const el of elements) if (el.type === 'relation') for (const m of el.members || []) if (m.type === 'way' && m.role !== 'inner') memberWays.add(m.ref);
  const attrs = tags => {
    const height = metres(tags.height ?? tags['building:height']), levels = integer(tags['building:levels']), y = year(tags.start_date ?? tags['construction_date']);
    if (height != null) buildingStats.withHeight += 1;
    if (levels != null) buildingStats.withLevels += 1;
    if (y != null) buildingStats.withYear += 1;
    return { height, levels, year: y, kind: kindOf(tags) };
  };
  for (const el of elements) {
    const tags = el.tags || {};
    if (el.type === 'way') {
      if (memberWays.has(el.id)) { buildingStats.memberWaysSkipped += 1; continue; }
      let ring = toPoints(el.geometry);
      if (closed(ring)) ring = ring.slice(0, -1);
      if (ring.length < 3) { buildingStats.dropped += 1; continue; }
      buildings.push({ id: `w${el.id}`, rings: [ring], ...attrs(tags) });
    } else if (el.type === 'relation') {
      buildingStats.relations += 1;
      const polygons = relationPolygons(el, buildingStats);
      const a = attrs(tags);
      polygons.forEach((poly, index) => buildings.push({ id: index === 0 ? `r${el.id}` : `r${el.id}_${index}`, rings: poly.rings, ...a }));
    }
  }
  console.log(`buildings: ${fmt(buildings.length)} polygons — ${buildingStats.relations} multipolygons, ${buildingStats.memberWaysSkipped} member ways folded in, ${buildingStats.open} open rings kept, ${buildingStats.dropped} dropped, ${buildingStats.orphanHoles} orphan holes; height on ${fmt(buildingStats.withHeight)}, levels on ${fmt(buildingStats.withLevels)}, year on ${fmt(buildingStats.withYear)}`);
}

/* ------------------------------------------------------------ 2. roads */

const roads = [];
{
  const elements = await fetchCategory('roads', grid(2));
  let areas = 0;
  for (const el of elements) {
    if (el.type !== 'way') continue;
    const tags = el.tags || {};
    if (tags.area === 'yes') { areas += 1; continue; }
    const points = toPoints(el.geometry);
    if (points.length < 2) continue;
    roads.push({ id: `w${el.id}`, points, kind: tags.highway, width: metres(tags.width), lanes: integer(tags.lanes), tunnel: flag(tags.tunnel), bridge: flag(tags.bridge) });
  }
  const kinds = {};
  for (const r of roads) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  console.log(`roads: ${fmt(roads.length)} polylines (${areas} area=yes skipped) — ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`roads: width on ${roads.filter(r => r.width != null).length}, lanes on ${roads.filter(r => r.lanes != null).length}, tunnel ${roads.filter(r => r.tunnel).length}, bridge ${roads.filter(r => r.bridge).length}`);
}

/* ------------------------------------------------------------ 3. water */

const water = [];
{
  const elements = await fetchCategory('water', [{ name: 'all', ...BOX }]);
  const stats = { open: 0, dropped: 0, orphanHoles: 0 };
  for (const el of elements) {
    if (el.type === 'way') {
      let ring = toPoints(el.geometry);
      if (!closed(ring)) continue;   // an open riverbank way is a bank line, not a polygon
      ring = ring.slice(0, -1);
      if (ring.length >= 3) water.push({ rings: [ring] });
    } else if (el.type === 'relation') {
      for (const poly of relationPolygons(el, stats)) water.push({ rings: poly.rings });
    }
  }
  console.log(`water: ${water.length} polygons (${elements.length} elements; ${stats.open} open rings kept, ${stats.dropped} dropped)`);
}

/* ------------------------------------------------------------ 4. terrain (GSI DEM tiles → lon/lat grid) */

const Z = SOURCES.gsi.zoom, N = 2 ** Z, TILE = 256;
const tileX = lon => ((lon + 180) / 360) * N;
const tileY = lat => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };

let terrain;
{
  const xMin = Math.floor(tileX(BOX.west)), xMax = Math.floor(tileX(BOX.east));
  const yMin = Math.floor(tileY(BOX.north)), yMax = Math.floor(tileY(BOX.south));
  const cols = xMax - xMin + 1, rows = yMax - yMin + 1;
  const W = cols * TILE, H = rows * TILE;
  const mosaic = new Float32Array(W * H).fill(NaN);
  let tiles = 0, empty = 0, downloaded = 0;
  for (let ty = yMin; ty <= yMax; ty += 1) for (let tx = xMin; tx <= xMax; tx += 1) {
    const file = `gsi/${Z}-${tx}-${ty}.txt`;
    let text;
    if (await fresh(file)) text = await readFile(new URL(file, cache), 'utf8');
    else {
      const url = SOURCES.gsi.tiles.replace('{z}', Z).replace('{x}', tx).replace('{y}', ty);
      console.log(`dem tile ${Z}/${tx}/${ty}`);
      text = await download(url, { allow404: true });
      if (text === null) text = 'e';   // no tile: sea or outside coverage
      await writeFile(new URL(file, cache), text);
      downloaded += 1;
      await sleep(300);
    }
    tiles += 1;
    if (text.trim() === 'e') { empty += 1; continue; }
    const lines = text.split('\n').filter(l => l.length);
    if (lines.length !== TILE) throw new Error(`dem tile ${tx}/${ty}: ${lines.length} rows`);
    lines.forEach((line, py) => {
      const cells = line.split(',');
      if (cells.length !== TILE) throw new Error(`dem tile ${tx}/${ty}: ${cells.length} columns in row ${py}`);
      const row = ((ty - yMin) * TILE + py) * W + (tx - xMin) * TILE;
      for (let px = 0; px < TILE; px += 1) { const v = cells[px]; if (v !== 'e') mosaic[row + px] = Number(v); }
    });
  }
  console.log(`dem: ${tiles} tiles at z${Z} (${downloaded} downloaded, ${empty} without data), mosaic ${W}×${H}`);

  // Bilinear sample of the web-mercator mosaic at a lon/lat.
  const sample = (lon, lat) => {
    const fx = (tileX(lon) - xMin) * TILE - 0.5, fy = (tileY(lat) - yMin) * TILE - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    let sum = 0, weight = 0;
    for (const [dx, dy, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || w === 0) continue;
      const v = mosaic[y * W + x];
      if (Number.isNaN(v)) continue;
      sum += v * w; weight += w;
    }
    return weight > 0.05 ? sum / weight : null;
  };

  // Equirectangular grid, ~10 m spacing, row-major from the north-west corner.
  const midLat = (BOX.north + BOX.south) / 2;
  const dLat = 10 / METERS_LAT, dLon = 10 / (METERS_LAT * Math.cos((midLat * Math.PI) / 180));
  const nx = Math.floor((BOX.east - BOX.west) / dLon) + 2, ny = Math.floor((BOX.north - BOX.south) / dLat) + 2;
  const heights = new Array(nx * ny);
  let nulls = 0, min = Infinity, max = -Infinity;
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
    const v = sample(BOX.west + i * dLon, BOX.north - j * dLat);
    if (v === null) { heights[j * nx + i] = null; nulls += 1; continue; }
    const h = Math.round(v * 10) / 10;
    heights[j * nx + i] = h;
    if (h < min) min = h; if (h > max) max = h;
  }
  terrain = { kind: 'grid', west: BOX.west, north: BOX.north, dLon, dLat, nx, ny, heights };
  console.log(`terrain: ${nx}×${ny} grid, dLon ${dLon.toExponential(4)} dLat ${dLat.toExponential(4)}, ${min}…${max} m, ${nulls} no-data nodes`);
  const probes = [
    ['Shibuya Scramble Crossing', 139.7005, 35.6595], ['Shibuya Station (JR)', 139.7016, 35.6580], ['Harajuku Station', 139.7027, 35.6702],
    ['Yoyogi Park (central lawn)', 139.6949, 35.6717], ['Meiji Jingu (main shrine)', 139.6993, 35.6764], ['Ebisu Station', 139.7101, 35.6467],
    ['Yebisu Garden Place', 139.7134, 35.6427], ['Omotesando crossing', 139.7124, 35.6652], ['Dogenzaka top (Cerulean)', 139.6990, 35.6563],
    ['Shibuya River at Stream', 139.7031, 35.6568], ['Daikanyama', 139.7030, 35.6486],
  ];
  for (const [name, lon, lat] of probes) { const v = sample(lon, lat); console.log(`  ${name.padEnd(28)} ${v === null ? 'no data' : v.toFixed(1) + ' m'}`); }
}

/* ------------------------------------------------------------ world-data.json */

const world = {
  fetchedAt: new Date().toISOString(),
  box: BOX,
  sources: [
    { name: 'OpenStreetMap contributors', url: SOURCES.osm.url, licence: SOURCES.osm.licence, via: SOURCES.osm.api, covers: 'buildings, streets, water' },
    { name: SOURCES.gsi.name, url: SOURCES.gsi.url, licence: SOURCES.gsi.licence, attribution: SOURCES.gsi.attribution, via: SOURCES.gsi.tiles.replace('{z}', String(Z)), covers: 'terrain' },
  ],
  buildings, roads, water, terrain,
};
const text = JSON.stringify(world);
await writeFile(new URL('world-data.json', cache), text);
console.log(`world-data.json: ${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB — ${fmt(buildings.length)} buildings, ${fmt(roads.length)} roads, ${water.length} water polygons, terrain ${terrain.nx}×${terrain.ny}`);
console.log('done');
