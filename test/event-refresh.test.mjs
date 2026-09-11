import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { renderGame } from '../build.mjs';
import { FEATURED_EVENT, SPOTLIGHT, RSVP_MIN } from '../tuning-build.mjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('source/manifest.json', root), 'utf8'));
const feedManifest = JSON.parse(await readFile(new URL('data/tech-week-enriched.parts.json', root), 'utf8'));  // the saved programme's own count
const source = (await Promise.all(manifest.parts.map(name => readFile(new URL(`source/${name}`, root), 'utf8')))).join('');
const html = renderGame(source);
const between = (start, end) => {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `built function boundary: ${start}`);
  return html.slice(from, to);
};
// Execute the final build's real normalization, ranking, placement, metadata
// and refresh together. Only WebGL/UI effects and the terrain API are stubbed.
const functions = [
  between('  function normalizeEvent(raw, i) {', '  function placeEvents() {'),
  between('  function placeEvents() {', '  function retireEvent(ev) {'),
  between('  async function refreshEvents()', '  /* ---------------------------------------------------------------- boot */'),
].join('\n');

function harness(raw) {
  let response;
  const calls = { place: 0, metadata: 0, build: 0, posters: 0, lists: 0, lifecycle: 0 };
  const state = { events: [], past: [], citizens: [], selected: null, officialFeed: true, user: { rsvps: new Set() } };
  const context = {
    state, calls, FEATURED_EVENT, SPOTLIGHT, TW: { state },
    location: { protocol: 'https:' },
    CFG: { week: { start: '2026-10-05' }, fleet: 100, rsvpMin: RSVP_MIN, shipAltitude: 50,
      harbor: { lat: 37.79, lng: -122.4 }, core: { lat: 37.79, lng: -122.4 }, featured: { lat: 37.79, lng: -122.4, y: 120 } },
    CATS: { founders: {} }, VEHICLES: ['airship', 'balloon', 'zeppelin', 'blimp'],
    hash: id => [...id].reduce((value, letter) => ((value * 31 + letter.charCodeAt(0)) >>> 0), 0),
    fmt: { dayKey: date => date.toISOString().slice(0, 10) },
    heat: event => event.rsvp || 0, rsvpCount: event => event.rsvp || 0,
    GEO: { Hn: (lng, lat) => ({ x: lng * 1000, z: lat * 1000 }) },
    c: { sampleTerrain: () => 0 }, roofHeightAt: () => 20,
    V3: (x, y, z) => ({ x, y, z, add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; },
      multiplyScalar(value) { this.x *= value; this.y *= value; this.z *= value; return this; } }),
    chipLayer: null,
    backend: { events: async () => response }, nav: { stop() {} },
    buildWorld() { calls.build++; for (const event of state.events) event.hasVehicle = !!event.wantsVehicle; },
    posterTexture() { calls.posters++; }, refreshChip() {},
    renderList() { calls.lists++; }, renderBoard() {}, renderCard() {}, log() {},
    lifecycleTick() { calls.lifecycle++; },
  };
  runInNewContext(`${functions}
    const actualPlace = placeEvents, actualMeta = computeMeta;
    placeEvents = (...args) => { calls.place++; return actualPlace(...args); };
    computeMeta = (...args) => { if (!args[0]) calls.metadata++; return actualMeta(...args); };
    globalThis.api = { normalizeEvent, placeEvents, refreshEvents };`, context);
  state.events = raw.map((event, index) => context.api.normalizeEvent(event, index));
  context.api.placeEvents();
  context.buildWorld();
  for (const key of Object.keys(calls)) calls[key] = 0;
  const refresh = async list => {
    response = { list, citizens: [], source: 'Official public sources', official: true };
    await context.api.refreshEvents();
  };
  return { state, calls, refresh };
}

const event = (id, fields = {}) => ({ id, title: id, category: 'founders', start: '2026-10-05T18:00:00-07:00',
  rsvp: 0, lat: null, lng: null, ...fields });
const assertSpatialMetadata = state => {
  for (const item of [...state.venues, ...state.clusters]) {
    assert.ok(Number.isFinite(item.pos.x) && Number.isFinite(item.pos.y) && Number.isFinite(item.pos.z));
    assert.ok(item.members.every(member => member.onMap && member.world));
  }
};

test('new mapped and addressless events are placed before spatial metadata, with one rebuild', async () => {
  const existing = event('existing', { rsvp: 80 });
  const h = harness([existing]);
  const added = [event('quiet'), event('busy', { rsvp: 100 }), event('addressed', { lat: 37.79, lng: -122.4 }),
    event('district', { approxLocation: true, lat: 37.78, lng: -122.41, rsvp: 1 })];
  await h.refresh([existing, ...added]);
  assert.equal(h.state.events.length, 5);
  assert.equal(h.state.events.find(item => item.id === 'quiet').world, null);
  assert.ok(h.state.events.filter(item => item.onMap).every(item => item.world));
  assertSpatialMetadata(h.state);
  assert.deepEqual(h.calls, { place: 1, metadata: 1, build: 1, posters: 0, lists: 1, lifecycle: 1 });
});

test('a real 48-event baseline upgrades to all saved events without null-position metadata', async () => {
  const baseline = JSON.parse(await readFile(new URL('data/tech-week-first.json', root), 'utf8'));
  const dataManifest = JSON.parse(await readFile(new URL('data/tech-week-enriched.parts.json', root), 'utf8'));
  const full = JSON.parse((await Promise.all(dataManifest.parts.map(name => readFile(new URL(`data/${name}`, root), 'utf8')))).join(''));
  const h = harness(baseline.events);
  await h.refresh(full.events);
  assert.equal(h.state.events.length, feedManifest.events);
  assert.equal(new Set(h.state.events.map(item => item.id)).size, feedManifest.events);
  assert.ok(h.state.events.filter(item => item.onMap).every(item => item.world));
  assertSpatialMetadata(h.state);
  assert.equal(h.calls.place, 1);
  assert.equal(h.calls.metadata, 1);
  assert.equal(h.calls.build, 1);
});

test('a quiet addressless event crossing the ship threshold is placed before computing venues', async () => {
  const quiet = event('quiet');
  const h = harness([quiet]);
  assert.equal(h.state.events[0].world, null);
  await h.refresh([{ ...quiet, rsvp: RSVP_MIN + 1 }]);
  assert.equal(h.state.events[0].wantsVehicle, true);
  assert.ok(h.state.events[0].world);
  assertSpatialMetadata(h.state);
  assert.equal(h.calls.place, 1);
  assert.equal(h.calls.metadata, 1);
  assert.equal(h.calls.build, 1);
});

test('a district poster appears and disappears without needing an airship transition', async () => {
  const district = event('district', { approxLocation: true, lat: 37.78, lng: -122.41 });
  const h = harness([district]);
  assert.equal(h.state.events[0].world, null);
  await h.refresh([{ ...district, rsvp: 1 }]);
  assert.equal(h.state.events[0].wantsVehicle, false);
  assert.equal(h.state.events[0].hasVehicle, false);
  assert.ok(h.state.events[0].world);
  assertSpatialMetadata(h.state);
  assert.equal(h.calls.build, 1);
  await h.refresh([district]);
  assert.equal(h.state.events[0].onMap, false);
  assert.equal(h.state.events[0].world, null);
  assert.equal(h.state.venues.length, 0);
  assert.equal(h.state.clusters.length, 0);
  assert.equal(h.calls.place, 2);
  assert.equal(h.calls.metadata, 2);
  assert.equal(h.calls.build, 2);
});

test('ordinary detail and RSVP updates refresh metadata without replacing placement or geometry', async () => {
  const busy = event('busy', { rsvp: 100 }), quiet = event('quiet');
  const h = harness([busy, quiet]);
  const position = h.state.events[0].world;
  await h.refresh([{ ...busy, title: 'Updated title', rsvp: 101 }, quiet]);
  assert.equal(h.state.events[0].world, position);
  assert.equal(h.state.events[0].title, 'Updated title');
  assert.equal(h.calls.place, 0);
  assert.equal(h.calls.build, 0);
  assert.equal(h.calls.metadata, 1);
  assert.equal(h.calls.posters, 2);
  assertSpatialMetadata(h.state);
});
