# Shibuya, Tokyo — a parallel world

The same game as SF Tech Week City — the ink renderer, the two-tone palettes,
the bird, the airships — over Shibuya instead of San Francisco. It is built as
**its own game** through the shared kit (`world-kit/README.md`); nothing in here
is loaded by the San Francisco build, and nothing in the SF build reads this
directory.

```sh
node shibuya/fetch-data.mjs           # OpenStreetMap + GSI → shibuya/.cache/world-data.json (~46 MB cache, ~2 min)
node world-kit/generate.mjs shibuya   # shibuya/.cache → shibuya/city/
node world-kit/build.mjs shibuya      # → dist-shibuya/ (serve it with any static server)
```

## What is in the box

| | |
|---|---|
| Area | 35.638–35.680° N, 139.675–139.725° E: Meiji Jingu and Yoyogi Park in the north, Harajuku, Omotesando and the Aoyama edge in the east, Daikanyama, Ebisu and Yebisu Garden Place in the south, Shinsen and the edge of Nakameguro in the west — about 4.5 × 4.7 km |
| Origin | Shibuya Scramble Crossing, 35.6595° N 139.7005° E; local metres, x east, y up, z south |
| Buildings | 48,271 OpenStreetMap footprints (multipolygons stitched, courtyards kept). OSM carries a `height` on ~10 % of them and `building:levels` on ~13 %; the rest rise to the per-kind defaults in `config.mjs → HEIGHTS` (Tokyo storeys of 3.1 m) — an unknown height is a low block |
| Streets | 5,814 OpenStreetMap ways (motorway … service) with `width`, `lanes`, `tunnel` and `bridge` where tagged |
| Water | 40 small polygons (ponds in Meiji Jingu, Yoyogi Park and the gardens; the Shibuya River is culverted through most of the box) |
| Ground | GSI 標高タイル (DEM10B, 10 m mesh) at zoom 14, resampled bilinearly from web-mercator to a 454 × 469 lon/lat grid at ~10 m; 5–43 m above sea level, the crossing at 19 m, Harajuku 30 m, Yoyogi Park 34 m |
| Landmarks | No hand-modelled buildings. The named towers are their own OSM footprints, stepped back to their published massing (`config.mjs → LANDMARKS`); `node shibuya/check-landmarks.mjs` reports which footprint each coordinate falls in and the OSM height it carries |
| Events | A **sample programme** — real Shibuya venues, fictional hosts, speakers and counts (`seed-events.json`, JST). Point the page at a real feed with `?events=<url>` or serve one at `/events.json` |
| Multiplayer | Off, as for Manhattan |

Facade families are an illustrative palette inferred from construction year
and height with a stable seed, as in the SF world. Nothing here is a surveyed
facade colour.

## Sources and licences

| | |
|---|---|
| Buildings, streets, water | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/), via the Overpass API (`overpass.openstreetmap.fr`, with `overpass-api.de` and `overpass.kumi.systems` as fallbacks) |
| Elevation | 国土地理院 [地理院タイル 標高タイル](https://maps.gsi.go.jp/development/ichiran.html#dem) (`dem`, DEM10B — 基盤地図情報 数値標高モデル 10 m), under the [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html) (Government of Japan Standard Terms of Use v2.0, compatible with CC BY 4.0). Attribution: **出典：国土地理院**. Publishing a map that reproduces the survey result may additionally need approval under the Survey Act (測量法 第29・30条) — this world states the source and does not claim such approval |

## Files

```
config.mjs           the crawl box, projection origin, landmarks, the Tech Week layer's
                     places (harbour, mast, flagship, spawn, neighbourhoods), views,
                     camera, tour, texts, birds, height and road rules — the world-kit contract
fetch-data.mjs       Overpass (4×4 sub-boxes, sequential, resumable) + GSI tiles → .cache/world-data.json
check-landmarks.mjs  checks config.LANDMARKS coordinates against the fetched footprints
seed-events.json     the sample programme
city/                the generated resources (node world-kit/generate.mjs shibuya)
```

`.cache/` is gitignored (raw Overpass responses, the GSI tiles and the
normalised `world-data.json`, ~46 MB). Re-running the fetch skips every sub-box
and tile already there; delete the directory to refresh from the network.

Not wired for Tokyo: the address search box of the base game (it queried
DataSF), the Discord address exchange and the calendar service — those are SF
deployments and are not part of this world.
