import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { wireHoverFlight } from '../flight-build.mjs';
import { wireTuning, wireTuningConfig } from '../tuning-build.mjs';
import { wireEventFeed } from '../events-build.mjs';

const sourceManifest = JSON.parse(await readFile(new URL('../source/manifest.json', import.meta.url)));
const source = (await Promise.all(sourceManifest.parts.map(part => readFile(new URL('../source/' + part, import.meta.url), 'utf8')))).join('');
const tuned = wireTuning(wireEventFeed(wireTuningConfig(source)));
const patched = wireHoverFlight(tuned);
class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  clone() { return new Vector(this.x, this.y, this.z); }
  add(other) { return this.set(this.x + other.x, this.y + other.y, this.z + other.z); }
  addScaledVector(other, scale) { return this.set(this.x + other.x * scale, this.y + other.y * scale, this.z + other.z * scale); }
  lerp(other, scale) { return this.set(this.x + (other.x - this.x) * scale, this.y + (other.y - this.y) * scale, this.z + (other.z - this.z) * scale); }
  length() { return Math.hypot(this.x, this.y, this.z); }
}
const helpers = { Math, We: { lerp: (a, b, t) => a + (b - a) * t, clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)) },
  s0: { lon: 0, lat: 0 }, R3: 1, A1: 1, za: { maxAltitude: 720 }, C: Vector,
  Hn: (_lon, _lat, height) => new Vector(0, height, 0), window: { innerWidth: 1280 },
  document: { createElement: () => ({ setAttribute() {} }) } };
const methodStart = patched.indexOf('setGullFlightMode(enabled) {');
const methodEnd = patched.indexOf('\n\n\nasync loadNorthShorePatch', methodStart);
assert.ok(methodStart > 0 && methodEnd > methodStart);
const methods = vm.runInNewContext('(class {' + patched.slice(methodStart, methodEnd) + '}).prototype', helpers);
const noInput = () => ({ forward: false, backward: false, left: false, right: false, up: false, down: false, boost: false });
function city() {
  const game = { setGullFlightMode: methods.setGullFlightMode, updateGullFlight: methods.updateGullFlight,
    freeFlightEnabled: false, camera: { fov: 42, updateProjectionMatrix() {} },
    flightCharacter: { position: new Vector(), rotation: new Vector(), visible: true },
    flightPose: { position: new Vector(), rotation: new Vector(), scale: new Vector() },
    flightInput: noInput(), flightVelocity: new Vector(), flightDesired: new Vector(), flightCameraGoal: new Vector(), target: new Vector(),
    gullWings: [], gullTail: { rotation: new Vector() }, fovPunch: 0,
    host: { appendChild() {} }, sampleTerrain: () => 0, clearFlightInput() { this.flightInput = noInput(); },
    setView() {}, applyOrbit() {} };
  game.setGullFlightMode(true); game.flightCharacter.rotation.y = 0; game.yaw = Math.PI;
  return game;
}
const simulate = (game, seconds = 1) => { for (let i = 0; i < seconds * 60; i++) game.updateGullFlight(1 / 60); };

test('entering flight and remaining idle for a full minute keeps exact world position', () => {
  const game = city(), initial = game.flightCharacter.position.clone();
  assert.equal(game.gullSpeed, 0); assert.equal(game.flightVelocity.length(), 0);
  simulate(game, 60);
  assert.deepEqual(game.flightCharacter.position, initial); assert.equal(game.gullFlightState, 'Hovering');
});

test('manual forward/turn flight moves normally, then release stops without residual drift', () => {
  const game = city(); game.flightInput.forward = true; simulate(game, 3);
  assert.ok(game.flightCharacter.position.z > 90); assert.ok(game.flightVelocity.z > 40);
  game.flightInput.left = true; simulate(game);
  assert.ok(game.flightCharacter.rotation.y > 0.7); assert.ok(game.flightCharacter.position.x > 0);
  game.clearFlightInput(); const p = game.flightCharacter.position.clone(), heading = game.flightCharacter.rotation.y;
  simulate(game, 10);
  assert.deepEqual(game.flightCharacter.position, p); assert.equal(game.flightCharacter.rotation.y, heading);
  assert.equal(game.flightVelocity.length(), 0); assert.equal(game.flightTurnVelocity, 0);
});

test('Shift alone hovers but boosts existing horizontal movement; S retains slow glide', () => {
  const game = city(), initial = game.flightCharacter.position.clone();
  game.flightInput.boost = true; simulate(game, 3); assert.deepEqual(game.flightCharacter.position, initial);
  game.flightInput.forward = true; simulate(game, 3); assert.ok(game.flightVelocity.length() > 74);
  game.flightInput.forward = false; simulate(game); assert.equal(game.flightVelocity.length(), 0);
  game.flightInput = { ...noInput(), backward: true }; simulate(game, 3);
  assert.ok(game.flightVelocity.z > 11 && game.flightVelocity.z < 13);
});

test('Space/C fly vertically without horizontal thrust and release clears each axis', () => {
  const game = city(); game.flightInput.up = true; simulate(game, 2);
  assert.equal(game.flightCharacter.position.x, 0); assert.equal(game.flightCharacter.position.z, 0);
  assert.ok(game.flightVelocity.y > 16);
  game.flightInput.boost = true; simulate(game, 2); assert.ok(game.flightVelocity.y > 26);
  game.clearFlightInput(); const p = game.flightCharacter.position.clone(); simulate(game);
  assert.deepEqual(game.flightCharacter.position, p);
  game.flightInput.down = true; simulate(game); assert.ok(game.flightCharacter.position.y < p.y);
  game.flightInput = { ...noInput(), forward: true }; game.updateGullFlight(1 / 60);
  assert.equal(game.flightVelocity.y, 0, 'horizontal movement does not preserve old descent');
});

test('explicit Fly-to navigation still supplies thrust while far, approaching and circling', () => {
  const game = city();
  const body = patched.match(/    tick\(dt\) \{([\s\S]*?)\n    \},\n  \};/)[1];
  const tick = vm.runInNewContext('({tick(dt){' + body + '}}).tick', { c: game, Math, state: { view: 'fpv' },
    window: {}, wrapAngle: a => Math.atan2(Math.sin(a), Math.cos(a)), setNavChip() {}, onArrive() {}, fenceCheck() {} });
  const nav = { tick, phase: 'idle', ev: {}, target: new Vector(0, 129, 2000), elapsed: 0, radius: 72, tour: { active: false }, label: () => '' };
  nav.tick(1 / 60); assert.deepEqual(game.flightInput, noInput(), 'idle navigation never invents input');
  nav.phase = 'travel'; nav.tick(1 / 60); assert.equal(game.flightInput.forward, true); assert.equal(game.flightInput.boost, true);
  simulate(game, 2); assert.ok(game.flightCharacter.position.z > 90);
  game.flightCharacter.position.set(0, 185, 0); game.flightCharacter.rotation.y = 0; game.clearFlightInput();
  nav.target.z = 150; nav.tick(1 / 60); assert.equal(game.flightInput.forward, true); assert.equal(game.flightInput.backward, true);
  simulate(game); assert.ok(game.flightCharacter.position.z > 0, 'does not stall just outside the arrival threshold');
  nav.phase = 'circle'; nav.tick(1 / 60); assert.equal(game.flightInput.backward, true);
  assert.ok(game.flightInput.left || game.flightInput.right, 'event orbit steering remains active');
});

test('enterCity clears navigation and motion; all idle-tour UI promises are gone', async () => {
  const game = city(); game.flightVelocity.set(20, 12, 7); game.gullSpeed = 22; game.flightTurnVelocity = 1;
  game.teleportToAddress = () => {};
  let stopped = false;
  const enter = patched.match(/  function enterCity\(\) \{[\s\S]*?\n  \}/)[0];
  vm.runInNewContext(enter + '; enterCity();', { c: game, ensureFlight: fn => fn(), applyBird() {},
    state: { view: 'chase', user: { name: 'Preview', bird: 'gull' } }, CFG: { spawn: { lat: 0, lng: 0, heading: 0 } },
    setView() {}, toast() {}, nav: { stop() { stopped = true; }, startTour() { throw Error('Unexpected automatic tour'); } } });
  assert.equal(stopped, true); assert.equal(game.flightVelocity.length(), 0); assert.equal(game.gullSpeed, 0);
  assert.equal(game.flightTurnVelocity, 0); assert.deepEqual(game.flightInput, noInput());
  assert.ok(!patched.includes('Your bird cruises the most-RSVP’d ones by itself'));
  assert.ok(!patched.includes('The bird tours the city on its own'));
  assert.ok(!patched.includes('Cruise forward automatically'));
  const extras = await readFile(new URL('../city-extras.mjs', import.meta.url), 'utf8');
  assert.ok(!extras.includes('installAutoFlight'));
  assert.ok(extras.includes('installCameraClearance(TW, city)'));
  assert.ok(extras.includes('installNeighbourCard(TW, city)'));
  assert.throws(() => wireHoverFlight(patched), /Hover flight patch target changed/);
});

test('editable focus, frame blur and hidden documents stop navigation and all residual motion', () => {
  const game = city(), listeners = {}, document = { hidden: false, addEventListener(type, fn) { listeners[type] = fn; } };
  class Element { constructor(editable) { this.editable = editable; } matches() { return this.editable; } }
  let stops = 0;
  const start = patched.indexOf('  function suspendFlightControls() {'), end = patched.indexOf('  let lastFence = 0;', start);
  vm.runInNewContext(patched.slice(start, end), { c: game, document, HTMLElement: Element,
    window: { addEventListener(type, fn) { listeners[type] = fn; } }, nav: { stop() { stops++; } } });
  const moving = () => { game.flightInput.forward = true; game.flightVelocity.set(42, 17, 22); game.gullSpeed = 42; };
  for (const trigger of [
    () => listeners.focusin({ composedPath: () => [new Element(true)] }),
    () => listeners.blur(),
    () => { document.hidden = true; listeners.visibilitychange(); },
  ]) {
    moving(); trigger(); assert.equal(game.flightVelocity.length(), 0); assert.equal(game.gullSpeed, 0);
    assert.deepEqual(game.flightInput, noInput());
  }
  assert.equal(stops, 3);
  listeners.focusin({ composedPath: () => [new Element(false)] }); assert.equal(stops, 3, 'camera/control buttons do not cancel explicit navigation');
});
