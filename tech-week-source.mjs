import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
export const CALENDAR_URL = 'https://www.tech-week.com/calendar/sf';

export function parseCalendarResponse(raw, now = Date.now()) {
  let rest = raw, status = 0, headers = {};
  // curl may include the proxy CONNECT headers before the origin response.
  while (/^HTTP\//.test(rest)) {
    const split = rest.match(/\r?\n\r?\n/);
    if (!split) throw new Error('Incomplete calendar response');
    const head = rest.slice(0, split.index).split(/\r?\n/);
    status = Number(head.shift().match(/^HTTP\/\S+\s+(\d+)/)?.[1]);
    headers = {};
    for (const line of head) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
    }
    rest = rest.slice(split.index + split[0].length);
  }
  if (status !== 200 || headers['x-vercel-mitigated'] === 'challenge' || /<title>Vercel Security Checkpoint/i.test(rest)) {
    const error = new Error(headers['x-vercel-mitigated'] === 'challenge' || /Vercel Security Checkpoint/.test(rest)
      ? 'Tech Week requires browser verification (HTTP ' + status + '); no event data was imported.'
      : `Tech Week returned HTTP ${status}; the previous cache was retained.`);
    const retry = headers['retry-after'];
    if (retry) error.retryAt = /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
    throw error;
  }
  return rest;
}

// Fail closed: accept public structured Event records, never execute the site's
// scripts or assume a partially rendered list is the complete weekly schedule.
// This adapter still needs verification against an unblocked calendar response.
export function parseCalendar(html) {
  const records = [];
  function walk(value) {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().some(t => t === 'Event' || t === 'BusinessEvent' || t === 'SocialEvent')) records.push(value);
    if (value['@graph']) walk(value['@graph']);
    if (value.itemListElement) walk(value.itemListElement);
    if (value.item) walk(value.item);
    if (value.subEvent) walk(value.subEvent);
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1])); } catch { /* Other JSON-LD blocks may be unrelated. */ }
  }
  const events = records.map(event => {
    const url = new URL(event.url || event['@id'] || '', CALENDAR_URL);
    if (url.protocol !== 'https:' || url.href === CALENDAR_URL || !event.name || !event.startDate) return null;
    const organizers = [event.organizer || []].flat().map(p => typeof p === 'string' ? p : p?.name).filter(Boolean);
    const start = event.startDate;
    if (!Number.isFinite(Date.parse(start)) || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(start)) return null;
    // An SF calendar item does not imply a public street address. Do not infer
    // venue/coordinates or guest counts from the title, neighborhood or markup.
    return { id: 'techweek-' + createHash('sha256').update(url.href).digest('hex').slice(0, 20),
      title: String(event.name).slice(0, 500), host: organizers[0] || 'Host not published', cohosts: organizers.slice(1),
      start, ...(event.endDate && Number.isFinite(Date.parse(event.endDate)) ? { end: event.endDate } : {}),
      url: url.href, status: 'unknown', rsvp: null, capacity: null, source: 'tech-week.com',
      description: typeof event.description === 'string' ? event.description.slice(0, 10000) : '',
    };
  }).filter(Boolean);
  if (!events.length) throw new Error('No verified structured events found. The calendar parser needs an accessible source response; cache retained.');
  return { events: [...new Map(events.map(e => [e.id, e])).values()] };
}

export async function fetchTechWeekEvents() {
  // Uses the existing network/proxy configuration. No browser cookies, stealth
  // headers, challenge solving, or route rotation are used.
  const { stdout } = await exec('curl', ['--silent', '--show-error', '--include',
    '--max-time', '20', '--max-filesize', '8000000', '--proto', '=https', CALENDAR_URL],
  { encoding: 'utf8', maxBuffer: 8500000, timeout: 25000 });
  return parseCalendar(parseCalendarResponse(stdout));
}
