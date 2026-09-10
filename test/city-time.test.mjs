import test from 'node:test';
import assert from 'node:assert/strict';
import { sanFranciscoLighting, installCityTime } from '../city-time.mjs';

test('San Francisco clock follows Pacific standard/daylight time regardless of host timezone', () => {
  assert.equal(sanFranciscoLighting(new Date('2026-01-15T20:00:00Z')).localTime, '12:00:00');
  assert.equal(sanFranciscoLighting(new Date('2026-07-15T20:00:00Z')).localTime, '13:00:00');
  assert.equal(sanFranciscoLighting(new Date('2026-03-08T09:59:59Z')).localTime, '01:59:59');
  assert.equal(sanFranciscoLighting(new Date('2026-03-08T10:00:00Z')).localTime, '03:00:00');
  assert.equal(sanFranciscoLighting(new Date('2026-11-01T08:59:59Z')).localTime, '01:59:59');
  assert.equal(sanFranciscoLighting(new Date('2026-11-01T09:00:00Z')).localTime, '01:00:00');
});

test('clock-driven dawn/day/dusk/night transitions are continuous and include midnight', () => {
  const at = time => sanFranciscoLighting(new Date(`2026-09-10T${time}-07:00`));
  assert.equal(at('00:00:00').label, 'night');
  assert.equal(at('23:59:59').label, 'night');
  assert.deepEqual([at('06:00:00').from, at('06:00:00').to, at('06:00:00').mix], ['night', 'dusk', 0.5]);
  assert.deepEqual([at('07:00:00').from, at('07:00:00').to, at('07:00:00').mix], ['dusk', 'day', 0.5]);
  assert.deepEqual([at('18:00:00').from, at('18:00:00').to, at('18:00:00').mix], ['day', 'dusk', 0.5]);
  assert.deepEqual([at('19:00:00').from, at('19:00:00').to, at('19:00:00').mix], ['dusk', 'night', 0.5]);
  assert.equal(at('12:00:00').label, 'day');
  for (const boundary of ['05:30:00', '06:30:00', '07:30:00', '17:30:00', '18:30:00', '19:30:00']) {
    const time = new Date(`2026-09-10T${boundary}-07:00`), a = sanFranciscoLighting(new Date(+time - 1)), b = sanFranciscoLighting(time);
    const weights = light => ({ [light.from]: 1 - light.mix, [light.to]: light.from === light.to ? 1 : light.mix });
    for (const palette of ['day', 'dusk', 'night']) assert.ok(Math.abs((weights(a)[palette] || 0) - (weights(b)[palette] || 0)) < 0.00001);
  }
});

function fixture() {
  const scope = new EventTarget(), document = new EventTarget(), tasks = new Map();
  document.documentElement = { dataset: {} }; document.hidden = false;
  let seq = 0, date = new Date('2026-09-10T18:00:00-07:00');
  Object.assign(scope, { document, setTimeout(fn) { tasks.set(++seq, fn); return seq; }, clearTimeout(id) { tasks.delete(id); } });
  const calls = [], captures = [], camera = { x: 17 }, velocity = { x: 42 };
  const city = { materialRecords: [{}], camera, flightVelocity: velocity, freeFlightEnabled: true, palette: 'day',
    captureTourPalette(name) { captures.push(name); return { name, count: this.materialRecords.length }; },
    applyTourPalette(from, to, mix) { calls.push({ from, to, mix }); }, applyPalette() { throw Error('Manual palette should not run'); },
    notifyCinematicTour() { this.notifiedPalette = this.palette; }, dispose() { this.disposed = true; } };
  const state = installCityTime(city, { scope, now: () => date });
  return { scope, document, tasks, city, state, calls, captures, camera, velocity, time(value) { date = new Date(value); } };
}

test('startup and cinematic palette writes use actual SF time without touching camera/flight', () => {
  const f = fixture();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].from.name, 'day'); assert.equal(f.calls[0].to.name, 'dusk');
  f.city.applyTourPalette('night', 'day', 1); assert.equal(f.calls.length, 1, 'cinematic frames do not repeatedly blend materials');
  f.city.palette = 'night'; f.city.notifyCinematicTour(); assert.equal(f.city.notifiedPalette, 'dusk');
  f.city.applyPalette('night'); assert.equal(f.city.palette, 'dusk');
  assert.equal(f.city.camera, f.camera); assert.equal(f.city.flightVelocity, f.velocity); assert.equal(f.city.freeFlightEnabled, true);
  f.state.dispose();
});

test('new streamed material records get full palette snapshots before interpolation', () => {
  const f = fixture(); f.city.materialRecords.push({});
  const event = new Event('sf-city-geometry-updated'); event.detail = { city: f.city }; f.scope.dispatchEvent(event);
  assert.equal(f.calls.at(-1).from.count, 2); assert.equal(f.calls.at(-1).to.count, 2); assert.equal(f.captures.length, 6);
  f.state.dispose();
});

test('hidden tabs suspend timers and resume from actual clock, including bfcache restoration', () => {
  const f = fixture(); assert.equal(f.tasks.size, 1);
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); assert.equal(f.tasks.size, 0);
  f.time('2026-09-10T22:00:00-07:00'); f.document.hidden = false; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.city.palette, 'night'); assert.equal(f.tasks.size, 1);
  f.scope.dispatchEvent(new Event('pagehide')); assert.equal(f.tasks.size, 0);
  f.time('2026-09-11T12:00:00-07:00'); f.scope.dispatchEvent(new Event('pageshow')); assert.equal(f.city.palette, 'day');
  f.city.dispose(); assert.equal(f.tasks.size, 0); assert.equal(f.city.disposed, true); assert.equal(f.city.sfLocalTime, undefined);
  f.scope.dispatchEvent(new Event('pageshow')); assert.equal(f.tasks.size, 0);
});
