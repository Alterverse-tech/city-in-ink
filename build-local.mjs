import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderGame } from './build.mjs';
// Standalone build for local development: same reassembly and add-on wiring as
// build-hosted.mjs, without the Chrona host-frame handshake. The add-on modules
// already branch on window.__SF_HOST_READY__, so leaving it undefined selects
// their standalone paths (local connect, /events.json feed, saved public data).
const url = path => new URL(path, import.meta.url);
const manifest = JSON.parse(await readFile(url('./source/manifest.json'), 'utf8'));
const original = (await Promise.all(manifest.parts.map(part => readFile(url('./source/' + part), 'utf8')))).join('');
if (createHash('sha256').update(original).digest('hex') !== manifest.sha256) throw new Error('Source bytes changed. Run `node build-hosted.mjs --accept-source-update` first to refresh the manifest.');
await mkdir(url('./dist-local/'), {recursive:true});
await writeFile(url('./dist-local/index.html'), renderGame(original));
for (const name of ['chrona','data','multiplayer.js','multiplayer.css','network-pose.js','public-world.js','events-sync.js','events-sync.css','gull-cluster-route.mjs','event-mini-map.mjs']) {
  await cp(url('./'+name), url('./dist-local/'+name), {recursive:true});
}
console.log('Standalone build ready in dist-local/ — serve it with any static server; no Chrona host frame required.');
