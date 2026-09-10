import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderGame } from './build.mjs';
import { wireStartup } from './startup-build.mjs';
import { slimFeedParts } from './feed-slim.mjs';
import { writeCityAssets } from './city-assets-build.mjs';
import { splitStreamingCityAssets, wireCityStreaming, writeCityPreload } from './city-streaming-build.mjs';
const url = path => new URL(path, import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');
let original;
try {
  const manifest = JSON.parse(await readFile(url('./source/manifest.json'), 'utf8'));
  original = (await Promise.all(manifest.parts.map(part => readFile(url('./source/' + part), 'utf8')))).join('');
  if (digest(original) !== manifest.sha256) {
    if (!process.argv.includes('--accept-source-update')) throw new Error('Source bytes changed. For intentional source edits, rebuild with --accept-source-update and push the updated manifest.');
    manifest.sha256 = digest(original); await writeFile(url('./source/manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  original = await readFile(url('./city-original.html'),'utf8');
}
const cityAssets = splitStreamingCityAssets(original);
let html = wireStartup(wireCityStreaming(renderGame(cityAssets.html)))
  .replace('<head>', '<head>\n<script>window.__SF_HOST_READY__ = import("./hosted-bootstrap.js"); window.__SF_HOST_READY__.catch(e => { console.error(e); document.body.insertAdjacentText("afterbegin", "Chrona connection failed: " + e.message); });</script>')
  .replace('<script id="tw-layer">', '<script type="module" id="tw-layer">\nawait window.__SF_HOST_READY__;');
// Rebuild dist from scratch: a stale copy left beside a fresh one could be
// served as the current snapshot if the fresh one ever fails to load.
await rm(url('./dist/'), {recursive:true, force:true});
await mkdir(url('./dist/'), {recursive:true});
await writeFile(url('./dist/index.html'),html);
await writeCityAssets(cityAssets.files, url('./dist/'));
for (const name of ['city-streaming.js','chrona','data','multiplayer.js','multiplayer.css','network-pose.js','public-world.js','events-sync.js','events-sync.css','hosted-bootstrap.js','gull-cluster-route.mjs','city-extras.mjs','gull-cluster-route.mjs',]) {
  await cp(url('./'+name), url('./dist/'+name), {recursive:true});
}
{ const slim = await slimFeedParts(new URL('./dist/data/', import.meta.url), 'tech-week-enriched'); console.log(`events feed ${slim.before} → ${slim.after} bytes across ${slim.parts} parts (provenance stays in data/)`); }
await writeCityPreload(cityAssets, url('./dist/'));
console.log(JSON.stringify({ build:'dist', originalSha256:digest(original), bytes:Buffer.byteLength(original), entryBytes:Buffer.byteLength(html), cityAssets:cityAssets.assetCount, hostedProtocol:'chrona.host/v1' }));
