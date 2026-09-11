import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Run the actual add-on functions, without booting the rest of the 3D city.
const source = readFileSync(new URL('../city-extras.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function neighbourXHandle(');
const end = source.indexOf('/* ------------------------------------- Tokyo-style signage', start);
assert.ok(start >= 0 && end > start, 'Neighbour card functions must be present');

function fixture({ hosted = true } = {}) {
  const messages = [], nodes = [], ticks = [];
  const window = {};
  window.parent = hosted ? { postMessage: (message, origin) => messages.push({ message, origin }) } : window;
  if (hosted) window.__SF_HOST_CLIENT__ = {};
  const document = {
    createElement() {
      const children = new Map();
      return {
        innerHTML: '',
        querySelector(selector) {
          if (!children.has(selector)) children.set(selector, {
            style: {}, listeners: {},
            addEventListener(type, callback) { this.listeners[type] = callback; },
          });
          return children.get(selector);
        },
        remove() { nodes.splice(nodes.indexOf(this), 1); },
      };
    },
    body: { appendChild: (node) => nodes.push(node) },
  };
  const context = vm.createContext({ window, document, setInterval: (callback) => ticks.push(callback) });
  vm.runInContext(`const X_LOGO = '<svg aria-hidden="true"></svg>'; const NEAR_PLAYER = 90, LEAVE_PLAYER = 150;\n${source.slice(start, end)}`, context);
  return { ...context, messages, nodes, ticks };
}

function click(overrides = {}) {
  return {
    type: 'click', isTrusted: true, prevented: 0,
    preventDefault() { this.prevented++; }, ...overrides,
  };
}

test('Profile handles preserve complete valid names and ignore numeric X coordinates', () => {
  const { neighbourXHandle } = fixture();
  assert.equal(neighbourXHandle({ handle: ' @pengpeng1366 ', name: 'Other' }), 'pengpeng1366');
  assert.equal(neighbourXHandle({ x: 312, name: 'legacy_name' }), 'legacy_name');
  assert.equal(neighbourXHandle({ x: '@legacy_x', name: 'Other' }), 'legacy_x');
  assert.equal(neighbourXHandle({ name: 'a'.repeat(15) }), 'a'.repeat(15));
});

test('Display names, malformed handles and URLs cannot become profile destinations', () => {
  const { neighbourXHandle } = fixture();
  for (const name of ['Ben Scott', 'a'.repeat(16), '@@pengpeng1366', 'https://x.com/name', 'name?redirect=evil', '<img onerror=alert(1)>', 'name/other', '']) {
    assert.equal(neighbourXHandle({ name }), '', name);
  }
  assert.equal(neighbourXHandle({ x: 312 }), '');
  assert.equal(neighbourXHandle({ handle: '<b>bad</b>', name: 'ValidButDifferent' }), '');
});

test('A real hosted click sends only the profile handle to the fixed trusted origin', () => {
  const { openHostedXProfile, messages } = fixture();
  const event = click();
  assert.equal(openHostedXProfile(event, 'pengpeng1366'), true);
  assert.equal(event.prevented, 1);
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), {
    message: { type: 'chrona:open-x-profile', handle: 'pengpeng1366' }, origin: 'https://chrona.world',
  });
});

test('Synthetic clicks and unrelated events never ask the host to open a profile', () => {
  const { openHostedXProfile, messages } = fixture();
  for (const event of [click({ isTrusted: false }), click({ type: 'mouseover' })]) {
    assert.equal(openHostedXProfile(event, 'pengpeng1366'), false);
    assert.equal(event.prevented, 0);
  }
  assert.equal(messages.length, 0);
});

test('Standalone links and frames without a ready Chrona host keep normal anchor behavior', () => {
  for (const hosted of [false, true]) {
    const f = fixture({ hosted });
    delete f.window.__SF_HOST_CLIENT__;
    const event = click();
    assert.equal(f.openHostedXProfile(event, 'pengpeng1366'), false);
    assert.equal(event.prevented, 0);
    assert.equal(f.messages.length, 0);
  }
});

test('Profile bridge rejects arbitrary destinations and non-string handles', () => {
  const { openHostedXProfile, messages } = fixture();
  for (const handle of ['https://evil.example', 'user/other', '@user', '', 'a'.repeat(16), 123, { toString: () => 'valid' }]) {
    const event = click();
    assert.equal(openHostedXProfile(event, handle), false);
    assert.equal(event.prevented, 0);
  }
  assert.equal(messages.length, 0);
});

test('The actual proximity card uses textContent and wires its Follow click to the bridge', () => {
  const f = fixture();
  f.window.__sfNet = { players: [{ id: 'peer', name: 'pengpeng1366', connected: true, position: { x: 10, y: 0, z: 0 }, color: '#fff' }] };
  f.installNeighbourCard({}, { freeFlightEnabled: true, flightCharacter: { position: { x: 0, y: 0, z: 0 } } });
  f.ticks[0]();
  assert.equal(f.nodes.length, 1);
  const card = f.nodes[0];
  assert.equal(card.querySelector('b').textContent, '@pengpeng1366');
  assert.equal(card.querySelector('i').style.backgroundColor, '#fff');
  assert.ok(!card.innerHTML.includes('pengpeng1366'), 'Player data is not interpolated into markup');
  assert.match(card.innerHTML, /target="_blank" rel="noopener noreferrer"/);
  const follow = card.querySelector('.tw-follow');
  assert.equal(follow.href, 'https://x.com/pengpeng1366');
  const event = click();
  follow.listeners.click(event);
  assert.equal(event.prevented, 1);
  assert.equal(f.messages[0].message.handle, 'pengpeng1366');
});

test('A nearer player with no valid profile cannot leave a stale Follow card behind', () => {
  const f = fixture();
  f.window.__sfNet = { players: [{ id: 'peer', name: 'valid_name', connected: true, position: { x: 10, y: 0, z: 0 } }] };
  f.installNeighbourCard({}, { freeFlightEnabled: true, flightCharacter: { position: { x: 0, y: 0, z: 0 } } });
  f.ticks[0]();
  assert.equal(f.nodes.length, 1);
  f.window.__sfNet.players.unshift({ id: 'other', name: 'Ben Scott', connected: true, position: { x: 1, y: 0, z: 0 } });
  f.ticks[0]();
  assert.equal(f.nodes.length, 0);
});
