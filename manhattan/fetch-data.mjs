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
console.log('done');
