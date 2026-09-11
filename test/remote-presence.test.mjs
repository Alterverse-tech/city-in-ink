import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { decodePose } from '../network-pose.js';

const source = readFileSync(new URL('../multiplayer.js', import.meta.url), 'utf8');
const first = source.indexOf('function makeRemote('), last = source.indexOf('function attachScene(', first);
assert.ok(first >= 0 && last > first, 'Actual renderer function boundaries');
const renderer = source.slice(first, last);
const timerStart = source.indexOf('const statusTimer = setInterval(');
const timerEnd = source.indexOf("window.addEventListener('pagehide'", timerStart);
assert.ok(timerStart >= 0 && timerEnd > timerStart, 'Actual stale timer boundary');

// The scene/DOM stand-ins record ownership, not renderer behavior. All roster
// selection, bird creation, deletion, visibility and publication code is real.
class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(p) { return this.set(p.x, p.y, p.z); }
  distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z); }
  project() { return this.set(this.x / 1000, this.y / 1000, .5); }
}
class Group {
  constructor() {
    this.children = []; this.position = new Vector(); this.userData = {};
    this.rotation = { set() {} }; this.scale = { z: 1, setScalar() {} };
  }
  add(child) { child.removeFromParent(); this.children.push(child); child.parent = this; }
  removeFromParent() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  clone() { return new Group(); }
  traverse(fn) { fn(this); this.children.forEach(fn); }
  getObjectByName() { return null; }
}
class Element {
  constructor() { this.children = []; this.hidden = true; this.style = { setProperty() {} }; }
  append(child) { child.remove(); this.children.push(child); child.parent = this; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
}
const player = (id, fields = {}) => ({ id, name: id, connected: true, lastProcessedInput: 1, ...fields });
const pose = (x = 10) => ({ position: { x: x / 100, y: 20.5, z: .1 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0 });

function fixture() {
  const scene = new Group(), labels = new Element(), remotes = new Map(), samples = new Map(), ticks = [];
  const listeners = {}, cleanup = { timers: 0, auth: 0, chrona: 0 };
  let now = 1000;
  const originalSimulation = () => {}, simulationWrapper = () => {}, originalRender = () => {}, renderWrapper = () => {};
  const c = { scene, gullPose: new Group(), createSolidMaterial: () => ({}),
    flightCharacter: { position: new Vector() }, renderer: { domElement: { clientWidth: 1000, clientHeight: 800 } }, camera: {},
    updateSimulation: simulationWrapper, render: renderWrapper };
  const scope = vm.createContext({ c, T: { Group, Vector3: Vector }, labels, remotes,
    document: { createElement: () => new Element() }, window: { addEventListener(type, fn) { listeners[type] = fn; } },
    presence: { sample: id => samples.get(id) || null }, decodePose,
    colorFor: () => '#fff', flyBeside() {}, renderUI() {},
    room: { state: 'offline', players: [], count: 0 }, stale: false, accumulator: 0, disposed: false,
    connectionActivity: new Map(), representativeIds: new Map(), REMOTE_STALE_MS: 8000, lastAuthorityMarker: null,
    lastSnapshot: now, performance: { now: () => now }, setInterval: callback => { ticks.push(callback); return 1; },
    originalSimulation, simulationWrapper, originalRender, renderWrapper, tw: null, accountUI: {},
    clearInterval() { cleanup.timers++; }, unsubscribeAuth() { cleanup.auth++; }, chrona: { destroy() { cleanup.chrona++; } },
  });
  vm.runInContext(renderer + '\n' + source.slice(timerStart), scope);
  return { scope, scene, labels, remotes, samples, cleanup,
    receive(players, state = 'room') { scope.receiveRoom({ state, players, count: players.length, ping: 25 }); },
    snapshot(next, event) { scope.presence.snapshot = () => next; scope.noteSnapshot(event); },
    frame() { scope.updateRemotes(.016, now / 1000); scope.updateLabels(); },
    advance(milliseconds) { now += milliseconds; },
    tick() { ticks[0](); },
    expire() { now += 9000; ticks[0](); },
    pagehide(persisted = false) { listeners.pagehide({ persisted }); },
    roster: () => scope.window.__sfNet,
  };
}
const ids = roster => Array.from(roster.players, p => p.id).sort();
const assertNoRemotes = h => {
  assert.equal(h.remotes.size, 0); assert.equal(h.scene.children.length, 0); assert.equal(h.labels.children.length, 0);
};

test('duplicate account connections create only one actual bird, label and published player', () => {
  const h = fixture(), peers = [player('tab-a', { userId: 'account' }), player('tab-b', { userId: 'account' })];
  for (const peer of peers) h.samples.set(peer.id, pose());
  h.receive(peers); h.frame();
  assert.equal(h.remotes.size, 1); assert.equal(h.scene.children.length, 1); assert.equal(h.labels.children.length, 1);
  assert.equal(h.roster().players.length, 1); assert.equal(h.roster().count, 1);
  assert.equal(h.roster().players[0].id, h.remotes.keys().next().value);
  assert.ok(h.roster().players[0].position);
});

test('the local account wins over its other tab, without hiding another account with the same name', () => {
  const h = fixture();
  const peers = [player('other-tab', { userId: 'mine', name: 'Same Name' }),
    player('self', { userId: 'mine', name: 'Same Name', self: true }),
    player('peer', { userId: 'different', name: 'Same Name' })];
  for (const peer of peers) h.samples.set(peer.id, pose());
  h.receive(peers); h.frame();
  assert.deepEqual(Array.from(h.remotes.keys()), ['peer']);
  assert.deepEqual(ids(h.roster()), ['peer', 'self']); assert.equal(h.roster().count, 2);
});

test('disconnected self records cannot hide a live connection and legacy normalized names deduplicate', () => {
  const h = fixture();
  const peers = [player('dead-self', { userId: 'same', self: true, connected: false }),
    player('live', { userId: 'same' }), player('legacy-a', { name: ' e\u0301 ' }), player('legacy-b', { name: 'é' })];
  for (const peer of peers) h.samples.set(peer.id, pose());
  h.receive(peers); h.frame();
  assert.equal(h.remotes.size, 2); assert.equal(h.roster().players.length, 2);
  assert.ok(h.remotes.has('live')); assert.ok(!h.roster().players.some(peer => peer.id === 'dead-self'));
});

test('account IDs cannot collide with display-name fallback and unnamed connections remain distinct', () => {
  const h = fixture();
  const peers = [player('account-peer', { userId: 'same-value', name: 'Known account' }),
    player('legacy-peer', { name: 'same-value' }), player('unnamed-a', { name: '' }), player('unnamed-b', { name: '' })];
  for (const peer of peers) h.samples.set(peer.id, pose());
  h.receive(peers); h.frame();
  assert.equal(h.remotes.size, 4); assert.equal(h.roster().players.length, 4);
});

test('new connection identity retires the previous object and DOM before the next render frame', () => {
  const h = fixture(); h.samples.set('old', pose()); h.samples.set('new', pose(20));
  h.receive([player('old', { userId: 'same' })]); h.frame();
  const retired = h.remotes.get('old');
  h.receive([player('new', { userId: 'same' })]);
  assert.equal(retired.root.parent, null); assert.equal(retired.label.parent, null); assert.equal(h.remotes.has('old'), false);
  assert.deepEqual(ids(h.roster()), ['new']);
  h.frame(); assert.equal(h.remotes.size, 1); assert.equal(h.labels.children.length, 1);
});

test('same-state departure or disconnect removes objects, labels and published positions without RAF', () => {
  for (const remaining of [[], [player('peer', { connected: false })]]) {
    const h = fixture(); h.samples.set('peer', pose());
    h.receive([player('peer')]); h.frame(); const retired = h.remotes.get('peer');
    h.receive(remaining);
    assertNoRemotes(h); assert.equal(retired.root.parent, null); assert.equal(retired.label.parent, null);
    assert.equal(h.roster().players.length, 0); assert.equal(h.roster().count, 0);
  }
});

test('offline and reconnecting transitions clear the old world even if a transport retains its last roster', () => {
  for (const state of ['offline', 'connecting', 'reconnecting']) {
    const h = fixture(), peer = player('peer'); h.samples.set(peer.id, pose());
    h.receive([peer]); h.frame(); h.receive([peer], state);
    assertNoRemotes(h); assert.equal(h.roster().state, state);
    assert.equal(h.roster().players.length, 0); assert.equal(h.roster().count, 0);
  }
});

test('the actual stale timer removes ghost birds and publishes no stale positions without another frame', () => {
  const h = fixture(); h.samples.set('peer', pose()); h.receive([player('peer')]); h.frame();
  assert.equal(h.scene.children.length, 1); h.expire();
  assert.equal(h.scope.stale, true); assertNoRemotes(h);
  assert.equal(h.roster().players.length, 0); assert.equal(h.roster().count, 0);
  h.frame(); assertNoRemotes(h);
});

test('a connected tombstone with frozen input expires even while other authority updates keep arriving', () => {
  const h = fixture(), frozen = player('frozen'), live = player('live');
  h.samples.set('frozen', pose()); h.samples.set('live', pose(30));
  h.receive([frozen, live]); h.frame(); assert.equal(h.remotes.size, 2);
  h.advance(4000); live.lastProcessedInput++; h.receive([frozen, live]); h.frame();
  h.advance(4001); live.lastProcessedInput++; h.receive([frozen, live]);
  assert.equal(h.scope.stale, false, 'No transport disconnect or globally stale flag is needed');
  assert.deepEqual(Array.from(h.remotes.keys()), ['live']);
  assert.deepEqual(ids(h.roster()), ['live']); assert.equal(h.roster().count, 1);
});

test('stationary pose remains present while the input acknowledgement advances', () => {
  const h = fixture(), peer = player('hovering'); h.samples.set(peer.id, pose(25));
  h.receive([peer]); h.frame(); const original = h.remotes.get(peer.id);
  for (let n = 0; n < 4; n++) {
    h.advance(5000); peer.lastProcessedInput++; h.receive([peer]); h.frame();
    assert.equal(h.remotes.get(peer.id), original); assert.equal(original.root.visible, true);
    assert.equal(h.roster().players[0].position.x, 25);
  }
});

test('a new session with a lower sequence wins over an older frozen duplicate by recent activity', () => {
  const h = fixture(), old = player('old', { userId: 'same', lastProcessedInput: 9999 });
  const fresh = player('fresh', { userId: 'same', lastProcessedInput: 1 });
  h.samples.set(old.id, pose()); h.samples.set(fresh.id, pose(40));
  h.receive([old]); h.frame(); const retired = h.remotes.get(old.id);
  h.advance(1000); h.receive([old, fresh]);
  assert.equal(retired.root.parent, null); assert.equal(retired.label.parent, null);
  h.frame(); assert.deepEqual(Array.from(h.remotes.keys()), ['fresh']);
  assert.deepEqual(ids(h.roster()), ['fresh']);
  h.receive([fresh, old]); h.frame();
  assert.deepEqual(Array.from(h.remotes.keys()), ['fresh'], 'Roster reordering cannot revive the stale high-sequence session');
});

test('alternating acknowledgements from live duplicate tabs retain the same bird and label', () => {
  const h = fixture(), old = player('old', { userId: 'same' }), fresh = player('fresh', { userId: 'same' });
  h.samples.set(old.id, pose()); h.samples.set(fresh.id, pose(40));
  h.receive([old]); h.frame();
  h.advance(100); h.receive([old, fresh]); h.frame();
  const original = h.remotes.get(fresh.id), originalLabel = original.label;
  for (let n = 0; n < 10; n++) {
    h.advance(100);
    (n % 2 ? fresh : old).lastProcessedInput++;
    h.receive(n % 2 ? [old, fresh] : [fresh, old]); h.frame();
    assert.equal(h.remotes.get(fresh.id), original, 'Acknowledgement timing cannot change the canonical connection');
    assert.equal(h.labels.children[0], originalLabel);
    assert.equal(h.scene.children[0], original.root);
    assert.equal(h.remotes.size, 1); assert.equal(h.labels.children.length, 1);
  }
  h.receive([{ ...fresh, connected: false }, old]); h.frame();
  assert.deepEqual(Array.from(h.remotes.keys()), ['old'], 'The remaining live tab takes over after a disconnect');
  assert.equal(original.root.parent, null); assert.equal(originalLabel.parent, null);
});

test('replayed hosted authority stamps expire, while a genuinely new stamp and input recover', () => {
  const h = fixture(), peer = player('peer'); h.samples.set(peer.id, pose());
  const next = { state: 'room', players: [peer], count: 1, serverTimeMs: 50000 };
  h.snapshot(next); h.frame(); assert.equal(h.remotes.size, 1);
  h.advance(5000); h.snapshot(next); assert.equal(h.scope.lastSnapshot, 1000);
  h.advance(4001); h.snapshot(next); h.tick();
  assert.equal(h.scope.stale, true); assertNoRemotes(h); assert.equal(h.roster().state, 'reconnecting');
  peer.lastProcessedInput++; next.serverTimeMs++;
  h.snapshot(next); h.frame();
  assert.equal(h.scope.lastSnapshot, 10001); assert.equal(h.scope.stale, false);
  assert.equal(h.remotes.size, 1); assert.equal(h.roster().state, 'room');
});

test('explicitly unknown authority stamps cannot fall back to changing bridge contents to extend liveness', () => {
  const h = fixture(), peer = player('peer'); h.samples.set(peer.id, pose());
  const next = { state: 'room', players: [peer], count: 1, serverTimeMs: null };
  h.snapshot(next); h.frame();
  h.advance(5000); peer.lastProcessedInput++; h.snapshot(next, { serverTimeMs: 99999 });
  assert.equal(h.scope.lastSnapshot, 1000, 'Explicit null from the host overrides an event stamp or signature fallback');
  h.advance(4001); peer.lastProcessedInput++; h.snapshot(next); h.tick();
  assert.equal(h.scope.stale, true); assertNoRemotes(h); assert.equal(h.roster().players.length, 0);
});

test('legacy hosts use changing input acknowledgements, never cached roster order, as heartbeat fallback', () => {
  const h = fixture(), one = player('one'), two = player('two');
  h.samples.set(one.id, pose()); h.samples.set(two.id, pose(20));
  const next = { state: 'room', players: [one, two], count: 2 };
  h.snapshot(next); h.frame();
  h.advance(5000); next.players.reverse(); h.snapshot(next); assert.equal(h.scope.lastSnapshot, 1000);
  h.advance(4001); h.snapshot(next); h.tick(); assertNoRemotes(h); assert.equal(h.scope.stale, true);
  one.lastProcessedInput++; h.snapshot(next); h.frame();
  assert.equal(h.scope.stale, false); assert.deepEqual(ids(h.roster()), ['one']);
});

test('real pagehide tears down remote objects, cached roster and Chrona even when hosted accountUI has no destroy', () => {
  const h = fixture(); h.samples.set('peer', pose()); h.receive([player('peer')]); h.frame();
  h.pagehide(true); assert.equal(h.remotes.size, 1); assert.equal(h.scope.disposed, false);
  h.pagehide(); assertNoRemotes(h); assert.equal(h.scope.disposed, true);
  assert.equal(h.roster().players.length, 0); assert.equal(h.roster().count, 0);
  assert.deepEqual(h.cleanup, { timers: 1, auth: 1, chrona: 1 });
  assert.equal(h.scope.c.updateSimulation, h.scope.originalSimulation); assert.equal(h.scope.c.render, h.scope.originalRender);
});

test('missing, rejected and uninitialized poses cannot keep a visible bird or published neighbour position', () => {
  for (const invalid of [null, { position: { x: NaN, y: 20.5, z: 0 }, yaw: 0 }, { position: { x: 0, y: 0, z: 0 }, yaw: 0 }]) {
    const h = fixture(); h.samples.set('peer', pose()); h.receive([player('peer')]); h.frame();
    h.samples.set('peer', invalid); h.frame();
    assert.ok(h.scene.children.every(bird => !bird.visible)); assert.ok(h.labels.children.every(label => label.hidden));
    assert.equal(h.roster().players[0]?.position ?? null, null);
  }
  const h = fixture(); h.samples.set('peer', pose()); h.receive([player('peer', { lastProcessedInput: 0 })]); h.frame();
  assertNoRemotes(h); assert.equal(h.roster().players[0]?.position ?? null, null);
});
