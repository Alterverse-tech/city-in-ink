// Refresh the public attendance signals for every Partiful event in
// data/tech-week-enriched.json. Public pages only, one request at a time, no
// login, no cookies — the same access an anonymous visitor has.
//
//   node scripts/refresh-partiful-counts.mjs [--limit N] [--out FILE]
//
// Partiful ships the numbers it shows in its own `__NEXT_DATA__` payload:
//   approvedGuestCount   on the list (approved) — what the page prints
//   goingGuestCount      "going" for events without approval
//   maybeGuestCount      maybe
//   interestedGuestCount "N Interested" — reminder opt-ins, not a seat
//   waitlistGuestCount   waitlist
// We store them separately and derive `heat` (the total public interest) plus
// `rsvp` (kept as the on-the-list count, for backward compatibility).
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const FILE = new URL('../data/tech-week-enriched.json', import.meta.url);
const OUT = arg('--out') ? new URL('../' + arg('--out'), import.meta.url) : FILE;
const LIMIT = Number(arg('--limit')) || Infinity;
const DELAY = Number(arg('--delay')) || 400;

const feed = JSON.parse(await readFile(FILE, 'utf8'));
const targets = feed.events.filter(e => /^https:\/\/partiful\.com\/e\//.test(e.url || '')).slice(0, LIMIT);
console.log(`${targets.length} Partiful events to refresh`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, changed = 0, failed = 0;
const now = new Date().toISOString();

for (const [i, ev] of targets.entries()) {
  try {
    const response = await fetch(ev.url, {
      headers: { 'User-Agent': 'CityInInkCalendar/1.0 (public event research; contact via chrona.world)' },
      redirect: 'follow', signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!match) throw new Error('no __NEXT_DATA__');
    const page = JSON.parse(match[1])?.props?.pageProps?.event;
    if (!page) throw new Error('no event payload');

    const num = v => (Number.isFinite(v) ? v : 0);
    const before = JSON.stringify([ev.rsvp, ev.interested, ev.heatCount, ev.status, ev.remainingCapacity]);

    // Only publish counts the page itself discloses.
    if (page.showGuestCount === true) {
      const list = num(page.approvedGuestCount) + num(page.goingGuestCount);
      ev.rsvp = list;
      ev.interested = num(page.interestedGuestCount);
      ev.maybe = num(page.maybeGuestCount);
      ev.waitlisted = num(page.waitlistGuestCount);
      ev.heatCount = list + ev.maybe + ev.interested + ev.waitlisted;
      ev.attendanceKind = page.guestAction === 'APPLY' ? 'approved' : 'going';
    }
    if (page.rsvpsEnabled === false) ev.status = 'closed';
    else if (page.rsvpsEnabled === true) {
      if (page.atCapacity === true && page.enableWaitlist === true) ev.status = 'waitlist';
      else if (page.atCapacity === true) ev.status = 'full';
      else if (page.guestAction === 'APPLY') ev.status = 'approval';
      else if (page.guestAction === 'RSVP') ev.status = 'open';
    }
    // Remaining seats: only when the host published a cap.
    const seats = html.match(/\b([\d,]+)\s*\/\s*([\d,]+)\s+spots left\b/i);
    if (seats) { ev.remainingCapacity = Number(seats[1].replaceAll(',', '')); ev.capacity = Number(seats[2].replaceAll(',', '')); }

    ev.countsFetchedAt = now;
    for (const field of ['rsvp', 'interested', 'heatCount', 'status']) {
      if (ev.fieldSources?.[field] || ev[field] != null) {
        ev.fieldSources = ev.fieldSources || {};
        ev.fieldSources[field] = { url: ev.url, method: 'public Partiful event payload; counts the page itself displays', fetchedAt: now };
      }
    }
    ok += 1;
    if (JSON.stringify([ev.rsvp, ev.interested, ev.heatCount, ev.status, ev.remainingCapacity]) !== before) changed += 1;
  } catch (error) {
    failed += 1;
    if (failed <= 5 || failed % 25 === 0) console.error(`  ! ${ev.url}: ${error.message}`);
    if (/429|403|checkpoint/i.test(error.message)) { console.error('  access restriction — stopping early'); break; }
  }
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${targets.length} · ok ${ok} · changed ${changed} · failed ${failed}`);
  await sleep(DELAY);
}

feed.countsRefreshedAt = now;
await writeFile(OUT, JSON.stringify(feed));
console.log(`done: ${ok} refreshed, ${changed} changed, ${failed} failed → ${OUT.pathname}`);
