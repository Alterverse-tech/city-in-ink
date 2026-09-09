# City in Ink — notes for Claude Code

- **No `npm install`.** The build uses Node built-ins only. Node ≥ 20 (verified on 24).
- **Local development:** `npm run build:local` → `dist-local/`, then serve that directory with any static server (e.g. `python3 -m http.server 8790 --directory dist-local`) and open http://localhost:8790/. There is no watcher — rebuild after every edit.
- **Never open `dist/` locally.** `npm run build` produces the Chrona-hosted build, which refuses to run outside Chrona's iframe by design (`A trusted HTTPS host origin is required`). That is not a bug to fix.
- **Edit surfaces:** add-on modules at the repo root — `event-mini-map.mjs` (the mini map), `multiplayer.js`, `events-sync.js`, `gull-cluster-route.mjs`, `chrona/` — edit directly. The original game is `source/part-*.txt` (one 24 MB HTML split into 4 MiB parts); after editing it run `node build-hosted.mjs --accept-source-update` and commit `source/manifest.json` together with the parts.
- Builds patch the original with exact-match string replacements (`build.mjs`, `events-build.mjs`). A `patch target changed` error means a source edit broke a patch — fix the patch or the edit; never bypass the check.
- **Expected in standalone mode, not bugs:** CORS errors for `cdn.tech-week.com` posters; `/events.json` 404 (the saved data in `data/` is used); sign-in and multiplayer go to the *test* control plane; `/assets/airship.glb` and `/assets/brand/techweek-logo.svg` 404 (optional assets with built-in fallbacks, also 404 in production).
- **Never commit** `.chrona/`, `dist/`, `dist-local/`.
- **Pushing to GitHub does not publish.** The live game is Chrona World `e9ef2f62-a6e0-47f2-8795-c2941cbc433a` on https://chrona.world; publishing goes through the Chrona CLI (README → "Publishing with the Chrona CLI"). Behind a proxy, run the CLI with `NODE_USE_ENV_PROXY=1`.
