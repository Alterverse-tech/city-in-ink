import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { renderGame } from '../build.mjs';
import { wireCityStreaming } from '../city-streaming-build.mjs';
import { FEATURED_EVENT, SPOTLIGHT, RSVP_MIN } from '../tuning-build.mjs';

const manifest = JSON.parse(await readFile(new URL('../source/manifest.json', import.meta.url), 'utf8'));
const source = (await Promise.all(manifest.parts.map(name => readFile(new URL('../source/' + name, import.meta.url), 'utf8')))).join('');
const html = wireCityStreaming(renderGame(source));
const between = (start, end) => {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'Final build function boundary: ' + start);
  return html.slice(from, to);
};
const functions = [
  between('  function normalizeEvent(raw, i) {', '  function retireEvent(ev) {'),
  between('  function mkChip(', '  /* ---------------------------------------------------------------- picking'),
  between('  async function refreshEvents()', '  /* ---------------------------------------------------------------- boot */'),
  between('    TW.refreshCityGeometry =', '    state.ready = true;'),
].join('\n');

class Element {
  constructor() {
    this.children = []; this.style = {}; this.dataset = {}; this.fields = new Map();
    this.classList = { toggle() {} };
  }
  set innerHTML(value) { this.markup = value; for (const child of this.children) child.parent = null; this.children = []; }
  get innerHTML() { return this.markup; }
  appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  addEventListener() {}
  querySelector(selector) { if (!this.fields.has(selector)) this.fields.set(selector, new Element()); return this.fields.get(selector); }
  querySelectorAll() { return []; }
}

// WebGL is outside this DOM lifecycle test. The camera uses a conventional
// perspective projection looking down -Z, including near/behind-camera results.
class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  copy(v) { Object.assign(this, { x: v.x, y: v.y, z: v.z }); return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  project(camera) {
    const x = this.x - camera.position.x, y = this.y - camera.position.y, z = this.z - camera.position.z;
    this.x = x / -z; this.y = y / -z;
    this.z = ((-1000.1 / 999.9) * z - 200 / 999.9) / -z;
    return this;
  }
}
const V3 = (...args) => new Vector(...args);
const event = (id, fields = {}) => ({ id, title: id, category: 'founders', start: '2026-10-05T18:00:00-07:00',
  rsvp: 0, lat: 37.79, lng: -122.4, venue: '795 Folsom St · 地址别名', ...fields });

function harness(raw = [event('one'), event('two')]) {
  let response, roof = 20;
  const host = new Element(); host.clientWidth = 1000; host.clientHeight = 800;
  const state = { events: [], past: [], citizens: [], venues: [], clusters: [], selected: null,
    officialFeed: true, user: { rsvps: new Set(), bird: 'gull' },
    flagship: { position: V3(0, 0, -300), userData: { ev: {} } },
    mast: { userData: { top: V3(100, 0, -300) } } };
  const context = { state, FEATURED_EVENT, SPOTLIGHT, TW: { state },
    document: { createElement: () => new Element() }, window: { open() {} }, T: { Vector3: Vector },
    CFG: { week: { start: '2026-10-05' }, fleet: 100, rsvpMin: RSVP_MIN, shipAltitude: 50, lod: { near: 900, mid: 2600 },
      posterReveal: 200, brand: {}, harbor: { lat: 37.79, lng: -122.4 }, core: { lat: 37.79, lng: -122.4 }, featured: { lat: 37.79, lng: -122.4, y: 120 } },
    CATS: { founders: {} }, VEHICLES: ['airship'], BIRDS: { gull: { name: 'Western Gull', dot: '#fff', scale: 1 } },
    hash: () => 0, V3, esc: String, fmt: { dayKey: d => d.toISOString().slice(0, 10), whenShort: () => '', when: () => '' },
    heat: e => e.rsvp || 0, rsvpCount: e => e.rsvp || 0, rsvpDisplay: e => e.rsvp || 0, rsvpTotalDisplay: () => 0,
    regStatus: () => ({}), catOf: () => ({ color: '#fff' }),
    GEO: { Hn: (lng, lat) => ({ x: (lng + 122.4) * 1000, z: -100 + (lat - 37.79) * 1000 }) },
    c: { host, camera: { position: V3() }, sampleTerrain: () => 0, freeFlightEnabled: false }, roofHeightAt: () => roof,
    chipLayer: null, backend: { events: async () => response }, location: { protocol: 'https:' }, nav: { stop() {} },
    lookAt() {}, select() {}, loadCover() {}, rebuildVenue() {}, posterTexture() {},
    renderList() {}, renderBoard() {}, renderCard() {}, log() {}, lifecycleTick() {},
  };
  runInNewContext(functions + `
    buildWorld = () => {
      for (const ev of state.events) {
        ev.hasVehicle = !!ev.wantsVehicle;
        ev.ship = ev.onMap ? { position: V3(ev.world.x, ev.shipY, ev.world.z), userData: { baseY: ev.shipY } } : null;
      }
      buildChips();
    };
    globalThis.api = { normalizeEvent, placeEvents, computeMeta, buildChips, updateChips, refreshEvents, buildWorld };
  `, context);
  state.events = raw.map(context.api.normalizeEvent);
  context.api.placeEvents(); context.api.buildWorld();
  return { state, host, context, api: context.api, layer: () => context.chipLayer,
    stream() { roof++; context.TW.refreshCityGeometry(); },
    async refresh(list) { response = { list, citizens: [], official: true, source: 'Official public sources' }; await context.api.refreshEvents(); },
    venues: () => context.chipLayer.children.filter(el => el.className?.includes('tw-chip-venue')) };
}

test('repeated streaming geometry refresh retires old venue DOM before a projection frame', () => {
  const h = harness(), retired = [];
  for (let i = 0; i < 8; i++) { retired.push(h.state.venues[0].el); h.stream(); }
  assert.equal(h.venues().length, 1);
  assert.ok(retired.every(el => el.parent === null));
  assert.ok(h.layer().children.every(el => el.style.display === 'none'));
  h.api.updateChips();
  // Current tuning intentionally hides venue/cluster groups. Orphans must not
  // bypass that policy; eligible ship/mast chips still acquire a real position.
  assert.equal(h.state.venues[0].el.style.display, 'none');
  assert.match(h.state.flagship.userData.chip.style.transform, /^translate\(-50%,-100%\) translate\(/);
});

test('ordinary feed refresh and a venue shrinking to one event leave no stale group labels', async () => {
  const h = harness(); h.api.updateChips(); const previous = h.state.venues[0].el;
  await h.refresh([event('one', { rsvp: 3 }), event('two')]);
  assert.equal(previous.parent, null); assert.equal(h.venues().length, 1);
  assert.match(h.state.venues[0].el.innerHTML, /795 Folsom St · 地址别名/);
  h.api.updateChips(); const second = h.state.venues[0].el;
  h.state.events.pop(); h.api.computeMeta();
  assert.equal(second.parent, null); assert.equal(h.venues().length, 0);
});

test('new chips are hidden until the first valid projection, including rebuilt layers', () => {
  const h = harness();
  assert.ok(h.layer().children.length > 3);
  assert.ok(h.layer().children.every(el => el.style.display === 'none' && !el.style.transform));
  h.api.updateChips(); assert.equal(h.state.flagship.userData.chip.style.display, '');
  h.api.buildChips();
  assert.ok(h.layer().children.every(el => el.style.display === 'none' && !el.style.transform));
});

test('chip projection hides NaN, infinite, near-plane, behind-camera and offscreen positions', () => {
  const h = harness(), group = h.state.venues[0], ship = h.state.flagship, label = ship.userData.chip, original = ship.position;
  for (const pos of [V3(NaN, 0, -100), V3(0, Infinity, -100), V3(0, 0, 0), V3(0, 0, 100), V3(0, 0, -.01), V3(1000, 0, -100)]) {
    group.pos = ship.position = pos; label.style.transform = ''; h.api.updateChips();
    assert.equal(group._p, null);
    assert.equal(label.style.display, 'none'); assert.equal(label.style.transform, '');
  }
  ship.position = original; h.api.updateChips();
  assert.equal(label.style.display, ''); assert.doesNotMatch(label.style.transform, /NaN|Infinity/);
  h.host.clientWidth = 0; h.api.updateChips(); assert.equal(label.style.display, 'none');
});

test('rank-only refresh does not replace venue DOM or discard expanded state', () => {
  const h = harness(), group = h.state.venues[0]; group.open = true;
  h.api.computeMeta(true);
  assert.strictEqual(h.state.venues[0], group); assert.equal(group.open, true); assert.equal(h.venues().length, 1);
});
