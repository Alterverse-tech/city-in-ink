import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sdk = new URL('../chrona/', import.meta.url);
const source = await readFile(new URL('chrona-presence.js', sdk), 'utf8');
const { mountChronaHost, createHostedConnect, HOST_PROTOCOL } = await import(new URL('chrona-host.js', sdk));
const between = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Presence lifecycle function boundary: ' + start);
  return source.slice(a, b);
};

// Execute the real snapshot, public-state, reset and leave functions. Only the
// authority socket/clock and UI subscriptions are replaced with local fixtures.
function authority() {
  const states = [], emitted = [], subscribers = new Set();
  const context = {
    states, emitted, subscribers, gameId: 'sf-game', protocolVersion: 1,
    state: 'room', session: { roomCode: 'ABCDEF', playerId: 'self' }, snapshot: null,
    players: [], rosterKey: '', seq: 1, synced: false, needResync: false, rttMs: 0,
    attemptWork: 0, interpolator: { push() {}, clear() {} },
    retire: async () => {},
    emit: (event, value) => emitted.push({ event, value }),
  };
  context.candidate = context.attempt = { roomSession: context.session };
  context.isCurrent = value => value === context.attempt;
  vm.createContext(context);
  vm.runInContext([
    between('  function publicState() {', '\n  function publish() {'),
    between('  function publish() {', '\n  const isCurrent ='),
    between('  function clearRuntime() {', '\n  async function retire('),
    between('  async function leave() {', '\n  const unsubscribeAuth ='),
  ].join('\n'), context);
  const listeners = new Map();
  return {
    read: context.publicState,
    emitted,
    feed(serverTimeMs) {
      context.onSnapshot(context.candidate, { gameId: 'sf-game', protocolVersion: 1,
        localPlayerId: 'self', serverTimeMs,
        players: [{ id: 'peer', displayName: 'River', connected: true,
          position: { x: 1, y: 2, z: 3 }, yaw: 0, lastProcessedInput: 5 }],
      });
    },
    presence: {
      state: () => context.state, snapshot: context.publicState,
      sample: () => ({ position: { x: 1, y: 2, z: 3 }, yaw: 0 }),
      subscribe(fn) { subscribers.add(fn); fn(context.publicState()); return () => subscribers.delete(fn); },
      on(event, fn) { listeners.set(event, fn); return () => listeners.delete(event); },
      enterWorld: async () => {}, leave: context.leave, destroy() {},
    },
    leave: context.leave,
  };
}

test('authority timestamps advance with real snapshots and reset on leave', async () => {
  const a = authority();
  assert.equal(a.read().serverTimeMs, null);
  a.feed(1000);
  assert.equal(a.read().serverTimeMs, 1000);
  assert.equal(a.emitted.find(e => e.event === 'snapshot').value.serverTimeMs, 1000);
  for (let i = 0; i < 20; i++) assert.equal(a.read().serverTimeMs, 1000);
  a.feed(1250);
  assert.equal(a.read().serverTimeMs, 1250);
  await a.leave();
  assert.equal(a.read().state, 'offline');
  assert.equal(a.read().serverTimeMs, null);
  assert.equal(a.read().players.length, 0);
  a.feed(2000); // A retired session's late packet must not restore freshness.
  assert.equal(a.read().serverTimeMs, null);
});

test('missing or non-finite server clocks remain unknown instead of becoming delivery timestamps', () => {
  for (const value of [undefined, null, NaN, Infinity]) {
    const a = authority(); a.feed(value);
    assert.equal(a.read().serverTimeMs, null);
    assert.equal(a.emitted.find(e => e.event === 'snapshot').value.serverTimeMs, null);
  }
  const a = authority(); a.feed(0);
  assert.equal(a.read().serverTimeMs, 0, 'A valid zero-based authority clock is preserved');
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Hosted bridge fixture timed out'); await delay(10); }
}

test('the actual host MessageChannel preserves freshness across replay frames and clears it on leave', async () => {
  const a = authority(), listeners = new Map(), sent = [];
  const child = {}, iframe = { contentWindow: child, addEventListener() {}, removeEventListener() {} };
  const parent = {
    localStorage: { getItem: () => null },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type),
    postMessage(data, origin, ports) {
      assert.equal(origin, 'https://chrona.world');
      listeners.get('message')({ source: child, origin: 'null', data, ports });
    },
  };
  child.parent = parent;
  const dispose = mountChronaHost({ iframe, scope: parent,
    account: { user: { id: 'account' }, profile: { displayName: 'River' }, subscribe: () => () => {} },
    binding: { protocol: HOST_PROTOCOL, platformWorldId: 'sf-world', world: { id: 'sf-world', gameId: 'sf-game' } },
    createPresence: async () => a.presence,
  });
  const client = createHostedConnect({ hostOrigin: 'https://chrona.world', scope: child });
  try {
    await client.ready;
    const p = await client.presence({ worldId: 'sf-world', gameId: 'sf-game' });
    p.on('snapshot', state => sent.push(state.serverTimeMs));
    await p.enterWorld();
    a.feed(1000);
    await until(() => sent.length >= 4);
    assert.ok(sent.every(stamp => stamp === 1000), '25ms host replays must not invent a new authority timestamp');
    a.feed(1250);
    await until(() => sent.includes(1250));
    assert.equal(p.snapshot().serverTimeMs, 1250);
    await p.leave();
    assert.equal(p.snapshot().state, 'offline');
    assert.equal(p.snapshot().serverTimeMs, null);
    const afterLeave = sent.length;
    await delay(60);
    assert.equal(sent.length, afterLeave, 'Offline authority must stop host replay frames');
  } finally { client.destroy(); dispose(); }
});
