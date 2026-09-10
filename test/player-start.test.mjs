import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { featuredSpawnPoint, wirePlayerStart } from '../player-start-build.mjs';
import { wireHoverFlight } from '../flight-build.mjs';
import { wireTuning, wireTuningConfig } from '../tuning-build.mjs';
import { wireEventFeed } from '../events-build.mjs';

const manifest = JSON.parse(await readFile(new URL('../source/manifest.json', import.meta.url)));
const source = (await Promise.all(manifest.parts.map(part => readFile(new URL('../source/' + part, import.meta.url), 'utf8')))).join('');
const hover = wireHoverFlight(wireTuning(wireEventFeed(wireTuningConfig(source))));
const patched = wirePlayerStart(hover);
const start = patched.indexOf('  function featuredSpawnPoint(');
const end = patched.indexOf("  window.addEventListener('keydown'", start);
assert.ok(start > 0 && end > start);
const runtime = patched.slice(start, end);

class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  add(other) { return this.set(this.x + other.x, this.y + other.y, this.z + other.z); }
}
function account(name = 'Chrona User', initialized = true) {
  const listeners = new Set();
  let state = { userId: 'trusted-user', initialized, profile: { displayName: name } };
  return {
    auth: { get userId() { return state.userId; }, get profile() { return state.profile; },
      subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); } },
    update(next) { state = next; for (const fn of listeners) fn(state); },
    listeners,
  };
}
function harness({ auth = account(), ready, featured = true, random = 0.65, storageThrows = false } = {}) {
  const events = featured ? [{ id: 'partiful-hgyN4UiBL4s3vA0ATTbr', featured: true,
    ship: { position: new Vector(100, 196, 200) }, world: new Vector(100, 0, 200), shipY: 196 }] : [];
  const selected = events[0];
  const state = { ready: false, welcomed: false, events, selected, view: 'chase', user: { name: '', bird: 'gull' } };
  const storage = new Map([['sf-ink-bird', JSON.stringify({ name: 'An old local name', bird: 'pelican' })]]);
  const windowListeners = new Map();
  const calls = { random: 0, render: 0, launch: 0, stop: 0, names: [], spawnsReady: [], appearances: [], messages: [] };
  const game = {
    freeFlightEnabled: false, flightAvatar: 'human', flightCharacter: { position: new Vector(-900, 12, 600), rotation: new Vector() },
    flightVelocity: new Vector(8, 9, 10), target: new Vector(), cameraFlight: {}, gullSpeed: 22, flightTurnVelocity: 1,
    clearFlightInput() { this.flightInput = {}; }, cancelCinematicTour() {},
    setFlightAvatar(value) { this.flightAvatar = value; this.freeFlightEnabled = false; },
    setFlightMode(on) { this.freeFlightEnabled = on; },
    applyOrbit() { calls.spawnsReady.push(state.ready); },
  };
  const win = { innerWidth: 1440, __SF_HOST_CLIENT__: auth, __SF_HOST_READY__: ready,
    addEventListener(type, fn) { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type).add(fn); },
    removeEventListener(type, fn) { windowListeners.get(type)?.delete(fn); },
  };
  const BIRDS = { gull: {}, pelican: {}, raven: {}, hummingbird: {}, peregrine: {}, parrot: {} };
  const tw = { state, BIRDS };
  const applyBird = value => { state.user.bird = value; calls.appearances.push(value); };
  tw.applyBird = applyBird;
  const context = vm.createContext({ Math: Object.assign(Object.create(Math), { random: () => { calls.random++; return random; } }), Promise,
    TW: tw, state, c: game, BIRDS, window: win, FEATURED_EVENT: 'hgyN4UiBL4s3vA0ATTbr',
    CFG: { featured: { lng: -122.3931, lat: 37.7969, y: 196 } }, GEO: { Hn: () => new Vector(100, 196, 200) },
    roofHeightAt: () => 0, V3: (x,y,z) => new Vector(x,y,z), nav: { stop: () => { calls.stop++; } },
    refreshMeChip: () => calls.names.push(state.user.name), applyBird,
    renderCard: ev => { assert.equal(ev, state.selected); calls.render++; },
    setView: view => { state.view = view; }, toast: text => calls.messages.push(text),
    ensureFlight: fn => { assert.equal(game.freeFlightEnabled, true); return fn(); },
    document: { querySelector: () => ({ click: () => { calls.launch++; } }) },
    localStorage: { setItem: (key, value) => { if (storageThrows) throw new Error('Storage denied'); storage.set(key, value); } },
  });
  vm.runInContext(runtime, context);
  return { state, tw, game, win, calls, context, storage, auth,
    start: () => vm.runInContext('startPlayer()', context),
    hide: persisted => { for (const fn of [...(windowListeners.get('pagehide') || [])]) fn({ persisted }); },
  };
}

test('real patched entry spawns before ready near the featured airship with zero momentum and no chooser', () => {
  const h = harness(); h.start();
  const p = h.game.flightCharacter.position, a = h.state.events[0].ship.position;
  assert.equal(h.state.ready, false); assert.deepEqual(h.calls.spawnsReady, [false]);
  assert.equal(h.tw.playerStart.spawned, true); assert.equal(h.state.welcomed, true);
  assert.equal(h.game.freeFlightEnabled, true); assert.equal(h.game.flightAvatar, 'gull');
  assert.ok(Math.abs(Math.hypot(p.x-a.x, p.z-a.z)-220) < 1e-9); assert.equal(p.y, 184);
  assert.equal(h.game.flightCharacter.rotation.y, Math.atan2(a.x-p.x, a.z-p.z));
  assert.deepEqual(h.game.flightVelocity, new Vector()); assert.equal(h.game.gullSpeed, 0); assert.equal(h.game.flightTurnVelocity, 0);
  assert.equal(h.game.cameraFlight, undefined); assert.equal(h.calls.stop, 1); assert.equal(h.calls.render, 1);
  assert.equal(h.calls.launch, 1); assert.equal(h.state.user.name, 'Chrona User');
});

test('appearance is chosen once per entry and the existing multiplayer preference restore cannot undo it', async () => {
  const h = harness({ random: 0.95 }); h.start();
  assert.equal(h.state.user.bird, 'parrot'); assert.equal(h.calls.random, 1);
  const multiplayer = await readFile(new URL('../multiplayer.js', import.meta.url), 'utf8');
  const line = multiplayer.split('\n').find(line => line.includes('if (saved?.bird && tw.BIRDS[saved.bird])'));
  assert.ok(line);
  vm.runInNewContext(line, { saved: JSON.parse(h.storage.get('sf-ink-bird')), tw: h.tw });
  assert.equal(h.state.user.bird, 'parrot');
  const before = { ...h.game.flightCharacter.position };
  h.game.flightCharacter.position.x += 500;
  h.state.events[0] = { ...h.state.events[0], ship: { position: new Vector(-200, 210, 50) } };
  h.start();
  assert.equal(h.calls.random, 1); assert.equal(h.game.flightCharacter.position.x, before.x + 500);
  assert.equal(h.calls.launch, 1); assert.equal(h.calls.stop, 1);
});

test('late trusted identity and subsequent profile updates keep the exact Chrona name without moving the player', async () => {
  let resolve;
  const ready = new Promise(done => { resolve = done; });
  const h = harness({ auth: undefined, ready });
  h.win.__SF_HOST_CLIENT__ = undefined;
  h.start(); assert.equal(h.state.user.name, '');
  const position = { ...h.game.flightCharacter.position };
  const later = account('董 / Chrona'); h.win.__SF_HOST_CLIENT__ = later; resolve();
  await ready; await Promise.resolve();
  assert.equal(h.state.user.name, '董 / Chrona');
  later.update({ initialized: true, userId: 'trusted-user', profile: { displayName: 'Updated Display Name' } });
  assert.equal(h.state.user.name, 'Updated Display Name');
  later.update({ initialized: false, userId: '', profile: { displayName: 'Guest' } });
  assert.equal(h.state.user.name, 'Updated Display Name');
  assert.deepEqual({ ...h.game.flightCharacter.position }, position); assert.equal(h.calls.random, 1);
  h.hide(true); assert.equal(later.listeners.size, 1);
  h.hide(false); assert.equal(later.listeners.size, 0);
});

test('a late host handshake after disposal cannot subscribe again', async () => {
  let resolve;
  const ready = new Promise(done => { resolve = done; });
  const h = harness({ ready }); h.win.__SF_HOST_CLIENT__ = undefined; h.start(); h.hide(false);
  const later = account('Late'); h.win.__SF_HOST_CLIENT__ = later; resolve();
  await ready; await Promise.resolve();
  assert.equal(later.listeners.size, 0); assert.equal(h.state.user.name, '');
});

test('missing early featured data uses the same configured location and a failed preference write does not block flight', () => {
  const h = harness({ featured: false, storageThrows: true }); h.start();
  const p = h.game.flightCharacter.position;
  assert.ok(Math.abs(Math.hypot(p.x-100, p.z-200)-220) < 1e-9); assert.equal(p.y, 184);
  assert.equal(h.game.freeFlightEnabled, true); assert.equal(h.tw.playerStart.spawned, true);
});

test('spawn probes avoid the nearby tower while remaining near the ship and face the destination', () => {
  const probes = [];
  const anchor = { x: 0, y: 196, z: 0 };
  const p = featuredSpawnPoint(anchor, (x,z) => { probes.push([x,z]); return x > 10 ? 260 : 0; });
  assert.equal(probes.length, 2); assert.equal(p.x, 0); assert.equal(p.z, 220); assert.equal(p.y, 184);
  const raised = featuredSpawnPoint(anchor, () => 200);
  assert.equal(raised.y, 238); assert.ok(Math.abs(Math.hypot(raised.x,raised.z)-220) < 1e-9);
});

test('entry patch is exact and removes only the initial chooser and its orphaned manual footer binding', () => {
  assert.ok(patched.includes('startPlayer();\n    state.ready = true; updateClock();'));
  assert.ok(!patched.includes("if (qs.get('welcome') !== '0') openWelcome();"));
  assert.ok(!patched.includes('id="tw-change-bird"')); assert.ok(!patched.includes("$('#tw-change-bird').addEventListener"));
  assert.ok(patched.includes('function needName(then)')); assert.ok(patched.includes('function flyTo(ev) { select(ev); ensureFlight('));
  assert.throws(() => wirePlayerStart(patched), /Player start patch target changed/);
  assert.throws(() => wirePlayerStart(hover.replace('state.ready = true; updateClock();', 'state.ready = true;')), /patch target changed/);
});
