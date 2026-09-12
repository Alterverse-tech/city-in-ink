// Builds a parallel world as its own game:
//
//   node world-kit/build.mjs <city>   →  dist-<city>/   (serve it with any static server)
//
// The San Francisco game is the base: its renderer, shaders, palettes, flight
// model and the Tech Week layer are reused byte for byte through the shared
// build pipeline (renderGame + streaming). What changes is the world: the city
// resources come from <city>/city/ (generate.mjs), and the projection origin,
// landmarks, camera views, tour, spawn, texts and the Tech Week places are
// swapped with exact-match patches that fail loudly if the base moves.
// Nothing here touches dist/, dist-local/ or the SF source parts.
//
// Multiplayer is left out: the presence room is bound to the SF Chrona World,
// and a World for each city has to be registered first.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { renderGame } from '../build.mjs';
import { wireStartup } from '../startup-build.mjs';
import { writeCityAssets } from '../city-assets-build.mjs';
import { splitStreamingCityAssets, wireCityStreaming, writeCityPreload } from '../city-streaming-build.mjs';

const root = new URL('../', import.meta.url);
const json = value => JSON.stringify(value);
const single = text => String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");   // inside a single-quoted JS literal

// The birds are six models; a world renames them after local species.
const ORIGINAL_BIRDS = {
  gull: { name: 'Western Gull', cn: '海鸥', blurb: 'The native. Steady, unbothered, everywhere.' },
  pelican: { name: 'Brown Pelican', cn: '鹈鹕', blurb: 'Big wings, slow flaps. Looks great over the piers.' },
  raven: { name: 'Common Raven', cn: '渡鸦', blurb: 'Ink on ink. The Sutro Tower crowd.' },
  hummingbird: { name: 'Anna’s Hummingbird', cn: '蜂鸟', blurb: 'Tiny and fast to look at. Same flight model, half the bird.' },
  peregrine: { name: 'Peregrine Falcon', cn: '游隼', blurb: 'Nests on the PG&E building downtown. Naturally.' },
  parrot: { name: 'Telegraph Hill Parrot', cn: '电报山鹦鹉', blurb: 'The cherry-headed conure. Loud, local, beloved.' },
};
const SF_NEIGHBORHOOD_LINES = `    ['Financial District', 37.7946, -122.3999], ['Embarcadero', 37.7993, -122.3977], ['Jackson Square', 37.7969, -122.4023],
    ['SoMa', 37.7785, -122.4056], ['Mission Bay', 37.7708, -122.3917], ['Dogpatch', 37.7590, -122.3880],
    ['Mission', 37.7599, -122.4148], ['Hayes Valley', 37.7759, -122.4245], ['Civic Center', 37.7793, -122.4193],
    ['Nob Hill', 37.7930, -122.4161], ['Chinatown', 37.7941, -122.4078], ['North Beach', 37.8060, -122.4103],
    ['Russian Hill', 37.8014, -122.4189], ['Marina', 37.8030, -122.4360], ['Presidio', 37.7989, -122.4662], ['Potrero Hill', 37.7605, -122.4005],
`;
const SF_SYNC_NEIGHBORHOODS = `  'fidi': { lat: 37.7937, lng: -122.4008 },
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
`;

export async function buildWorld(cityDir) {
  const dir = new URL(cityDir.endsWith('/') ? cityDir : cityDir + '/', pathToFileURL(process.cwd() + '/'));
  const config = await import(new URL('config.mjs', dir).href);
  const { NAME, CITY, ORIGIN, LANDMARKS, WORLD, TERRAIN_BOUNDS, VIEWS, LABELS, CAMERA, PORTRAIT = {}, BIRDS = {}, SOURCES = {} } = config;
  for (const [key, value] of Object.entries({ NAME, CITY, ORIGIN, LANDMARKS, WORLD, TERRAIN_BOUNDS, VIEWS, LABELS, CAMERA })) if (!value) throw new Error(`${cityDir}/config.mjs must export ${key}`);
  const cityName = cityDir.replace(/\/$/, '').split('/').pop();
  const dist = new URL(`../dist-${cityName}/`, import.meta.url);
  const label = CITY.label;

  function once(html, from, to, note = from.slice(0, 70)) {
    if (html.split(from).length !== 2) throw new Error(`${label} patch target changed: ` + note);
    return html.replace(from, to);
  }
  function every(html, from, to, minimum, note = from.slice(0, 70)) {
    const count = html.split(from).length - 1;
    if (count < minimum) throw new Error(`${label} patch target changed (${count} < ${minimum}): ` + note);
    return html.replaceAll(from, to);
  }
  // Replace the object literal that starts right after `start` (brace-matched,
  // string-aware), e.g. the landmark table `var ha={…}`.
  function replaceLiteral(html, start, literal) {
    const at = html.indexOf(start);
    if (at < 0 || html.indexOf(start, at + 1) >= 0 || !start.endsWith('{')) throw new Error(`${label} literal target changed: ` + start);
    let depth = 0, quote = null, i = at + start.length - 1;
    for (; i < html.length; i += 1) {
      const ch = html[i];
      if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}' && --depth === 0) break;
    }
    if (depth !== 0) throw new Error(`${label} literal is unbalanced: ` + start);
    return html.slice(0, at) + start.slice(0, -1) + literal + html.slice(i + 1);
  }

  /* ---- the original ---- */
  const manifest = JSON.parse(await readFile(new URL('./source/manifest.json', root), 'utf8'));
  const original = (await Promise.all(manifest.parts.map(part => readFile(new URL('./source/' + part, root), 'utf8')))).join('');
  if (createHash('sha256').update(original).digest('hex') !== manifest.sha256) throw new Error('Source bytes changed. Run `node build-hosted.mjs --accept-source-update` first to refresh the manifest.');

  /* ---- the city: generated resources in the shape of the original inline map ---- */
  const index = JSON.parse(await readFile(new URL('city/index.json', dir), 'utf8')).files;
  const assets = {};
  for (const [path, entry] of Object.entries(index)) assets[path] = (await readFile(new URL('city/' + entry.file, dir))).toString('base64');
  if (!assets['/data/city-manifest.json']) throw new Error(`${cityDir}/city is missing city-manifest.json — run node world-kit/generate.mjs ${cityName}`);
  const cityManifest = JSON.parse(await readFile(new URL('city/manifest.json', dir), 'utf8'));
  const open = '<script id="sf-city-assets" type="application/json">';
  const mapStart = original.indexOf(open), mapEnd = original.indexOf('</script>', mapStart);
  if (mapStart < 0 || mapEnd < 0 || original.split(open).length !== 2) throw new Error('City asset map not found');
  let html = original.slice(0, mapStart + open.length) + JSON.stringify(assets) + original.slice(mapEnd);

  /* ---- the world, before the shared pipeline ---- */
  const layerAt = html.indexOf('<script id="tw-layer">');
  if (layerAt < 0) throw new Error('Tech Week layer not found');
  let base = html.slice(0, layerAt), layer = html.slice(layerAt);

  const landmarkTable = Object.fromEntries(Object.entries(LANDMARKS).map(([id, l]) => [id, { id, label: l.label, latitude: l.latitude, longitude: l.longitude, heightMeters: l.heightMeters, headingDegrees: 0, sourceUrls: [] }]));
  base = once(base, 's0={lon:-122.4205,lat:37.7955}', `s0={lon:${ORIGIN.lon},lat:${ORIGIN.lat}}`);
  base = replaceLiteral(base, 'var ha={', json(landmarkTable));
  base = replaceLiteral(base, 'var D3={', json(Object.fromEntries(Object.keys(LANDMARKS).map(id => [id, id]))));
  // Every tower stands in the surveyed footprints already; no procedural
  // landmark models and no bridge. Labels still hang over the named places.
  base = once(base,
    'buildLandmarks(){let e=Object.fromEntries(Object.entries(ha).map(([s,r])=>[s,this.sampleTerrain(r.longitude,r.latitude)])),a=window.innerWidth<850?"medium":"high",n=b1({project:Hn,materialFactory:s=>this.createSolidMaterial(s.role,s.color,s),detail:a,elevations:e});n.name="Landmark architecture",this.scene.add(n);let i=T1(Hn,(s,r)=>this.createSolidMaterial(s,r.defaultColor),window.innerWidth<850?"low":"medium");this.scene.add(i),this.createLandmarkLabels(e)}',
    'buildLandmarks(){let e=Object.fromEntries(Object.entries(ha).map(([s,r])=>[s,this.sampleTerrain(r.longitude,r.latitude)]));this.createLandmarkLabels(e)}', 'buildLandmarks');
  base = once(base,
    'createLandmarkLabels(e){let a=[{id:"salesforce_tower",landmark:"salesforce_tower"},{id:"transamerica_pyramid",landmark:"transamerica_pyramid"},{id:"ferry_building",landmark:"ferry_building"},{id:"coit_tower",landmark:"coit_tower"},{id:"city_hall",landmark:"city_hall"}];',
    `createLandmarkLabels(e){let a=${json(LABELS.filter(id => LANDMARKS[id]).map(id => ({ id, landmark: id })))};`, 'createLandmarkLabels');
  base = once(base,
    '}let n=document.createElement("div");n.className="world-label bridge-label",n.textContent="Golden Gate Bridge",this.labelLayer.appendChild(n),this.labels.push({element:n,point:Hn(-122.47854,37.81975,245),id:"golden_gate"})}',
    '}}', 'Golden Gate label');
  const v = WORLD.downtownView, ov = CAMERA.overview, dOff = CAMERA.downtownOffset || [-1100, 560, 1500];
  base = once(base,
    'if(e==="overview")return{position:new C(-2200,2300,8200),target:new C(-1500,105,-700)};if(e==="downtown"){let n=Hn(-122.3986,37.7919,120);return{position:n.clone().add(new C(-1350,620,1600)),target:n}}if(e==="golden_gate"){let n=Hn(-122.47854,37.81975,86);return{position:n.clone().add(new C(-1280,520,1560)),target:n}}',
    `if(e==="overview")return{position:new C(${ov.position.join(',')}),target:new C(${ov.target.join(',')})};if(e==="downtown"){let n=Hn(${v.lng},${v.lat},${v.y});return{position:n.clone().add(new C(${dOff.join(',')})),target:n}}`, 'viewPose');
  const tour = (CAMERA.tour || []).map(step => step[0] === 'overview'
    ? `  nodes.push({ id: 'overview', position: new C(${step[1].join(', ')}), target: new C(${step[2].join(', ')}) });`
    : `  pass(${json(step[1])}, [${step[2].join(', ')}]);`).join('\n');
  if (!tour) throw new Error('CAMERA.tour is empty');
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
  nodes.push({ id: 'overview', position: new C(-5200, 1600, 3400), target: new C(-1000, 130, -500) });`, tour, 'cinematic tour');
  const viewsStart = base.indexOf('lr=[{id:"overview"'), viewsEnd = base.indexOf('],V3=[', viewsStart);
  if (viewsStart < 0 || viewsEnd < 0) throw new Error(`${label} patch target changed: view list`);
  base = base.slice(0, viewsStart) + 'lr=' + json(VIEWS) + base.slice(viewsEnd + 1);

  // where flight begins, where the water is, how far the map goes
  const sp = WORLD.spawn, b = TERRAIN_BOUNDS, m = 150;
  base = once(base, 'let a=-122.4014,n=37.7921,i=this.sampleTerrain(a,n);', `let a=${sp.lng},n=${sp.lat},i=this.sampleTerrain(a,n);`);
  base = once(base, 'this.flightCharacter.position.copy(Hn(-122.3900, 37.8005, 185));', `this.flightCharacter.position.copy(Hn(${sp.lng}, ${sp.lat}, 260));`);
  base = once(base, 'x.position.set(-1600,.7,-1200),x.name="San Francisco Bay"', `x.position.set(0,.7,0),x.name=${json(CITY.water || 'Water')}`);
  base = once(base, 'p.x = We.clamp(p.x, -6600, 5100); p.z = We.clamp(p.z, -5600, 5400);',
    `p.x = We.clamp(p.x, ${Math.round(b.minX + m)}, ${Math.round(b.maxX - m)}); p.z = We.clamp(p.z, ${Math.round(b.minZ + m)}, ${Math.round(b.maxZ - m)});`);

  // words
  const buildingsRounded = (Math.round(cityManifest.buildings.renderedBuildings / 1000) * 1000).toLocaleString('en-US');
  const coord = (value, pos, neg) => `${Math.abs(value).toFixed(4)}\\xB0 ${value >= 0 ? pos : neg}`;
  base = once(base, '"aria-label":"3D San Francisco cityscape"', `"aria-label":${json(`3D ${label} cityscape`)}`);
  base = once(base, '"A 3D San Francisco built with open data"', json(`A 3D ${label} built with open data`));
  base = once(base, 'message:"Raising 27,000 buildings"', `message:"Raising ${buildingsRounded} buildings"`);
  base = once(base, 'children:"37.7955\\xB0 N"}),(0,G.jsx)("span",{children:"122.4205\\xB0 W"})', `children:"${coord(ORIGIN.lat, 'N', 'S')}"}),(0,G.jsx)("span",{children:"${coord(ORIGIN.lon, 'E', 'W')}"})`, 'data note');
  base = once(base, 'children:"Building footprints, elevations, roads and coastlines come from San Francisco open data. Over 13,000 downtown footprints retain source coordinates and courtyard boundaries. Major landmarks use public architectural references. Facade colors and window patterns are illustrative. Two-tone shading, fine ink lines and distance fog keep the city in its Sable-inspired palette."',
    `children:${json(PORTRAIT.paragraph || `Building footprints, roof heights and streets come from open data. Facade colors and window patterns are illustrative. Two-tone shading, fine ink lines and distance fog keep the city in its Sable-inspired palette.`)}`, 'data portrait');
  base = once(base, '(0,G.jsx)("dd",{children:E.stats?.buildings.toLocaleString("en-US")??"27,000+"})', `(0,G.jsx)("dd",{children:E.stats?.buildings.toLocaleString("en-US")??${json(PORTRAIT.buildings || buildingsRounded)}})`);
  base = once(base, '(0,G.jsx)("dd",{children:E.stats?.streets.toLocaleString("en-US")??"4,427"})', `(0,G.jsx)("dd",{children:E.stats?.streets.toLocaleString("en-US")??${json(PORTRAIT.streets || cityManifest.roads.sourceFeatures.toLocaleString('en-US'))}})`);
  base = once(base, '(0,G.jsx)("dd",{children:"12 + GGB"})', `(0,G.jsx)("dd",{children:"${Object.values(LANDMARKS).filter(l => !l.place).length} towers"})`);
  const sourcesStart = base.indexOf('(0,G.jsxs)("div",{className:"source-list",children:['), sourcesEnd = base.indexOf(']}),(0,G.jsx)("small",{children:"A visual reconstruction', sourcesStart);
  if (sourcesStart < 0 || sourcesEnd < 0) throw new Error(`${label} patch target changed: source list`);
  const links = Object.values(SOURCES).filter(s => s?.url && s?.name).map(s => `(0,G.jsx)("a",{href:${json(s.url)},target:"_blank",rel:"noreferrer",children:${json(s.name)}})`);
  base = base.slice(0, sourcesStart) + '(0,G.jsxs)("div",{className:"source-list",children:[' + links.join(',') + base.slice(sourcesEnd);
  base = once(base, '"Ride the wind over San Francisco."', json(`Ride the wind over ${label}.`));
  base = once(base, 'coordinateSystem:"local metres; origin near Civic Center; x east, y up, z south"', `coordinateSystem:${json(`local metres; origin at ${CITY.originLabel || label}; x east, y up, z south`)}`);
  // The address box searched DataSF; nothing equivalent is wired for other cities.
  base = once(base, '</head>', '  <style>.address-search{display:none !important}</style>\n</head>');

  // the Tech Week layer: its places in this city
  layer = once(layer, `    tz: 'America/Los_Angeles',
    week: { start: '2026-10-05', days: 7, label: 'OCT 5–11, 2026' },
    harbor: { lat: 37.8036, lng: -122.3828 },                // holding pattern over the bay for address-less events
    mast: { lat: 37.7951, lng: -122.3957 },                  // leaderboard mast, Embarcadero Plaza
    flagship: { lat: 37.7955, lng: -122.3937, y: 268 },      // week banner over the Ferry Building
    spawn: { lat: 37.7975, lng: -122.3925, heading: -0.5 },  // where a new bird enters the city (Embarcadero, facing downtown)`,
    `    tz: ${json(WORLD.timeZone)},
    week: { start: '2026-10-05', days: 7, label: 'OCT 5–11, 2026' },
    harbor: ${json(WORLD.harbor)},                // holding pattern for address-less events
    mast: ${json(WORLD.mast)},                  // leaderboard mast
    flagship: ${json(WORLD.flagship)},      // week banner
    spawn: ${json(WORLD.spawn)},  // where a new bird enters the city`, 'CFG places');
  layer = once(layer, SF_NEIGHBORHOOD_LINES, WORLD.neighborhoods.map(([name, lat, lng]) => `    [${json(name)}, ${lat}, ${lng}],`).join('\n') + '\n', 'NEIGHBORHOODS');
  layer = every(layer, '-07:00', CITY.utcOffset, 4, 'Pacific offsets');
  layer = once(layer, 'A16Z TECH WEEK · SAN FRANCISCO · ${CFG.week.label}', `TECH WEEK CITY · ${CITY.word} · \${CFG.week.label}`);
  layer = once(layer, "host: 'Someone in SF'", `host: '${single(CITY.hostFallback || `Someone in ${label}`)}'`);
  layer = once(layer, "`${ev.address}, San Francisco, CA` : `${ev.lat},${ev.lng}`", "`${ev.address}, " + (CITY.gcalCity || label) + "` : `${ev.lat},${ev.lng}`", 'directions link');
  layer = once(layer, 'Any San Francisco street address (DataSF resolves it), a neighborhood name, or', `Any ${label} street address, a neighborhood name, or`, 'claim dialog');
  const fv = WORLD.flagshipVenue || { venue: label, address: label };
  layer = once(layer, "host: 'Tech Week by a16z', cohosts: ['every host in this city'], speakers: [], start: '2026-10-05T09:00:00" + CITY.utcOffset + "', category: 'founders', venue: 'Ferry Building', address: 'Embarcadero'",
    `host: 'Tech Week City', cohosts: ['every host in this city'], speakers: [], start: '2026-10-05T09:00:00${CITY.utcOffset}', category: 'founders', venue: '${single(fv.venue)}', address: '${single(fv.address)}'`, 'flagship');
  layer = once(layer, "g.fillText('SF TECH WEEK ’26', W - 32, band / 2);", "g.fillText('TECH WEEK CITY ’26', W - 32, band / 2);", 'poster header');
  for (const [key, orig] of Object.entries(ORIGINAL_BIRDS)) {
    const bird = BIRDS[key] || {};
    if (bird.name && bird.name !== orig.name) layer = once(layer, `name: '${orig.name}',`, `name: '${single(bird.name)}',`, `bird ${key} name`);
    if (bird.cn && bird.cn !== orig.cn) layer = once(layer, `cn: '${orig.cn}',`, `cn: '${single(bird.cn)}',`, `bird ${key} cn`);
    if (bird.blurb && bird.blurb !== orig.blurb) layer = once(layer, `'${orig.blurb}'`, `'${single(bird.blurb)}'`, `bird ${key} blurb`);
  }
  html = base + layer;

  /* ---- the shared pipeline ---- */
  const cityAssets = splitStreamingCityAssets(html, { centre: { lon: WORLD.core.lng, lat: WORLD.core.lat } });
  html = wireStartup(wireCityStreaming(renderGame(cityAssets.html)));

  /* ---- the seed and the words the pipeline introduced ---- */
  const seed = JSON.parse(await readFile(new URL('seed-events.json', dir), 'utf8'));
  {
    const seedOpen = '<script id="tw-events-seed" type="application/json">';
    if (html.split(seedOpen).length !== 2) throw new Error('Event seed script must occur exactly once');
    const start = html.indexOf(seedOpen) + seedOpen.length, end = html.indexOf('</script>', start);
    const text = JSON.stringify(seed).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    html = html.slice(0, start) + text + html.slice(end);
  }
  html = once(html, '<title>SF TECH WEEK CITY · every event is an airship</title>', `<title>${NAME} · every event is an airship</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="Tech Week City, ${label}: an ink-drawn ${label} where every event is an airship over its venue. Fly your bird between the towers.">`);
  html = once(html, '<h1 class="tw-name"><span>SF TECH WEEK CITY</span>', `<h1 class="tw-name"><span>${NAME}</span>`);
  html = once(html, '(0,G.jsx)("span",{children:"SAN FRANCISCO"}),(0,G.jsx)("small",{children:"SF TECH WEEK CITY"})', `(0,G.jsx)("span",{children:${json(CITY.word)}}),(0,G.jsx)("small",{children:"TECH WEEK CITY"})`, 'loading overlay');
  html = once(html, "title: 'SF Tech Week 2026 — SF Tech Week City'", `title: 'Tech Week City — ${single(label)}'`);
  html = once(html, "'PRODID:-//SF Tech Week City//EN'", `'PRODID:-//Tech Week City ${single(label)}//EN'`);
  html = once(html, '<span class="tw-boot-name">SF TECH WEEK CITY</span>', `<span class="tw-boot-name">${NAME}</span>`);
  html = once(html, 'Loading San Francisco', CITY.loading || `Loading ${label}`);
  html = once(html, "    featured: { lat: 37.7969, lng: -122.3931, y: 196 },      // the host's own event, parked over the spawn point",
    `    featured: ${json(WORLD.featured)},      // the host's own event, parked over the spawn point`, 'CFG.featured');
  html = once(html, "    core: { lat: 37.7915, lng: -122.4005 },                  // downtown: where ships with no address of their own fly",
    `    core: ${json({ lat: WORLD.core.lat, lng: WORLD.core.lng })},                  // where ships with no address of their own fly`, 'CFG.core');
  html = once(html, '<i></i><span>Oct 5–11 · San Francisco</span><b>SF Tech Week 2026</b>', `<i></i><span>Oct 5–11 · ${label}</span><b>Tech Week City</b>`);
  html = once(html, "(ev.neighborhood || 'FiDi') + ' · venue soon'", `(ev.neighborhood || '${single(CITY.districtFallback || label)}') + ' · venue soon'`);
  html = once(html, "'San Francisco Tech Week'", `'${single(label)} Tech Week'`);
  html = once(html, 'if (horizontal && (p.x <= -6599 || p.x >= 5099 || p.z <= -5599 || p.z >= 5399)) {',
    `if (horizontal && (p.x <= ${Math.round(b.minX + m) + 1} || p.x >= ${Math.round(b.maxX - m) - 1} || p.z <= ${Math.round(b.minZ + m) + 1} || p.z >= ${Math.round(b.maxZ - m) - 1})) {`, 'flight fence');
  html = once(html, 'import "./multiplayer.js";\n', '');
  html = once(html, '  <link rel="stylesheet" href="./multiplayer.css">\n', '');

  /* ---- the add-ons, copied with their places moved ---- */
  const addonPatches = {
    'city-streaming.js': [["water.position.set(-1600,.7,-1200);water.name='San Francisco Bay';", `water.position.set(0,.7,0);water.name='${single(CITY.water || 'Water')}';`]],
    'city-time.mjs': [
      ["export const SF_TIME_ZONE = 'America/Los_Angeles';", `export const SF_TIME_ZONE = ${json(WORLD.timeZone)};`],
      ["// The city's authored palettes follow San Francisco's wall clock, including", `// The city's authored palettes follow ${label}'s wall clock, including`],
    ],
    'city-extras.mjs': [
      ['const DOWNTOWN = { lat: 37.7915, lng: -122.4005, radius: 620 };  // Financial District / Downtown core', `const DOWNTOWN = ${json({ lat: WORLD.core.lat, lng: WORLD.core.lng, radius: WORLD.core.radius || 620 })};  // ${label} core`],
      ["timeZone: 'America/Los_Angeles'", `timeZone: ${json(WORLD.timeZone)}`],
    ],
    'events-sync.js': [
      [SF_SYNC_NEIGHBORHOODS, WORLD.neighborhoods.map(([name, lat, lng]) => `  ${json(name.toLowerCase())}: { lat: ${lat}, lng: ${lng} }`).join(',\n') + '\n'],
      // No saved Tech Week snapshot exists for this city: the seed is the
      // programme until /events.json answers.
      ['async function readBaseline() {\n  try {', 'async function readBaseline() {\n  return null;\n  try {'],
      ['async function readSaved() {\n  const load', 'async function readSaved() {\n  return null;\n  const load'],
    ],
  };
  await rm(dist, { recursive: true, force: true });
  await mkdir(new URL('./data/', dist), { recursive: true });
  await writeFile(new URL('./index.html', dist), html);
  await writeCityAssets(cityAssets.files, dist);
  for (const name of ['city-time.mjs', 'event-card.mjs', 'city-streaming.js', 'events-sync.js', 'events-sync.css', 'gull-cluster-route.mjs', 'city-extras.mjs']) {
    let text = await readFile(new URL('./' + name, root), 'utf8');
    for (const [from, to] of addonPatches[name] || []) text = once(text, from, to, `${name}: ${from.slice(0, 50)}`);
    await writeFile(new URL('./' + name, dist), text);
  }
  // The runtime reads the curated venue list from data/; this world has none yet.
  await writeFile(new URL('./data/venue-overrides.json', dist), JSON.stringify({ addresses: [], events: [] }) + '\n');
  await cp(new URL('README.md', dir), new URL('./README.md', dist)).catch(() => {});
  await writeCityPreload(cityAssets, dist);
  return { dist: `dist-${cityName}/`, tiles: cityAssets.tiles.length, assets: cityAssets.files.size, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const city = process.argv[2];
  if (!city) { console.error('usage: node world-kit/build.mjs <city>'); process.exit(2); }
  const result = await buildWorld(city);
  console.log(`${city} world ready in ${result.dist} — index.html ${(result.bytes / 1048576).toFixed(2)} MB, ${result.assets} city files (${result.tiles} building tiles). Serve the directory with any static server.`);
}
