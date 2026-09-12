// Downloads the public data the Manhattan world is generated from into
// manhattan/.cache/ (gitignored). Re-run to refresh; generate-city.mjs reads
// only this cache, so the build itself never needs the network.
//
//   node manhattan/fetch-data.mjs
//
// Node built-ins only. Behind a proxy Node ≥ 24 honours HTTPS_PROXY with
// NODE_USE_ENV_PROXY=1; when fetch cannot reach a host this script falls back
// to curl, which reads the same environment.
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BOX, TERRAIN_BOUNDS, SOURCES } from './config.mjs';

const run = promisify(execFile);
const cache = new URL('./.cache/', import.meta.url);
await mkdir(cache, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function download(url, { binary = false, attempts = 6 } = {}) {
  let delay = 2000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: binary ? '*/*' : 'application/json' } });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { fatal: true });
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) {
      if (error.fatal) throw error;
      // Node's fetch ignores proxy variables unless told otherwise; curl does not.
      try {
        const { stdout } = await run('curl', ['-sS', '-f', '--max-time', '300', url], { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 512 * 1024 * 1024 });
        return stdout;
      } catch (curlError) {
        if (attempt === attempts) throw new Error(`${url}: ${error.message}; curl: ${curlError.message}`);
        console.log(`  retry ${attempt}/${attempts} in ${delay / 1000}s — ${error.message}`);
        await sleep(delay); delay = Math.min(delay * 2, 60000);
      }
    }
  }
}

const soda = (id, params) => `https://data.cityofnewyork.us/resource/${id}.json?${new URLSearchParams(params)}`;
const withinBox = field => `within_box(${field},${BOX.north},${BOX.west},${BOX.south},${BOX.east})`;

async function fresh(name) {
  try { const info = await stat(new URL(name, cache)); return info.size > 0; } catch { return false; }
}

// 1. Building footprints, paged by BIN so a retry never skips a page.
if (!(await fresh('footprints.json'))) {
  const rows = []; const page = 10000;
  for (let offset = 0; ; offset += page) {
    console.log(`footprints: offset ${offset}`);
    const text = await download(soda(SOURCES.footprints.id, {
      $select: 'bin,the_geom,height_roof,ground_elevation,construction_year,feature_code,last_status_type,shape_area',
      $where: withinBox('the_geom'), $order: 'bin', $limit: String(page), $offset: String(offset),
    }));
    const batch = JSON.parse(text); rows.push(...batch);
    if (batch.length < page) break;
  }
  await writeFile(new URL('footprints.json', cache), JSON.stringify(rows));
  console.log(`footprints: ${rows.length} features`);
}

// 2. Street centerlines.
if (!(await fresh('centerlines.json'))) {
  console.log('centerlines');
  const text = await download(soda(SOURCES.centerlines.id, { $where: withinBox('the_geom'), $order: 'physicalid', $limit: '50000' }));
  const rows = JSON.parse(text);
  await writeFile(new URL('centerlines.json', cache), JSON.stringify(rows));
  console.log(`centerlines: ${rows.length} segments`);
}

// 3. Borough polygons (the land mask on the New York side).
if (!(await fresh('boroughs.json'))) {
  const rows = [];
  for (const borocode of [1, 2, 3, 4]) {
    console.log(`borough ${borocode}`);
    const text = await download(soda(SOURCES.boroughs.id, { borocode: String(borocode) }));
    rows.push(...JSON.parse(text));
  }
  await writeFile(new URL('boroughs.json', cache), JSON.stringify(rows));
  console.log(`boroughs: ${rows.map(r => r.boroname).join(', ')}`);
}

// 4. Bare-earth elevation sampled on the terrain grid (one pixel per node).
if (!(await fresh('dem.tif'))) {
  const { nx, nz } = TERRAIN_BOUNDS;
  console.log(`elevation ${nx}×${nz}`);
  const params = new URLSearchParams({
    bbox: `${BOX.west},${BOX.south},${BOX.east},${BOX.north}`, bboxSR: '4326', imageSR: '4326',
    size: `${nx},${nz}`, format: 'tiff', pixelType: 'F32', noData: '-9999', interpolation: 'RSP_BilinearInterpolation', f: 'image',
  });
  const bytes = await download(`${SOURCES.elevation.url}/exportImage?${params}`, { binary: true });
  if (bytes.length < 1000 || !(bytes[0] === 0x49 && bytes[1] === 0x49)) throw new Error('Elevation export is not a little-endian TIFF: ' + bytes.slice(0, 200).toString());
  await writeFile(new URL('dem.tif', cache), bytes);
  console.log(`elevation: ${bytes.length} bytes`);
}

const manifest = { fetchedAt: new Date().toISOString(), box: BOX, grid: TERRAIN_BOUNDS, sources: SOURCES };
await writeFile(new URL('fetch-manifest.json', cache), JSON.stringify(manifest, null, 2));

// 5. The kit's input (world-kit/README.md): the same features, normalised.
{
  const FT = 0.3048;
  const [footprints, centerlines, boroughs, demBytes] = await Promise.all([
    readFile(new URL('footprints.json', cache), 'utf8').then(JSON.parse),
    readFile(new URL('centerlines.json', cache), 'utf8').then(JSON.parse),
    readFile(new URL('boroughs.json', cache), 'utf8').then(JSON.parse),
    readFile(new URL('dem.tif', cache)),
  ]);
  const buildings = [];
  for (const row of footprints) for (const polygon of row.the_geom.coordinates) {
    const heightFeet = Number(row.height_roof);
    buildings.push({ id: String(row.bin), rings: polygon, height: heightFeet > 0 ? heightFeet * FT : null, levels: null,
      year: Number(row.construction_year) || null, kind: String(row.feature_code || '') });
  }
  const roads = [];
  centerlines.forEach((row, i) => {
    const widthFeet = Number(row.streetwidth);
    for (const line of row.the_geom.coordinates) roads.push({ id: String(row.physicalid || row.objectid || i), points: line, kind: String(row.rw_type),
      width: widthFeet > 0 ? widthFeet * FT : null, lanes: Number(row.number_total_lanes) || null, tunnel: row.rw_type === '4', bridge: row.rw_type === '3' });
  });
  const land = [];
  for (const borough of boroughs) for (const polygon of borough.the_geom.coordinates) land.push({ rings: polygon });
  const dem = readTiff(demBytes);
  const terrain = { kind: 'grid', west: BOX.west, north: BOX.north, east: BOX.east, south: BOX.south, nx: dem.width, ny: dem.height,
    heights: Array.from(dem.data, v => (v < -1000 ? null : Math.round(v * 1000) / 1000)) };
  const world = { fetchedAt: manifest.fetchedAt, sources: Object.values(SOURCES), buildings, roads, water: [], land, terrain };
  await writeFile(new URL('world-data.json', cache), JSON.stringify(world));
  console.log(`world-data.json: ${buildings.length} buildings, ${roads.length} road polylines, ${land.length} land polygons, ${dem.width}×${dem.height} terrain`);
}
console.log('done');

// Little-endian TIFF, uncompressed 32-bit float, tiled or stripped — what the
// USGS ImageServer export returns.
function readTiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x49 || bytes[1] !== 0x49 || view.getUint16(2, true) !== 42) throw new Error('Expected a little-endian classic TIFF');
  const ifd = view.getUint32(4, true), count = view.getUint16(ifd, true), tags = new Map();
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12, tag = view.getUint16(entry, true), type = view.getUint16(entry + 2, true), n = view.getUint32(entry + 4, true);
    const size = sizes[type] || 1, offset = n * size <= 4 ? entry + 8 : view.getUint32(entry + 8, true), values = [];
    for (let k = 0; k < n; k += 1) {
      const at = offset + k * size;
      values.push(type === 3 ? view.getUint16(at, true) : type === 4 ? view.getUint32(at, true) : type === 11 ? view.getFloat32(at, true) : type === 12 ? view.getFloat64(at, true) : bytes[at]);
    }
    tags.set(tag, values);
  }
  const width = tags.get(256)[0], height = tags.get(257)[0];
  if ((tags.get(259) || [1])[0] !== 1 || tags.get(258)[0] !== 32 || (tags.get(339) || [3])[0] !== 3) throw new Error('Elevation TIFF must be uncompressed 32-bit float');
  const data = new Float32Array(width * height);
  if (tags.has(324)) {
    const tw = tags.get(322)[0], th = tags.get(323)[0], offsets = tags.get(324), across = Math.ceil(width / tw);
    offsets.forEach((offset, t) => {
      const tx = t % across, ty = Math.floor(t / across);
      for (let y = 0; y < th; y += 1) for (let x = 0; x < tw; x += 1) {
        const X = tx * tw + x, Y = ty * th + y;
        if (X < width && Y < height) data[Y * width + X] = view.getFloat32(offset + (y * tw + x) * 4, true);
      }
    });
  } else {
    const rows = (tags.get(278) || [height])[0], offsets = tags.get(273);
    offsets.forEach((offset, s) => {
      for (let y = 0; y < rows; y += 1) for (let x = 0; x < width; x += 1) {
        const Y = s * rows + y;
        if (Y < height) data[Y * width + x] = view.getFloat32(offset + (y * width + x) * 4, true);
      }
    });
  }
  return { width, height, data };
}
