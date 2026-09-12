# world-kit — one city generator and one world build for every parallel world

The parallel worlds (Manhattan, Shibuya, Shanghai, …) share this kit. A world
is a directory `<city>/` holding:

```
config.mjs           everything that names a place in the world (contract below)
fetch-data.mjs       downloads public data into <city>/.cache/ (gitignored) and
                     writes <city>/.cache/world-data.json in the format below
seed-events.json     the sample programme shown while no live feed exists
city/                generated resources (committed): node world-kit/generate.mjs <city>
README.md            what is in the box, sources, licences
```

```sh
node <city>/fetch-data.mjs             # network; writes <city>/.cache/world-data.json
node world-kit/generate.mjs <city>     # <city>/.cache → <city>/city/*.gz + manifest.json
node world-kit/build.mjs <city>        # → dist-<city>/  (serve with any static server)
```

Node built-ins only, no `npm install`. Nothing here touches the San Francisco
build; the worlds reuse its pipeline through exact-match patches that throw
`<City> patch target changed` if the base game moves.

## `<city>/.cache/world-data.json`

```jsonc
{
  "fetchedAt": "2026-09-12T08:00:00Z",
  "sources": [{ "name": "OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright", "licence": "ODbL" }],
  "buildings": [
    { "id": "w12345",                              // stable per feature; seeds the facade family and tone
      "rings": [[[lon, lat], ...], [[lon, lat], ...]],   // outer ring first, then holes; any orientation, closed or not
      "height": 28.5,                              // metres above ground, or null when unknown
      "levels": 4,                                 // storeys, or null
      "year": 1985,                                // construction year, or null
      "kind": "retail" }                           // free text (OSM building=*, dataset feature code…)
  ],
  "roads": [
    { "id": "w678", "points": [[lon, lat], ...],   // one polyline per entry (split multi-lines)
      "kind": "primary",                           // free text (OSM highway=*, dataset road type…)
      "width": 12.0,                               // metres, or null
      "lanes": 4,                                  // or null
      "tunnel": false, "bridge": false }
  ],
  "water": [ { "rings": [[[lon, lat], ...], ...] } ],   // water polygons (outer + holes); land = outside all of them
  "land":  [ { "rings": [...] } ],                       // optional; when present, land = inside any of these instead
  "terrain": { "kind": "grid", "west": 139.67, "north": 35.69, "dLon": 0.0000858, "dLat": 0.0000695,
               "nx": 640, "ny": 640, "heights": [ ... ] }   // row-major from the north-west corner, metres; null = no data
            // or { "kind": "flat", "height": 4.0 }
}
```

Heights: the kit uses `height`, else `levels × config.HEIGHTS.levelMetres`, else
`config.HEIGHTS.byKind[kind]`, else `config.HEIGHTS.default`. Never invent a
tower: an unknown height is a low block.

## `<city>/config.mjs`

Copy `manhattan/config.mjs` and keep every export; the kit reads:

| export | meaning |
|---|---|
| `NAME` | masthead / tab title, e.g. `'TECH WEEK CITY · SHIBUYA'` |
| `CITY` | `{ word: 'SHIBUYA', label: 'Shibuya', loading: 'Loading Shibuya', region: 'Tokyo, Japan', utcOffset: '+09:00', gcalCity: 'Tokyo, Japan', hostFallback: 'Someone in Tokyo' }` |
| `BOX`, `ORIGIN`, `METERS_LAT`, `METERS_LON`, `project`, `GRID_METRES`, `TERRAIN_BOUNDS` | as in Manhattan |
| `SOURCES` | `{ key: { name, url, … } }`; every entry is linked from the in-game data panel |
| `LANDMARKS` | `{ id: { label, latitude, longitude, heightMeters, tiers?, spireMeters?, place? } }` — `tiers` = `[[fraction of height, footprint scale], …]` for published massing; `place` = label only |
| `WORLD` | `{ timeZone, harbor, mast, flagship: {lat,lng,y}, spawn: {lat,lng,heading}, featured: {lat,lng,y}, core: {lat,lng,radius}, downtownView: {lat,lng,y}, neighborhoods: [[name, lat, lng], …], flagshipVenue: { venue, address } }` |
| `VIEWS` | `[{ id, short, name, fact }]` — `overview`, `downtown`, then landmark ids |
| `LABELS` | landmark ids that get a floating label |
| `CAMERA` | `{ overview: { position: [x,y,z], target: [x,y,z] }, downtownOffset: [x,y,z], tour: [ ['overview', [x,y,z], [tx,ty,tz]] \| ['pass', landmarkId \| 'downtown', [dx,dy,dz]] … ] }` — local metres, x east, y up, z south |
| `PORTRAIT` | `{ paragraph, buildings: '20,000', streets: '4,500' }` — the in-game data panel |
| `BIRDS` | names/blurbs for the six bird models: `gull, pelican, raven, hummingbird, peregrine, parrot` → `{ name?, cn?, blurb? }` (local species; models stay) |
| `HEIGHTS` | `{ levelMetres: 3.1, default: 9, byKind: { house: 7, … } }` |
| `WATER_HEIGHT?` | metres below the water plane for water cells (default −2.5); `LAND_MIN_HEIGHT?` (default 1.2) |
