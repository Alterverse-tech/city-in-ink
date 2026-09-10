import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { renderGame } from '../build.mjs';
import { wireStartup } from '../startup-build.mjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('source/manifest.json', root), 'utf8'));
const source = (await Promise.all(manifest.parts.map(name => readFile(new URL(`source/${name}`, root), 'utf8')))).join('');
const rendered = renderGame(source), html = wireStartup(rendered);
const functions = html.slice(html.indexOf('function scheduleOptionalAirship()'), html.indexOf('  function whenReady(cb)'));
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness({ rebuildError = false } = {}) {
  let resolveModel, rejectModel;
  const model = new Promise((resolve, reject) => { resolveModel = resolve; rejectModel = reject; });
  const calls = { requests: [], builds: [], intervals: [], logs: [], warnings: [], welcome: 0 };
  const frames = [], timers = new Map(), listeners = new Map();
  const state = { events: [], ready: false, user: { bird: 'parrot' }, selected: { id: 'selected' } };
  const window = { __SF_THREE: {}, __sfGeo: {} };
  const empty = () => {};
  const context = {
    window, T: null, GEO: null, TW: {}, CFG: { airshipModel: 'assets/airship.glb' }, state, VERSION: 'test',
    backend: { events: async () => ({ source: 'Saved feed', list: [{ id: 'event-one' }], citizens: [], official: true }) },
    normalizeEvent: event => event, isPast: () => false,
    loadGLB(url, options) { calls.requests.push({ url, options }); return model; },
    buildWorld() { calls.builds.push(state.shipModel); if (rebuildError && state.shipModel) throw new Error('model cannot clone'); },
    c: { render: empty, updateSimulation: empty, applyPalette: empty, setLabels: empty, setGullFlightMode: empty },
    nav: { tick: empty, stop: empty }, qs: { get: () => null },
    openWelcome() { calls.welcome++; },
    log(...args) { calls.logs.push(args); }, console: { warn(...args) { calls.warnings.push(args); }, error: empty },
    setInterval(callback, delay) { calls.intervals.push({ callback, delay }); },
    requestAnimationFrame(callback) { frames.push(callback); },
    setTimeout(callback, delay) { const id = timers.size + 1; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, AbortController,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  for (const name of ['loadCover', 'injectUI', 'placeEvents', 'installPicking', 'tagGullParts', 'renderList', 'renderBoard', 'frame', 'updateChips', 'applyView', 'applyBannerLight', 'applyBird', 'select', 'flyTo', 'look', 'lookAt', 'toast', 'drawPoster', 'geocodeSF', 'leaderboard', 'rebuildVenue', 'moveShip', 'refreshChip', 'renderCard', 'setView', 'enterCity', 'retireEvent', 'lifecycleTick', 'refreshEvents', 'updateClock', 'downloadIcs', 'nowMs']) context[name] = empty;
  runInNewContext(`${functions}\nglobalThis.start = init;`, context);
  return { calls, state, context, timers, listeners, resolveModel, rejectModel,
    frame() { for (const callback of frames.splice(0)) callback(); } };
}

test('the actual game init becomes ready with procedural ships while an optional request is stalled', async () => {
  const h = harness();
  await h.context.start();
  assert.equal(h.state.ready, true);
  assert.equal(h.state.events.length, 1);
  assert.equal(h.calls.welcome, 1);
  assert.deepEqual(h.calls.builds, [null]);
  assert.equal(h.calls.requests.length, 0);
  h.frame();
  assert.equal(h.calls.requests.length, 0);
  h.frame();
  assert.equal(h.calls.requests.length, 1);
  assert.equal(h.calls.requests[0].url, 'assets/airship.glb');
  assert.equal(h.state.ready, true);
  assert.equal([...h.timers.values()][0].delay, 30000);
  assert.equal(h.calls.intervals.length, 2);
  h.rejectModel(new Error('optional model missing'));
  await settle();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.calls.builds, [null]);
});

test('a late model success rebuilds the fallback ships once and preserves the player and selection', async () => {
  const h = harness(), user = h.state.user, selection = h.state.selected;
  await h.context.start(); h.frame(); h.frame();
  const model = { name: 'Blender airship' };
  h.resolveModel(model); await settle();
  assert.equal(h.state.shipModel, model);
  assert.deepEqual(h.calls.builds, [null, model]);
  assert.equal(h.state.user, user);
  assert.equal(h.state.selected, selection);
  assert.equal(h.state.ready, true);
  assert.equal(h.timers.size, 0);
});

test('timeout cancels the optional fetch and a late completion cannot replace the fallback', async () => {
  const h = harness();
  await h.context.start(); h.frame(); h.frame();
  [...h.timers.values()][0].callback();
  assert.equal(h.calls.requests[0].options.signal.aborted, true);
  h.resolveModel({ name: 'arrived after timeout' }); await settle();
  assert.equal(h.state.shipModel, null);
  assert.deepEqual(h.calls.builds, [null]);
  assert.equal(h.state.ready, true);
});

test('failed model construction restores fallback ships and page exit aborts loading', async () => {
  const h = harness({ rebuildError: true });
  await h.context.start(); h.frame(); h.frame();
  h.resolveModel({ name: 'invalid model' }); await settle();
  assert.equal(h.state.shipModel, null);
  assert.equal(h.calls.builds.length, 3);
  assert.equal(h.calls.builds.at(-1), null);
  assert.equal(h.state.ready, true);
  const exit = harness();
  await exit.context.start(); exit.frame(); exit.frame();
  exit.listeners.get('pagehide')();
  assert.equal(exit.calls.requests[0].options.signal.aborted, true);
  exit.rejectModel(new Error('aborted')); await settle();
  assert.deepEqual(exit.calls.builds, [null]);
});

test('optional startup patches fail closed if the original source contract moves', () => {
  assert.throws(() => wireStartup(rendered.replace('state.shipModel = await loadGLB', 'state.shipModel = await changedLoad')), /Startup patch target changed/);
  assert.throws(() => wireStartup(html), /Startup patch target changed/);
});


test('the real GLB loader forwards cancellation to its low-priority network request', async () => {
  const start = html.indexOf('  async function loadGLB('), end = html.indexOf('  /* ---------------------------------------------------------------- events → world */', start);
  assert.ok(start > 0 && end > start);
  let request;
  const context = { fetch(url, options) {
    request = { url, options };
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('network cancelled')), { once: true }));
  } };
  runInNewContext(html.slice(start, end) + '\nglobalThis.load = loadGLB;', context);
  const controller = new AbortController();
  const pending = context.load('assets/airship.glb', { signal: controller.signal });
  assert.equal(request.options.priority, 'low');
  controller.abort();
  await assert.rejects(pending, /network cancelled/);
});

test('leaving before the first painted frames never starts an optional request', async () => {
  const h = harness();
  await h.context.start();
  h.listeners.get('pagehide')(); h.frame(); h.frame();
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.timers.size, 0);
});
