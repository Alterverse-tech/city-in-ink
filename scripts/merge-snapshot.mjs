// Merge the published data-report snapshot (the richer crawl: detail pages,
// venues, geocoded addresses) into data/tech-week-enriched.json, keeping the
// live attendance counts that refresh-partiful-counts.mjs just collected.
//
//   node scripts/merge-snapshot.mjs <report-snapshot.json>
//
// The report payload is a projection, so only fields it actually carries are
// copied; everything else in the game feed is left untouched. Coordinates are
// the point of the exercise: an event with lat/lng lands on its building
// instead of the harbor.
import { readFile, writeFile } from 'node:fs/promises';

const source = process.argv[2];
if (!source) throw new Error('usage: node scripts/merge-snapshot.mjs <report-snapshot.json>');
const feedFile = new URL('../data/tech-week-enriched.json', import.meta.url);

const feed = JSON.parse(await readFile(feedFile, 'utf8'));
const rows = JSON.parse(await readFile(source, 'utf8'));
const byId = new Map(feed.events.map(e => [e.id, e]));
const byUrl = new Map(feed.events.filter(e => e.url).map(e => [e.url, e]));

// Counts we crawled live win over the report's older numbers.
const LIVE = new Set(['rsvp', 'interested', 'maybe', 'waitlisted', 'heatCount', 'status', 'capacity', 'remainingCapacity', 'attendanceKind']);
const COPY = ['title', 'host', 'cohosts', 'speakers', 'start', 'end', 'neighborhood', 'venue', 'address', 'lat', 'lng',
  'tags', 'description', 'image', 'url', 'sourceUrl', 'category', 'capacity', 'remainingCapacity', 'rsvp', 'status'];

let matched = 0, placed = 0, added = 0, fields = 0;
for (const row of rows) {
  const ev = byId.get(row.id) || byUrl.get(row.url);
  if (!ev) {
    if (row.id && row.start) { feed.events.push({ ...row, source: 'tech-week-public' }); added += 1; }
    continue;
  }
  matched += 1;
  const fresh = ev.countsFetchedAt;
  for (const key of COPY) {
    const value = row[key];
    if (value == null || (Array.isArray(value) && !value.length) || value === '') continue;
    if (fresh && LIVE.has(key)) continue;          // do not overwrite a live count with a stale one
    if (JSON.stringify(ev[key]) === JSON.stringify(value)) continue;
    ev[key] = value; fields += 1;
  }
  if (ev.lat != null && ev.lng != null) placed += 1;
}

feed.mergedAt = new Date().toISOString();
feed.coverage = { ...(feed.coverage || {}), events: feed.events.length, geocoded: feed.events.filter(e => e.lat != null && e.lng != null).length };
await writeFile(feedFile, JSON.stringify(feed));
console.log(`merged ${matched} events (${added} new, ${fields} fields updated); ${placed} now have coordinates`);
