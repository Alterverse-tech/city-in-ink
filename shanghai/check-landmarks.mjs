// Checks every LANDMARK in shanghai/config.mjs against the fetched OSM
// footprints: is the coordinate inside a building polygon, and what height /
// storeys does that polygon carry? For misses it lists the nearest named
// buildings so the coordinate can be moved onto the right footprint.
//
//   node shanghai/fetch-data.mjs        # first, once
//   node shanghai/check-landmarks.mjs
//   node shanghai/check-landmarks.mjs --find '艾美|Méridien'   # search footprints by name
//
// Exit code 1 when a tower (non-place landmark) misses every footprint.
import { readFile, readdir } from 'node:fs/promises';
import { LANDMARKS, project } from './config.mjs';

const cache = new URL('./.cache/', import.meta.url);
const data = JSON.parse(await readFile(new URL('world-data.json', cache), 'utf8'));

// Names live in the raw Overpass responses (world-data.json carries no tags).
const names = new Map();
for (const file of await readdir(cache)) {
  if (!file.startsWith('buildings-')) continue;
  const json = JSON.parse(await readFile(new URL(file, cache), 'utf8'));
  for (const el of json.elements) {
    const t = el.tags || {};
    const name = t['name:en'] || t.name;
    if (name) names.set(`${el.type[0]}${el.id}`, `${name}${t['name:en'] && t.name && t.name !== t['name:en'] ? ` / ${t.name}` : ''}`);
  }
}
const nameOf = id => names.get(id.replace(/_\d+$/, ''));

// The centroid when it lies inside the footprint, otherwise the nearest point
// to it on a spoke towards a vertex (L-shaped and courtyard buildings).
function interiorPoint(b) {
  const [cx, cy] = centroid(b.rings[0]);
  if (inside(cx, cy, b)) return [cx, cy];
  let best = null;
  for (const [x, y] of b.rings[0]) for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const px = cx + (x - cx) * t, py = cy + (y - cy) * t;
    if (inside(px, py, b)) { const d = (px - cx) ** 2 + (py - cy) ** 2; if (!best || d < best[2]) best = [px, py, d]; }
  }
  return best ? [best[0], best[1]] : [cx, cy];
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inside = (lon, lat, b) => pointInRing(lon, lat, b.rings[0]) && !b.rings.slice(1).some(h => pointInRing(lon, lat, h));

function centroid(ring) {
  let x = 0, y = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; }
  return [x / ring.length, y / ring.length];
}
const metres = (a, b) => { const p = project(a[0], a[1]), q = project(b[0], b[1]); return Math.hypot(p.x - q.x, p.z - q.z); };

// --find <regex>: list the cached footprints whose name matches, with an
// interior point ready to paste into LANDMARKS, then exit.
const findAt = process.argv.indexOf('--find');
if (findAt > 0) {
  const re = new RegExp(process.argv[findAt + 1] || '.', 'i');
  for (const b of data.buildings) {
    const name = nameOf(b.id);
    if (!name || !re.test(name)) continue;
    const [lon, lat] = interiorPoint(b);
    console.log(`${b.id.padEnd(12)} ${String(b.height ?? '—').padStart(6)} m ${String(b.levels ?? '—').padStart(4)} lv  ${lat.toFixed(5)}, ${lon.toFixed(5)}  ${b.kind.padEnd(10)} ${name}`);
  }
  process.exit(0);
}

let failures = 0;
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('landmark', 16)} ${pad('hit', 5)} ${pad('osm id', 12)} ${pad('height', 8)} ${pad('levels', 7)} ${pad('kind', 12)} name`);
for (const [id, l] of Object.entries(LANDMARKS)) {
  const hits = data.buildings.filter(b => inside(l.longitude, l.latitude, b));
  // The biggest footprint containing the point (the outline, not a courtyard piece).
  const hit = hits.sort((a, b) => b.rings[0].length - a.rings[0].length)[0];
  if (hit) {
    const heightNote = hit.height == null ? (hit.levels == null ? 'no height/levels in OSM' : '') : (Math.abs(hit.height - l.heightMeters) > l.heightMeters * 0.25 && !l.place ? ` ≠ config ${l.heightMeters} m` : '');
    console.log(`${pad(id, 16)} ${pad('yes', 5)} ${pad(hit.id, 12)} ${pad(hit.height ?? '—', 8)} ${pad(hit.levels ?? '—', 7)} ${pad(hit.kind, 12)} ${nameOf(hit.id) || ''}${heightNote ? `  [${heightNote}]` : ''}`);
  } else {
    if (!l.place) failures += 1;
    console.log(`${pad(id, 16)} ${pad(l.place ? 'place' : 'MISS', 5)} ${pad('—', 12)} ${pad('—', 8)} ${pad('—', 7)} ${pad('—', 12)} ${l.place ? '(label only)' : `nothing at ${l.latitude}, ${l.longitude}`}`);
    if (!l.place) {
      const near = data.buildings
        .map(b => ({ b, d: metres([l.longitude, l.latitude], centroid(b.rings[0])) }))
        .filter(x => x.d < 250 && (x.b.height != null || nameOf(x.b.id)))
        .sort((a, b) => a.d - b.d).slice(0, 6);
      for (const { b, d } of near) {
        const [lon, lat] = interiorPoint(b);
        console.log(`    ${Math.round(d)} m: ${b.id} ${b.height ?? '—'} m / ${b.levels ?? '—'} lv ${b.kind} ${nameOf(b.id) || ''} @ ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
      }
    }
  }
}
// Named towers the config might want: everything tagged above 150 m.
console.log('\nOSM buildings tagged 150 m or taller in the box:');
for (const b of data.buildings.filter(b => b.height >= 150).sort((a, b) => b.height - a.height)) {
  const [lon, lat] = centroid(b.rings[0]);
  console.log(`  ${pad(b.id, 12)} ${pad(b.height + ' m', 8)} ${pad(b.levels ?? '—', 4)} ${lat.toFixed(5)}, ${lon.toFixed(5)}  ${nameOf(b.id) || ''}`);
}
if (failures) { console.error(`\n${failures} tower(s) miss every footprint`); process.exitCode = 1; }
else console.log('\nall towers sit on an OSM footprint');
