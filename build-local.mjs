import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderGame } from './build.mjs';
import { wireStartup } from './startup-build.mjs';
import { slimFeedParts } from './feed-slim.mjs';
import { writeCityAssets } from './city-assets-build.mjs';
import { splitStreamingCityAssets, wireCityStreaming, writeCityPreload } from './city-streaming-build.mjs';
// Standalone build for local development: same reassembly and add-on wiring as
// build-hosted.mjs, without the Chrona host-frame handshake. The add-on modules
// already branch on window.__SF_HOST_READY__, so leaving it undefined selects
// their standalone paths (local connect, /events.json feed, saved public data).
const url = path => new URL(path, import.meta.url);
const manifest = JSON.parse(await readFile(url('./source/manifest.json'), 'utf8'));
const original = (await Promise.all(manifest.parts.map(part => readFile(url('./source/' + part), 'utf8')))).join('');
if (createHash('sha256').update(original).digest('hex') !== manifest.sha256) throw new Error('Source bytes changed. Run `node build-hosted.mjs --accept-source-update` first to refresh the manifest.');
const cityAssets = splitStreamingCityAssets(original);
await rm(url('./dist-local/'), {recursive:true, force:true});
await mkdir(url('./dist-local/'), {recursive:true});
await writeFile(url('./dist-local/index.html'), wireStartup(wireCityStreaming(renderGame(cityAssets.html))));
await writeCityAssets(cityAssets.files, url('./dist-local/'));
for (const name of ['city-streaming.js','chrona','data','multiplayer.js','multiplayer.css','network-pose.js','public-world.js','events-sync.js','events-sync.css','gull-cluster-route.mjs','city-extras.mjs']) {
  await cp(url('./'+name), url('./dist-local/'+name), {recursive:true});
}
{ const slim = await slimFeedParts(new URL('./dist-local/data/', import.meta.url), 'tech-week-enriched'); console.log(`events feed ${slim.before} → ${slim.after} bytes across ${slim.parts} parts (provenance stays in data/)`); }
await writeCityPreload(cityAssets, url('./dist-local/'));
console.log('Standalone build ready in dist-local/ — serve it with any static server; no Chrona host frame required.');
