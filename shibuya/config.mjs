// Shibuya, Tokyo — a parallel world of SF Tech Week City, kept apart from the
// San Francisco game and built through world-kit/. Everything that names a
// place in this world lives here: the crawl box, the projection origin, the
// landmarks and the places the Tech Week layer needs (harbour, mast, flagship,
// spawn), the camera views and the tour, the texts and the bird names.

export const NAME = 'TECH WEEK CITY · SHIBUYA';
export const CITY = {
  word: 'SHIBUYA', label: 'Shibuya', loading: 'Loading Shibuya', region: 'Tokyo, Japan',
  utcOffset: '+09:00', gcalCity: 'Tokyo, Japan', hostFallback: 'Someone in Tokyo',
  districtFallback: 'Shibuya', originLabel: 'the Scramble Crossing', water: 'Shibuya River', world: 'Shibuya, Tokyo',
};

// Crawl box (WGS 84), centred on the Scramble Crossing. Meiji Jingu and Yoyogi
// Park close the north, Yebisu Garden Place the south, Shinsen and the edge of
// Nakameguro the west, Aoyama and the Nishi-Azabu edge the east.
export const BOX = { south: 35.638, north: 35.680, west: 139.675, east: 139.725 };

// Local metres: x = east, y = up, z = south, origin at the Shibuya Scramble Crossing.
export const ORIGIN = { lon: 139.7005, lat: 35.6595 };
export const METERS_LAT = 111320;
export const METERS_LON = METERS_LAT * Math.cos(ORIGIN.lat * Math.PI / 180);
export const project = (lon, lat) => ({ x: (lon - ORIGIN.lon) * METERS_LON, z: (ORIGIN.lat - lat) * METERS_LAT });

// Terrain grid spacing (metres). Shibuya is a valley — the Shibuya River cut
// it between the Dogenzaka and Miyamasuzaka slopes, with Yoyogi and Aoyama on
// the plateaus 15 m higher — so the grid stays tight enough to keep the slopes.
export const GRID_METRES = 20;

export const TERRAIN_BOUNDS = (() => {
  const sw = project(BOX.west, BOX.south), ne = project(BOX.east, BOX.north);
  const minX = Math.min(sw.x, ne.x), maxX = Math.max(sw.x, ne.x), minZ = Math.min(sw.z, ne.z), maxZ = Math.max(sw.z, ne.z);
  const nx = Math.round((maxX - minX) / GRID_METRES) + 1, nz = Math.round((maxZ - minZ) / GRID_METRES) + 1;
  return { minX, maxX, minZ, maxZ, nx, nz };
})();

// Open data used by fetch-data.mjs. Every entry is linked from the in-game data panel.
export const SOURCES = {
  osm: { name: 'OpenStreetMap contributors · buildings, streets, water', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0',
    api: 'https://overpass.openstreetmap.fr/api/interpreter',
    fallbacks: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'] },
  gsi: { name: '国土地理院 地理院タイル · 標高タイル (DEM10B, 10 m mesh)', url: 'https://maps.gsi.go.jp/development/ichiran.html#dem',
    tiles: 'https://cyberjapandata.gsi.go.jp/xyz/dem/{z}/{x}/{y}.txt', zoom: 14,
    licence: '国土地理院コンテンツ利用規約 (Government of Japan Standard Terms of Use v2.0, compatible with CC BY 4.0) — attribution "出典：国土地理院"; reproducing the survey result in a published map may additionally need approval under the Survey Act (測量法 第29・30条)',
    attribution: '出典：国土地理院 地理院タイル（標高タイル）— 基盤地図情報 数値標高モデル' },
};

// Landmarks. Every tower is drawn from its OSM footprint like any other
// building; `tiers` only shapes the extrusion into the published massing
// ([fraction of roof height, footprint scale]) — the station towers are all a
// low-rise podium with a slimmer shaft above it. `place` entries are labels
// only (the crossing, parks, the shrine, complexes OSM carries no height for).
// Coordinates sit inside the OSM footprints (checked with
// `node shibuya/check-landmarks.mjs`); heights are the OSM `height` tag where
// one exists (it agrees with the published figure for every tower below).
export const LANDMARKS = {
  scramble_square: { label: 'Shibuya Scramble Square', latitude: 35.65837, longitude: 139.70222, heightMeters: 230,   // OSM 229.706
    tiers: [[0.2, 1], [0.92, 0.62], [1, 0.5]] },
  hikarie:         { label: 'Shibuya Hikarie', latitude: 35.65912, longitude: 139.70379, heightMeters: 183,           // OSM 182.5
    tiers: [[0.3, 1], [1, 0.72]] },
  stream:          { label: 'Shibuya Stream', latitude: 35.65717, longitude: 139.70307, heightMeters: 180,            // OSM 179.95
    tiers: [[0.16, 1], [1, 0.66]] },
  cerulean:        { label: 'Cerulean Tower', latitude: 35.65632, longitude: 139.69929, heightMeters: 184,            // OSM 184
    tiers: [[0.14, 1], [1, 0.62]] },
  sakura_stage:    { label: 'Shibuya Sakura Stage', latitude: 35.65700, longitude: 139.70174, heightMeters: 180,      // SHIBUYA Tower, OSM 179.97
    tiers: [[0.18, 1], [1, 0.7]] },
  sakura_tower:    { label: 'Sakura Stage · SAKURA Tower', latitude: 35.65574, longitude: 139.70270, heightMeters: 133, // OSM 133
    tiers: [[0.2, 1], [1, 0.75]] },
  axsh:            { label: 'Shibuya Axsh', latitude: 35.65915, longitude: 139.70464, heightMeters: 120, tiers: [[1, 1]] },            // OSM 120
  cross_tower:     { label: 'Shibuya Cross Tower', latitude: 35.65879, longitude: 139.70539, heightMeters: 115, tiers: [[1, 1]] },     // OSM 115.4
  solasta:         { label: 'Shibuya Solasta', latitude: 35.65641, longitude: 139.69660, heightMeters: 107, tiers: [[1, 1]] },         // OSM 106.9
  fukuras:         { label: 'Shibuya Fukuras', latitude: 35.65776, longitude: 139.70012, heightMeters: 104, tiers: [[1, 1]] },         // OSM 103.96
  parco:           { label: 'Shibuya PARCO', latitude: 35.66202, longitude: 139.69881, heightMeters: 100, tiers: [[0.5, 1], [1, 0.8]] }, // OSM 99.9
  infoss:          { label: 'Shibuya Infoss Tower', latitude: 35.65513, longitude: 139.70086, heightMeters: 89, tiers: [[1, 1]] },     // OSM 89.2
  city_office:     { label: 'Shibuya City Office', latitude: 35.66373, longitude: 139.69779, heightMeters: 70, tiers: [[1, 1]] },      // OSM 70.46
  shibuya_109:     { label: 'Shibuya 109', latitude: 35.65956, longitude: 139.69879, heightMeters: 34, tiers: [[1, 1]] },              // OSM 33.6
  // Kenzo Tange's 1964 arena: OSM gives the roof 30.2 m, the two masts rise to ~40 m.
  yoyogi_gym:      { label: 'Yoyogi National Gymnasium', latitude: 35.66730, longitude: 139.69975, heightMeters: 40, tiers: [[1, 1]] },
  omotesando_hills:{ label: 'Omotesando Hills', latitude: 35.66728, longitude: 139.70868, heightMeters: 23, tiers: [[1, 1]] },        // no OSM height; 6 storeys kept to the zelkova line
  // The 1994 tower: 167 m, 40 storeys (published). OSM has the footprint as
  // building=roof with height 27 and building:levels=40 — this entry corrects it.
  ebisu_garden_place:{ label: 'Yebisu Garden Place Tower', latitude: 35.64254, longitude: 139.71386, heightMeters: 167, tiers: [[1, 1]], overrideHeight: true },
  ebisu_prime_square:{ label: 'Ebisu Prime Square', latitude: 35.65005, longitude: 139.71264, heightMeters: 101, tiers: [[1, 1]] },   // OSM 101.35
  westin:          { label: 'The Westin Tokyo', latitude: 35.64169, longitude: 139.71547, heightMeters: 80, tiers: [[1, 1]] },          // OSM 80
  daikanyama_address:{ label: 'Daikanyama Address', latitude: 35.64920, longitude: 139.70275, heightMeters: 120, tiers: [[1, 1]] },   // published 119.9 m, 36 storeys; no OSM height
  // Published 165 m / 45 storeys; OSM has only building:levels=40. Unverified online from here.
  nakameguro_atlas:{ label: 'Nakameguro Atlas Tower', latitude: 35.64388, longitude: 139.70043, heightMeters: 165, tiers: [[0.1, 1], [1, 0.85]] },
  scramble_crossing:{ label: 'Shibuya Scramble Crossing', latitude: 35.65950, longitude: 139.70050, heightMeters: 0, place: true },
  hachiko:         { label: 'Hachikō', latitude: 35.65905, longitude: 139.70058, heightMeters: 0, place: true },
  mark_city:       { label: 'Shibuya Mark City', latitude: 35.65826, longitude: 139.69881, heightMeters: 0, place: true },   // multipolygon without heights in OSM
  nhk:             { label: 'NHK Broadcasting Center', latitude: 35.66522, longitude: 139.69574, heightMeters: 0, place: true },  // nested multipolygon, no heights
  meiji_jingu:     { label: 'Meiji Jingu', latitude: 35.67640, longitude: 139.69930, heightMeters: 0, place: true },
  yoyogi_park:     { label: 'Yoyogi Park', latitude: 35.67170, longitude: 139.69490, heightMeters: 0, place: true },
  harajuku_station:{ label: 'Harajuku Station', latitude: 35.67041, longitude: 139.70264, heightMeters: 0, place: true },
  miyashita_park:  { label: 'Miyashita Park', latitude: 35.66194, longitude: 139.70176, heightMeters: 0, place: true },
  daikanyama_tsite:{ label: 'Daikanyama T-Site', latitude: 35.64932, longitude: 139.69985, heightMeters: 0, place: true },
  ebisu_station:   { label: 'Ebisu Station', latitude: 35.64670, longitude: 139.71010, heightMeters: 0, place: true },
};

// The Tech Week layer's fixed places in this world.
export const WORLD = {
  timeZone: 'Asia/Tokyo',
  harbor: { lat: 35.6712, lng: 139.6949 },              // no water here: the holding pattern circles over Yoyogi Park
  mast: { lat: 35.65905, lng: 139.70058 },              // leaderboard mast on Hachikō Square
  flagship: { lat: 35.65837, lng: 139.70222, y: 330 },  // week banner above Shibuya Scramble Square
  spawn: { lat: 35.6606, lng: 139.6999, heading: 2.6 }, // a new bird enters over the crossing, facing the station towers
  featured: { lat: 35.65950, lng: 139.70050, y: 190 },  // the host's own ship, parked over the crossing
  core: { lat: 35.65950, lng: 139.70050, radius: 650 }, // Shibuya core: where ships with no address of their own fly
  downtownView: { lat: 35.6586, lng: 139.7018, y: 110 },// the "Shibuya" camera view target (the station towers)
  neighborhoods: [
    ['Shibuya', 35.6595, 139.7005], ['Dogenzaka', 35.6582, 139.6968], ['Center-gai', 35.6605, 139.6985],
    ['Udagawacho', 35.6618, 139.6972], ['Sakuragaoka', 35.6567, 139.6995], ['Nanpeidai', 35.6555, 139.6955],
    ['Shinsen', 35.6565, 139.6920], ['Shoto', 35.6605, 139.6925], ['Kamiyamacho', 35.6635, 139.6935],
    ['Jinnan', 35.6625, 139.7000], ['Miyashita Park', 35.6619, 139.7018], ['Aoyama', 35.6650, 139.7150],
    ['Omotesando', 35.6655, 139.7120], ['Jingumae', 35.6670, 139.7060], ['Harajuku', 35.6704, 139.7026],
    ['Takeshita-dori', 35.6712, 139.7045], ['Yoyogi', 35.6765, 139.6930], ['Yoyogi Park', 35.6717, 139.6949],
    ['Sendagaya', 35.6790, 139.7115], ['Tomigaya', 35.6690, 139.6875], ['Daikanyama', 35.6486, 139.7030],
    ['Ebisu', 35.6467, 139.7101], ['Ebisu Garden Place', 35.6421, 139.7137], ['Hiroo', 35.6520, 139.7215],
    ['Higashi', 35.6530, 139.7085], ['Nakameguro', 35.6440, 139.6985], ['Nishi-Azabu', 35.6580, 139.7230],
  ],
  flagshipVenue: { venue: 'Shibuya Scramble Square', address: 'Shibuya 2-chome' },
};

// The camera views the view menu offers: overview, the station area, then landmarks.
export const VIEWS = [
  { id: 'overview', short: 'Overview', name: 'Shibuya', fact: 'Shibuya, Tokyo — from Yoyogi Park and Meiji Jingu down the valley to Daikanyama and Ebisu, mapped to real geographic coordinates.' },
  { id: 'downtown', short: 'Shibuya', name: 'Shibuya Station', fact: 'The station towers rising around the busiest pedestrian crossing in the world, drawn from OpenStreetMap footprints on GSI elevation.' },
  { id: 'scramble_square', short: 'Scramble Square', name: 'Shibuya Scramble Square', fact: 'A 230 m tower straight above Shibuya Station, opened in 2019 — its roof deck, Shibuya Sky, is the highest point in the ward.' },
  { id: 'hikarie', short: 'Hikarie', name: 'Shibuya Hikarie', fact: 'A 183 m tower of shops, offices and a 2,000-seat theatre on the east side of the station, opened in 2012.' },
  { id: 'stream', short: 'Stream', name: 'Shibuya Stream', fact: 'A 180 m tower from 2018 on the old Toyoko Line platforms, beside a daylighted stretch of the Shibuya River.' },
  { id: 'cerulean', short: 'Cerulean', name: 'Cerulean Tower', fact: 'A 184 m hotel and office tower from 2001 at the top of Sakuragaoka, the tallest in Shibuya for nearly two decades.' },
  { id: 'sakura_stage', short: 'Sakura Stage', name: 'Shibuya Sakura Stage', fact: 'A 180 m tower over the Sakuragaoka slope, completed in 2023 as the last piece of the station redevelopment.' },
  { id: 'yoyogi_gym', short: 'Yoyogi Gym', name: 'Yoyogi National Gymnasium', fact: 'Kenzo Tange’s suspended-roof arena for the 1964 Olympics, its ridge slung from two concrete masts.' },
  { id: 'ebisu_garden_place', short: 'Ebisu', name: 'Yebisu Garden Place Tower', fact: 'A 167 m tower from 1994 on the site of the old Yebisu brewery, the south end of this map.' },
  { id: 'meiji_jingu', short: 'Meiji Jingu', name: 'Meiji Jingu', fact: 'The Shinto shrine of 1920 inside a 70-hectare planted forest of 100,000 trees, north of Harajuku.' },
];
export const LABELS = ['scramble_square', 'hikarie', 'stream', 'cerulean', 'sakura_stage', 'axsh', 'cross_tower', 'solasta', 'fukuras', 'parco', 'shibuya_109',
  'yoyogi_gym', 'nhk', 'omotesando_hills', 'ebisu_garden_place', 'nakameguro_atlas', 'daikanyama_address', 'city_office',
  'scramble_crossing', 'hachiko', 'mark_city', 'meiji_jingu', 'yoyogi_park', 'harajuku_station', 'miyashita_park', 'daikanyama_tsite', 'ebisu_station'];

// Local metres, x east, y up, z south. The overview stands south-west over
// Nanpeidai looking at the station towers; the tour is a dozen passes.
export const CAMERA = {
  overview: { position: [-1400, 1500, 3200], target: [150, 90, 200] },
  downtownOffset: [-1000, 520, 1300],
  tour: [
    ['overview', [-1700, 1300, 2900], [100, 90, 150]],
    ['pass', 'cerulean', [-620, 400, 560]],
    ['pass', 'sakura_stage', [520, 380, 520]],
    ['pass', 'scramble_square', [720, 430, -560]],
    ['pass', 'hikarie', [560, 400, 520]],
    ['pass', 'downtown', [-950, 520, 1150]],
    ['pass', 'stream', [-640, 380, -500]],
    ['pass', 'shibuya_109', [-560, 340, 480]],
    ['pass', 'yoyogi_gym', [640, 380, 620]],
    ['pass', 'meiji_jingu', [-380, 520, 1300]],
    ['pass', 'omotesando_hills', [-560, 340, 620]],
    ['pass', 'ebisu_garden_place', [680, 420, 560]],
    ['pass', 'ebisu_garden_place', [-620, 400, -520]],
    ['overview', [-2600, 1200, 1900], [0, 90, 0]],
    ['overview', [-2000, 1400, 3200], [100, 90, 100]],
  ],
};

// The in-game data panel.
export const PORTRAIT = {
  paragraph: 'Building footprints, streets and water come from OpenStreetMap; the ground is the Geospatial Information Authority of Japan’s 10 m elevation mesh (地理院タイル 標高タイル). Some 48,000 footprints keep their mapped coordinates and courtyards; a building rises to its mapped height or storey count, and an unknown height is a low block. The named towers step back to their published massing. Facade colours and window patterns are illustrative. Two-tone shading, fine ink lines and distance fog keep the city in its Sable-inspired palette.',
  buildings: '48,000', streets: '5,800',
};

// The six bird models keep their shapes; the names and stories are Tokyo's.
export const BIRDS = {
  gull:        { name: 'Black-tailed Gull', cn: 'ウミネコ', blurb: 'The umineko — the “sea cat” that mews over Tokyo Bay and follows the rivers in.' },
  pelican:     { name: 'Brown Pelican', cn: 'カッショクペリカン', blurb: 'Big wings, slow flaps. A rare Tokyo Bay visitor who wandered up the valley.' },
  raven:       { name: 'Large-billed Crow', cn: 'ハシブトガラス', blurb: 'Ink on ink. The Shibuya crow — the real owner of the crossing at dawn.' },
  hummingbird: { name: 'Hummingbird', cn: 'ハチドリ', blurb: 'Tiny and fast to look at. Same flight model, half the bird.' },
  peregrine:   { name: 'Peregrine Falcon', cn: 'ハヤブサ', blurb: 'Nests on the station skyscrapers. Naturally.' },
  parrot:      { name: 'Rose-ringed Parakeet', cn: 'ワカケホンセイインコ', blurb: 'The Tokyo parakeet. Loud, local, beloved — roosts by the thousand in the city’s parks.' },
};

// Building heights when OSM has none: storeys × levelMetres, else by kind.
// (In the crawl only ~10% of footprints carry `height` and ~13% `building:levels`.)
export const HEIGHTS = {
  levelMetres: 3.1,
  default: 9,
  max: 240,
  byKind: {
    house: 7, detached: 7, residential: 9, apartments: 22, dormitory: 15, hotel: 24,
    commercial: 18, office: 18, retail: 12, industrial: 9, warehouse: 9, parking: 12, garage: 3, garages: 3,
    school: 12, university: 15, hospital: 20, public: 12, civic: 12, government: 15, train_station: 10, transportation: 10,
    temple: 8, shrine: 8, church: 10, kindergarten: 7, roof: 4, shed: 3, hut: 3, service: 4, construction: 9,
  },
};

// OSM highway=* → drawn width (metres) when the way has no width tag, and tone.
const ROAD_WIDTHS = { motorway: 20, trunk: 18, primary: 16, secondary: 12, tertiary: 10, unclassified: 7, residential: 6, living_street: 5, pedestrian: 6, service: 4 };
export const ROADS = {
  include: road => road.kind in ROAD_WIDTHS,
  width: road => { const width = road.width > 0 ? road.width : (ROAD_WIDTHS[road.kind] || 6); return Math.max(4, Math.min(30, width)); },
  tone: (road, width) => /^(motorway|trunk)$/.test(road.kind) ? 235 : width >= 12 ? 190 : 135,
};

export const WATER_HEIGHT = -2.5;
export const LAND_MIN_HEIGHT = 1.2;
