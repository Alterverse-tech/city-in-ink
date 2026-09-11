import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DISCORD_INVITE } from '../tuning-build.mjs';

// Every Discord link the game shows must be the one invite. A second literal
// once crept into a patch layer and the venue button opened the wrong server.
const root = new URL('../', import.meta.url);
const sources = ['tuning-build.mjs', 'ui-build.mjs', 'events-build.mjs', 'city-extras.mjs', 'events-sync.js', 'multiplayer.js', 'event-card-build.mjs', 'player-start-build.mjs', 'startup-build.mjs'];

test('every discord.gg literal in the game sources is DISCORD_INVITE', async () => {
  assert.match(DISCORD_INVITE, /^https:\/\/discord\.gg\/[A-Za-z0-9]+$/);
  const seen = new Map();
  for (const name of sources) {
    let text;
    try { text = await readFile(new URL(name, root), 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const match of text.matchAll(/https:\/\/discord\.gg\/[A-Za-z0-9]+/g)) seen.set(name, [...(seen.get(name) || []), match[0]]);
  }
  const strays = [...seen].flatMap(([name, links]) => links.filter(link => link !== DISCORD_INVITE).map(link => `${name}: ${link}`));
  assert.deepEqual(strays, [], 'a second invite would send players to the wrong server');
  assert.ok(seen.size >= 2, 'the invite is referenced by more than one layer');
});
