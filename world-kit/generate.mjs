// Turns <city>/.cache/world-data.json (see README.md) into the city resources
// the game engine already knows how to draw — the same buffers, attribute
// layouts and manifest shape as the San Francisco world:
//
//   terrain-heights.i16 / terrain-land.u8       nx × nz grid, decimetres, land mask
//   buildings-refined-{position.f32,normal.i8,tone.u8,index.u32,facade.u16}
//   roads-{position.i16,normal.i8,tone.u8,index.u32}
//   city-manifest.json
//
//   node world-kit/generate.mjs <city>      →  <city>/city/*.gz + manifest.json
//
// Facade attribute per vertex (u16 × 4): metres along the wall × 10, metres
// above the wall base × 10, wall height × 10, material family
// (0 stone · 1 concrete · 2 brick · 3 glass · 4 granite). Families are an
// illustrative palette inferred from construction year and height with a
// stable seed — never a surveyed facade colour.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { triangulate } from './earcut.mjs';

const HEIGHT_SCALE = 0.1;            // terrain i16 = decimetres
const ROAD_SCALE = 0.3;              // road i16 = 0.3 m steps
const WALL_SINK = 1.5;               // walls start this far below the lowest terrain sample

/* ------------------------------------------------------------------ helpers */

class Grow {
  constructor(Type, initial = 1 << 20) { this.Type = Type; this.array = new Type(initial); this.length = 0; }
  push(...values) {
    if (this.length + values.length > this.array.length) {
      const next = new this.Type(Math.max(this.array.length * 2, this.length + values.length));
      next.set(this.array.subarray(0, this.length)); this.array = next;
    }
    for (const value of values) this.array[this.length++] = value;
  }
  result() { return this.array.slice(0, this.length); }
}

export function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const unit = (seed, salt) => (hash32(`${seed}:${salt}`) % 100000) / 100000;

function ringArea(ring) {           // shoelace in the (x, z) plane
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
}
function ringCentroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cz += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [cx / (3 * a), cz / (3 * a)];
}
function simplify(points, tolerance) { // Douglas–Peucker on an open polyline
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, far = tolerance * tolerance;
    const [ax, az] = points[a], [bx, bz] = points[b], dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    for (let i = a + 1; i < b; i += 1) {
      const [px, pz] = points[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
      const qx = ax + t * dx - px, qz = az + t * dz - pz, d2 = qx * qx + qz * qz;
      if (d2 > far) { far = d2; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const bbox = ring => ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const inBox = (x, y, b) => x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3];

// Polygons (lon/lat rings) → point test with ring bounding boxes.
function polygonIndex(polygons) {
  const list = (polygons || []).filter(p => p?.rings?.length && p.rings[0].length >= 3).map(p => p.rings.map(ring => ({ ring, box: bbox(ring) })));
  return (lon, lat) => {
    for (const rings of list) {
      const outer = rings[0];
      if (!inBox(lon, lat, outer.box) || !pointInRing(lon, lat, outer.ring)) continue;
      let hole = false;
      for (let i = 1; i < rings.length && !hole; i += 1) hole = inBox(lon, lat, rings[i].box) && pointInRing(lon, lat, rings[i].ring);
      if (!hole) return true;
    }
    return false;
  };
}

/* ------------------------------------------------------------------ defaults for OSM-shaped inputs */

const OSM_ROAD_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian', 'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const OSM_ROAD_WIDTH = { motorway: 22, trunk: 18, primary: 16, secondary: 13, tertiary: 10, unclassified: 8, residential: 7, living_street: 6, pedestrian: 6, service: 5, motorway_link: 9, trunk_link: 9, primary_link: 8, secondary_link: 7, tertiary_link: 7 };
export const OSM_ROADS = {
  include: road => OSM_ROAD_KINDS.has(road.kind) && !road.tunnel,
  width: road => {
    let width = road.width > 0 ? road.width : road.lanes > 0 ? road.lanes * 3.2 : OSM_ROAD_WIDTH[road.kind] ?? 7;
    return Math.max(4, Math.min(30, width));
  },
  tone: (road, width) => /^(motorway|trunk)/.test(road.kind) ? 235 : /^(primary|secondary)/.test(road.kind) || width >= 18 ? 190 : 135,
};
const DEFAULT_HEIGHTS = { levelMetres: 3.1, default: 9, max: 480, byKind: { house: 7, detached: 7, residential: 15, apartments: 22, commercial: 18, office: 20, retail: 12, industrial: 9, warehouse: 8, hotel: 30, garage: 4, garages: 4, shed: 3, roof: 3, school: 12, hospital: 20, university: 16, church: 14, temple: 10, shrine: 8, train_station: 12 } };

/* ------------------------------------------------------------------ generator */

export async function generateWorld(cityDir) {
  const dir = new URL(cityDir.endsWith('/') ? cityDir : cityDir + '/', pathToFileURL(process.cwd() + '/'));
  const config = await import(new URL('config.mjs', dir).href);
  const { BOX, ORIGIN, METERS_LAT, METERS_LON, project, TERRAIN_BOUNDS, SOURCES = {}, LANDMARKS = {} } = config;
  const HEIGHTS = { ...DEFAULT_HEIGHTS, ...(config.HEIGHTS || {}), byKind: { ...DEFAULT_HEIGHTS.byKind, ...(config.HEIGHTS?.byKind || {}) } };
  const ROADS = { ...OSM_ROADS, ...(config.ROADS || {}) };
  const WATER_HEIGHT = config.WATER_HEIGHT ?? -2.5, LAND_MIN_HEIGHT = config.LAND_MIN_HEIGHT ?? 1.2;
  const unproject = (x, z) => ({ lon: ORIGIN.lon + x / METERS_LON, lat: ORIGIN.lat - z / METERS_LAT });
  const out = new URL('city/', dir), label = config.CITY?.label || cityDir;

  const data = JSON.parse(await readFile(new URL('.cache/world-data.json', dir), 'utf8'));
  const { minX, maxX, minZ, maxZ, nx, nz } = TERRAIN_BOUNDS;
  console.log(`${label}: ${data.buildings.length} buildings, ${data.roads.length} road polylines, ${(data.water || []).length} water polygons, ${(data.land || []).length} land polygons, terrain ${data.terrain?.kind}`);

  /* ---- terrain ---- */
  const grid = data.terrain?.kind === 'grid' ? data.terrain : null;
  if (grid) {
    grid.east ??= grid.west + grid.dLon * grid.nx; grid.south ??= grid.north - grid.dLat * grid.ny;
    if (grid.heights.length !== grid.nx * grid.ny) throw new Error('Terrain grid has the wrong number of heights');
  }
  // Grid samples sit at pixel centres; sample bilinearly at the exact node so
  // the surface, the land test and the buildings agree.
  function demAt(lon, lat) {
    if (!grid) return data.terrain?.height ?? 2;
    const fx = (lon - grid.west) / (grid.east - grid.west) * grid.nx - 0.5, fy = (grid.north - lat) / (grid.north - grid.south) * grid.ny - 0.5;
    const x0 = Math.max(0, Math.min(grid.nx - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(grid.ny - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const v = (x, y) => { const s = grid.heights[y * grid.nx + x]; return s == null || s < -1000 ? 0 : s; };
    return v(x0, y0) * (1 - tx) * (1 - ty) + v(x0 + 1, y0) * tx * (1 - ty) + v(x0, y0 + 1) * (1 - tx) * ty + v(x0 + 1, y0 + 1) * tx * ty;
  }
  const insideLand = data.land?.length ? polygonIndex(data.land) : null, insideWater = polygonIndex(data.water);
  const landRule = typeof config.LAND_RULE === 'function' ? config.LAND_RULE : null;
  const dx = (maxX - minX) / (nx - 1), dz = (maxZ - minZ) / (nz - 1);
  const heights = new Int16Array(nx * nz), land = new Uint8Array(nx * nz), heightMetres = new Float32Array(nx * nz);
  let landCells = 0;
  for (let j = 0; j < nz; j += 1) for (let i = 0; i < nx; i += 1) {
    const x = minX + i * dx, z = minZ + j * dz, { lon, lat } = unproject(x, z), elevation = demAt(lon, lat);
    const isLand = (insideLand ? insideLand(lon, lat) : !insideWater(lon, lat)) || (landRule ? landRule(lon, lat, elevation) : false);
    const h = isLand ? Math.max(LAND_MIN_HEIGHT, elevation) : WATER_HEIGHT;
    const k = j * nx + i;
    land[k] = isLand ? 1 : 0; heightMetres[k] = h; heights[k] = Math.round(h / HEIGHT_SCALE); landCells += isLand;
  }
  console.log(`terrain: ${landCells} land cells of ${nx * nz}`);
  function terrainAt(x, z) {          // the engine's own bilinear sampleTerrain, on this grid
    const cx = Math.max(0, Math.min(nx - 1.001, (x - minX) / (maxX - minX) * (nx - 1))), cz = Math.max(0, Math.min(nz - 1.001, (z - minZ) / (maxZ - minZ) * (nz - 1)));
    const i = Math.floor(cx), j = Math.floor(cz), u = cx - i, v = cz - j;
    return heightMetres[j * nx + i] * (1 - u) * (1 - v) + heightMetres[j * nx + i + 1] * u * (1 - v) + heightMetres[(j + 1) * nx + i] * (1 - u) * v + heightMetres[(j + 1) * nx + i + 1] * u * v;
  }
  function landAt(x, z) {
    const i = Math.round(Math.max(0, Math.min(nx - 1, (x - minX) / dx))), j = Math.round(Math.max(0, Math.min(nz - 1, (z - minZ) / dz)));
    return land[j * nx + i] === 1;
  }

  /* ---- buildings ---- */
  const B = { position: new Grow(Float32Array, 1 << 22), normal: new Grow(Int8Array, 1 << 22), tone: new Grow(Uint8Array, 1 << 21), facade: new Grow(Uint16Array, 1 << 22), index: new Grow(Uint32Array, 1 << 22) };
  let vertexCount = 0;
  const familyCounts = { stone: 0, concrete: 0, brick: 0, glass: 0, granite: 0 };
  const FAMILY = { stone: 0, concrete: 1, brick: 2, glass: 3, granite: 4 };

  function pickFamily(seed, year, height) {
    const r = unit(seed, 'family');
    const pick = table => { let acc = 0; for (const [name, weight] of table) { acc += weight; if (r < acc) return name; } return table.at(-1)[0]; };
    if (!year) return pick(height > 120 ? [['glass', .5], ['concrete', .3], ['granite', .2]] : [['stone', .45], ['brick', .4], ['concrete', .15]]);
    if (year < 1900) return pick([['brick', .55], ['stone', .45]]);
    if (year < 1930) return pick([['stone', .5], ['brick', .35], ['granite', .15]]);
    if (year < 1965) return pick([['stone', .4], ['concrete', .35], ['brick', .15], ['granite', .1]]);
    if (year < 1995) return pick([['concrete', .45], ['glass', .35], ['granite', .2]]);
    return pick([['glass', .65], ['concrete', .2], ['granite', .15]]);
  }
  // Setbacks: the landmark table first, then a seeded rule for other towers.
  function tierProfile(seed, year, height, compactness, landmark) {
    if (landmark?.tiers) return landmark.tiers;
    if (height < 90 || compactness < 0.5) return [[1, 1]];
    const r = unit(seed, 'tiers'), prewar = year && year < 1965;
    if (height < 150) return r < (prewar ? .8 : .3) ? [[0.7, 1], [1, 0.74]] : [[1, 1]];
    if (r < .6) return [[0.55, 1], [0.8, 0.82], [1, 0.64]];
    return [[0.7, 1], [1, 0.76]];
  }
  function scaleRing(ring, s) {
    if (s === 1) return ring;
    const [cx, cz] = ringCentroid(ring);
    return ring.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s]);
  }
  function cleanRing(coordinates) {
    let ring = coordinates.map(([lon, lat]) => { const p = project(lon, lat); return [p.x, p.z]; });
    if (ring.length > 1 && Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < 1e-6) ring = ring.slice(0, -1);
    if (ring.length < 3) return ring;
    ring = simplify([...ring, ring[0]], 0.25).slice(0, -1);
    const clean = [];
    for (const p of ring) if (!clean.length || Math.hypot(p[0] - clean.at(-1)[0], p[1] - clean.at(-1)[1]) > 0.05) clean.push(p);
    while (clean.length > 1 && Math.hypot(clean[0][0] - clean.at(-1)[0], clean[0][1] - clean.at(-1)[1]) <= 0.05) clean.pop();
    return clean;
  }
  // One closed ring of walls. Vertex order per edge mirrors the SF buffers:
  // bottom-left, bottom-right, top-right, top-left, triangles (0,1,2) (0,2,3).
  function emitWalls(ring, bottom, top, family, tone) {
    const H = Math.round((top - bottom) * 10);
    let u = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      const ex = x1 - x0, ez = z1 - z0, len = Math.hypot(ex, ez);
      if (len < 1e-4) continue;
      // Outer rings run counter-clockwise in lon/lat (clockwise in x/z), holes
      // the other way; (-ez, ex) then points out of the building on both.
      const nxw = Math.round(-ez / len * 127), nzw = Math.round(ex / len * 127);
      const u0 = Math.min(65535, Math.round(u * 10)), u1 = Math.min(65535, Math.round((u + len) * 10));
      B.position.push(x0, bottom, z0, x1, bottom, z1, x1, top, z1, x0, top, z0);
      for (let k = 0; k < 4; k += 1) { B.normal.push(nxw, 0, nzw); B.tone.push(tone); }
      B.facade.push(u0, 0, H, family, u1, 0, H, family, u1, H, H, family, u0, H, H, family);
      B.index.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
      vertexCount += 4; u += len;
    }
  }
  function emitRoof(outer, holes, y, wallHeight, family, tone) {
    const flat = [], holeStarts = [];
    for (const [x, z] of outer) flat.push(x, z);
    for (const hole of holes) { holeStarts.push(flat.length / 2); for (const [x, z] of hole) flat.push(x, z); }
    const tris = triangulate(flat, holeStarts);
    if (!tris.length) return 0;
    const base = vertexCount, H = Math.round(wallHeight * 10);
    for (let i = 0; i < flat.length; i += 2) {
      B.position.push(flat[i], y, flat[i + 1]); B.normal.push(0, 127, 0); B.tone.push(tone); B.facade.push(0, H, H, family);
    }
    for (const t of tris) B.index.push(base + t);
    vertexCount += flat.length / 2;
    return tris.length / 3;
  }

  // Landmark lookup: the footprint that contains the landmark's coordinate.
  const landmarkTargets = Object.entries(LANDMARKS).filter(([, l]) => !l.place).map(([id, l]) => ({ id, ...l, point: project(l.longitude, l.latitude) }));
  const landmarkHits = new Map();
  const heightOf = (b, landmark) => {
    let height = b.height > 0 ? b.height : b.levels > 0 ? b.levels * HEIGHTS.levelMetres : 0;
    if (!(height >= 2.5)) height = landmark ? landmark.heightMeters : (HEIGHTS.byKind[b.kind] ?? HEIGHTS.default);   // unknown: a low block, never a guess at a tower
    return Math.min(height, HEIGHTS.max);
  };

  let rendered = 0, skipped = 0, roofTriangles = 0, holesKept = 0, tallest = 0;
  for (const b of data.buildings) {
    const rings = (b.rings || []).map(cleanRing).filter(ring => ring.length >= 3);
    if (!rings.length) { skipped += 1; continue; }
    let outer = rings[0];
    const outerArea = ringArea(outer);
    if (Math.abs(outerArea) < 5) { skipped += 1; continue; }
    if (outerArea > 0) outer = outer.slice().reverse();          // clockwise in x/z = counter-clockwise in lon/lat
    const holes = rings.slice(1).filter(ring => Math.abs(ringArea(ring)) >= 4).map(ring => ringArea(ring) < 0 ? ring.slice().reverse() : ring);
    holesKept += holes.length;
    const box = bbox(outer), compactness = Math.abs(outerArea) / Math.max(1, (box[2] - box[0]) * (box[3] - box[1]));
    const landmark = landmarkTargets.find(l => inBox(l.point.x, l.point.z, box) && pointInRing(l.point.x, l.point.z, outer));
    const seed = String(b.id), year = Number(b.year) || 0, height = heightOf(b, landmark);
    if (landmark) landmarkHits.set(landmark.id, { id: b.id, height: Math.round(height) });
    let groundMin = Infinity;
    for (const [x, z] of outer) groundMin = Math.min(groundMin, terrainAt(x, z));
    const [cx, cz] = ringCentroid(outer);
    const base = landAt(cx, cz) ? Math.max(LAND_MIN_HEIGHT, groundMin) : LAND_MIN_HEIGHT;   // piers stand on the water plane
    const familyName = pickFamily(seed, year, height), family = FAMILY[familyName];
    familyCounts[familyName] += 1;
    const tone = 40 + (hash32(seed + ':tone') % 176);
    const tiers = tierProfile(seed, year, height, compactness, landmark);
    let bottom = base - WALL_SINK;
    for (let t = 0; t < tiers.length; t += 1) {
      const [fraction, scale] = tiers[t], top = base + height * fraction;
      if (top - bottom < 0.5) continue;
      const ring = scaleRing(outer, scale), tierHoles = scale === 1 ? holes : [];
      emitWalls(ring, bottom, top, family, tone);
      for (const hole of tierHoles) emitWalls(hole, bottom, top, family, tone);
      roofTriangles += emitRoof(ring, tierHoles, top, top - bottom, family, tone);
      bottom = top;
    }
    if (landmark?.spireMeters && landmark.spireMeters > base + height + 2) {
      const mast = scaleRing(outer, 0.05), top = base + landmark.spireMeters;   // the antenna above the surveyed roof
      emitWalls(mast, bottom, top, 4, tone); roofTriangles += emitRoof(mast, [], top, top - bottom, 4, tone);
    }
    tallest = Math.max(tallest, height);
    rendered += 1;
  }
  for (const l of landmarkTargets) if (!landmarkHits.has(l.id)) console.warn(`landmark not found in the footprints: ${l.id} (${l.label})`);
  console.log(`buildings: ${rendered} rendered, ${skipped} skipped, ${holesKept} courtyards, ${vertexCount} vertices, ${B.index.length / 3} triangles (${roofTriangles} roof), tallest ${tallest.toFixed(1)} m`);
  console.log('landmarks:', [...landmarkHits].map(([id, hit]) => `${id}=${hit.id}/${hit.height}m`).join(' '));

  /* ---- roads ---- */
  const R = { position: new Grow(Int16Array, 1 << 18), normal: new Grow(Int8Array, 1 << 18), tone: new Grow(Uint8Array, 1 << 16), index: new Grow(Uint32Array, 1 << 18) };
  let roadVertices = 0;
  const drawnFeatures = new Set();
  for (const road of data.roads) {
    if (!ROADS.include(road)) continue;
    const width = ROADS.width(road), tone = ROADS.tone(road, width);
    const points = road.points.map(([lon, lat]) => { const p = project(lon, lat); return [p.x, p.z]; });
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [x0, z0] = points[i], [x1, z1] = points[i + 1], ex = x1 - x0, ez = z1 - z0, len = Math.hypot(ex, ez);
      if (len < 0.5 || (!landAt(x0, z0) && !landAt(x1, z1))) continue;
      const wx = -ez / len * width / 2, wz = ex / len * width / 2;
      const quad = [[x0 + wx, z0 + wz], [x0 - wx, z0 - wz], [x1 - wx, z1 - wz], [x1 + wx, z1 + wz]];
      for (const [x, z] of quad) {
        const y = terrainAt(x, z) + 0.6;
        R.position.push(Math.round(x / ROAD_SCALE), Math.round(y / ROAD_SCALE), Math.round(z / ROAD_SCALE)); R.normal.push(0, 127, 0); R.tone.push(tone);
      }
      R.index.push(roadVertices, roadVertices + 1, roadVertices + 2, roadVertices, roadVertices + 2, roadVertices + 3);
      roadVertices += 4; drawnFeatures.add(road.id);
    }
  }
  const roadFeatures = drawnFeatures.size;
  console.log(`roads: ${roadFeatures} segments drawn, ${roadVertices} vertices`);
  for (const v of R.position.array.subarray(0, R.position.length)) if (v < -32768 || v > 32767) throw new Error('Road coordinate exceeds int16');

  /* ---- output ---- */
  const manifest = {
    generatedAt: new Date().toISOString(),
    world: config.CITY?.world || label,
    origin: { lon: ORIGIN.lon, lat: ORIGIN.lat },
    projection: { metersLat: METERS_LAT, metersLon: METERS_LON, convention: 'x=east, y=up, z=south' },
    terrain: { bounds: { minX, maxX, minZ, maxZ }, nx, nz, heightScale: HEIGHT_SCALE, heights: '/data/terrain-heights.i16', landMask: '/data/terrain-land.u8' },
    buildings: { sourceFeatures: data.buildings.length, renderedBuildings: rendered, vertices: vertexCount, indices: B.index.length,
      position: '/data/buildings-refined-position.f32', positionScale: 1, normal: '/data/buildings-refined-normal.i8', tone: '/data/buildings-refined-tone.u8',
      index: '/data/buildings-refined-index.u32', facade: '/data/buildings-refined-facade.u16', positionType: 'Float32', facadeUnits: 'decimetres; family integer',
      familyCounts, courtyards: holesKept, tallestMetres: Math.round(tallest),
      materialAssignment: 'Illustrative families inferred from construction year and building height with a stable seed; not surveyed facade colors',
      setbacks: 'Towers above 90 m are stepped back on a seeded rule; the named landmarks follow their published massing. Footprints and roof heights stay as surveyed.' },
    roads: { sourceFeatures: roadFeatures, vertices: roadVertices, indices: R.index.length, position: '/data/roads-position.i16', positionScale: ROAD_SCALE,
      normal: '/data/roads-normal.i8', tone: '/data/roads-tone.u8', index: '/data/roads-index.u32' },
    sources: [...Object.values(SOURCES), ...(data.sources || [])],
    box: BOX,
  };

  const files = {
    '/data/city-manifest.json': Buffer.from(JSON.stringify(manifest)),
    '/data/terrain-heights.i16': Buffer.from(heights.buffer),
    '/data/terrain-land.u8': Buffer.from(land.buffer),
    '/data/roads-position.i16': Buffer.from(R.position.result().buffer),
    '/data/roads-normal.i8': Buffer.from(R.normal.result().buffer),
    '/data/roads-tone.u8': Buffer.from(R.tone.result().buffer),
    '/data/roads-index.u32': Buffer.from(R.index.result().buffer),
    '/data/buildings-refined-position.f32': Buffer.from(B.position.result().buffer),
    '/data/buildings-refined-normal.i8': Buffer.from(B.normal.result().buffer),
    '/data/buildings-refined-tone.u8': Buffer.from(B.tone.result().buffer),
    '/data/buildings-refined-index.u32': Buffer.from(B.index.result().buffer),
    '/data/buildings-refined-facade.u16': Buffer.from(B.facade.result().buffer),
  };
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const index = { generatedAt: manifest.generatedAt, files: {} };
  let total = 0;
  for (const [path, bytes] of Object.entries(files)) {
    const name = path.slice('/data/'.length) + '.gz', compressed = gzipSync(bytes, { level: 9 });
    await writeFile(new URL(name, out), compressed);
    index.files[path] = { file: name, bytes: bytes.length, compressed: compressed.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    total += compressed.length;
  }
  await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(new URL('index.json', out), JSON.stringify(index, null, 2) + '\n');
  console.log(`wrote ${Object.keys(files).length} resources, ${(total / 1048576).toFixed(1)} MB compressed → ${cityDir}/city/`);
  return manifest;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const city = process.argv[2];
  if (!city) { console.error('usage: node world-kit/generate.mjs <city>'); process.exit(2); }
  await generateWorld(city);
}
