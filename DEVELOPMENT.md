# SF Tech Week City — SF Tech Week 2026

*Every event is an airship.* The game is named **SF TECH WEEK CITY** (formerly *City in Ink*; the repository keeps its old name). The rename is applied at build time by `wireBrand()` in `build.mjs`, so the original single-file game in `source/` is unchanged. A single-file browser game: fly a bird over an ink-rendered San Francisco while the public SF Tech Week calendar is mapped onto the city. This repository is the development source for the Chrona World **SF Tech Week — City in Ink** and is the place where GitHub collaborators work; the live game is published through Chrona (see [Relationship with Chrona](#relationship-with-chrona)).

## 快速开始（中文）

新加入的开发者请读 **[协作手册](collaborator-handbook.zh.md)** —— 上手、日常流程、以及"推 main 即上线"的注意事项。

前提：仓库是私有的，先让 owner 把你的 GitHub 账号加为协作者。

```sh
git clone git@github.com:Alterverse-tech/city-in-ink.git && cd city-in-ink   # 或 https://github.com/Alterverse-tech/city-in-ink.git
npm run build:local                                   # 生成 dist-local/，无需 npm install
python3 -m http.server 8790 --directory dist-local    # 任意静态服务器都行
```

打开 http://localhost:8790 即可游玩。**不要用 `npm run build` 的产物 `dist/` 在本地打开**——那是 Chrona 托管版，脱离 Chrona 的 iframe 会直接报 `A trusted HTTPS host origin is required`。改代码后重新 `npm run build:local` 刷新即可。发布到线上仍然走 Chrona，见下文。

## Requirements

| Requirement | Notes |
|---|---|
| Node.js 20+ | Verified on 24.14.1. The build scripts use only Node built-ins; there is **no `npm install`**. |
| Git | Repository work. |
| Any static file server | `python3 -m http.server` is used in examples; nothing is server-side rendered. |
| Chrona CLI (`chrona-game` plugin ≥ 0.3.1) | Only for publishing to the live World. Not needed for local development. |

## Install and run locally

```sh
npm run build:local
python3 -m http.server 8790 --directory dist-local
```

Open http://localhost:8790/. What to expect in standalone mode:

- The city, the bird picker and gull flight routes all work from the saved public event data in `data/`.
- Event poster images from `cdn.tech-week.com` fail with CORS errors in the console on `localhost`; the game falls back to its own posters. Cosmetic.
- `/events.json` returns 404 from a plain static server, so the calendar shows the saved snapshot instead of a live refresh. To test live refresh, run `node calendar-server.mjs` (see [Calendar service](#calendar-service)) behind a reverse proxy that maps `/events.json` to it. Not required for development.
- `/assets/airship.glb` and `/assets/brand/techweek-logo.svg` return 404. The repository has no `assets/` directory; both are optional (the airship is an optional Blender export with a procedural fallback, the logo renders as text) and they 404 on the live Chrona build as well.
- Sign-in and multiplayer use the standalone `chrona/chrona-connect.js` path (Supabase auth, control plane `https://multiplayer.13-216-49-19.sslip.io`, which is the **test** multiplayer environment, `livemode: false`). Inside Chrona the account is supplied by the host frame instead.

## Repository layout

```
source/part-*.txt, source/manifest.json   The original single-file game (24,130,132 bytes, SHA-256
                                           16c29efe…), split into 49 parts because Chrona limits text
                                           files to 4 MiB each. Reassembly verifies the manifest hash.
build.mjs                                  renderGame(): patches the original HTML — injects the add-on
                                           module imports, the dialog fix and the event-feed hook.
build-hosted.mjs                           `npm run build` → dist/ for Chrona. Adds the host-frame handshake.
city-assets-build.mjs                      Packages 18 city resources as content-hashed city-assets/*.bin
                                          files; hosted/local entries stay about 1.2 MB.
build-local.mjs                            `npm run build:local` → dist-local/ for local work. Same source,
                                           no handshake.
build-artifact.mjs, artifact-assets.js     `npm run build:artifact` → dist-artifact/: one self-contained HTML
                                           file (~10.8 MB) for hosts that serve a single page with no network
                                           — claude.ai Artifacts and the like. See "Single-file preview build".
events-build.mjs                           The narrow patches applied by renderGame (event backend swap,
                                           in-game refresh interval 15 min → 60 s).

events-sync.js, events-sync.css            Event feed sync + poster loading from whitelisted origins.
gull-cluster-route.mjs                     Fly-to fallback: an event with no place in the world sends the gull to the busiest building.
multiplayer.js, multiplayer.css            Multiplayer UI; hosted or standalone connect.
network-pose.js                            Pose encoding for the netcode (1 authority unit = 100 m).
public-world.js                            The fixed directory entry: World id 93a8c02d…, gameId cybercity.
hosted-bootstrap.js                        Chrona host handshake; swaps localStorage/sessionStorage to
                                           host-scoped preferences. Hosted build only.
chrona/                                    Chrona client SDK copies: chrona-host.js (hosted facade),
                                           chrona-connect.js (standalone auth + rooms), presence, space,
                                           worlds, connect UI, amp/ netcode, socket.io.

calendar-server.mjs, event-cache.mjs,      Separately deployed public calendar service (see below).
tech-week-source.mjs
data/                                      Saved public event data (tech-week-enriched.json 3.8 MB,
                                           tech-week-calendar.json 1.1 MB, …). See data/README.md.
delivery.json                              Chrona delivery metadata for the hosted build.
```

Generated and ignored: `dist/`, `dist-local/`, `dist-artifact/`, `node_modules/`, `.chrona/`. Never commit `.chrona/` — it holds the Chrona workspace binding.

## Editing

There are two editing surfaces:

1. **Add-on modules** (`multiplayer.js`, `events-sync.js`, `gull-cluster-route.mjs`, styles, `chrona/`): edit directly, rebuild with `npm run build:local`, reload.
2. **The original city** (`source/part-*.txt`): the parts are byte slices of one HTML file. After editing, refresh the manifest hash and commit it together with the parts:

   ```sh
   node build-hosted.mjs --accept-source-update
   git add source/ && git commit
   ```

   Without `--accept-source-update` both build scripts refuse to run on changed source bytes; this protects against accidental corruption of the split file. The split is packaging, not a replacement game.

Both build scripts patch the original with exact-match string replacements (`events-build.mjs`, `build.mjs`). If a patch target disappears after a source edit, the build fails with `… patch target changed` — update the patch or the source, don't skip the check.

The GitHub workflow is ordinary: branch, commit, open a pull request against `main`.

## Relationship with Chrona

The live game is a Chrona World:

| | |
|---|---|
| Site | https://chrona.world |
| World ID | `e9ef2f62-a6e0-47f2-8795-c2941cbc433a` |
| Studio editor | https://chrona.world/studio/?world=e9ef2f62-a6e0-47f2-8795-c2941cbc433a |
| Collaboration (branches, review, release) | https://chrona.world/studio/collaboration/?world=e9ef2f62-a6e0-47f2-8795-c2941cbc433a |
| Play | https://chrona.world/play/e9ef2f62-a6e0-47f2-8795-c2941cbc433a/ (sign-in required) |
| Hosted multiplayer binding | World `93a8c02d-df9f-4db6-bbfe-a663772a6b5b`, gameId `cybercity`, `livemode: false` |

**Origin of this repository.** It was exported on 2026-09-09 from the World's collaboration checkout at main commit `a9c1cd20` (submission *"Navigate buttons, event mini map, gull flight route…"*). Chrona stores each World as a bare git repository on the server (`project.git`, one `project.json` per commit); that history is **not** replayed here — this repo starts from a snapshot import. Chrona's own commit ids (`a9c1cd20`, …) do not correspond to commits in this repo.

**A merge to `main` is a production deploy.** Chrona does not read GitHub; the CI below is what carries a commit across, and it releases without asking anyone.

### Automatic release from GitHub (CI)

**Every push to `main` goes live.** [`.github/workflows/chrona-release.yml`](.github/workflows/chrona-release.yml) mirrors the commit into a fresh Chrona branch, builds it, uploads a preview, then approves, merges and **releases** it to the live World. There is no human gate in the pipeline, so the real gate is *who can merge to `main`* — protect that branch rather than relying on a review click. The Actions run summary reports the live revision and the play link.

**Chrona-side edits are detected, not overwritten.** The mirror step replaces the whole tree, so a change made directly on Chrona (Studio Collaboration, or the CLI) that never reached this repository would otherwise be silently deleted. Before mirroring, the pipeline reconstructs the last GitHub tree it synced — every commit it makes records its GitHub sha, so that sha is read back from Chrona `main`'s ancestry — and compares it against what Chrona `main` holds now. Any added, changed or deleted file stops the run before anything is pushed, and the summary names the files. Bring them into this repository and push again, or re-run with `CHRONA_ALLOW_DRIFT=1` to let GitHub win. This needs the full history, hence `fetch-depth: 0` on the checkout step.

Run **Actions → Chrona release → Run workflow** and pick **stop_at** to go part way: `drift` audits for Chrona-side edits and writes nothing at all, `preview` stops after the branch preview, `submit` stops before the release, `release` (the default) does everything.

- Credential: repository secret `CHRONA_CLIENTS_JSON`, a `clients.json` holding one World-scoped connection with `read, write, publish`. Chrona refuses `--remember` together with `--world`, so this credential **expires** (90 days). [`.github/check-chrona-credential.mjs`](.github/check-chrona-credential.mjs) runs before every release: it warns 14 days out and fails the run once the credential lapses. Re-mint it and update the secret:

  ```sh
  node CLI login --world 'https://chrona.world/studio/?world=e9ef2f62-a6e0-47f2-8795-c2941cbc433a' --publish --force
  python3 -c "import json,os;c=json.load(open(os.path.expanduser('~/.config/chrona/clients.json')));k=[x for x in c['clients'] if 'publish' in (x.get('scopes') or []) and x.get('worldId')];json.dump({'clients':k},open('ci.json','w'))"
  gh secret set CHRONA_CLIENTS_JSON --repo Alterverse-tech/city-in-ink < ci.json && rm ci.json
  ```

  Connections are revocable at https://chrona.world/studio/connect/.
- CLI: `Alterverse-tech/chrona-game` pinned by commit in the workflow (`CHRONA_CLI_COMMIT`); bump it deliberately.
- One push = one Chrona branch, one submission and one release. A push whose tree already matches Chrona `main` releases nothing.
- Docs-only pushes (`**.md`) and `.github/**` changes do not trigger it.
- To show work in progress **without** releasing, build a preview locally instead of dispatching the workflow:

  ```sh
  NODE_USE_ENV_PROXY=1 CHRONA_CLI=/path/to/chrona.mjs \
  CHRONA_WORLD='https://chrona.world/studio/?world=e9ef2f62-a6e0-47f2-8795-c2941cbc433a' \
  CHRONA_SUBMIT_STOP_AT=preview node .github/chrona-release.mjs      # or =submit to stop after submitting
  ```

> **Never dispatch this workflow on a branch other than `main`.** It would release that branch's tree to the live World, leaving GitHub `main` and the live game divergent — and the next push to `main` would then silently revert those changes.

### Publishing with the Chrona CLI

The `chrona-game` plugin (≥ 0.3.1) bundles `scripts/chrona.mjs`; `CLI` below is its absolute path. Login opens the browser once and remembers the connection outside the project.

```sh
WORLD='https://chrona.world/studio/?world=e9ef2f62-a6e0-47f2-8795-c2941cbc433a'
node CLI login    --world "$WORLD"
node CLI checkout --world "$WORLD" --dir ./city-in-ink-chrona --name "Describe the change" --client "Claude Code"
# copy the changed files from this repo into ./city-in-ink-chrona (everything except .git, dist*, .chrona)
cd city-in-ink-chrona
node CLI push    --dir . --summary "Describe the change"
npm run build                                   # hosted build → dist/
node CLI preview --dir . --dist dist            # branch-scoped preview link
node CLI submit  --dir . --title "Describe the change"
# owner:
node CLI review  --dir . --submission SUBMISSION_ID
node CLI merge   --dir . --submission SUBMISSION_ID
node CLI publish --dir .                        # releases the live World
```

`checkout` needs an empty directory and creates a Chrona branch. `rebase` integrates main before submitting. Chrona limits: 4 MiB per text file, 1,200 text files, 32 MiB text total; this project has no binary assets. `delivery.json` declares the static entry, the output directory and the exact origins the hosted game may contact (`connectOrigins`); add an origin there before the game fetches from it.

### The hosted build

`npm run build` writes `dist/` for Chrona. It differs from the local build only by the handshake in `hosted-bootstrap.js`: the game runs inside Chrona's sandboxed iframe, receives the signed-in account and the authoritative room from the host, and stores preferences per account/World instead of in browser `localStorage`. `chrona/chrona-host.js` deliberately has no standalone fallback — a failed handshake never starts a separate login — so `dist/` renders only the error line when opened outside Chrona. That is expected.

Both hosted and local builds extract the city's existing gzip/base64 payload from the HTML into `city-assets/*.bin`. The entry starts loading scripts immediately and the game's existing parallel fetches load the binary geometry relative to that build's directory. Three integer index arrays use lossless delta/varint encoding before gzip; floating-point positions and the other resources retain their original compressed bytes. Every decoded resource must match the original byte for byte. Serve or publish the entire output directory, including `city-assets/`; copying `index.html` alone is insufficient. The single-file artifact build retains its existing self-contained format. `npm test` rebuilds hosted/local outputs and verifies byte equivalence for all 18 resources, request concurrency, retry behavior, and entry size.

Builds also split the unchanged slim event snapshot into ordered UTF-8 parts of at most 200 KiB. The game can start from the small saved baseline while the complete snapshot loads in the background; incomplete parts never become an event feed. Optional calendar/address refreshes do not block scene readiness.

### Single-file preview build

`npm run build:artifact` writes `dist-artifact/index.html` (a complete document) and `dist-artifact/city-in-ink.artifact.html` (the same page without the `<html>/<head>/<body>` wrapper, for publishers that add their own). It exists for hosts that can serve exactly one HTML file and block every other origin — claude.ai Artifacts in particular, whose page limit is 16 MB while the original game is 24 MB. Compared with the local build:

- The embedded city geometry (23 MB of base64) is re-encoded by `build-artifact.mjs` — planar delta + zigzag varints, positions quantised to 2 cm steps (max error 1 cm) — and `artifact-assets.js` expands it back to the original `Float32Array`/`Uint32Array` bytes inside the page's `fetch` shim. The game bundle is byte-for-byte the original; the page lands at about 10.8 MB.
- `data/tech-week-enriched.json` and `data/tech-week-first.json` are embedded and served by the same shim; `/events.json` (and the chrona.world feed URL the add-ons poll when hosted) resolve to the enriched snapshot, so the calendar and gull routes both see the full snapshot without a calendar service.
- `events-sync.js` and `gull-cluster-route.mjs` are inlined. `multiplayer.js` is left out: single-file hosts block WebSocket and the Supabase sign-in, so the preview is solo flight.
- Expected on such hosts: posters and the DataSF address lookup are blocked by the host's CSP, and the `.ics` download link does nothing.

## Address exchange with Discord

Most Tech Week events never publish a street address, so the city keeps them in
the harbour. Two small services let the community fill that in, with a human in
the loop:

```
in-world "Claim address" ──▶ address-service.mjs ──▶ review card in Discord
Discord "!address <link> <street>" ──▶ bot ──▶ ─────┘        │
                                                    approve ─┤
                              GET /addresses.json ◀──────────┘
                                        │
                    events-sync.js merges it ──▶ the airship moves to the roof
```

- `services/address-service.mjs` holds submissions in one JSON file and serves
  **approved** entries at `GET /addresses.json`. Moderation endpoints need
  `INK_ADDRESS_TOKEN`; the public endpoints are read-only and CORS-limited to
  `INK_ADDRESS_ORIGINS`. Coordinates outside San Francisco are refused.
- `services/discord-address-bot.mjs` is a zero-dependency gateway client (Node
  22's global `WebSocket`). It reads the address channel, files submissions,
  posts an Approve/Reject card, and enforces the moderator role on the buttons.
  In-world claims are polled from the same queue so they get the same card.
- Approving publishes the address; the city merges it on its next refresh and
  the event moves from the harbour to its building. Nothing a player types
  reaches other players before a moderator approves it.

```sh
INK_ADDRESS_PORT=8139 INK_ADDRESS_DATA=.cache INK_ADDRESS_TOKEN=$SECRET \
  node services/address-service.mjs

DISCORD_BOT_TOKEN=$BOT_TOKEN INK_DISCORD_GUILD_ID=$GUILD \
INK_DISCORD_CHANNEL_NAME=find-event-venues INK_DISCORD_MODERATOR_ROLE_NAME=Staff \
INK_ADDRESS_URL=http://127.0.0.1:8139 INK_ADDRESS_TOKEN=$SECRET \
  node services/discord-address-bot.mjs
```

Channels and roles may be given by name (`INK_DISCORD_CHANNEL_NAME`,
`INK_DISCORD_MODERATOR_ROLE_NAME`) instead of ids — the bot resolves them
against the guild at startup. Approving publishes the **building**, never the
door: house numbers and any floor/suite are stripped from `/addresses.json`, so
the exact door stays in Discord where a person can ask for it.

**Venue overrides.** `data/venue-overrides.json` is the hand-curated counterpart
for venues the crawl does not carry. Its `addresses` use the same shape as
`/addresses.json` and go through the same code (`applyApprovedAddresses`), with a
moderator-approved entry outranking a supplement for the same event, field by
field; its `events` are listings the public crawl has not reached yet, appended
at runtime. Give a supplement its registration `url`: that is how it is
recognised and dropped once the crawl carries the same event — without one it
would be listed twice. `street` never holds a
house number. Coordinates come from `node scripts/geocode-venue-overrides.mjs`,
which reads full addresses only from the gitignored `.local/venue-doors.json`
(see `.local/venue-doors.json.example`), tries DataSF then Nominatim, refuses
road- or district-level matches, and writes back lat/lng. A card with the door
withheld keeps its **Find the venue ↗** Discord link even once its sign hangs on
the right building, and a listing with no registration page links to the
Discord instead of showing an RSVP button.

The bot needs the **Message Content** privileged intent, and `addresses.json`
must be routed like the calendar feed (`/integrations/city-in-ink/addresses.json`
→ `127.0.0.1:8139`). Add no origins to `delivery.json` for this — it is served
from chrona.world itself.

## Calendar service

`calendar-server.mjs` is a small game-owned HTTP service that scrapes https://www.tech-week.com/calendar/sf every 30 minutes (`event-cache.mjs`, one updater per server, never one scrape per browser) and serves the snapshot as `GET /events.json`. Failed refreshes keep the last complete feed.

```sh
INK_CALENDAR_PORT=8138 INK_CALENDAR_DATA=.cache node calendar-server.mjs   # binds 127.0.0.1
```

Static hosting alone does not run it. On the Chrona host it is deployed separately and nginx routes `https://chrona.world/integrations/city-in-ink/events.json` to `127.0.0.1:8138`; the hosted build reads that URL, the standalone build reads `/events.json` on its own origin. When neither is reachable the game uses the saved public data in `data/` (`tech-week-first.json` is the immutable baseline). Hosted `localStorage` is account/World-scoped browser preferences, not cloud saves.

## Social trailer

`node scripts/trailer.mjs` renders the X / LinkedIn trailer from the game itself: a standalone build (`npm run build:local` first) is loaded in headless Chromium, the engine's animation loop is stopped, and every frame is one fixed simulation step, one render and one screenshot. Frames are assembled with ffmpeg into an H.264 MP4 (`dist-trailer/sf-tech-week-city-720p.mp4`, plus `poster.jpg` for the post). Because the frames are stepped, not recorded, the result is smooth and identical on every run, GPU or not — on a machine without a GPU a 720p frame costs about 1.5 s (reading the pixels back, the render itself is milliseconds), so the 51-second cut takes roughly half an hour.

```bash
node scripts/trailer.mjs                                   # 1280x720, 24 fps
node scripts/trailer.mjs --width 1920 --height 1080        # about twice as long per frame
node scripts/trailer.mjs --shots title,airship --fps 4     # a quick storyboard check of two shots
```

Needs Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`, or `--playwright <path to playwright/index.mjs>`) and ffmpeg with libx264 (`--ffmpeg`, `$FFMPEG`, PATH, or `pip install imageio-ffmpeg`, whose binary the script finds by itself).

The script is the `SHOTS` table at the top of the file: one entry per shot with its length, the flight keys held, the game UI kept visible (event card, cruise chip, neighbour card) and the caption. A shot with a `setup` starts with a cut (a teleport, `flyTo`, the poster wall, the street canyon, the cruise); a shot without one continues the previous flight. Copy changes are edits to that table; the light slides from dusk to night over the whole cut.

| # | Shot | What is on screen | Caption |
| --- | --- | --- | --- |
| 0 | title (3 s) | glide over the Embarcadero towards downtown, title card | SF TECH WEEK CITY · Fly the week |
| 1 | city (6 s) | same flight, the skyline and the airships | Every Tech Week event, in the city where it happens. |
| 2 | airship (7 s) | `flyTo` the featured airship, arrive, circle | Airships fly over the busiest events. Pick one and your bird flies there. |
| 3 | card (6 s) | circling with the event card open | RSVP in one click. Venue not public yet? The Discord knows. |
| 4 | posters (6 s) | glide towards a facade wearing posters | Posters on the real facades. |
| 5 | friends (6 s) | a second bird beside yours, the neighbour card | See who is flying beside you. Follow them on X, or fly beside them. |
| 6 | beak (6 s) | beak cam through a downtown street canyon | Chase cam or beak cam. Buildings are solid. |
| 7 | cruise (6 s) | T: the auto-cruise towards the hottest event, nav chip on | Press T and your bird tours the hottest events for you. |
| 8 | end (5 s) | the cruise continues under the end card | chrona.world · in your browser · Discord |

In this sandbox the poster CDNs are unreachable, so the billboards show the drawn posters (title, host, hour); a run on a normal connection shows the real covers.

## Troubleshooting

- **`dist/index.html` opens blank with "Chrona connection failed: A trusted HTTPS host origin is required".** You opened the hosted build outside Chrona. Use `npm run build:local` and `dist-local/`.
- **Build fails with "Source bytes changed".** `source/part-*.txt` no longer matches `source/manifest.json`. If the edit was intentional: `node build-hosted.mjs --accept-source-update`, then commit the manifest.
- **Chrona CLI `checkout`/`pull` aborts at exactly 120 s with nothing downloaded, while `status` works.** Cause verified on macOS: the machine uses a local proxy (`HTTPS_PROXY=http://127.0.0.1:7897`), which `curl`, `pip` and `aws` honor, but **Node ignores proxy environment variables by default**, so the CLI's `fetch` goes direct to us-east-1 over a throttled route (~25 KB/s; the 30 MB checkout needs 20+ minutes and hits the CLI's 120 s timeout). Fix — make Node use the proxy (Node ≥ 24):

  ```sh
  NODE_USE_ENV_PROXY=1 node CLI pull --dir ./city-in-ink-chrona     # 30 MB in ~5 s
  ```

  Put `export NODE_USE_ENV_PROXY=1` in your shell profile to make it permanent. Diagnose with `curl -v https://chrona.world/` (look for `CONNECT` via the proxy) and `env | grep -i proxy`. The server answers the same request in under a second; do not look for the problem there.
- **Console CORS errors for `cdn.tech-week.com` images on localhost.** Expected; posters fall back. The hosted build whitelists those origins in `delivery.json`.
