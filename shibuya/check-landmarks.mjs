// Checks config.mjs → LANDMARKS against the fetched OSM footprints.
//
//   node shibuya/check-landmarks.mjs          (after node shibuya/fetch-data.mjs)
//
// For every landmark it reports the building polygon its coordinate falls in
// (name, OSM height / storeys) or "outside every footprint", and for the named
// towers it also lists the footprints whose name tags match, with centroid and
// area, so a coordinate can be moved onto the right one. Reads the raw
// Overpass cache (world-data.json carries no names). Node built-ins only.
import { readdir, readFile } from 'node:fs/promises';
import { LANDMARKS } from './config.mjs';

const cache = new URL('./.cache/overpass/', import.meta.url);

// What each landmark is called in OSM (name, name:en, name:ja, brand, …).
const NAMES = {
  scramble_square: /scramble square|スクランブルスクエア/i,
  hikarie: /hikarie|ヒカリエ/i,
  stream: /shibuya stream|渋谷ストリーム/i,
  cerulean: /cerulean|セルリアン/i,
  sakura_stage: /sakura stage|サクラステージ/i,
  mark_city: /mark ?city|マークシティ/i,
  shibuya_109: /^(shibuya ?109|渋谷109|SHIBUYA109)/i,
  parco: /shibuya parco|渋谷パルコ|渋谷PARCO/i,
  fukuras: /fukuras|フクラス|東急プラザ渋谷/i,
  yoyogi_gym: /代々木競技場|yoyogi national/i,
  nhk: /nhk放送センター|nhk broadcasting/i,
  omotesando_hills: /omotesando hills|表参道ヒルズ/i,
  ebisu_garden_place: /garden place tower|ガーデンプレイスタワー/i,
  harajuku_station: /^原宿駅|harajuku station/i,
  miyashita_park: /miyashita park|宮下パーク|ミヤシタパーク/i,
  daikanyama: /蔦屋書店|t-site|tsutaya/i,
  meiji_jingu: /明治神宮/i,
};

const files = (await readdir(cache)).filter(f => f.startsWith('buildings-'));
const seen = new Set(), polygons = [];
const ring = geometry => geometry.filter(g => g).map(g => [g.lon, g.lat]);
for (const file of files) {
  const data = JSON.parse(await readFile(new URL(file, cache), 'utf8'));
  for (const el of data.elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key) || !el.tags?.building) continue;
    seen.add(key);
    if (el.type === 'way' && el.geometry) polygons.push({ id: key, tags: el.tags, ring: ring(el.geometry) });
    else if (el.type === 'relation') for (const m of el.members || []) if (m.type === 'way' && m.geometry && m.role !== 'inner') polygons.push({ id: key, tags: el.tags, ring: ring(m.geometry) });
  }
}

const inside = (p, r) => {
  let ok = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
};
const COS = Math.cos((35.66 * Math.PI) / 180);
function centroidArea(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
  }
  if (Math.abs(a) < 1e-14) return { lon: r[0][0], lat: r[0][1], m2: 0 };
  return { lon: cx / (3 * a), lat: cy / (3 * a), m2: Math.round(Math.abs(a) / 2 * 111320 * 111320 * COS) };
}
const nameOf = t => t.name || t['name:en'] || t['name:ja'] || t.brand || t.operator || '(unnamed)';
const describe = p => `${p.id} “${nameOf(p.tags)}” height=${p.tags.height ?? '–'} levels=${p.tags['building:levels'] ?? '–'} building=${p.tags.building}${p.tags.start_date ? ' since ' + p.tags.start_date : ''}`;

let bad = 0;
for (const [id, l] of Object.entries(LANDMARKS)) {
  const hits = polygons.filter(p => inside([l.longitude, l.latitude], p.ring));
  const status = hits.length ? 'inside ' + hits.map(describe).join(' | ') : (l.place ? 'outside every footprint (a place — fine)' : 'OUTSIDE EVERY FOOTPRINT');
  if (!hits.length && !l.place) bad += 1;
  console.log(`${id.padEnd(20)} ${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}  ${l.heightMeters} m — ${status}`);
  const pattern = NAMES[id];
  if (!pattern) continue;
  const named = polygons.filter(p => Object.entries(p.tags).some(([k, v]) => /^(name|brand|operator)/.test(k) && pattern.test(v)));
  for (const p of named) {
    const c = centroidArea(p.ring);
    console.log(`    name match ${describe(p)} — centroid ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}, ${c.m2.toLocaleString('en-US')} m²${hits.includes(p) ? ' ← this one' : ''}`);
  }
}
for (const [id, pattern] of Object.entries(NAMES)) {
  if (LANDMARKS[id]) continue;
  for (const p of polygons.filter(p => Object.entries(p.tags).some(([k, v]) => /^(name|brand|operator)/.test(k) && pattern.test(v)))) {
    const c = centroidArea(p.ring);
    console.log(`(not a landmark) ${id}: ${describe(p)} — centroid ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}, ${c.m2.toLocaleString('en-US')} m²`);
  }
}
console.log(`${polygons.length.toLocaleString('en-US')} footprints checked; ${bad} tower coordinate(s) outside every footprint`);
process.exitCode = bad ? 1 : 0;
