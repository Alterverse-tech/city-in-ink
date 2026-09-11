import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFeedText, slimFeed } from '../feed-slim.mjs';
import { INITIAL_FEATURED_EVENT_ID, createInitialEventFeed, readInitialEventFeed, writeInitialEventFeed, wireInitialEventSeed } from '../initial-event-feed.mjs';

const dataDir = new URL('../data/', import.meta.url);
const featured = { id: INITIAL_FEATURED_EVENT_ID, calendarId: 'calendar-original',
  url: 'https://partiful.com/e/hgyN4UiBL4s3vA0ATTbr', title: 'Real host event',
  start: '2026-10-10T20:30:00.000Z', rsvp: 0, capacity: null, neighborhood: 'FiDi (SF)' };

test('the genuine Saturday host event is in the 49-entry startup feed with exact sourced values', async () => {
  const rawBaseline = await readFile(new URL('tech-week-first.json', dataDir));
  const fullText = (await readFeedText(dataDir, 'tech-week-enriched')).text;
  const full = JSON.parse(fullText), source = full.events.find(event => event.id === INITIAL_FEATURED_EVENT_ID);
  const initial = await readInitialEventFeed(dataDir);
  assert.equal(initial.events.length, 49);
  assert.equal(initial.events[0].id, INITIAL_FEATURED_EVENT_ID);
  assert.deepEqual(initial.events[0], slimFeed({ events: [source] }).events[0]);
  // The organiser can publish or withhold the guest count at any time, and this
  // event now withholds it. Tie the assertion to what the source published, so
  // the guard still catches an invented number without pinning one snapshot's
  // value: a withheld count stays absent and never becomes a zero.
  assert.equal(initial.events[0].rsvp ?? null, source.rsvp ?? null);
  // Location is still withheld for this event, so those fields must stay absent.
  // Capacity is now published on the page, so the guard compares against the
  // source: the entry may carry a sourced number, never one we made up.
  const slimSource = slimFeed({ events: [source] }).events[0];
  for (const field of ['lat', 'lng', 'address', 'venue']) assert.equal(field in initial.events[0], false, `${field} must not be invented`);
  assert.equal(initial.events[0].capacity ?? null, slimSource.capacity ?? null, 'capacity must not be invented');
  assert.equal(initial.coverage.complete, false);
  assert.equal(initial.coverage.events, 49);
  assert.equal(initial.coverage.lastStart, source.start);
  assert.ok(Buffer.byteLength(JSON.stringify(initial)) < 32 * 1024, 'keep the initial programme lightweight');
  assert.deepEqual(await readFile(new URL('tech-week-first.json', dataDir)), rawBaseline);
  assert.equal((await readFeedText(dataDir, 'tech-week-enriched')).text, fullText);
});

test('fresh featured data replaces a stale calendar alias once without changing unrelated events', () => {
  const baseline = { fetchedAt: '2026-09-08', events: [
    { id: 'calendar-original', title: 'Old host data', rsvp: 900 },
    { id: INITIAL_FEATURED_EVENT_ID, title: 'Duplicate host data' },
    { id: 'other', title: 'Other event', rsvp: 0 },
  ] };
  const full = { fetchedAt: '2026-09-09', events: [{ ...featured }] };
  const before = JSON.stringify({ full, baseline });
  const initial = createInitialEventFeed(full, baseline);
  assert.deepEqual(initial.events.map(event => event.id), [INITIAL_FEATURED_EVENT_ID, 'other']);
  assert.equal(initial.events[0].title, featured.title);
  assert.equal(initial.events[0].rsvp, 0);
  assert.equal(initial.events[1].rsvp, 0);
  assert.equal(JSON.stringify({ full, baseline }), before);
});

test('missing, duplicate or mismatched featured source data fails the build instead of making up a fallback', () => {
  const baseline = { events: [] };
  for (const events of [[], [featured, featured], [{ ...featured, url: 'https://example.com/unrelated' }],
    [{ ...featured, id: 'unrelated' }]]) {
    assert.throws(() => createInitialEventFeed({ events }, baseline), /exactly one sourced/);
  }
});

test('copied baseline and inline fallback retain the real event when the full feed is unavailable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sf-initial-events-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const feed = createInitialEventFeed({ fetchedAt: '2026-09-09', events: [featured] }, { events: [] });
  const written = await writeInitialEventFeed(pathToFileURL(directory + '/'), feed);
  const bytes = await readFile(join(directory, 'tech-week-first.json'));
  assert.equal(written.bytes, bytes.length);
  assert.deepEqual(JSON.parse(bytes).events, feed.events);
  const seedOpen = '<script id="tw-events-seed" type="application/json">';
  const page = '<head></head><body>' + seedOpen + '{"events":[{"id":"fictional"}]}</script><main>Game</main></body>';
  const wired = wireInitialEventSeed(page, feed);
  const inline = JSON.parse(wired.split(seedOpen)[1].split('</script>')[0]);
  assert.equal(inline.publicSnapshot, true);
  assert.equal(inline.coverage.complete, false);
  assert.deepEqual(inline.events, feed.events);
  assert.ok(!wired.includes('fictional'));
  assert.ok(wired.endsWith('<main>Game</main></body>'));
  const dangerous = { ...feed, events: [{ ...feed.events[0], title: '</script><script>not executable</script>' }] };
  const safe = wireInitialEventSeed(page, dangerous);
  assert.equal((safe.match(/<\/script>/g) || []).length, 1);
  assert.equal(JSON.parse(safe.split(seedOpen)[1].split('</script>')[0]).events[0].title, dangerous.events[0].title);
  assert.throws(() => wireInitialEventSeed(page + seedOpen + '{}</script>', feed), /exactly once/);
});
