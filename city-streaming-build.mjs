import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { splitCityAssets } from './city-assets-build.mjs';

const MAP = /<script id="sf-city-assets" type="application\/json">([\s\S]*?)<\/script>/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const BUILDING_PATHS = ['position.f32','normal.i8','tone.u8','index.u32','facade.u16'].map(name => '/data/buildings-refined-' + name);
const TILE_METRES = 640;
const MAX_TRIANGLES = 18000;

// Partition by triangle centroid; retain original vertex attribute bytes and
// triangle winding. Shared edge vertices may be copied into adjacent tiles,
// but no triangle is dropped, simplified, moved, or drawn twice.
export function partitionBuildings(buffers, { tileMetres = TILE_METRES, maxTriangles = MAX_TRIANGLES } = {}) {
  const { position, normal, tone, index, facade } = buffers;
  const positions = new Float32Array(position.buffer, position.byteOffset, position.byteLength / 4);
  const indices = new Uint32Array(index.buffer, index.byteOffset, index.byteLength / 4);
  const vertexCount = position.length / 12;
  if (!Number.isInteger(vertexCount) || normal.length !== vertexCount * 3 || tone.length !== vertexCount || facade.length !== vertexCount * 8 || indices.length % 3) throw new Error('Invalid building attribute lengths');
  const tiles = new Map(), usedVertices = new Uint8Array(vertexCount);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ids = [indices[offset], indices[offset + 1], indices[offset + 2]];
    if (ids.some(id => id >= vertexCount)) throw new Error('Building index out of range');
    for (const id of ids) usedVertices[id] = 1;
    const x = ids.reduce((sum,id) => sum + positions[id * 3], 0) / 3;
    const z = ids.reduce((sum,id) => sum + positions[id * 3 + 2], 0) / 3;
    const key = `${Math.floor(x / tileMetres)},${Math.floor(z / tileMetres)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(offset);
  }
  const chunks = [];
  for (const [key, triangles] of tiles) {
    for (let part = 0; part * maxTriangles < triangles.length; part++) {
      const offsets = triangles.slice(part * maxTriangles, (part + 1) * maxTriangles);
      const originals = [], remap = new Map(), localIndices = new Uint32Array(offsets.length * 3);
      let n = 0;
      for (const offset of offsets) for (let i = 0; i < 3; i++) {
        const original = indices[offset + i];
        if (!remap.has(original)) { remap.set(original, originals.length); originals.push(original); }
        localIndices[n++] = remap.get(original);
      }
      const encoded = Buffer.alloc(localIndices.length * 5);
      let used = 0, previous = 0;
      for (const value of localIndices) {
        const delta = value - previous; previous = value;
        let zigzag = delta >= 0 ? delta * 2 : -delta * 2 - 1;
        while (zigzag >= 128) { encoded[used++] = (zigzag & 127) | 128; zigzag = Math.floor(zigzag / 128); }
        encoded[used++] = zigzag;
      }
      const count = originals.length, bytes = Buffer.alloc(16 + count * 24 + used);
      bytes.writeUInt32LE(0x31434653, 0); bytes.writeUInt32LE(count, 4); bytes.writeUInt32LE(localIndices.length, 8); bytes.writeUInt32LE(used, 12);
      let destination = 16;
      for (const [input, stride] of [[position,12],[normal,3],[tone,1],[facade,8]]) {
        for (const original of originals) { input.copy(bytes, destination, original * stride, (original + 1) * stride); destination += stride; }
      }
      encoded.copy(bytes, destination, 0, used);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const original of originals) { const x=positions[original*3], z=positions[original*3+2]; minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z); }
      const compressed = gzipSync(bytes, { level: 9 });
      chunks.push({ key: `${key}:${part}`, compressed, bounds: { minX,maxX,minZ,maxZ }, vertices: count, triangles: offsets.length, originalOffsets: offsets });
    }
  }
  if (chunks.reduce((n,chunk) => n + chunk.triangles, 0) !== indices.length / 3) throw new Error('Building partition lost triangles');
  // The original roof query also inspected a few unreferenced survey vertices.
  // Retain those points for exact query behavior even though they draw no faces.
  const unused = [];
  for (let id = 0; id < usedVertices.length; id++) if (!usedVertices[id]) unused.push(position.subarray(id*12,(id+1)*12));
  chunks.roofPoints = Buffer.concat(unused);
  return chunks;
}

export function splitStreamingCityAssets(source) {
  const originalAssets = JSON.parse(source.match(MAP)[1]);
  const originalManifest = JSON.parse(gunzipSync(Buffer.from(originalAssets['/data/city-manifest.json'], 'base64')));
  const buffers = Object.fromEntries(BUILDING_PATHS.map(path => [path.split('refined-')[1].split('.')[0], gunzipSync(Buffer.from(originalAssets[path], 'base64'))]));
  const chunks = partitionBuildings(buffers);
  const result = splitCityAssets(source), paths = JSON.parse(result.html.match(MAP)[1]);
  for (const path of [...BUILDING_PATHS, '/data/city-manifest.json']) {
    const entry = paths[path]; result.files.delete((typeof entry === 'string' ? entry : entry.file).slice(2)); delete paths[path];
  }
  const centre = { x: (-122.4005 - originalManifest.origin.lon) * originalManifest.projection.metersLon,
    z: (originalManifest.origin.lat - 37.7915) * originalManifest.projection.metersLat };
  const tiles = chunks.map(chunk => {
    const file = `city-assets/${hash(chunk.compressed)}.bin`; result.files.set(file, chunk.compressed);
    const { minX,maxX,minZ,maxZ } = chunk.bounds;
    const dx = Math.max(minX - centre.x, 0, centre.x - maxX), dz = Math.max(minZ - centre.z, 0, centre.z - maxZ);
    return { id: chunk.key, url: './' + file, bytes: chunk.compressed.length, bounds: chunk.bounds, vertices: chunk.vertices, triangles: chunk.triangles,
      priority: Math.hypot(dx,dz) < 620 ? 'critical' : 'background', distance: Math.hypot((minX+maxX)/2-centre.x,(minZ+maxZ)/2-centre.z) };
  }).sort((a,b) => a.distance - b.distance);
  const cityManifest = structuredClone(originalManifest);
  cityManifest.buildings.tiles = tiles;
  if (chunks.roofPoints.length) {
    const packed = gzipSync(chunks.roofPoints, { level: 9 }), file = `city-assets/${hash(packed)}.bin`;
    result.files.set(file, packed);
    cityManifest.buildings.roofPoints = { url: './' + file, bytes: packed.length };
  }
  cityManifest.buildings.streamingVersion = 1;
  for (const field of ['position','normal','tone','index','facade']) delete cityManifest.buildings[field];
  const compressedManifest = gzipSync(JSON.stringify(cityManifest), { level: 9 });
  const manifestFile = `city-assets/${hash(compressedManifest)}.bin`;
  result.files.set(manifestFile, compressedManifest); paths['/data/city-manifest.json'] = './' + manifestFile;
  result.html = result.html.replace(MAP, `<script id="sf-city-assets" type="application/json">${JSON.stringify(paths)}</script>`);
  const start = result.html.indexOf('async loadCityData(){'), end = result.html.indexOf('createCinematicTour() {', start);
  if (start < 0 || end < 0 || result.html.slice(start,end).length > 5000) throw new Error('Progressive city startup patch changed');
  result.html = result.html.slice(0,start) + 'async loadCityData(){return window.__sfLoadStreamingCity(this)}' + result.html.slice(end);
  const north = 'const buffers = await Promise.all([config.heights,config.landMask,config.position,config.normal,config.tone,config.index].map(url=>this.fetchBuffer(url)));';
  if (result.html.split(north).length !== 2) throw new Error('North shore streaming queue patch changed');
  result.html = result.html.replace(north, 'const buffers = await window.__sfLoadCityBuffers(this,[config.heights,config.landMask,config.position,config.normal,config.tone,config.index]);');
  const marker = '<script>(()=>{var G1=Object.create;';
  // renderGame subsequently converts this exact marker into its module imports.
  if (result.html.split(marker).length !== 2) throw new Error('City streaming import marker changed');
  result.tiles = tiles; result.manifest = cityManifest; result.paths = paths;
  result.assetCount = result.files.size;
  return result;
}

export function wireCityStreaming(html) {
  const marker = 'import "./events-sync.js";';
  if (html.split(marker).length !== 2) throw new Error('City streaming module import changed');
  html = html.replace(marker, 'import "./city-streaming.js";\n' + marker);
  const initialView = '[r,o]=(0,Dt.useState)("overview")';
  if (html.split(initialView).length !== 2) throw new Error('City initial view patch changed');
  html = html.replace(initialView, '[r,o]=(0,Dt.useState)("downtown")');
  const roofStart = html.indexOf('  function roofHeightAt(x, z, radius) {');
  const landmarks = html.indexOf('    for (const lm of Object.values(GEO.ha || {}))', roofStart);
  if (roofStart < 0 || landmarks < 0 || landmarks - roofStart > 2000) throw new Error('City roof query patch changed');
  html = html.slice(0,roofStart) + `  function roofHeightAt(x, z, radius) {
    let meshes = c.streaming?.roofMeshes;
    if (!meshes) { meshes = []; c.scene.traverse(o => { if (o.isMesh && /Refined DataSF footprints/.test(o.name)) meshes.push(o); }); }
    let best = window.__sfRoofHeightAtMeshes(meshes, x, z, radius);
` + html.slice(landmarks);
  const ready = '    state.ready = true;';
  if (html.split(ready).length !== 2) throw new Error('City ready hook changed');
  html = html.replace(ready, `    TW.refreshCityGeometry = () => {
      const previous = new Map(state.events.map(ev => [ev, { roof: ev.roof, shipY: ev.shipY }]));
      placeEvents();
      for (const ev of state.events) {
        const old = previous.get(ev);
        if (!old || old.roof === ev.roof || !ev.onMap) continue;
        if (ev.ship) {
          ev.ship.position.y += ev.shipY - old.shipY;
          ev.ship.userData.baseY = ev.shipY; ev.ship.userData.anchorY = ev.anchorY;
          if (ev.ship.userData.move) ev.ship.userData.move.to.y = ev.shipY;
        }
        if (ev.venueGroup) {
          ev.venueGroup.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
          rebuildVenue(ev);
        }
      }
    };
` + ready);
  return html;
}

// Published URLs are relative to index.html, never relative to this manifest.
// Include only existing output files, so website warmup can validate sizes and
// reuse exactly the same versioned URLs as the game frame.
export async function writeCityPreload(result, directory) {
  const priorities = new Map(result.tiles.map(tile => [tile.url.slice(2), tile.priority]));
  for (const [path,entry] of Object.entries(result.paths)) priorities.set((typeof entry === 'string' ? entry : entry.file).slice(2), path.includes('marin-north') ? 'background' : 'critical');
  if (result.manifest.buildings.roofPoints) priorities.set(result.manifest.buildings.roofPoints.url.slice(2), 'critical');
  const assets = [];
  const walk = async (folder, prefix = '') => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) { await walk(new URL(entry.name + '/', folder), path + '/'); continue; }
      if (path === 'city-assets/preload.json' || path === 'index.html') continue;
      if (!/\.(?:js|mjs|css|bin|json|txt)$/.test(path)) continue;
      const bytes = (await readFile(new URL(entry.name, folder))).length;
      let priority = priorities.get(path) || (path.startsWith('data/') ? 'background' : 'critical');
      if (path === 'data/tech-week-first.json') priority = 'critical';
      assets.push({ url: './' + path, bytes, priority });
    }
  };
  await walk(directory);
  await writeFile(new URL('city-assets/preload.json', directory), JSON.stringify({ version: 1, assets }, null, 2) + '\n');
}
