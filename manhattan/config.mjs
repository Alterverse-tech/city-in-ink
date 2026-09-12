// Manhattan Midtown — a parallel world of SF Tech Week City, kept apart from
// the San Francisco game. Everything that names a place in this world lives
// here: the crawl box, the projection origin, the landmarks and the places the
// Tech Week layer needs (harbour, mast, flagship, spawn).

// Crawl box (WGS 84). Hoboken/Weehawken give the Hudson a far shore, Long
// Island City and Roosevelt Island do the same for the East River; north edge
// is around 72nd Street inside Central Park, south edge around 12th Street.
export const BOX = { south: 40.733, north: 40.782, west: -74.030, east: -73.945 };

// Local metres: x = east, y = up, z = south, origin at Bryant Park / 42nd St.
export const ORIGIN = { lon: -73.9855, lat: 40.7550 };
export const METERS_LAT = 111320;
export const METERS_LON = METERS_LAT * Math.cos(ORIGIN.lat * Math.PI / 180);
export const project = (lon, lat) => ({ x: (lon - ORIGIN.lon) * METERS_LON, z: (ORIGIN.lat - lat) * METERS_LAT });

// Terrain grid spacing (metres). The SF world uses ~53 m; Midtown is flat, so
// a tighter grid mostly keeps the waterfront honest.
export const GRID_METRES = 20;

export const TERRAIN_BOUNDS = (() => {
  const sw = project(BOX.west, BOX.south), ne = project(BOX.east, BOX.north);
  const minX = Math.min(sw.x, ne.x), maxX = Math.max(sw.x, ne.x), minZ = Math.min(sw.z, ne.z), maxZ = Math.max(sw.z, ne.z);
  const nx = Math.round((maxX - minX) / GRID_METRES) + 1, nz = Math.round((maxZ - minZ) / GRID_METRES) + 1;
  return { minX, maxX, minZ, maxZ, nx, nz };
})();

// Open data used by fetch-data.mjs.
export const SOURCES = {
  footprints: { name: 'NYC Open Data · Building Footprints', id: '5zhs-2jue', url: 'https://data.cityofnewyork.us/d/5zhs-2jue' },
  centerlines: { name: 'NYC Open Data · Centerline (CSCL)', id: 'inkn-q76z', url: 'https://data.cityofnewyork.us/d/inkn-q76z' },
  boroughs: { name: 'NYC Open Data · Borough Boundaries', id: 'gthc-hcne', url: 'https://data.cityofnewyork.us/d/gthc-hcne' },
  elevation: { name: 'USGS 3DEP bare-earth elevation (metres)', url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer' },
};

// Landmarks. Every tower here is drawn from its surveyed footprint like any
// other building; `tiers` only shapes the extrusion into the setbacks the
// 1916 zoning gave Midtown ([fraction of roof height, footprint scale]), and
// `spireMeters` adds the mast above the surveyed roof. Nothing is modelled by
// hand. `place` entries are labels only (parks, squares).
export const LANDMARKS = {
  empire_state:  { label: 'Empire State Building', latitude: 40.748441, longitude: -73.985664, heightMeters: 443,
    tiers: [[0.055, 1], [0.72, 0.58], [0.86, 0.42], [0.95, 0.3], [1, 0.14]], spireMeters: 443 },
  chrysler:      { label: 'Chrysler Building', latitude: 40.751652, longitude: -73.975311, heightMeters: 319,
    tiers: [[0.2, 1], [0.6, 0.74], [0.8, 0.58], [0.9, 0.44], [0.96, 0.3], [1, 0.14]], spireMeters: 319 },
  one_vanderbilt:{ label: 'One Vanderbilt', latitude: 40.752968, longitude: -73.978660, heightMeters: 427,
    tiers: [[0.22, 1], [0.55, 0.86], [0.82, 0.7], [0.95, 0.5], [1, 0.28]] },
  rockefeller:   { label: '30 Rockefeller Plaza', latitude: 40.758740, longitude: -73.978955, heightMeters: 259,
    tiers: [[0.28, 1], [0.62, 0.82], [0.86, 0.66], [1, 0.5]] },
  bank_of_america:{ label: 'Bank of America Tower', latitude: 40.755577, longitude: -73.984542, heightMeters: 366,
    tiers: [[0.68, 1], [0.9, 0.76], [1, 0.3]], spireMeters: 366 },
  hudson_yards:  { label: '30 Hudson Yards', latitude: 40.753786, longitude: -74.001110, heightMeters: 387,
    tiers: [[0.32, 1], [0.72, 0.86], [1, 0.7]] },
  central_park_tower: { label: 'Central Park Tower', latitude: 40.766315, longitude: -73.980917, heightMeters: 472,
    tiers: [[0.12, 1], [1, 0.8]] },
  steinway:      { label: '111 West 57th Street', latitude: 40.764852, longitude: -73.977670, heightMeters: 435, tiers: [[0.16, 1], [1, 0.9]] },
  park_432:      { label: '432 Park Avenue', latitude: 40.761614, longitude: -73.971744, heightMeters: 426, tiers: [[1, 1]] },
  grand_central: { label: 'Grand Central Terminal', latitude: 40.752726, longitude: -73.977229, heightMeters: 38, tiers: [[1, 1]] },
  flatiron:      { label: 'Flatiron Building', latitude: 40.741061, longitude: -73.989699, heightMeters: 87, tiers: [[1, 1]] },
  nypl:          { label: 'New York Public Library', latitude: 40.753179, longitude: -73.982176, heightMeters: 32, tiers: [[1, 1]] },
  msg:           { label: 'Madison Square Garden', latitude: 40.750504, longitude: -73.993439, heightMeters: 46, tiers: [[1, 1]] },
  united_nations:{ label: 'United Nations Secretariat', latitude: 40.749002, longitude: -73.968083, heightMeters: 154, tiers: [[1, 1]] },
  times_square:  { label: 'Times Square', latitude: 40.758000, longitude: -73.985500, heightMeters: 40, place: true },
  bryant_park:   { label: 'Bryant Park', latitude: 40.753597, longitude: -73.983233, heightMeters: 0, place: true },
  central_park:  { label: 'Central Park', latitude: 40.769500, longitude: -73.976000, heightMeters: 0, place: true },
};

// The Tech Week layer's fixed places in this world.
export const WORLD = {
  timeZone: 'America/New_York',
  harbor: { lat: 40.7470, lng: -73.9585 },     // holding pattern over the East River, off the UN
  mast: { lat: 40.7536, lng: -73.9832 },       // leaderboard mast in Bryant Park
  flagship: { lat: 40.7484, lng: -73.9857, y: 520 },  // week banner above the Empire State Building
  spawn: { lat: 40.7550, lng: -73.9840, heading: -0.35 },  // a new bird enters over Bryant Park, facing the Empire State (velocity = sin h, 0, cos h; z south)
  featured: { lat: 40.7536, lng: -73.9832, y: 210 },      // the host's own ship, parked over Bryant Park
  core: { lat: 40.7536, lng: -73.9832, radius: 700 },     // Midtown core: where ships with no address of their own fly
  downtownView: { lat: 40.7527, lng: -73.9820, y: 140 },  // the "Midtown" camera view target
  flagshipVenue: { venue: 'Empire State Building', address: 'Fifth Avenue' },
  neighborhoods: [
    ['Midtown', 40.7549, -73.9840], ['Times Square', 40.7580, -73.9855], ['Bryant Park', 40.7536, -73.9832],
    ['Grand Central', 40.7527, -73.9772], ['Murray Hill', 40.7478, -73.9757], ['Koreatown', 40.7477, -73.9868],
    ['Garment District', 40.7538, -73.9910], ['Hudson Yards', 40.7538, -74.0011], ['Hell’s Kitchen', 40.7638, -73.9918],
    ['Columbus Circle', 40.7681, -73.9819], ['Midtown East', 40.7570, -73.9700], ['Turtle Bay', 40.7530, -73.9680],
    ['Flatiron', 40.7411, -73.9897], ['Chelsea', 40.7465, -74.0014], ['NoMad', 40.7448, -73.9880], ['Gramercy', 40.7368, -73.9845],
    ['Union Square', 40.7359, -73.9911], ['Kips Bay', 40.7420, -73.9770], ['Lincoln Square', 40.7736, -73.9830], ['Long Island City', 40.7447, -73.9485],
  ],
};

// ---- what the world-kit build needs beyond the places ----------------------
export const NAME = 'TECH WEEK CITY · MANHATTAN';
export const CITY = { word: 'MANHATTAN', label: 'Manhattan', loading: 'Loading Manhattan', region: 'New York, NY', utcOffset: '-04:00',
  gcalCity: 'New York, NY', hostFallback: 'Someone in NYC', districtFallback: 'Midtown', originLabel: 'Bryant Park', water: 'Hudson and East River', world: 'Manhattan Midtown' };

export const VIEWS = [
  { id: 'overview', short: 'Overview', name: 'Manhattan', fact: 'Midtown Manhattan between the Hudson and the East River, mapped to real geographic coordinates.' },
  { id: 'downtown', short: 'Midtown', name: 'Midtown', fact: 'Nearly 20,000 surveyed NYC footprints with their roof heights, courtyards and the setbacks the 1916 zoning gave the towers.' },
  { id: 'empire_state', short: 'Empire State', name: 'Empire State Building', fact: 'A 381 m Art Deco tower from 1931, 443 m to the tip of its mast \u2014 the skyline\u2019s anchor for ninety years.' },
  { id: 'chrysler', short: 'Chrysler', name: 'Chrysler Building', fact: 'A 319 m crown of stainless-steel arches and a spire, finished in 1930.' },
  { id: 'one_vanderbilt', short: 'One Vanderbilt', name: 'One Vanderbilt', fact: 'A 427 m tapered tower beside Grand Central, opened in 2020.' },
  { id: 'rockefeller', short: '30 Rock', name: '30 Rockefeller Plaza', fact: 'The 259 m slab at the heart of Rockefeller Center, stepped back in limestone.' },
  { id: 'hudson_yards', short: 'Hudson Yards', name: '30 Hudson Yards', fact: 'A 387 m tower over the rail yards on the far West Side, with the city\u2019s highest outdoor deck.' },
  { id: 'central_park_tower', short: 'Central Park Tower', name: 'Central Park Tower', fact: 'At 472 m the tallest residential building in the world, on Billionaires\u2019 Row.' },
  { id: 'flatiron', short: 'Flatiron', name: 'Flatiron Building', fact: 'The 87 m wedge at Fifth Avenue and Broadway, 1902.' },
];
export const LABELS = ['empire_state', 'chrysler', 'one_vanderbilt', 'rockefeller', 'hudson_yards', 'central_park_tower', 'flatiron', 'grand_central', 'times_square', 'bryant_park', 'central_park', 'msg', 'united_nations', 'nypl', 'bank_of_america', 'steinway', 'park_432'];

// Local metres: x east, y up, z south.
export const CAMERA = {
  overview: { position: [-1500, 1900, 4900], target: [0, 120, -500] },
  downtownOffset: [-1100, 560, 1500],
  tour: [
    ['overview', [-1700, 1500, 4600], [-200, 130, -400]],
    ['pass', 'flatiron', [-520, 420, 640]],
    ['pass', 'empire_state', [900, 560, 700]],
    ['pass', 'empire_state', [-820, 520, -480]],
    ['pass', 'downtown', [-1150, 600, 1300]],
    ['pass', 'one_vanderbilt', [700, 620, 560]],
    ['pass', 'chrysler', [640, 460, -520]],
    ['pass', 'rockefeller', [-700, 500, 520]],
    ['pass', 'central_park_tower', [-760, 640, 900]],
    ['pass', 'central_park', [300, 700, 1500]],
    ['pass', 'hudson_yards', [-1100, 600, 500]],
    ['pass', 'hudson_yards', [900, 520, -700]],
    ['overview', [-4600, 1300, 700], [-600, 130, -200]],
    ['overview', [-3200, 1500, 3600], [-300, 130, -300]],
  ],
};

export const PORTRAIT = {
  paragraph: 'Building footprints, roof heights, streets and the shoreline come from NYC Open Data; the ground is USGS 3DEP elevation. Nearly 20,000 Midtown footprints keep their surveyed coordinates and courtyards. Setbacks on the towers follow a seeded rule and the published massing of the named landmarks. Facade colors and window patterns are illustrative. Two-tone shading, fine ink lines and distance fog keep the city in its Sable-inspired palette.',
  buildings: '20,000', streets: '4,500',
};

export const BIRDS = {
  gull: { name: 'Herring Gull', blurb: 'The native. Steady, unbothered, everywhere from the piers to the park.' },
  pelican: { blurb: 'Big wings, slow flaps. A summer visitor to the harbour.' },
  raven: { blurb: 'Ink on ink. Nests on the bridges these days.' },
  hummingbird: { name: 'Ruby-throated Hummingbird' },
  peregrine: { blurb: 'Nests on the MetLife Building. Naturally.' },
  parrot: { name: 'Monk Parakeet', cn: '\u548c\u5c1a\u9e66\u9e49', blurb: 'The Brooklyn parakeet. Loud, local, beloved.' },
};

// NYC footprints carry a surveyed roof height; an unsurveyed one is a low block.
export const HEIGHTS = { levelMetres: 3, default: 4.5, max: 480, byKind: {} };

// CSCL rw_type: 1 street \u00b7 2 highway \u00b7 3 bridge \u00b7 4 tunnel \u00b7 6 path \u00b7 7 step
// street \u00b7 8 driveway \u00b7 9 ramp \u00b7 10 alley \u00b7 13 U-turn \u00b7 14 ferry route.
const ROAD_TYPES = new Set(['1', '2', '3', '6', '9', '10']);
export const ROADS = {
  include: road => ROAD_TYPES.has(String(road.kind)),
  width: road => { let width = road.width > 0 ? road.width : 9; if (road.kind === '6') width = Math.min(width, 6); return Math.max(5, Math.min(30, width)); },
  tone: (road, width) => road.kind === '2' ? 235 : width >= 22 ? 190 : 135,
};

// West of the state line only the bare-earth height tells New Jersey from the river.
export const LAND_RULE = (lon, lat, elevation) => lon < -74.012 && elevation >= 0.6;
