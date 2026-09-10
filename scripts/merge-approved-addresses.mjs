// Fold moderator-approved venues from the Discord bot's store into the game
// data. This is the hand-carried sync: the bot runs on a laptop, its queue is
// one JSON file, and every so often that file is merged here and the game is
// released. Nothing automatic sits between Discord and the map.
//
//   node scripts/merge-approved-addresses.mjs <path/to/addresses.json>
//
// Only entries with status "approved" are used. What lands in the data is the
// building — coordinates, venue, and the street with its house number and any
// floor/suite stripped — never the exact door. Anything not approved is ignored.
import { readFile, writeFile } from 'node:fs/promises';

const source = process.argv[2];
if (!source) throw new Error('usage: node scripts/merge-approved-addresses.mjs <addresses.json>');
const feedFile = new URL('../data/tech-week-enriched.json', import.meta.url);

const DOOR = /^\s*(?:no\.?\s*)?\d+[a-z]?(?:\s*[-–/]\s*\d+[a-z]?)?\s+/i;
const UNIT = /[,(]?\s*(?:\b(?:suite|ste|apt|apartment|unit|floor|fl|room|rm)\b|#)\s*[\w-]+\)?/gi;
const streetOnly = (address) => String(address || '').replace(UNIT, '').replace(DOOR, '').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
const inSF = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 37.6 && lat < 37.86 && lng > -122.55 && lng < -122.33;

const store = JSON.parse(await readFile(source, 'utf8'));
const approved = (store.submissions || store.addresses || []).filter(s => s.status === 'approved' || store.addresses);
const feed = JSON.parse(await readFile(feedFile, 'utf8'));
const byId = new Map(feed.events.map(e => [e.id, e]));
const byUrl = new Map(feed.events.filter(e => e.url).map(e => [e.url, e]));

let applied = 0, skipped = 0;
const now = new Date().toISOString();
for (const entry of approved) {
  const ev = byId.get(entry.eventId) || byUrl.get(entry.eventUrl);
  if (!ev) { skipped += 1; console.warn(`  ! no event for ${entry.eventUrl || entry.eventId}`); continue; }
  if (!inSF(entry.lat, entry.lng)) { skipped += 1; console.warn(`  ! ${ev.title}: coordinates missing or outside San Francisco; a street alone cannot place a sign`); continue; }
  ev.lat = entry.lat; ev.lng = entry.lng;
  ev.approxLocation = false;
  if (entry.venue) ev.venue = entry.venue;
  const street = streetOnly(entry.street || entry.address);
  if (street) ev.address = street;
  ev.addressSource = 'community-approved';
  ev.approvedAddressAt = entry.approvedAt || now;
  ev.fieldSources = ev.fieldSources || {};
  ev.fieldSources.address = { method: 'shared in the Chrona Discord and approved by a moderator; house number withheld', fetchedAt: entry.approvedAt || now };
  applied += 1;
  console.log(`  ✓ ${ev.title.slice(0, 60)} → ${ev.venue || ''} ${street} (${entry.lat.toFixed(4)}, ${entry.lng.toFixed(4)})`);
}
feed.addressesMergedAt = now;
await writeFile(feedFile, JSON.stringify(feed));
console.log(`merged ${applied} approved venue${applied === 1 ? '' : 's'} into the game data (${skipped} skipped)`);
