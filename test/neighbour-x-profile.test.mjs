import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Run the actual add-on functions, without booting the rest of the 3D city.
const source = readFileSync(new URL('../city-extras.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function neighbourXHandle(');
const end = source.indexOf('/* ------------------------------------- Tokyo-style signage', start);
assert.ok(start >= 0 && end > start, 'Neighbour card functions must be present');
const fallbackStart = source.indexOf('function installLinkFallback(');
const fallbackEnd = source.indexOf('/* ------------------------------------------------------------------ Discord', fallbackStart);
assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'Generic link fallback must be retained');

function fixture({ hosted = true } = {}) {
  const messages = [], nodes = [], ticks = [], opened = [], links = [], listeners = {};
  const window = {};
  window.open = (...args) => { opened.push(args); return null; };
  window.parent = hosted ? { postMessage: (message, origin) => messages.push({ message, origin }) } : window;
  if (hosted) window.__SF_HOST_CLIENT__ = {};
  const document = {
    addEventListener(type, callback) { listeners[type] = callback; },
    createElement() {
      const children = new Map();
      return {
        innerHTML: '',
        querySelector(selector) {
          if (!children.has(selector)) children.set(selector, {
            style: {}, dataset: {}, listeners: {},
            addEventListener(type, callback) { this.listeners[type] = callback; },
          });
          return children.get(selector);
        },
        remove() { nodes.splice(nodes.indexOf(this), 1); },
      };
    },
    body: { appendChild: (node) => nodes.push(node) },
  };
  const context = vm.createContext({ window, document, setInterval: (callback) => ticks.push(callback), showLink: (url) => links.push(url) });
  vm.runInContext(`const X_LOGO = '<svg aria-hidden="true"></svg>'; const NEAR_PLAYER = 90, LEAVE_PLAYER = 150;\n${source.slice(start, end)}`, context);
  vm.runInContext(source.slice(fallbackStart, fallbackEnd), context);
  return { ...context, messages, nodes, ticks, opened, links, listeners };
}

function click(overrides = {}) {
  return {
    type: 'click', button: 0, isTrusted: true, prevented: 0,
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
  f.window.__sfNet = { state: 'room', players: [{ id: 'peer', name: 'pengpeng1366', connected: true, position: { x: 10, y: 0, z: 0 }, color: '#fff' }] };
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
  f.window.__sfNet = { state: 'room', players: [{ id: 'peer', name: 'valid_name', connected: true, position: { x: 10, y: 0, z: 0 } }] };
  f.installNeighbourCard({}, { freeFlightEnabled: true, flightCharacter: { position: { x: 0, y: 0, z: 0 } } });
  f.ticks[0]();
  assert.equal(f.nodes.length, 1);
  f.window.__sfNet.players.unshift({ id: 'other', name: 'Ben Scott', connected: true, position: { x: 1, y: 0, z: 0 } });
  f.ticks[0]();
  assert.equal(f.nodes.length, 0);
});

test('Leaving the room removes a Follow card even if the old player list is retained', () => {
  for (const state of ['offline', 'connecting', 'reconnecting']) {
    const f = fixture();
    f.window.__sfNet = { state: 'room', players: [{ id: 'peer', name: 'valid_name', connected: true, position: { x: 10, y: 0, z: 0 } }] };
    f.installNeighbourCard({}, { freeFlightEnabled: true, flightCharacter: { position: { x: 0, y: 0, z: 0 } } });
    f.ticks[0](); assert.equal(f.nodes.length, 1);
    f.window.__sfNet.state = state;
    f.ticks[0](); assert.equal(f.nodes.length, 0, state);
  }
});

test('A departed player cannot keep their card through a different player in the hysteresis band', () => {
  for (const departure of ['removed', 'disconnected', 'unpositioned']) {
    const f = fixture();
    const peer = { id: 'peer', name: 'valid_name', connected: true, position: { x: 10, y: 0, z: 0 } };
    const other = { id: 'other', name: 'other_name', connected: true, position: { x: 100, y: 0, z: 0 } };
    f.window.__sfNet = { state: 'room', players: [peer, other] };
    f.installNeighbourCard({}, { freeFlightEnabled: true, flightCharacter: { position: { x: 0, y: 0, z: 0 } } });
    f.ticks[0](); assert.equal(f.nodes.length, 1);
    if (departure === 'removed') f.window.__sfNet.players = [other];
    else if (departure === 'disconnected') peer.connected = false;
    else peer.position = null;
    f.ticks[0](); assert.equal(f.nodes.length, 0, departure);
    other.position.x = 20;
    f.ticks[0](); assert.equal(f.nodes.length, 1);
    assert.equal(f.nodes[0].querySelector('b').textContent, '@other_name');
  }
});

test('A still-connected current player retains the existing distance hysteresis', () => {
  const f = fixture();
  const peer = { id: 'peer', name: 'valid_name', connected: true, position: { x: 10, y: 0, z: 0 } };
  f.window.__sfNet = { state: 'room', players: [peer] };
  f.installNeighbourCard({}, { freeFlightEnabled: true, flightCharacter: { position: { x: 0, y: 0, z: 0 } } });
  f.ticks[0](); const card = f.nodes[0];
  peer.position.x = 100; f.ticks[0](); assert.equal(f.nodes[0], card);
  peer.position.x = 160; f.ticks[0](); assert.equal(f.nodes.length, 0);
});

test('Generic capture handling yields to the hosted X card before its target handler runs', () => {
  const f = fixture();
  f.installLinkFallback();
  f.window.__sfNet = { state: 'room', players: [{ id: 'peer', name: 'pengpeng1366', connected: true, position: { x: 10, y: 0, z: 0 } }] };
  f.installNeighbourCard({}, { freeFlightEnabled: true, flightCharacter: { position: { x: 0, y: 0, z: 0 } } });
  f.ticks[0]();
  const follow = f.nodes[0].querySelector('.tw-follow');
  const event = click({ target: { closest: () => follow } });
  f.listeners.click(event); // Document capture runs before the card's target handler.
  assert.equal(event.prevented, 0);
  follow.listeners.click(event);
  assert.equal(event.prevented, 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].message.handle, 'pengpeng1366');
  assert.equal(f.opened.length, 0, 'No forbidden iframe popup attempt before the parent opens X');
  assert.equal(f.links.length, 0, 'No duplicate copy box after a successful host request');
});

test('Other external links and standalone X links retain the newer popup/copy fallback', () => {
  for (const hosted of [false, true]) {
    const f = fixture({ hosted }); f.installLinkFallback();
    const links = [
      { href: 'https://discord.gg/example', dataset: {} },
      { href: 'https://partiful.com/e/example', dataset: { chronaXHandle: 'pengpeng1366' } },
      { href: 'https://x.com/user/other', dataset: { chronaXHandle: 'user/other' } },
    ];
    if (!hosted) links.push({ href: 'https://x.com/pengpeng1366', dataset: { chronaXHandle: 'pengpeng1366' } });
    for (const a of links) {
      const event = click({ target: { closest: () => a } });
      f.listeners.click(event);
      assert.equal(event.prevented, 1);
      assert.equal(f.links.at(-1), a.href);
    }
    assert.equal(f.opened.length, links.length);
    assert.equal(f.messages.length, 0);
  }
});
