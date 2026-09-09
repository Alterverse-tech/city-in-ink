# City in Ink

Temporary architecture decision: Chrona hosts the account and authoritative connection; gameplay remains unchanged.

Run npm run build. The original 24130132-byte HTML is stored losslessly in source/part-*.txt because the importer limits each text file to 4 MiB. SHA-256: 16c29efe435aa4b5dfe8b3dcf2a887c8564dadbe8bb32b328d1c265f4340ea5d. Reassembly verifies the manifest hash. For intentional original-code changes use node build-hosted.mjs --accept-source-update and push the updated manifest too. The source split is packaging, not a replacement game.

Use the ordinary Chrona CLI checkout/push/preview/submit workflow; collaborators keep separate branches and their own authorization. No runtime credential belongs in the project.

Calendar refresh is provided by the separately deployed calendar-server.mjs; static hosting alone does not run it. Saved partial events remain available when the source cannot be refreshed. Hosted localStorage is account/World-scoped browser preferences, not cloud saves.

## Local development

`npm run build` produces the Chrona-hosted build in `dist/`; it deliberately refuses to run outside the Chrona host frame ("A trusted HTTPS host origin is required"). For local work use the standalone build:

```sh
npm run build:local          # writes dist-local/ (same source, no host-frame handshake)
python3 -m http.server 8790 --directory dist-local
```

Then open http://localhost:8790/. The add-on modules (`multiplayer.js`, `events-sync.js`, `gull-cluster-route.mjs`, `event-mini-map.mjs`) already branch on `window.__SF_HOST_READY__`, so the standalone build uses their local paths and the saved public event data. Event poster images from `cdn.tech-week.com` are blocked by CORS on localhost; that is cosmetic.

Editing the original city itself means editing `source/part-*.txt` and rebuilding with `node build-hosted.mjs --accept-source-update` (this refreshes `source/manifest.json`; commit it). The add-on modules can be edited directly.
