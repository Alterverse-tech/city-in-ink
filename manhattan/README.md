# Manhattan Midtown — a parallel world

The same game as SF Tech Week City — the ink renderer, the Sable-inspired
two-tone palettes, the bird, the airships — over Midtown Manhattan instead of
San Francisco. It is built as **its own game** in `dist-manhattan/`; nothing in
here is loaded by the San Francisco build, and nothing in the SF build reads
this directory.

```sh
npm run build:manhattan                                   # → dist-manhattan/
python3 -m http.server 8791 --directory dist-manhattan    # any static server
```

Open http://localhost:8791/. Expected in the console, exactly as for the SF
standalone build: `/events.json` and `/addresses.json` 404 (no calendar or
address service is deployed for this world), `assets/airship.glb` and the
Tech Week logo 404 (optional assets with built-in fallbacks).

## What is in the box

| | |
|---|---|
| Area | Hudson (with the Hoboken/Weehawken shore) to the East River (Long Island City, Roosevelt Island), ~12th Street to ~72nd Street |
| Origin | Bryant Park, 40.7550° N 73.9855° W; local metres, x east, y up, z south |
| Buildings | 19,921 surveyed footprints with roof heights and courtyards (NYC Open Data, Building Footprints `5zhs-2jue`) |
| Streets | 4,549 centerline segments with their widths (NYC Open Data, Centerline `inkn-q76z`) |
| Ground | USGS 3DEP bare-earth elevation on a 20 m grid; land mask from the NYC borough polygons (`gthc-hcne`), and from the elevation west of the state line |
| Landmarks | No hand-modelled buildings. The named towers are their own footprints, stepped back to their published massing (`config.mjs` → `LANDMARKS`); other towers above 90 m get a seeded setback |
| Events | A **sample programme** — real Midtown venues, fictional hosts, speakers and counts (`seed-events.json`). Point the page at a real feed with `?events=<url>` or serve one at `/events.json` |
| Multiplayer | Off. The presence room is bound to the SF Chrona World; register a World for this city, add a `public-world.js` for it and put the `multiplayer.js` import back in `build.mjs` |

Facade families (stone / concrete / brick / glass / granite) are an illustrative
palette inferred from construction year and height with a stable seed, as in
the SF world. Nothing here is a surveyed facade colour.

## Files

```
config.mjs           the crawl box, projection origin, landmarks, the Tech Week layer's
                     places (harbour, mast, flagship, spawn, neighbourhoods), views,
                     camera, tour, birds and road rules — the world-kit contract
fetch-data.mjs       downloads the open data into .cache/ (gitignored) and writes the
                     kit's normalised .cache/world-data.json
city/                the generated resources + manifest.json (committed, ~6 MB)
seed-events.json     the sample programme
```

The generator and the build live in `world-kit/` and are shared by every
parallel world (`world-kit/README.md`).

## Regenerating the city

```sh
node manhattan/fetch-data.mjs          # NYC Open Data + USGS, ~20 MB into manhattan/.cache/
node world-kit/generate.mjs manhattan   # ~15 s → manhattan/city/
npm run build:manhattan                 # = node world-kit/build.mjs manhattan
```

Behind a proxy, Node ≥ 24 needs `NODE_USE_ENV_PROXY=1`; on older Node the
fetch script falls back to `curl`, which reads the same proxy variables.

## How the build works

`world-kit/build.mjs` reassembles the original San Francisco game from `source/`, swaps
the inline city resources for `city/`, and patches the bundle with exact-match
replacements — projection origin, landmark table, labels, camera views, the
cinematic tour, spawn point, water plane, flight fence, texts — and the Tech
Week layer's places, time zone (`America/New_York`) and bird names. The result
then goes through the same pipeline as `build-local.mjs` (`renderGame`,
streaming tiles, startup), with the SF-specific strings those steps introduce
(brand, boot overlay, featured/core coordinates) patched afterwards. The add-on
copies (`city-extras.mjs`, `events-sync.js`, `city-time.mjs`,
`city-streaming.js`) get the same treatment. Every patch throws
`Manhattan patch target changed` if the base game moves under it — fix the
patch, never skip the check.

Not wired for New York: the address search box of the base game (it queried
DataSF) is hidden; the Discord address exchange and the calendar service are
SF deployments and are not part of this world.
