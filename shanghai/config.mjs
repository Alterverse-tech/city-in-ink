// Shanghai city centre — a parallel world of SF Tech Week City, kept apart from
// the San Francisco game and built through world-kit/. Everything that names
// a place in this world lives here: the crawl box, the projection origin, the
// landmarks and the places the Tech Week layer needs (harbour, mast, flagship,
// spawn), plus the texts, camera, birds and height defaults the kit reads.

export const NAME = 'TECH WEEK CITY · SHANGHAI';
export const CITY = {
  word: 'SHANGHAI', label: 'Shanghai', loading: 'Loading Shanghai', region: 'Shanghai, China',
  utcOffset: '+08:00', gcalCity: 'Shanghai, China', hostFallback: 'Someone in Shanghai',
  districtFallback: 'The Bund', originLabel: 'the Bund (Chen Yi Square)', water: 'Huangpu River', world: 'Shanghai',
};

// Crawl box (WGS 84): People's Square and Nanjing Road in the west, the whole
// Bund and the Old City in the middle, the Huangpu and the Lujiazui towers in
// the east; Suzhou Creek and the North Bund (Hongkou) along the top edge.
export const BOX = { south: 31.213, north: 31.257, west: 121.462, east: 121.528 };

// Local metres: x = east, y = up, z = south. Origin on the Bund promenade at
// Chen Yi Square, where Nanjing Road East reaches the river. OSM puts the last
// Bund facade at 121.4853° E and the waterline at 121.4863° E on this latitude.
export const ORIGIN = { lon: 121.4860, lat: 31.2400 };
export const METERS_LAT = 111320;
export const METERS_LON = METERS_LAT * Math.cos(ORIGIN.lat * Math.PI / 180);
export const project = (lon, lat) => ({ x: (lon - ORIGIN.lon) * METERS_LON, z: (ORIGIN.lat - lat) * METERS_LAT });

// Terrain grid spacing (metres). Shanghai is flat; the grid only carries the
// river and creek mask, so 20 m keeps the Bund's waterline honest.
export const GRID_METRES = 20;

export const TERRAIN_BOUNDS = (() => {
  const sw = project(BOX.west, BOX.south), ne = project(BOX.east, BOX.north);
  const minX = Math.min(sw.x, ne.x), maxX = Math.max(sw.x, ne.x), minZ = Math.min(sw.z, ne.z), maxZ = Math.max(sw.z, ne.z);
  const nx = Math.round((maxX - minX) / GRID_METRES) + 1, nz = Math.round((maxZ - minZ) / GRID_METRES) + 1;
  return { minX, maxX, minZ, maxZ, nx, nz };
})();

// Open data used by fetch-data.mjs. Everything comes from OpenStreetMap
// (© OpenStreetMap contributors, ODbL) through the Overpass API.
export const SOURCES = {
  buildings: { name: 'OpenStreetMap · buildings and building parts', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', endpoint: 'https://overpass.openstreetmap.fr/api/interpreter' },
  roads: { name: 'OpenStreetMap · highways', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', endpoint: 'https://overpass.openstreetmap.fr/api/interpreter' },
  water: { name: 'OpenStreetMap · water (Huangpu River, Suzhou Creek)', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', endpoint: 'https://overpass.openstreetmap.fr/api/interpreter' },
  overpass: { name: 'Overpass API (overpass.openstreetmap.fr)', url: 'https://overpass.openstreetmap.fr/', licence: 'ODbL (data)' },
};

// Landmarks. Every tower is drawn from its OSM footprint like any other
// building; `tiers` only shapes the extrusion into the published massing
// ([fraction of roof height, footprint scale]) and `spireMeters` adds a mast
// above the roof. Nothing is modelled by hand. `place` entries are labels
// only (squares, streets, districts). Every coordinate is an interior point of
// the OSM footprint — `node shanghai/check-landmarks.mjs` verifies each one
// and `--find <regex>` searches the cached footprints by name.
export const LANDMARKS = {
  shanghai_tower: { label: 'Shanghai Tower', latitude: 31.23559, longitude: 121.50127, heightMeters: 632,          // OSM w165792123, 632 m
    tiers: [[0.1, 1], [0.5, 0.85], [0.85, 0.7], [1, 0.5]] },
  swfc:           { label: 'Shanghai World Financial Center', latitude: 31.23659, longitude: 121.50299, heightMeters: 492,   // w10691100, 492 m
    tiers: [[0.3, 1], [0.7, 0.8], [0.9, 0.6], [1, 0.42]] },
  jin_mao:        { label: 'Jin Mao Tower', latitude: 31.23726, longitude: 121.50139, heightMeters: 421,            // w376075961, 420.5 m
    tiers: [[0.35, 1], [0.55, 0.9], [0.7, 0.8], [0.82, 0.7], [0.9, 0.6], [0.96, 0.48], [1, 0.3]] },
  oriental_pearl: { label: 'Oriental Pearl Tower', latitude: 31.24190, longitude: 121.49527, heightMeters: 468,     // w40778038; 468 m from its building:part
    tiers: [[0.06, 1], [0.55, 0.35], [0.6, 0.6], [0.8, 0.3], [0.9, 0.45], [1, 0.12]] },
  shanghai_ifc:   { label: 'Shanghai IFC', latitude: 31.23909, longitude: 121.49775, heightMeters: 260, tiers: [[0.85, 1], [1, 0.8]] },   // Two IFC, w423304682, 259.9 m
  boc_tower:      { label: 'Bank of China Tower', latitude: 31.24057, longitude: 121.49902, heightMeters: 226, tiers: [[0.9, 1], [1, 0.7]] },   // w164957811; 226 m from its building:part
  customs_house:  { label: 'Customs House', latitude: 31.23863, longitude: 121.48542, heightMeters: 79, tiers: [[0.45, 1], [1, 0.28]] },   // w178407318 (7 storeys tagged)
  peace_hotel:    { label: 'Fairmont Peace Hotel', latitude: 31.24107, longitude: 121.48436, heightMeters: 77, tiers: [[0.85, 1], [1, 0.4]] },   // r2376366 (11 storeys tagged)
  hsbc_building:  { label: 'HSBC Building', latitude: 31.23801, longitude: 121.48525, heightMeters: 46, tiers: [[0.72, 1], [1, 0.35]] },   // r2380996, today's SPDB (7 storeys tagged)
  bund_finance:   { label: 'Bund Finance Center', latitude: 31.22784, longitude: 121.49336, heightMeters: 180, tiers: [[1, 1]] },   // w447024809, the 45-storey S2 tower
  tomorrow_square:{ label: 'Tomorrow Square', latitude: 31.23248, longitude: 121.46507, heightMeters: 285,          // w445161727, 284.6 m
    tiers: [[0.12, 1], [0.6, 0.85], [0.85, 0.7], [1, 0.4]] },
  shimao_plaza:   { label: 'Shimao International Plaza', latitude: 31.23638, longitude: 121.47109, heightMeters: 333,   // w51317372, 333 m
    tiers: [[0.15, 1], [0.8, 0.85], [1, 0.6]] },
  shanghai_museum:{ label: 'Shanghai Museum', latitude: 31.23014, longitude: 121.47097, heightMeters: 30, tiers: [[0.5, 1], [1, 0.7]] },   // w161090899
  grand_theatre:  { label: 'Shanghai Grand Theatre', latitude: 31.23129, longitude: 121.46733, heightMeters: 40, tiers: [[1, 1]] },   // w39763758
  city_hall:      { label: 'Shanghai Municipal Government', latitude: 31.23228, longitude: 121.46915, heightMeters: 50, tiers: [[1, 1]] },   // w178801539, 50 m
  peoples_square: { label: 'People’s Square', latitude: 31.23200, longitude: 121.47120, heightMeters: 0, place: true },
  nanjing_road:   { label: 'Nanjing Road Pedestrian Street', latitude: 31.23580, longitude: 121.47700, heightMeters: 30, place: true },
  yu_garden:      { label: 'Yu Garden', latitude: 31.22720, longitude: 121.49200, heightMeters: 0, place: true },
  lujiazui:       { label: 'Lujiazui', latitude: 31.23800, longitude: 121.50000, heightMeters: 0, place: true },
  bund:           { label: 'The Bund', latitude: 31.24000, longitude: 121.48580, heightMeters: 0, place: true },
};

// The Tech Week layer's fixed places in this world. The Huangpu at Nanjing
// Road runs from 121.4863° E to 121.4907° E (419 m), so everything "over the
// river" sits between those and everything "on the Bund" west of 121.4863.
export const WORLD = {
  timeZone: 'Asia/Shanghai',
  harbor: { lat: 31.2430, lng: 121.4895 },      // holding pattern over the Huangpu, off the Bund
  mast: { lat: 31.2403, lng: 121.4859 },        // leaderboard mast on the Bund promenade, Chen Yi Square
  flagship: { lat: 31.2400, lng: 121.4885, y: 380 },   // week banner over the middle of the river, facing Lujiazui
  spawn: { lat: 31.2395, lng: 121.4858, heading: 1.6 }, // a new bird enters over the Bund promenade, facing Lujiazui across the river
  featured: { lat: 31.2403, lng: 121.4859, y: 220 },    // the host's own ship, parked over Chen Yi Square
  core: { lat: 31.2400, lng: 121.4860, radius: 700 },   // the Bund core: where ships with no address of their own fly
  downtownView: { lat: 31.2392, lng: 121.4855, y: 120 }, // the "Bund" camera view target
  neighborhoods: [
    ['The Bund', 31.2400, 121.4858], ['Nanjing Road', 31.2358, 121.4770], ['People’s Square', 31.2320, 121.4712],
    ['Lujiazui', 31.2380, 121.5000], ['Xintiandi', 31.2200, 121.4740], ['Yu Garden', 31.2272, 121.4920],
    ['Jing’an', 31.2290, 121.4650], ['North Bund', 31.2510, 121.4925], ['Hongkou', 31.2520, 121.4870],
    ['Suzhou Creek', 31.2440, 121.4830], ['Old City', 31.2250, 121.4880], ['Dongjiadu', 31.2180, 121.5000],
    ['Huangpu', 31.2330, 121.4830], ['Hankou Road', 31.2375, 121.4820], ['Sichuan Road North', 31.2470, 121.4820],
    ['Century Avenue', 31.2350, 121.5150], ['Zhabei', 31.2520, 121.4700], ['Dapuqiao', 31.2150, 121.4690],
  ],
  flagshipVenue: { venue: 'The Bund', address: 'Zhongshan East 1st Road' },
};

// Camera views (the "overview"/"downtown" ids are fixed; the rest are landmark ids).
export const VIEWS = [
  { id: 'overview', short: 'Overview', name: 'Shanghai', fact: 'The Huangpu bend between People’s Square and Lujiazui — the Bund on the west bank, the towers on the east — mapped to real geographic coordinates.' },
  { id: 'downtown', short: 'The Bund', name: 'The Bund', fact: 'A mile of 1920s banks and hotels on Zhongshan East 1st Road facing the Pudong skyline across 420 m of river; OpenStreetMap footprints with their tagged heights and storeys.' },
  { id: 'shanghai_tower', short: 'Shanghai Tower', name: 'Shanghai Tower', fact: 'At 632 m the tallest building in China, a twisting glass skin around nine stacked vertical neighbourhoods, finished in 2015.' },
  { id: 'swfc', short: 'SWFC', name: 'Shanghai World Financial Center', fact: 'A 492 m tower from 2008 with a trapezoid opening at the top — the “bottle opener” of Lujiazui.' },
  { id: 'jin_mao', short: 'Jin Mao', name: 'Jin Mao Tower', fact: 'The 421 m pagoda-stepped tower of 1999, its setbacks tapering in eighths.' },
  { id: 'oriental_pearl', short: 'Oriental Pearl', name: 'Oriental Pearl Tower', fact: 'The 468 m TV tower of 1994 — eleven spheres on three columns at the tip of Lujiazui.' },
  { id: 'customs_house', short: 'Customs House', name: 'Customs House', fact: 'The Bund’s 79 m clock tower of 1927; the bells still play “The East Is Red” on the hour.' },
  { id: 'peace_hotel', short: 'Peace Hotel', name: 'Fairmont Peace Hotel', fact: 'Sassoon House of 1929, the green copper pyramid at the river end of Nanjing Road.' },
  { id: 'tomorrow_square', short: 'Tomorrow Square', name: 'Tomorrow Square', fact: 'The 285 m tower on People’s Square that twists 45° halfway up and ends in four splayed claws.' },
  { id: 'peoples_square', short: 'People’s Square', name: 'People’s Square', fact: 'The old racecourse, now the civic centre — municipal government, museum, Grand Theatre and the metro hub beneath.' },
];
export const LABELS = ['shanghai_tower', 'swfc', 'jin_mao', 'oriental_pearl', 'shanghai_ifc', 'customs_house', 'peace_hotel', 'hsbc_building',
  'bund_finance', 'tomorrow_square', 'shimao_plaza', 'shanghai_museum', 'peoples_square', 'nanjing_road', 'yu_garden', 'lujiazui', 'bund'];

// Camera, in local metres (x east, y up, z south; the Lujiazui towers stand
// around x 1450, z 300–500, People's Square around x −1400, z 900). The
// overview comes in from the south-west over the Old City looking north-east
// at the Bund and the towers across the river; the tour runs the Bund, crosses
// to Lujiazui, and comes back over Yu Garden and Nanjing Road to People's Square.
export const CAMERA = {
  overview: { position: [-2400, 1600, 3800], target: [500, 120, 300] },
  downtownOffset: [-950, 520, 1350],
  tour: [
    ['overview', [-2200, 1400, 3400], [400, 130, 300]],
    ['pass', 'downtown', [-900, 480, 1200]],
    ['pass', 'customs_house', [-520, 330, 560]],
    ['pass', 'peace_hotel', [-560, 360, -480]],
    ['pass', 'oriental_pearl', [-700, 520, -620]],
    ['pass', 'oriental_pearl', [640, 560, 560]],
    ['pass', 'jin_mao', [720, 520, -560]],
    ['pass', 'swfc', [820, 620, 640]],
    ['pass', 'shanghai_tower', [-900, 760, 780]],
    ['pass', 'yu_garden', [560, 420, 700]],
    ['pass', 'shimao_plaza', [700, 520, 620]],
    ['pass', 'tomorrow_square', [-760, 560, 640]],
    ['pass', 'peoples_square', [500, 640, 900]],
    ['overview', [-4200, 1300, 1400], [-300, 130, 400]],
    ['overview', [-2800, 1600, 3600], [300, 130, 300]],
  ],
};

// The in-game data panel. Counts come from the fetch report (2026-09-12).
export const PORTRAIT = {
  paragraph: 'Building footprints, tagged heights and storeys, streets, the Huangpu River and Suzhou Creek come from OpenStreetMap (© OpenStreetMap contributors, ODbL) through the Overpass API; the ground is flat at 4 m, as Shanghai is. Footprints keep their mapped coordinates and courtyards; OSM coverage of small buildings is partial here, so some blocks stand emptier than the city does. An untagged height falls back to the storey count or a low default — no tower is invented. The named landmarks follow their published massing. Facade colors and window patterns are illustrative. Two-tone shading, fine ink lines and distance fog keep the city in its Sable-inspired palette.',
  buildings: '8,600', streets: '4,600',
};

// The birds are the same six models; only their names and stories move to the
// Yangtze delta. Every species named here is on the Shanghai list.
export const BIRDS = {
  gull:        { name: 'Black-headed Gull', cn: '红嘴鸥', blurb: 'The Bund’s winter gull. Arrives in November, works the Huangpu ferries till March.' },
  pelican:     { name: 'Dalmatian Pelican', cn: '卷羽鹈鹕', blurb: 'Big wings, slow flaps. A rare winter visitor to the Yangtze estuary mudflats.' },
  raven:       { name: 'Large-billed Crow', cn: '大嘴乌鸦', blurb: 'Ink on ink. The rooftop crowd of the Old City and the parks.' },
  hummingbird: { name: 'Fork-tailed Sunbird', cn: '叉尾太阳鸟', blurb: 'The closest thing to a hummingbird here — a southern nectar-feeder that turns up in the parks some winters.' },
  peregrine:   { name: 'Peregrine Falcon', cn: '游隼', blurb: 'Nests on the Lujiazui towers. Naturally.' },
  parrot:      { name: 'Azure-winged Magpie', cn: '灰喜鹊', blurb: 'The park flocks of Shanghai. Loud, local, blue-winged, beloved.' },
};

// Height defaults for footprints without a tagged height (metres). `max` must
// clear the Shanghai Tower (632 m).
export const HEIGHTS = {
  levelMetres: 3.0, default: 10, max: 640,
  byKind: { house: 6, detached: 6, terrace: 8, apartments: 30, residential: 24, dormitory: 18, commercial: 24, office: 24, retail: 12,
    hotel: 36, industrial: 10, warehouse: 8, school: 14, university: 16, hospital: 20, church: 14, temple: 10, roof: 4, garage: 4, garages: 4, shed: 3, hut: 3 },
};

// Water cells sit this far below the water plane; land never sinks below LAND_MIN_HEIGHT.
export const WATER_HEIGHT = -2.5;
export const LAND_MIN_HEIGHT = 1.2;
