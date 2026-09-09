# City in Ink

Temporary architecture decision: Chrona hosts the account and authoritative connection; gameplay remains unchanged.

Run npm run build. The original 24130132-byte HTML is stored losslessly in source/part-*.txt because the importer limits each text file to 4 MiB. SHA-256: 16c29efe435aa4b5dfe8b3dcf2a887c8564dadbe8bb32b328d1c265f4340ea5d. Reassembly verifies the manifest hash. For intentional original-code changes use node build-hosted.mjs --accept-source-update and push the updated manifest too. The source split is packaging, not a replacement game.

Use the ordinary Chrona CLI checkout/push/preview/submit workflow; collaborators keep separate branches and their own authorization. No runtime credential belongs in the project.

Calendar refresh is provided by the separately deployed calendar-server.mjs; static hosting alone does not run it. Saved partial events remain available when the source cannot be refreshed. Hosted localStorage is account/World-scoped browser preferences, not cloud saves.
