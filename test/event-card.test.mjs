import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createEventCardPolicy, eventCardCandidates, installEventCards } from '../event-card.mjs';
import { renderGame } from '../build.mjs';

function harness() {
  const policy = createEventCardPolicy();
  let now = 0;
  const choose = (id, reason = 'nearby') => policy.selected({ id, featured: id === 'host', reason, now });
  const next = (candidates = [], blocked = false) => policy.next({ now, featuredId: 'host', candidates, blocked });
  const at = value => { now = value; };
  return { policy, choose, next, at };
}
const near = (id, distance = 50) => ({ id, distance });

test('the host is the initial card, stays readable, then yields to a stable nearby event', () => {
  const h = harness();
  assert.deepEqual(h.next(), { id: 'host', reason: 'default' });
  h.choose('host', 'default');
  h.at(1000); assert.equal(h.next([near('a')]), null);
  h.at(7999); assert.equal(h.next([near('a')]), null);
  h.at(8000); assert.deepEqual(h.next([near('a')]), { id: 'a', reason: 'nearby' });
});

test('five actual nearby changes show all five cards before the featured return', () => {
  const h = harness(); h.choose('host', 'default');
  for (let i = 1; i <= 5; i++) {
    h.at(i * 10000); h.next([near('e' + i)]);
    h.at(i * 10000 + 1000);
    assert.deepEqual(h.next([near('e' + i)]), { id: 'e' + i, reason: 'nearby' });
    h.choose('e' + i);
    // New feed object, same event: not a sixth selection or a new read timer.
    h.choose('e' + i, 'restore');
  }
  h.at(56999); assert.equal(h.next([near('e5')]), null);
  h.at(57000); assert.deepEqual(h.next([near('e5')]), { id: 'host', reason: 'fifth-return' });
  h.choose('host', 'fifth-return');
  h.at(64999); assert.equal(h.next([near('e5')]), null);
  h.at(65000); assert.deepEqual(h.next([near('e5')]), { id: 'e5', reason: 'nearby' });
  h.choose('e5'); h.at(72000); assert.equal(h.next([near('e5')]), null, 'counter reset after host');
});

test('leaving the activity area returns the host, including vertical distance', () => {
  const h = harness(); h.choose('a');
  h.at(6000); assert.equal(h.next([near('a', 310)]), null);
  assert.equal(h.next([near('a', 321)]), null);
  h.at(7000);
  assert.deepEqual(h.next([near('a', 321)]), { id: 'host', reason: 'away' });
  assert.deepEqual(h.next([]), { id: 'host', reason: 'away' });
  const c = eventCardCandidates([{ id: 'a', hasVehicle: true, ship: { position: { x: 0, y: 400, z: 0 } } }], { x: 0, y: 0, z: 0 });
  assert.equal(c[0].distance, 400);
});

test('a short render/LOD gap does not reset five-change counting as an away return', () => {
  const h = harness(); h.choose('a'); h.at(6000);
  assert.equal(h.next([]), null);
  h.at(6500); assert.equal(h.next([near('b')]), null);
  h.at(7500); assert.deepEqual(h.next([near('b')]), { id: 'b', reason: 'nearby' });
});

test('candidate dwell and distance hysteresis prevent neighbouring posters flickering', () => {
  const h = harness(); h.choose('a'); h.at(10000);
  h.next([near('b', 40), near('a', 50)]);
  h.at(12000); assert.equal(h.next([near('b', 40), near('a', 50)]), null);
  assert.deepEqual(h.next([near('b', 20), near('a', 60)]), { id: 'b', reason: 'nearby' });
  h.at(13000); assert.equal(h.next([near('c', 10)]), null);
  h.at(13500); assert.equal(h.next([near('b', 20)]), null);
  h.at(14500); assert.deepEqual(h.next([near('b', 20)]), { id: 'b', reason: 'nearby' });
});

test('manual reading and card interactions defer automatic replacement without counting as switches', () => {
  const h = harness(); h.choose('manual', 'manual'); h.at(11000);
  assert.equal(h.next([near('a')]), null);
  h.at(13000); assert.equal(h.next([near('a')], true), null);
  assert.deepEqual(h.next([near('a')]), { id: 'a', reason: 'nearby' });
  h.choose('a'); h.at(20000); assert.equal(h.next([near('a')]), null);
});

test('approaching a different poster on the same wall can cross the smaller close-range margin', () => {
  const h = harness(); h.choose('a'); h.at(10000);
  h.next([near('b', 14), near('a', 22)]);
  h.at(11000); assert.deepEqual(h.next([near('b', 14), near('a', 22)]), { id: 'b', reason: 'nearby' });
});

test('poster anchors and moving ships are read fresh, unknown locations never become candidates', () => {
  const ship = { x: 60, y: 0, z: 0 };
  const events = [{ id: 'ship', hasVehicle: true, ship: { position: ship } }, { id: 'poster', world: { x: 0, y: 0, z: 0 } }, { id: 'unknown', hasVehicle: false, ship: { visible: false, position: { x: 0, y: 0, z: 0 } } }];
  const signs = { anchorPoint: ev => ev.id === 'poster' ? { x: 0, y: 80, z: 0 } : null };
  assert.deepEqual(eventCardCandidates(events, { x: 0, y: 0, z: 0 }, signs), [near('ship', 60), near('poster', 80)]);
  ship.x = 120;
  assert.equal(eventCardCandidates(events, { x: 0, y: 0, z: 0 }, signs)[0].distance, 120);
  events[1].ship = { visible: false, position: { x: 0, y: 0, z: 0 } };
  assert.equal(eventCardCandidates(events, { x: 0, y: 0, z: 0 }, signs)[1].distance, 80,
    'a nearby hidden kite never overrides the real poster altitude');
});

const manifest = JSON.parse(await readFile(new URL('../source/manifest.json', import.meta.url)));
const source = (await Promise.all(manifest.parts.map(name => readFile(new URL('../source/' + name, import.meta.url), 'utf8')))).join('');
const html = renderGame(source);
const body = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));

test('the real selection closure keeps a card on close and restores replaced feed objects by ID', () => {
  const host = { id: 'host', featured: true }, other = { id: 'other' };
  const state = { events: [host, other], venues: [], selected: null };
  const rendered = [];
  const env = { performance: { now: () => 0 }, setInterval: () => 1, clearInterval() {} };
  const TW = { state, renderCard: ev => rendered.push(ev) };
  const context = { TW, state, document: { documentElement: { classList: { toggle() {} } } },
    eventListRows: new Map(), refreshChip() {}, renderList() {}, renderCard: TW.renderCard, c: { freeFlightEnabled: true } };
  runInNewContext(body('  function select(ev, opts)', '  function lookAt(') + '\nglobalThis.select = select;', context);
  TW.select = context.select;
  TW.eventCards = installEventCards(TW, {}, env);
  TW.eventCards.restore(); assert.equal(state.selected, host);
  TW.select(other); assert.equal(state.selected, other);
  TW.select(null); assert.equal(state.selected, host, 'Close/Escape never hides the last card');
  TW.select(other);
  const replaced = { ...other, title: 'Fresh data' }; state.events = [{ ...host }, replaced];
  TW.eventCards.restore(); assert.equal(state.selected, replaced);
  state.events = [{ ...host }]; state.selected = null; TW.eventCards.restore();
  assert.equal(state.selected.id, 'host', 'official feed reset restores default in the same call');
});

test('late cover/RSVP renders cannot show an old event over the current selection', () => {
  const card = { hidden: false, dataset: {}, classList: { toggle() {} } };
  const state = { selected: { id: 'new' } };
  const context = { state, TW: { eventCards: {} }, $: () => card };
  // Run the renderer through the stale-callback guard. Everything beyond the
  // guard deliberately throws, so this verifies it exits before drawing.
  const from = html.indexOf('  function renderCard(ev) {');
  const to = html.indexOf('    if(window.__SF_HOST_READY__)', from);
  runInNewContext(html.slice(from, to) + '\nthrow new Error("Unexpected render"); }\nrenderCard({id:"old"});', context);
  assert.equal(state.selected.id, 'new'); assert.equal(card.hidden, false);
});
