import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { renderGame } from '../build.mjs';
import { wireLayerPerformance } from '../layer-performance-build.mjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('source/manifest.json', root), 'utf8'));
const source = (await Promise.all(manifest.parts.map(name => readFile(new URL(`source/${name}`, root), 'utf8')))).join('');
const html = renderGame(source);

// The layer's time helpers, exactly as built, running against a counting
// Intl.DateTimeFormat so the test sees every construction.
function timeHelpers(page) {
  const start = page.indexOf('  const dtfCache = new Map();');
  const end = page.indexOf('  const WEEK_DAYS = ', start);
  assert.ok(start > 0 && end > start, 'the cached formatter precedes the week table');
  let constructed = 0;
  class CountingFormat extends Intl.DateTimeFormat { constructor(...args) { super(...args); constructed++; } }
  const context = { CFG: { tz: 'America/Los_Angeles' }, Intl: { DateTimeFormat: CountingFormat }, JSON, Map };
  runInNewContext(`${page.slice(start, end)}\nglobalThis.fmt = fmt; globalThis.dtf = dtf;`, context);
  return { fmt: context.fmt, dtf: context.dtf, constructed: () => constructed };
}

test('the built layer caches one Intl.DateTimeFormat per option set instead of one per call', () => {
  const h = timeHelpers(html);
  const d = new Date('2026-10-07T18:30:00-07:00');
  assert.equal(h.fmt.when({ startDate: d }), 'Wed Oct 7 · 6:30 PM');
  assert.equal(h.fmt.dateKey(d), '10/07/2026');
  assert.equal(h.fmt.clock(d), 'WED · OCT 7 · 6:30 PM PT');
  const built = h.constructed();
  assert.ok(built >= 4 && built <= 6, `one formatter per distinct option set, got ${built}`);
  for (let i = 0; i < 500; i++) { h.fmt.when({ startDate: d }); h.fmt.dayKey(d); h.fmt.dateKey(d); h.fmt.clock(d); }
  assert.equal(h.constructed(), built, 'repeated formatting constructs nothing new');
  assert.equal(h.dtf({ weekday: 'short' }), h.dtf({ weekday: 'short' }));
  assert.notEqual(h.dtf({ weekday: 'short' }), h.dtf({ day: 'numeric' }));
});

test('cached formatters produce exactly what a fresh Intl.DateTimeFormat in Pacific time produces', () => {
  const h = timeHelpers(html);
  const fresh = opts => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ...opts });
  for (const iso of ['2026-10-05T09:00:00-07:00', '2026-10-11T23:59:00-07:00', '2026-11-02T01:30:00-08:00', '2026-03-08T02:30:00Z']) {
    const d = new Date(iso);
    assert.equal(h.fmt.dayShort(d), fresh({ weekday: 'short' }).format(d));
    assert.equal(h.fmt.dayNum(d), fresh({ day: 'numeric' }).format(d));
    assert.equal(h.fmt.time(d), fresh({ hour: 'numeric', minute: '2-digit' }).format(d).replace(' ', ' '));
    assert.equal(h.fmt.dateKey(d), fresh({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));
  }
});

test('the patch refuses a source whose time helpers moved', () => {
  assert.throws(() => wireLayerPerformance(html), /Layer performance patch target changed/);
  assert.throws(() => wireLayerPerformance(source.replace("const dtf = (opts) =>", "const dtf = (o) =>")), /Layer performance patch target changed/);
  assert.match(wireLayerPerformance(source), /const dtfCache = new Map\(\);/);
});
