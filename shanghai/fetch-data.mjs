// Downloads the OpenStreetMap data the Shanghai world is generated from into
// shanghai/.cache/ (gitignored) and writes shanghai/.cache/world-data.json in
// the world-kit format (world-kit/README.md). Re-run to refresh; sub-boxes
// already in the cache are skipped, so an interrupted run resumes.
//
//   node shanghai/fetch-data.mjs            # resume / reuse the cache
//   node shanghai/fetch-data.mjs --fresh    # ignore the cached Overpass responses
//
// Node built-ins only. Requests go through curl (it honours HTTPS_PROXY; Node's
// fetch does not unless NODE_USE_ENV_PROXY=1), with fetch as the fallback when
// curl is missing. Data © OpenStreetMap contributors, ODbL.
import { mkdir, writeFile, readFile, stat, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BOX, SOURCES } from './config.mjs';

const run = promisify(execFile);
const cache = new URL('./.cache/', import.meta.url);
await mkdir(cache, { recursive: true });
const FRESH = process.argv.includes('--fresh');
const ENDPOINT = SOURCES.buildings.endpoint;
const GRID = 4;                      // sub-boxes per side (16 requests per theme)
const PAUSE_MS = 1500;               // polite gap between requests

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fmt = n => n.toLocaleString('en-US');

/* ------------------------------------------------------------ Overpass transport */

async function haveCurl() {
  try { await run('curl', ['--version']); return true; } catch { return false; }
}
const useCurl = await haveCurl();

async function post(query) {
  if (useCurl) {
    const body = new URL(`body-${process.pid}.json`, cache);
    const { stdout } = await run('curl', ['-sS', '--max-time', '300', '-o', body.pathname, '-w', '%{http_code}', ENDPOINT, '--data-urlencode', `data=${query}`], { maxBuffer: 16 * 1024 * 1024 });
    const status = Number(stdout.trim());
    const text = await readFile(body, 'utf8').catch(() => '');
    await unlink(body).catch(() => {});
    return { status, text };
  }
  const response = await fetch(ENDPOINT, { method: 'POST', body: new URLSearchParams({ data: query }) });
  return { status: response.status, text: await response.text() };
}

// Sequential, polite, with backoff on 429/504 and on network failures. A 400
// is a broken query and stops the run with Overpass's own message.
async function overpass(query, { attempts = 7 } = {}) {
  let delay = 5000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let status, text;
    try { ({ status, text } = await post(query)); } catch (error) { status = 0; text = error.message; }
    if (status === 200) {
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      if (json && Array.isArray(json.elements)) {
        if (json.remark && /timed out|out of memory/i.test(json.remark)) throw new Error(`Overpass remark: ${json.remark} — shrink the sub-box (GRID)`);
        return json;
      }
      text = `unparseable response: ${text.slice(0, 200)}`;
    }
    if (status === 400) throw new Error(`Overpass rejected the query (400):\n${text.replace(/<[^>]+>/g, '').trim().slice(0, 1500)}`);
    if (attempt === attempts) throw new Error(`Overpass failed after ${attempts} attempts (last: HTTP ${status} ${String(text).slice(0, 200)})`);
    const why = status ? `HTTP ${status}` : String(text).slice(0, 120);
    console.log(`  retry ${attempt}/${attempts} in ${delay / 1000}s — ${why}`);
    await sleep(delay); delay = Math.min(delay * 2, 120000);
  }
}

async function cached(name, produce) {
  const file = new URL(name, cache);
  if (!FRESH) {
    try {
      if ((await stat(file)).size > 0) {
        const json = JSON.parse(await readFile(file, 'utf8'));
        if (Array.isArray(json.elements)) { console.log(`${name}: cached (${json.elements.length} elements)`); return json; }
      }
    } catch { /* fall through and fetch */ }
  }
  const json = await produce();
  await writeFile(file, JSON.stringify(json));
  console.log(`${name}: ${json.elements.length} elements`);
  await sleep(PAUSE_MS);
  return json;
}

/* ------------------------------------------------------------ sub-boxes */

const subBoxes = [];
for (let r = 0; r < GRID; r += 1) for (let c = 0; c < GRID; c += 1) {
  const dLat = (BOX.north - BOX.south) / GRID, dLon = (BOX.east - BOX.west) / GRID;
  const s = BOX.south + r * dLat, w = BOX.west + c * dLon;
  subBoxes.push({ r, c, bbox: `${s.toFixed(5)},${w.toFixed(5)},${(s + dLat).toFixed(5)},${(w + dLon).toFixed(5)}` });
}
const bboxAll = `${BOX.south},${BOX.west},${BOX.north},${BOX.east}`;

const ROAD_KINDS = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service)$';

// 1. Buildings (ways and multipolygon relations), one request per sub-box.
const buildingResponses = [];
for (const { r, c, bbox } of subBoxes) {
  buildingResponses.push(await cached(`buildings-r${r}c${c}.json`, () => {
    console.log(`buildings r${r}c${c} (${bbox})`);
    return overpass(`[out:json][timeout:120];(way["building"](${bbox});relation["building"](${bbox}););out body geom;`);
  }));
}

// 2. Roads, one request per sub-box.
const roadResponses = [];
for (const { r, c, bbox } of subBoxes) {
  roadResponses.push(await cached(`roads-r${r}c${c}.json`, () => {
    console.log(`roads r${r}c${c} (${bbox})`);
    return overpass(`[out:json][timeout:120];way["highway"~"${ROAD_KINDS}"](${bbox});out body geom;`);
  }));
}

// 3. Water: the Huangpu River, Suzhou Creek and the ponds, for the whole box
//    (about 400 KB — the river is mapped in segments, so `out geom` stays small).
const waterResponse = await cached('water.json', () => {
  console.log(`water (${bboxAll})`);
  return overpass(`[out:json][timeout:120];(nwr["natural"="water"](${bboxAll});nwr["waterway"~"^(riverbank|river)$"](${bboxAll}););out body geom;`);
});

// 4. Building parts with their own heights (Simple 3D Buildings), for the
//    whole box (about 250 KB). An outline that carries no height of its own
//    takes the tallest part standing inside it — the Bank of China Tower's
//    outline, for instance, is tagged with the podium's 6 storeys while its
//    tower part is tagged 226 m. That is OSM data, not a guess.
const partsResponse = await cached('building-parts.json', () => {
  console.log(`building parts (${bboxAll})`);
  return overpass(`[out:json][timeout:120];(way["building:part"]["height"](${bboxAll});relation["building:part"]["height"](${bboxAll}););out body geom;`);
});

/* ------------------------------------------------------------ geometry helpers */

const toRing = geometry => geometry.map(p => [p.lon, p.lat]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const closed = ring => ring.length >= 4 && same(ring[0], ring[ring.length - 1]);

// Stitch member ways with one role into closed rings by matching endpoints
// (OSM multipolygons split rings into several ways in any direction).
function stitch(members) {
  const pieces = members.map(m => toRing(m.geometry || [])).filter(p => p.length >= 2);
  const rings = [];
  const pending = pieces.filter(p => !closed(p));
  for (const p of pieces) if (closed(p)) rings.push(p);
  while (pending.length) {
    let ring = pending.shift();
    let grew = true;
    while (!closed(ring) && grew) {
      grew = false;
      const tail = ring[ring.length - 1];
      for (let i = 0; i < pending.length; i += 1) {
        const p = pending[i];
        if (same(p[0], tail)) { ring = ring.concat(p.slice(1)); pending.splice(i, 1); grew = true; break; }
        if (same(p[p.length - 1], tail)) { ring = ring.concat(p.slice(0, -1).reverse()); pending.splice(i, 1); grew = true; break; }
      }
    }
    if (closed(ring)) rings.push(ring);
    else if (ring.length >= 4) rings.push(ring.concat([ring[0]]));   // gap in the data: close it anyway
  }
  return rings;
}

function ringArea(ring) {   // signed, in degrees² (only compared between rings)
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(lon, lat, rings) {
  if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
  for (const hole of rings.slice(1)) if (pointInRing(lon, lat, hole)) return false;
  return true;
}

// A relation → list of polygons [outer, ...holes]: each outer ring takes the
// inner rings that fall inside it.
function relationPolygons(relation) {
  const members = relation.members || [];
  const outers = stitch(members.filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '')));
  const inners = stitch(members.filter(m => m.type === 'way' && m.role === 'inner'));
  return outers.map(outer => ({ rings: [outer, ...inners.filter(inner => pointInRing(inner[0][0], inner[0][1], outer))] }));
}

const number = value => {
  if (value == null) return null;
  const text = String(value).trim().replace(',', '.');
  const m = text.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (/ft|'/.test(text)) n *= 0.3048;
  return Number.isFinite(n) ? n : null;
};
const integer = value => { const n = number(value); return n == null ? null : Math.round(n); };
const year = value => { const m = value == null ? null : String(value).match(/\b(1[5-9]\d\d|20\d\d)\b/); return m ? Number(m[1]) : null; };
const flag = value => value != null && value !== 'no';

/* ------------------------------------------------------------ buildings */

const buildings = [];
const seen = new Set();
let relationCount = 0, skippedRelations = 0, withHeight = 0, withLevels = 0, withYear = 0;
for (const response of buildingResponses) {
  for (const el of response.elements) {
    const id = `${el.type[0]}${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = el.tags || {};
    const attrs = { height: number(tags.height), levels: integer(tags['building:levels']), year: year(tags.start_date), kind: tags.building || 'yes' };
    if (attrs.height == null && tags['est_height']) attrs.height = number(tags['est_height']);
    if (el.type === 'way') {
      if (!el.geometry || el.geometry.length < 4) continue;
      const ring = toRing(el.geometry);
      if (!closed(ring)) continue;
      buildings.push({ id, rings: [ring], ...attrs });
    } else if (el.type === 'relation') {
      if (tags.type && tags.type !== 'multipolygon') { skippedRelations += 1; continue; }   // type=building outlines are ways of their own
      const polygons = relationPolygons(el);
      if (!polygons.length) { skippedRelations += 1; continue; }
      relationCount += 1;
      polygons.forEach((polygon, index) => buildings.push({ id: index ? `${id}_${index}` : id, rings: polygon.rings, ...attrs }));
    } else continue;
    if (attrs.height != null) withHeight += 1;
    if (attrs.levels != null) withLevels += 1;
    if (attrs.year != null) withYear += 1;
  }
}

// Fold building:part heights into outlines that have no height tag of their own.
const parts = [];
for (const el of partsResponse.elements) {
  const geometry = el.type === 'way' ? el.geometry : (el.members || []).find(m => m.role !== 'inner' && m.geometry)?.geometry;
  const height = number(el.tags?.height);
  if (!geometry || !(height > 0)) continue;
  let lon = 0, lat = 0;
  for (const p of geometry) { lon += p.lon; lat += p.lat; }
  parts.push({ lon: lon / geometry.length, lat: lat / geometry.length, height });
}
let fromParts = 0;
if (parts.length) {
  const cell = 0.002, index = new Map();   // ~200 m buckets
  const key = (lon, lat) => `${Math.floor(lon / cell)}:${Math.floor(lat / cell)}`;
  for (const p of parts) { const k = key(p.lon, p.lat); (index.get(k) || index.set(k, []).get(k)).push(p); }
  for (const b of buildings) {
    if (b.height != null) continue;
    const outer = b.rings[0];
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of outer) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
    let best = null;
    for (let cx = Math.floor(minLon / cell); cx <= Math.floor(maxLon / cell); cx += 1) for (let cy = Math.floor(minLat / cell); cy <= Math.floor(maxLat / cell); cy += 1) {
      for (const p of index.get(`${cx}:${cy}`) || []) if (p.height > (best ?? 0) && pointInPolygon(p.lon, p.lat, b.rings)) best = p.height;
    }
    if (best != null) { b.height = best; b.heightFrom = 'building:part'; fromParts += 1; withHeight += 1; }
  }
}

/* ------------------------------------------------------------ roads */

const roads = [];
const seenRoads = new Set();
for (const response of roadResponses) {
  for (const el of response.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const id = `w${el.id}`;
    if (seenRoads.has(id)) continue;
    seenRoads.add(id);
    const tags = el.tags || {};
    roads.push({ id, points: toRing(el.geometry), kind: tags.highway, width: number(tags.width), lanes: integer(tags.lanes), tunnel: flag(tags.tunnel), bridge: flag(tags.bridge) });
  }
}

/* ------------------------------------------------------------ water */

const water = [];
let waterWays = 0, waterRelations = 0, waterSkipped = 0;
for (const el of waterResponse.elements) {
  const tags = el.tags || {};
  if (el.type === 'way') {
    const ring = el.geometry ? toRing(el.geometry) : [];
    if (closed(ring)) { water.push({ id: `w${el.id}`, name: tags['name:en'] || tags.name || null, rings: [ring] }); waterWays += 1; }
    else waterSkipped += 1;   // waterway=river centrelines are lines, not water
  } else if (el.type === 'relation') {
    if (tags.type && tags.type !== 'multipolygon') { waterSkipped += 1; continue; }   // type=waterway route relations
    const polygons = relationPolygons(el);
    if (!polygons.length) { waterSkipped += 1; continue; }
    waterRelations += 1;
    polygons.forEach((polygon, index) => water.push({ id: index ? `r${el.id}_${index}` : `r${el.id}`, name: tags['name:en'] || tags.name || null, rings: polygon.rings }));
  } else waterSkipped += 1;
}
// Larger polygons first, so the river wins any overlap when the kit rasterises.
water.sort((a, b) => Math.abs(ringArea(b.rings[0])) - Math.abs(ringArea(a.rings[0])));

/* ------------------------------------------------------------ write */

const data = {
  fetchedAt: new Date().toISOString(),
  sources: [
    { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL' },
    { name: 'Overpass API (overpass.openstreetmap.fr)', url: 'https://overpass.openstreetmap.fr/', licence: 'ODbL (data)' },
  ],
  box: BOX,
  buildings, roads, water,
  terrain: { kind: 'flat', height: 4.0 },
};
await writeFile(new URL('world-data.json', cache), JSON.stringify(data));

/* ------------------------------------------------------------ report */

const inWater = (lat, lon) => water.filter(w => pointInPolygon(lon, lat, w.rings)).map(w => `${w.id}${w.name ? ` (${w.name})` : ''}`);
const checks = [
  ['Huangpu off the Bund at Nanjing Road', 31.2400, 121.4885, true],
  ['Huangpu off the Bund at the Customs House', 31.2386, 121.4890, true],
  ['Huangpu off Lujiazui, north of the Oriental Pearl', 31.2450, 121.4910, true],
  ['Suzhou Creek at Sichuan Road', 31.2452, 121.4800, true],
  ['People’s Square', 31.2320, 121.4712, false],
  ['Lujiazui (Oriental Pearl)', 31.2419, 121.4953, false],
  ['The Bund promenade (origin)', 31.2400, 121.4860, false],
  ['Nanjing Road East', 31.2358, 121.4770, false],
];
const heights = buildings.map(b => b.height).filter(h => h != null).sort((a, b) => a - b);
const tallest = buildings.filter(b => b.height != null).sort((a, b) => b.height - a.height).slice(0, 5);
const roadKinds = {};
for (const r of roads) roadKinds[r.kind] = (roadKinds[r.kind] || 0) + 1;

console.log('');
console.log(`buildings: ${fmt(buildings.length)} polygons (${fmt(relationCount)} from multipolygon relations, ${skippedRelations} relations skipped)`);
console.log(`  with height: ${fmt(withHeight)} (${fmt(fromParts)} of them from building:part) · with levels: ${fmt(withLevels)} · with year: ${fmt(withYear)}`);
if (heights.length) console.log(`  tagged heights: median ${heights[Math.floor(heights.length / 2)]} m, max ${heights[heights.length - 1]} m`);
for (const b of tallest) console.log(`  ${b.id}: ${b.height} m, ${b.levels ?? '?'} levels, ${b.kind}`);
console.log(`roads: ${fmt(roads.length)} polylines · ${Object.entries(roadKinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`  with width: ${roads.filter(r => r.width != null).length} · with lanes: ${roads.filter(r => r.lanes != null).length} · bridges: ${roads.filter(r => r.bridge).length} · tunnels: ${roads.filter(r => r.tunnel).length}`);
console.log(`water: ${water.length} polygons (${waterWays} closed ways, ${waterRelations} multipolygon relations; ${waterSkipped} line/route elements skipped)`);
for (const w of water.slice(0, 8)) console.log(`  ${w.id} ${w.name || ''} · ${w.rings[0].length} pts${w.rings.length > 1 ? `, ${w.rings.length - 1} holes` : ''}`);
let ok = true;
for (const [label, lat, lon, expectWater] of checks) {
  const hits = inWater(lat, lon);
  const pass = (hits.length > 0) === expectWater;
  ok = ok && pass;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label} (${lat}, ${lon}): ${hits.length ? `in ${hits.join(', ')}` : 'land'} — expected ${expectWater ? 'water' : 'land'}`);
}
{
  let west = null, east = null;
  for (let lon = 121.480; lon <= 121.500; lon += 0.0001) if (inWater(31.2400, lon).length) { if (west == null) west = lon; east = lon; }
  console.log(`  Huangpu at 31.2400 N: west bank ${west?.toFixed(4)}, east bank ${east?.toFixed(4)} (${west == null ? '?' : Math.round((east - west) * 95170)} m wide)`);
}
console.log(`terrain: flat, ${data.terrain.height} m`);
console.log(`wrote shanghai/.cache/world-data.json (${fmt(Buffer.byteLength(JSON.stringify(data)))} bytes)`);
if (!ok) { console.error('water check failed'); process.exitCode = 1; }
