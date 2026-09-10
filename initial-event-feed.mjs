import { readFile, writeFile } from 'node:fs/promises';
import { readFeedText, slimFeed } from './feed-slim.mjs';
import { FEATURED_EVENT } from './tuning-build.mjs';

export const INITIAL_FEATURED_EVENT_ID = `partiful-${FEATURED_EVENT}`;
const featuredUrl = `https://partiful.com/e/${FEATURED_EVENT}`;
const baselineFile = 'tech-week-first.json';

function matchesFeaturedUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://partiful.com' && url.pathname.replace(/\/$/, '') === `/e/${FEATURED_EVENT}`;
  } catch { return false; }
}

function featuredEvent(feed) {
  const events = feed?.events?.filter(event => event.id === INITIAL_FEATURED_EVENT_ID || matchesFeaturedUrl(event.url));
  if (!events || events.length !== 1 || events[0].id !== INITIAL_FEATURED_EVENT_ID || !matchesFeaturedUrl(events[0].url)) {
    throw new Error(`Initial event feed requires exactly one sourced ${INITIAL_FEATURED_EVENT_ID} event with its public Partiful URL`);
  }
  return events[0];
}

// The archived first snapshot contains only Monday morning. Keep those entries,
// but include the real host event from the complete source before the full feed
// arrives. No event details or geographic coordinates are invented here.
export function createInitialEventFeed(full, baseline) {
  if (!Array.isArray(baseline?.events)) throw new Error('Initial event baseline is missing its saved events');
  const featured = featuredEvent(full);
  const events = [featured, ...baseline.events.filter(event =>
    event.id !== featured.id && !matchesFeaturedUrl(event.url) &&
    !(featured.calendarId && (event.id === featured.calendarId || event.calendarId === featured.calendarId)))];
  const sorted = [...events].filter(event => Number.isFinite(Date.parse(event.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return slimFeed({ ...baseline, fetchedAt: full.fetchedAt || baseline.fetchedAt,
    source: full.source || baseline.source, sourceLabel: 'Public Tech Week startup snapshot',
    publicSnapshot: true, initialSnapshot: true,
    sourceSnapshots: { baselineFetchedAt: baseline.fetchedAt, fullFetchedAt: full.fetchedAt },
    coverage: { complete: false, timeZone: 'America/Los_Angeles', events: events.length,
      firstStart: sorted[0]?.start, lastStart: sorted.at(-1)?.start,
      selection: 'Saved first snapshot plus featured host event' },
    citizens: [], events });
}

export async function readInitialEventFeed(dataDir) {
  const [{ text }, baselineText] = await Promise.all([
    readFeedText(dataDir, 'tech-week-enriched'),
    readFile(new URL(baselineFile, dataDir), 'utf8'),
  ]);
  return createInitialEventFeed(JSON.parse(text), JSON.parse(baselineText));
}

// Call only on a copied build data directory, after copying data/ and before
// generating preload.json so its byte count and hash reflect this exact file.
export async function writeInitialEventFeed(outputDataDir, feed) {
  featuredEvent(feed);
  const bytes = JSON.stringify(feed);
  await writeFile(new URL(baselineFile, outputDataDir), bytes);
  return { events: feed.events.length, bytes: Buffer.byteLength(bytes) };
}

// The tiny inline fallback keeps the real featured card available even if both
// saved-feed requests fail. It replaces the old fictional sample programme.
export function wireInitialEventSeed(html, feed) {
  const event = featuredEvent(feed);
  const seed = { publicSnapshot: true, initialSnapshot: true, fetchedAt: feed.fetchedAt,
    source: feed.source || featuredUrl, coverage: { complete: false, events: 1 }, citizens: [], events: [event] };
  const open = '<script id="tw-events-seed" type="application/json">';
  if (html.split(open).length !== 2) throw new Error('Initial event seed script must occur exactly once');
  const start = html.indexOf(open) + open.length, end = html.indexOf('</script>', start);
  if (end < start) throw new Error('Initial event seed script is not closed');
  const json = JSON.stringify(seed).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return html.slice(0, start) + json + html.slice(end);
}
