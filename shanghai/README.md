# Shanghai — a parallel world

The same game as SF Tech Week City — the ink renderer, the two-tone palettes,
the bird, the airships — over the centre of Shanghai: People's Square, Nanjing
Road, the Bund, the Huangpu and the Lujiazui towers. It is built through the
shared `world-kit/` as **its own game** in `dist-shanghai/`; nothing here is
loaded by the San Francisco build.

```sh
node shanghai/fetch-data.mjs           # OpenStreetMap via Overpass → shanghai/.cache/ (gitignored)
node shanghai/check-landmarks.mjs      # every LANDMARK coordinate sits on an OSM footprint
node world-kit/generate.mjs shanghai   # → shanghai/city/
node world-kit/build.mjs shanghai      # → dist-shanghai/ (serve with any static server)
```

## What is in the box

| | |
|---|---|
| Area | 31.213–31.257° N, 121.462–121.528° E: People's Square and the west end of Nanjing Road to Century Avenue in Pudong; Xintiandi and Dongjiadu in the south to Suzhou Creek and the North Bund in the north |
| Origin | The Bund promenade at Chen Yi Square, 31.2400° N 121.4860° E; local metres, x east, y up, z south |
| Buildings | 8,609 OpenStreetMap footprints (178 of them courtyard multipolygons); 181 carry a tagged height (16 taken from their tallest `building:part`), 1,332 a storey count, 172 a construction year. OSM coverage of small buildings in Shanghai is partial — some blocks stand emptier than the city does |
| Streets | 4,645 highway polylines (motorway…service, pedestrian, living street) with lanes, bridge and tunnel flags; OSM carries no widths here |
| Water | 60 polygons: the Huangpu River in its OSM segments, Suzhou Creek, the harbour basins and park ponds. The Huangpu is 419 m wide at Nanjing Road (121.4863–121.4907° E) |
| Ground | Flat at 4 m — Shanghai is a delta. No elevation download |
| Landmarks | No hand-modelled buildings. The named towers are their own OSM footprints, stepped back to their published massing (`config.mjs` → `LANDMARKS`); a tagged OSM height wins over the table, the table wins over a bare storey count |
| Events | A **sample programme** — real venues, fictional hosts, speakers and counts (`seed-events.json`). Serve a real feed at `/events.json` or open the page with `?events=<url>` |
| Multiplayer | Off, as for Manhattan |

Heights: 632 m Shanghai Tower, 492 m SWFC, 420.5 m Jin Mao, 468 m Oriental
Pearl (from its `building:part`), 333 m Shimao International Plaza, 284.6 m
Tomorrow Square, 259.9 m Two IFC, 226 m Bank of China Tower (from its
`building:part`). The Bund's Customs House, Peace Hotel and HSBC Building carry
only storey counts in OSM (7, 11, 7), so their heights come from the landmark
table (79 m clock tower, 77 m, 46 m); Le Royal Méridien has no identifiable
footprint in OSM and is not a landmark.

## Sources and licences

Everything is © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright),
fetched through the public Overpass instance at `overpass.openstreetmap.fr`
(`overpass-api.de` and `kumi.systems` were unreachable from the build host).
Facade families and colours are illustrative, as in the SF world.

## Files

```
config.mjs           the crawl box, projection origin, landmarks, the Tech Week layer's
                     places (harbour, mast, flagship, spawn, neighbourhoods), views,
                     camera, tour, birds and height defaults — the world-kit contract
fetch-data.mjs       Overpass downloads into .cache/ (16 sub-boxes each for buildings and
                     roads, one request each for water and building parts; resumable) and
                     the kit's normalised .cache/world-data.json with a water self-check
check-landmarks.mjs  reports, per landmark, the OSM footprint under its coordinate and that
                     footprint's height/storeys; --find <regex> searches footprints by name
seed-events.json     the sample programme (Oct 5–11, 2026, +08:00)
city/                the generated resources + manifest.json (node world-kit/generate.mjs shanghai)
```

## Regenerating

`node shanghai/fetch-data.mjs` re-downloads only what is missing from
`.cache/`; pass `--fresh` to refetch everything (about 35 polite sequential
requests, a few minutes). It ends with counts, the tallest tagged buildings
and a water check — a point mid-river off the Bund must be water, People's
Square, the Oriental Pearl and the Bund promenade must be land — and exits
non-zero if that fails. Then `node shanghai/check-landmarks.mjs` must report
every tower on a footprint before regenerating `city/`.

Behind a proxy the script uses `curl` (it reads `HTTPS_PROXY`); Node's own
`fetch` is only the fallback when curl is missing.
