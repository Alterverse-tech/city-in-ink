// Manhattan Midtown — a parallel world in the same ink, built as its own game.
//
//   npm run build:manhattan   →  dist-manhattan/   (serve it with any static server)
//
// The San Francisco game is the base: its renderer, shaders, palettes, flight
// model and the Tech Week layer are reused byte for byte through the shared
// build pipeline (renderGame + streaming). What changes is the world: the city
// resources come from manhattan/city/ (generate-city.mjs), the projection
// origin, landmarks, camera views, tour, spawn, texts and the Tech Week places
// are swapped with exact-match patches that fail loudly if the base moves.
// Nothing here touches dist/, dist-local/ or the SF source parts.
//
// Multiplayer is left out: the presence room is bound to the SF Chrona World,
// and a second World for this city has to be registered first (README).
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderGame } from '../build.mjs';
import { wireStartup } from '../startup-build.mjs';
import { writeCityAssets } from '../city-assets-build.mjs';
import { splitStreamingCityAssets, wireCityStreaming, writeCityPreload } from '../city-streaming-build.mjs';
import { ORIGIN, LANDMARKS, WORLD, TERRAIN_BOUNDS } from './config.mjs';

const root = new URL('../', import.meta.url), here = new URL('./', import.meta.url), dist = new URL('../dist-manhattan/', import.meta.url);
export const WORLD_NAME = 'TECH WEEK CITY · MANHATTAN';
const json = value => JSON.stringify(value);

function once(html, from, to, label = from.slice(0, 70)) {
  if (html.split(from).length !== 2) throw new Error('Manhattan patch target changed: ' + label);
  return html.replace(from, to);
}
function every(html, from, to, minimum, label = from.slice(0, 70)) {
  const count = html.split(from).length - 1;
  if (count < minimum) throw new Error(`Manhattan patch target changed (${count} < ${minimum}): ` + label);
  return html.replaceAll(from, to);
}
// Replace the object literal that starts right after `start` (brace-matched,
// string-aware), e.g. the landmark table `var ha={…}`.
function replaceLiteral(html, start, literal) {
  const at = html.indexOf(start);
  if (at < 0 || html.indexOf(start, at + 1) >= 0 || !start.endsWith('{')) throw new Error('Manhattan literal target changed: ' + start);
  let depth = 0, quote = null, i = at + start.length - 1;
  for (; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) break;
  }
  if (depth !== 0) throw new Error('Manhattan literal is unbalanced: ' + start);
  return html.slice(0, at) + start.slice(0, -1) + literal + html.slice(i + 1);
}

/* ------------------------------------------------------------ the original */

export async function readOriginal() {
  const manifest = JSON.parse(await readFile(new URL('./source/manifest.json', root), 'utf8'));
  const original = (await Promise.all(manifest.parts.map(part => readFile(new URL('./source/' + part, root), 'utf8')))).join('');
  if (createHash('sha256').update(original).digest('hex') !== manifest.sha256) throw new Error('Source bytes changed. Run `node build-hosted.mjs --accept-source-update` first to refresh the manifest.');
  return original;
}

/* ------------------------------------------------------------ the city */

// The generated resources, in the shape the original inline map has: gzip +
// base64 keyed by the /data/ path the engine fetches.
export async function readCityAssets() {
  const index = JSON.parse(await readFile(new URL('./city/index.json', here), 'utf8'));
  const map = {};
  for (const [path, entry] of Object.entries(index.files)) map[path] = (await readFile(new URL('./city/' + entry.file, here))).toString('base64');
  if (!map['/data/city-manifest.json']) throw new Error('manhattan/city is missing city-manifest.json — run node manhattan/generate-city.mjs');
  return map;
}
export function wireCityAssets(html, assets) {
  const open = '<script id="sf-city-assets" type="application/json">';
  const start = html.indexOf(open), end = html.indexOf('</script>', start);
  if (start < 0 || end < 0 || html.split(open).length !== 2) throw new Error('City asset map not found');
  return html.slice(0, start + open.length) + JSON.stringify(assets) + html.slice(end);
}

/* ------------------------------------------------------------ the world (before the shared pipeline) */

const VIEWS = [
  { id: 'overview', short: 'Overview', name: 'Manhattan', fact: 'Midtown Manhattan between the Hudson and the East River, mapped to real geographic coordinates.' },
  { id: 'downtown', short: 'Midtown', name: 'Midtown', fact: 'Nearly 20,000 surveyed NYC footprints with their roof heights, courtyards and the setbacks the 1916 zoning gave the towers.' },
  { id: 'empire_state', short: 'Empire State', name: 'Empire State Building', fact: 'A 381 m Art Deco tower from 1931, 443 m to the tip of its mast — the skyline’s anchor for ninety years.' },
  { id: 'chrysler', short: 'Chrysler', name: 'Chrysler Building', fact: 'A 319 m crown of stainless-steel arches and a spire, finished in 1930.' },
  { id: 'one_vanderbilt', short: 'One Vanderbilt', name: 'One Vanderbilt', fact: 'A 427 m tapered tower beside Grand Central, opened in 2020.' },
  { id: 'rockefeller', short: '30 Rock', name: '30 Rockefeller Plaza', fact: 'The 259 m slab at the heart of Rockefeller Center, stepped back in limestone.' },
  { id: 'hudson_yards', short: 'Hudson Yards', name: '30 Hudson Yards', fact: 'A 387 m tower over the rail yards on the far West Side, with the city’s highest outdoor deck.' },
  { id: 'central_park_tower', short: 'Central Park Tower', name: 'Central Park Tower', fact: 'At 472 m the tallest residential building in the world, on Billionaires’ Row.' },
  { id: 'flatiron', short: 'Flatiron', name: 'Flatiron Building', fact: 'The 87 m wedge at Fifth Avenue and Broadway, 1902.' },
];
const LABELS = ['empire_state', 'chrysler', 'one_vanderbilt', 'rockefeller', 'hudson_yards', 'central_park_tower', 'flatiron', 'grand_central', 'times_square', 'bryant_park', 'central_park', 'msg', 'united_nations', 'nypl', 'bank_of_america', 'steinway', 'park_432'];

function landmarkTable() {
  const table = {};
  for (const [id, l] of Object.entries(LANDMARKS)) table[id] = { id, label: l.label, latitude: l.latitude, longitude: l.longitude, heightMeters: l.heightMeters, headingDegrees: 0, sourceUrls: [] };
  return table;
}
const NEIGHBORHOOD_LINES = `    ['Financial District', 37.7946, -122.3999], ['Embarcadero', 37.7993, -122.3977], ['Jackson Square', 37.7969, -122.4023],
    ['SoMa', 37.7785, -122.4056], ['Mission Bay', 37.7708, -122.3917], ['Dogpatch', 37.7590, -122.3880],
    ['Mission', 37.7599, -122.4148], ['Hayes Valley', 37.7759, -122.4245], ['Civic Center', 37.7793, -122.4193],
    ['Nob Hill', 37.7930, -122.4161], ['Chinatown', 37.7941, -122.4078], ['North Beach', 37.8060, -122.4103],
    ['Russian Hill', 37.8014, -122.4189], ['Marina', 37.8030, -122.4360], ['Presidio', 37.7989, -122.4662], ['Potrero Hill', 37.7605, -122.4005],
`;

export function wireWorld(html) {
  const layerAt = html.indexOf('<script id="tw-layer">');
  if (layerAt < 0) throw new Error('Tech Week layer not found');
  let base = html.slice(0, layerAt), layer = html.slice(layerAt);

  // ---- projection, landmarks, labels, views -------------------------------
  base = once(base, 's0={lon:-122.4205,lat:37.7955}', `s0={lon:${ORIGIN.lon},lat:${ORIGIN.lat}}`);
  base = replaceLiteral(base, 'var ha={', json(landmarkTable()));
  base = replaceLiteral(base, 'var D3={', json(Object.fromEntries(Object.keys(LANDMARKS).map(id => [id, id]))));
  // Every tower stands in the surveyed footprints already; no procedural
  // landmark models and no bridge. Labels still hang over the named places.
  base = once(base,
    'buildLandmarks(){let e=Object.fromEntries(Object.entries(ha).map(([s,r])=>[s,this.sampleTerrain(r.longitude,r.latitude)])),a=window.innerWidth<850?"medium":"high",n=b1({project:Hn,materialFactory:s=>this.createSolidMaterial(s.role,s.color,s),detail:a,elevations:e});n.name="Landmark architecture",this.scene.add(n);let i=T1(Hn,(s,r)=>this.createSolidMaterial(s,r.defaultColor),window.innerWidth<850?"low":"medium");this.scene.add(i),this.createLandmarkLabels(e)}',
    'buildLandmarks(){let e=Object.fromEntries(Object.entries(ha).map(([s,r])=>[s,this.sampleTerrain(r.longitude,r.latitude)]));this.createLandmarkLabels(e)}', 'buildLandmarks');
  base = once(base,
    'createLandmarkLabels(e){let a=[{id:"salesforce_tower",landmark:"salesforce_tower"},{id:"transamerica_pyramid",landmark:"transamerica_pyramid"},{id:"ferry_building",landmark:"ferry_building"},{id:"coit_tower",landmark:"coit_tower"},{id:"city_hall",landmark:"city_hall"}];',
    `createLandmarkLabels(e){let a=${json(LABELS.map(id => ({ id, landmark: id })))};`, 'createLandmarkLabels');
  base = once(base,
    '}let n=document.createElement("div");n.className="world-label bridge-label",n.textContent="Golden Gate Bridge",this.labelLayer.appendChild(n),this.labels.push({element:n,point:Hn(-122.47854,37.81975,245),id:"golden_gate"})}',
    '}}', 'Golden Gate label');
  const v = WORLD.downtownView;
  base = once(base,
    'if(e==="overview")return{position:new C(-2200,2300,8200),target:new C(-1500,105,-700)};if(e==="downtown"){let n=Hn(-122.3986,37.7919,120);return{position:n.clone().add(new C(-1350,620,1600)),target:n}}if(e==="golden_gate"){let n=Hn(-122.47854,37.81975,86);return{position:n.clone().add(new C(-1280,520,1560)),target:n}}',
    `if(e==="overview")return{position:new C(-1500,1900,4900),target:new C(0,120,-500)};if(e==="downtown"){let n=Hn(${v.lng},${v.lat},${v.y});return{position:n.clone().add(new C(-1100,560,1500)),target:n}}`, 'viewPose');
  base = once(base,
    `  nodes.push({ id: 'overview', position: new C(-2800, 1650, 5200), target: new C(-800, 130, -600) });
  pass('city_hall', [-650, 530, 850]);
  pass('city_hall', [700, 490, 420]);
  pass('downtown', [-1150, 600, 1300]);
  pass('salesforce_tower', [740, 400, 650]);
  pass('salesforce_tower', [760, 400, -430]);
  pass('ferry_building', [800, 490, 530]);
  pass('ferry_building', [850, 500, -460]);
  pass('transamerica_pyramid', [700, 460, -480]);
  pass('transamerica_pyramid', [-680, 460, -570]);
  pass('coit_tower', [670, 500, -460]);
  pass('coit_tower', [-700, 540, -750]);
  pass('golden_gate', [1600, 650, 1450]);
  pass('golden_gate', [1050, 460, -1250]);
  nodes.push({ id: 'overview', position: new C(-6300, 1250, -650), target: new C(-1900, 130, -900) });
  nodes.push({ id: 'overview', position: new C(-5200, 1600, 3400), target: new C(-1000, 130, -500) });`,
    `  nodes.push({ id: 'overview', position: new C(-1700, 1500, 4600), target: new C(-200, 130, -400) });
  pass('flatiron', [-520, 420, 640]);
  pass('empire_state', [900, 560, 700]);
  pass('empire_state', [-820, 520, -480]);
  pass('downtown', [-1150, 600, 1300]);
  pass('one_vanderbilt', [700, 620, 560]);
  pass('chrysler', [640, 460, -520]);
  pass('rockefeller', [-700, 500, 520]);
  pass('central_park_tower', [-760, 640, 900]);
  pass('central_park', [300, 700, 1500]);
  pass('hudson_yards', [-1100, 600, 500]);
  pass('hudson_yards', [900, 520, -700]);
  nodes.push({ id: 'overview', position: new C(-4600, 1300, 700), target: new C(-600, 130, -200) });
  nodes.push({ id: 'overview', position: new C(-3200, 1500, 3600), target: new C(-300, 130, -300) });`, 'cinematic tour');
  const viewsStart = base.indexOf('lr=[{id:"overview"'), viewsEnd = base.indexOf('],V3=[', viewsStart);
  if (viewsStart < 0 || viewsEnd < 0) throw new Error('Manhattan patch target changed: view list');
  base = base.slice(0, viewsStart) + 'lr=' + json(VIEWS) + base.slice(viewsEnd + 1);

  // ---- where flight begins, where the water is, how far the map goes -------
  const sp = WORLD.spawn;
  base = once(base, 'let a=-122.4014,n=37.7921,i=this.sampleTerrain(a,n);', `let a=${sp.lng},n=${sp.lat},i=this.sampleTerrain(a,n);`);
  base = once(base, 'this.flightCharacter.position.copy(Hn(-122.3900, 37.8005, 185));', `this.flightCharacter.position.copy(Hn(${sp.lng}, ${sp.lat}, 260));`);
  base = once(base, 'x.position.set(-1600,.7,-1200),x.name="San Francisco Bay"', 'x.position.set(0,.7,0),x.name="Hudson and East River"');
  const b = TERRAIN_BOUNDS, m = 150;
  base = once(base, 'p.x = We.clamp(p.x, -6600, 5100); p.z = We.clamp(p.z, -5600, 5400);',
    `p.x = We.clamp(p.x, ${Math.round(b.minX + m)}, ${Math.round(b.maxX - m)}); p.z = We.clamp(p.z, ${Math.round(b.minZ + m)}, ${Math.round(b.maxZ - m)});`);

  // ---- words -----------------------------------------------------------
  base = once(base, '"aria-label":"3D San Francisco cityscape"', '"aria-label":"3D Manhattan cityscape"');
  base = once(base, '"A 3D San Francisco built with open data"', '"A 3D Manhattan built with open data"');
  base = once(base, 'message:"Raising 27,000 buildings"', 'message:"Raising 20,000 buildings"');
  base = once(base, 'children:"37.7955\\xB0 N"}),(0,G.jsx)("span",{children:"122.4205\\xB0 W"})', 'children:"40.7550\\xB0 N"}),(0,G.jsx)("span",{children:"73.9855\\xB0 W"})', 'data note');
  base = once(base, 'children:"Building footprints, elevations, roads and coastlines come from San Francisco open data. Over 13,000 downtown footprints retain source coordinates and courtyard boundaries. Major landmarks use public architectural references. Facade colors and window patterns are illustrative. Two-tone shading, fine ink lines and distance fog keep the city in its Sable-inspired palette."',
    'children:"Building footprints, roof heights, streets and the shoreline come from NYC Open Data; the ground is USGS 3DEP elevation. Nearly 20,000 Midtown footprints keep their surveyed coordinates and courtyards. Setbacks on the towers follow a seeded rule and the published massing of the named landmarks. Facade colors and window patterns are illustrative. Two-tone shading, fine ink lines and distance fog keep the city in its Sable-inspired palette."', 'data portrait');
  base = once(base, '(0,G.jsx)("dd",{children:E.stats?.buildings.toLocaleString("en-US")??"27,000+"})', '(0,G.jsx)("dd",{children:E.stats?.buildings.toLocaleString("en-US")??"20,000"})');
  base = once(base, '(0,G.jsx)("dd",{children:E.stats?.streets.toLocaleString("en-US")??"4,427"})', '(0,G.jsx)("dd",{children:E.stats?.streets.toLocaleString("en-US")??"4,500"})');
  base = once(base, '(0,G.jsx)("dd",{children:"12 + GGB"})', `(0,G.jsx)("dd",{children:"${Object.values(LANDMARKS).filter(l => !l.place).length} towers"})`);
  const sourcesStart = base.indexOf('(0,G.jsxs)("div",{className:"source-list",children:['), sourcesEnd = base.indexOf(']}),(0,G.jsx)("small",{children:"A visual reconstruction', sourcesStart);
  if (sourcesStart < 0 || sourcesEnd < 0) throw new Error('Manhattan patch target changed: source list');
  const link = (href, text) => `(0,G.jsx)("a",{href:${json(href)},target:"_blank",rel:"noreferrer",children:${json(text)}})`;
  base = base.slice(0, sourcesStart) + '(0,G.jsxs)("div",{className:"source-list",children:[' + [
    link('https://data.cityofnewyork.us/d/5zhs-2jue', 'NYC Open Data · Building Footprints'),
    link('https://data.cityofnewyork.us/d/inkn-q76z', 'NYC Open Data · Street Centerlines'),
    link('https://data.cityofnewyork.us/d/gthc-hcne', 'NYC Open Data · Borough Boundaries'),
    link('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer', 'USGS 3DEP · Elevation'),
  ].join(',') + base.slice(sourcesEnd);
  base = once(base, '"Ride the wind over San Francisco."', '"Ride the wind over Manhattan."');
  base = once(base, 'coordinateSystem:"local metres; origin near Civic Center; x east, y up, z south"', 'coordinateSystem:"local metres; origin at Bryant Park; x east, y up, z south"');
  // The address box searched DataSF; there is no equivalent wired for New York.
  base = once(base, '</head>', '  <style>.address-search{display:none !important}</style>\n</head>');

  // ---- the Tech Week layer: its places in this city ------------------------
  layer = once(layer, `    tz: 'America/Los_Angeles',
    week: { start: '2026-10-05', days: 7, label: 'OCT 5–11, 2026' },
    harbor: { lat: 37.8036, lng: -122.3828 },                // holding pattern over the bay for address-less events
    mast: { lat: 37.7951, lng: -122.3957 },                  // leaderboard mast, Embarcadero Plaza
    flagship: { lat: 37.7955, lng: -122.3937, y: 268 },      // week banner over the Ferry Building
    spawn: { lat: 37.7975, lng: -122.3925, heading: -0.5 },  // where a new bird enters the city (Embarcadero, facing downtown)`,
    `    tz: ${json(WORLD.timeZone)},
    week: { start: '2026-10-05', days: 7, label: 'OCT 5–11, 2026' },
    harbor: ${json(WORLD.harbor)},                // holding pattern over the East River for address-less events
    mast: ${json(WORLD.mast)},                  // leaderboard mast in Bryant Park
    flagship: ${json(WORLD.flagship)},      // week banner above the Empire State Building
    spawn: ${json(WORLD.spawn)},  // where a new bird enters the city (Bryant Park, facing the Empire State)`, 'CFG places');
  layer = once(layer, NEIGHBORHOOD_LINES, WORLD.neighborhoods.map(([name, lat, lng]) => `    [${json(name)}, ${lat}, ${lng}],`).join('\n') + '\n', 'NEIGHBORHOODS');
  layer = every(layer, '-07:00', '-04:00', 4, 'Pacific offsets');
  layer = once(layer, 'A16Z TECH WEEK · SAN FRANCISCO · ${CFG.week.label}', 'TECH WEEK CITY · MANHATTAN · ${CFG.week.label}');
  layer = once(layer, "host: 'Someone in SF'", "host: 'Someone in NYC'");
  layer = once(layer, "`${ev.address}, San Francisco, CA` : `${ev.lat},${ev.lng}`", "`${ev.address}, New York, NY` : `${ev.lat},${ev.lng}`", 'directions link');
  layer = once(layer, 'Any San Francisco street address (DataSF resolves it), a neighborhood name, or', 'Any Manhattan street address, a neighborhood name, or', 'claim dialog');
  layer = once(layer, "host: 'Tech Week by a16z', cohosts: ['every host in this city'], speakers: [], start: '2026-10-05T09:00:00-04:00', category: 'founders', venue: 'Ferry Building', address: 'Embarcadero'",
    "host: 'Tech Week City', cohosts: ['every host in this city'], speakers: [], start: '2026-10-05T09:00:00-04:00', category: 'founders', venue: 'Empire State Building', address: 'Fifth Avenue'", 'flagship');
  layer = once(layer, "g.fillText('SF TECH WEEK ’26', W - 32, band / 2);", "g.fillText('TECH WEEK CITY ’26', W - 32, band / 2);", 'poster header');
  // The birds are the same six models; only their names and stories move east.
  for (const [from, to] of [
    ["name: 'Western Gull',", "name: 'Herring Gull',"],
    ["'The native. Steady, unbothered, everywhere.'", "'The native. Steady, unbothered, everywhere from the piers to the park.'"],
    ["'Big wings, slow flaps. Looks great over the piers.'", "'Big wings, slow flaps. A summer visitor to the harbour.'"],
    ["'Ink on ink. The Sutro Tower crowd.'", "'Ink on ink. Nests on the bridges these days.'"],
    ["name: 'Anna’s Hummingbird',", "name: 'Ruby-throated Hummingbird',"],
    ["'Nests on the PG&E building downtown. Naturally.'", "'Nests on the MetLife Building. Naturally.'"],
    ["name: 'Telegraph Hill Parrot', cn: '电报山鹦鹉',", "name: 'Monk Parakeet', cn: '和尚鹦鹉',"],
    ["'The cherry-headed conure. Loud, local, beloved.'", "'The Brooklyn parakeet. Loud, local, beloved.'"],
  ]) layer = once(layer, from, to);
  return base + layer;
}

/* ------------------------------------------------------------ after the shared pipeline */

export function wireSeed(html, seed) {
  const open = '<script id="tw-events-seed" type="application/json">';
  if (html.split(open).length !== 2) throw new Error('Event seed script must occur exactly once');
  const start = html.indexOf(open) + open.length, end = html.indexOf('</script>', start);
  const text = JSON.stringify(seed).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return html.slice(0, start) + text + html.slice(end);
}

export function wireAfter(html) {
  html = once(html, '<title>SF TECH WEEK CITY · every event is an airship</title>', `<title>${WORLD_NAME} · every event is an airship</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Tech Week City, Manhattan: an ink-drawn Midtown where every event is an airship over its venue. Fly your bird between the towers.">');
  html = once(html, '<h1 class="tw-name"><span>SF TECH WEEK CITY</span>', `<h1 class="tw-name"><span>${WORLD_NAME}</span>`);
  html = once(html, '(0,G.jsx)("span",{children:"SAN FRANCISCO"}),(0,G.jsx)("small",{children:"SF TECH WEEK CITY"})', '(0,G.jsx)("span",{children:"MANHATTAN"}),(0,G.jsx)("small",{children:"TECH WEEK CITY"})', 'loading overlay');
  html = once(html, "title: 'SF Tech Week 2026 — SF Tech Week City'", "title: 'Tech Week City — Manhattan'");
  html = once(html, "'PRODID:-//SF Tech Week City//EN'", "'PRODID:-//Tech Week City Manhattan//EN'");
  html = once(html, '<span class="tw-boot-name">SF TECH WEEK CITY</span>', `<span class="tw-boot-name">${WORLD_NAME}</span>`);
  html = once(html, 'Loading San Francisco', 'Loading Manhattan');
  html = once(html, "    featured: { lat: 37.7969, lng: -122.3931, y: 196 },      // the host's own event, parked over the spawn point",
    `    featured: ${json(WORLD.featured)},      // the host's own event, parked over the spawn point`, 'CFG.featured');
  html = once(html, "    core: { lat: 37.7915, lng: -122.4005 },                  // downtown: where ships with no address of their own fly",
    `    core: ${json({ lat: WORLD.core.lat, lng: WORLD.core.lng })},                  // Midtown: where ships with no address of their own fly`, 'CFG.core');
  html = once(html, '<i></i><span>Oct 5–11 · San Francisco</span><b>SF Tech Week 2026</b>', '<i></i><span>Oct 5–11 · Manhattan</span><b>Tech Week City</b>');
  html = once(html, "(ev.neighborhood || 'FiDi') + ' · venue soon'", "(ev.neighborhood || 'Midtown') + ' · venue soon'");
  html = once(html, "'San Francisco Tech Week'", "'New York Tech Week'");
  const b = TERRAIN_BOUNDS, m = 150;
  html = once(html, 'if (horizontal && (p.x <= -6599 || p.x >= 5099 || p.z <= -5599 || p.z >= 5399)) {',
    `if (horizontal && (p.x <= ${Math.round(b.minX + m) + 1} || p.x >= ${Math.round(b.maxX - m) - 1} || p.z <= ${Math.round(b.minZ + m) + 1} || p.z >= ${Math.round(b.maxZ - m) - 1})) {`, 'flight fence');
  html = once(html, 'import "./multiplayer.js";\n', '');
  html = once(html, '  <link rel="stylesheet" href="./multiplayer.css">\n', '');
  return html;
}

/* ------------------------------------------------------------ the add-ons, copied with their places moved */

const ADDON_PATCHES = {
  'city-streaming.js': [["water.position.set(-1600,.7,-1200);water.name='San Francisco Bay';", "water.position.set(0,.7,0);water.name='Hudson and East River';"]],
  'city-time.mjs': [
    ["export const SF_TIME_ZONE = 'America/Los_Angeles';", `export const SF_TIME_ZONE = ${json(WORLD.timeZone)};`],
    ["// The city's authored palettes follow San Francisco's wall clock, including", "// The city's authored palettes follow New York's wall clock, including"],
  ],
  'city-extras.mjs': [
    ['const DOWNTOWN = { lat: 37.7915, lng: -122.4005, radius: 620 };  // Financial District / Downtown core', `const DOWNTOWN = ${json(WORLD.core)};  // Midtown core`],
    ["timeZone: 'America/Los_Angeles'", `timeZone: ${json(WORLD.timeZone)}`],
  ],
  'events-sync.js': [
    // Districts an event may name instead of an address.
    [`  'fidi': { lat: 37.7937, lng: -122.4008 },
  'financial district': { lat: 37.7937, lng: -122.4008 },
  'downtown': { lat: 37.79, lng: -122.4025 },
  'downtown sf': { lat: 37.79, lng: -122.4025 },
  'soma': { lat: 37.7838, lng: -122.4011 },
  'south of market': { lat: 37.7838, lng: -122.4011 },
  'mission': { lat: 37.7596, lng: -122.4148 },
  'mission bay': { lat: 37.7706, lng: -122.3912 },
  'dogpatch': { lat: 37.7590, lng: -122.3919 },
  'nob hill': { lat: 37.7930, lng: -122.4160 },
  'embarcadero': { lat: 37.7951, lng: -122.3935 },
  'jackson square': { lat: 37.7963, lng: -122.3991 },
  'hayes valley': { lat: 37.7767, lng: -122.4292 },
  'civic center': { lat: 37.7786, lng: -122.4156 },
  'golden gate park': { lat: 37.7690, lng: -122.4827 },
  'fi di': { lat: 37.7937, lng: -122.4008 }
`, WORLD.neighborhoods.map(([name, lat, lng]) => `  ${json(name.toLowerCase())}: { lat: ${lat}, lng: ${lng} }`).join(',\n') + '\n'],
    // No saved Tech Week snapshot exists for this city: the seed is the programme
    // until /events.json answers.
    ['async function readBaseline() {\n  try {', 'async function readBaseline() {\n  return null;\n  try {'],
    ['async function readSaved() {\n  const load', 'async function readSaved() {\n  return null;\n  const load'],
  ],
};
async function copyAddon(name) {
  let text = await readFile(new URL('./' + name, root), 'utf8');
  for (const [from, to] of ADDON_PATCHES[name] || []) text = once(text, from, to, `${name}: ${from.slice(0, 50)}`);
  await writeFile(new URL('./' + name, dist), text);
}

/* ------------------------------------------------------------ build */

export async function build() {
  const original = await readOriginal();
  const world = wireWorld(wireCityAssets(original, await readCityAssets()));
  const cityAssets = splitStreamingCityAssets(world, { centre: { lon: WORLD.core.lng, lat: WORLD.core.lat } });
  const seed = JSON.parse(await readFile(new URL('./seed-events.json', here), 'utf8'));
  const html = wireAfter(wireSeed(wireStartup(wireCityStreaming(renderGame(cityAssets.html))), seed));
  await rm(dist, { recursive: true, force: true });
  await mkdir(new URL('./data/', dist), { recursive: true });
  await writeFile(new URL('./index.html', dist), html);
  await writeCityAssets(cityAssets.files, dist);
  for (const name of ['city-time.mjs', 'event-card.mjs', 'city-streaming.js', 'events-sync.js', 'events-sync.css', 'gull-cluster-route.mjs', 'city-extras.mjs']) await copyAddon(name);
  // The runtime reads the curated venue list from data/; this world has none yet.
  await writeFile(new URL('./data/venue-overrides.json', dist), JSON.stringify({ addresses: [], events: [] }) + '\n');
  await cp(new URL('./README.md', here), new URL('./README.md', dist)).catch(() => {});
  await writeCityPreload(cityAssets, dist);
  return { tiles: cityAssets.tiles.length, assets: cityAssets.files.size, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const result = await build();
  console.log(`Manhattan world ready in dist-manhattan/ — index.html ${(result.bytes / 1048576).toFixed(2)} MB, ${result.assets} city files (${result.tiles} building tiles). Serve the directory with any static server.`);
}
