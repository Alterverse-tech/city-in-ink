# City in Ink — SF Tech Week 2026

*Every event is an airship.* A single-file browser game: fly a bird over an ink-rendered San Francisco while the public SF Tech Week calendar is mapped onto the city. This repository is the development source for the Chrona World **SF Tech Week — City in Ink** and is the place where GitHub collaborators work; the live game is published through Chrona (see [Relationship with Chrona](#relationship-with-chrona)).

## 快速开始（中文）

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
build-local.mjs                            `npm run build:local` → dist-local/ for local work. Same source,
                                           no handshake.
events-build.mjs                           The narrow patches applied by renderGame (event backend swap,
                                           in-game refresh interval 15 min → 60 s).

events-sync.js, events-sync.css            Event feed sync + poster loading from whitelisted origins.
gull-cluster-route.mjs                     Gull flight routes clustered from the event feed.
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

Generated and ignored: `dist/`, `dist-local/`, `node_modules/`, `.chrona/`. Never commit `.chrona/` — it holds the Chrona workspace binding.

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

**Pushing to GitHub does not publish anything.** Chrona only reads its own collaboration branches. Two ways to get changes live:

- *Chrona as the publishing channel, GitHub as source of truth (recommended for a small team).* One person publishes from a Chrona checkout using the CLI (below).
- *Chrona-native collaboration.* Each collaborator gets their own Chrona branch and authorization; the owner reviews and merges in the Studio. Requires the owner to add the collaborator as **Full Developer** (World Development → Player & Creator Access) after they have signed in to chrona.world once.

### Automatic submission from GitHub (CI)

Every push to `main` (except docs-only and `.github/` changes) runs [`.github/workflows/chrona-submit.yml`](.github/workflows/chrona-submit.yml), which mirrors the commit into a **fresh Chrona branch**, uploads the hosted build as a preview and **submits it for review**. It does not release anything: the owner opens the [collaboration page](https://chrona.world/studio/collaboration/?world=e9ef2f62-a6e0-47f2-8795-c2941cbc433a) and clicks **Accept & publish** — that single click is what changes the live World. The Actions run summary lists the branch, the submission id and the preview link.

- Credential: repository secret `CHRONA_CLIENTS_JSON`, a `clients.json` holding one remembered `read, write` connection to chrona.world (revocable at https://chrona.world/studio/connect/). It cannot publish.
- CLI: `Alterverse-tech/chrona-game` pinned by commit in the workflow (`CHRONA_CLI_COMMIT`); bump it deliberately.
- One push = one Chrona branch + one submission. Pushes whose tree already matches Chrona `main` submit nothing.
- Run it by hand: **Actions → Chrona submit → Run workflow**, or locally:

  ```sh
  NODE_USE_ENV_PROXY=1 CHRONA_CLI=/path/to/chrona.mjs \
  CHRONA_WORLD='https://chrona.world/studio/?world=e9ef2f62-a6e0-47f2-8795-c2941cbc433a' \
  CHRONA_SUBMIT_STOP_AT=preview node .github/chrona-submit.mjs      # drop STOP_AT to also submit
  ```

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

`npm run build` writes `dist/` for Chrona. It differs from the local build only by the handshake in `hosted-bootstrap.js`: the game runs inside Chrona's sandboxed iframe, receives the signed-in account and the authoritative room from the host, and stores preferences per account/World instead of in browser `localStorage`. `chrona/chrona-host.js` deliberately has no standalone fallback — a failed handshake never starts a separate login — so `dist/` renders only the error line and the mini map when opened outside Chrona. That is expected.

## Calendar service

`calendar-server.mjs` is a small game-owned HTTP service that scrapes https://www.tech-week.com/calendar/sf every 30 minutes (`event-cache.mjs`, one updater per server, never one scrape per browser) and serves the snapshot as `GET /events.json`. Failed refreshes keep the last complete feed.

```sh
INK_CALENDAR_PORT=8138 INK_CALENDAR_DATA=.cache node calendar-server.mjs   # binds 127.0.0.1
```

Static hosting alone does not run it. On the Chrona host it is deployed separately and nginx routes `https://chrona.world/integrations/city-in-ink/events.json` to `127.0.0.1:8138`; the hosted build reads that URL, the standalone build reads `/events.json` on its own origin. When neither is reachable the game uses the saved public data in `data/` (`tech-week-first.json` is the immutable baseline). Hosted `localStorage` is account/World-scoped browser preferences, not cloud saves.

## Troubleshooting

- **`dist/index.html` opens blank with "Chrona connection failed: A trusted HTTPS host origin is required".** You opened the hosted build outside Chrona. Use `npm run build:local` and `dist-local/`.
- **Build fails with "Source bytes changed".** `source/part-*.txt` no longer matches `source/manifest.json`. If the edit was intentional: `node build-hosted.mjs --accept-source-update`, then commit the manifest.
- **Chrona CLI `checkout`/`pull` aborts at exactly 120 s with nothing downloaded, while `status` works.** Cause verified on macOS: the machine uses a local proxy (`HTTPS_PROXY=http://127.0.0.1:7897`), which `curl`, `pip` and `aws` honor, but **Node ignores proxy environment variables by default**, so the CLI's `fetch` goes direct to us-east-1 over a throttled route (~25 KB/s; the 30 MB checkout needs 20+ minutes and hits the CLI's 120 s timeout). Fix — make Node use the proxy (Node ≥ 24):

  ```sh
  NODE_USE_ENV_PROXY=1 node CLI pull --dir ./city-in-ink-chrona     # 30 MB in ~5 s
  ```

  Put `export NODE_USE_ENV_PROXY=1` in your shell profile to make it permanent. Diagnose with `curl -v https://chrona.world/` (look for `CONNECT` via the proxy) and `env | grep -i proxy`. The server answers the same request in under a second; do not look for the problem there.
- **Console CORS errors for `cdn.tech-week.com` images on localhost.** Expected; posters fall back. The hosted build whitelists those origins in `delivery.json`.
