// Address exchange between the city and Discord.
//
//   POST /addresses            a submission (from the game, or from the bot)
//   GET  /addresses.json       approved addresses only — the game merges these
//   GET  /addresses/pending    what is waiting for a moderator (bot token only)
//   POST /addresses/:id/review { decision: 'approve' | 'reject' }  (bot token only)
//
// Nothing is published until a moderator approves it in Discord. Submissions
// are held in one JSON file so the service can be restarted freely.
//
//   INK_ADDRESS_PORT=8139 INK_ADDRESS_DATA=.cache INK_ADDRESS_TOKEN=<shared secret> \
//   node services/address-service.mjs
//
// Deploy it beside calendar-server.mjs and route
// https://chrona.world/integrations/city-in-ink/addresses.json to it.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.INK_ADDRESS_PORT || 8139);
const FILE = resolve(process.env.INK_ADDRESS_DATA || '.cache', 'addresses.json');
const TOKEN = process.env.INK_ADDRESS_TOKEN || '';
const ORIGINS = (process.env.INK_ADDRESS_ORIGINS || 'https://chrona.world').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 8 * 1024;
const RATE = { windowMs: 60_000, max: 20, hits: new Map() };

if (!TOKEN) console.warn('INK_ADDRESS_TOKEN is unset — moderation endpoints are disabled.');

let store = { submissions: [], updatedAt: null };
try { store = JSON.parse(await readFile(FILE, 'utf8')); } catch { /* first run */ }

let writing = null;
async function persist() {
  store.updatedAt = new Date().toISOString();
  const body = JSON.stringify(store, null, 2);
  writing = (writing || Promise.resolve()).then(async () => {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE + '.tmp', body);
    await rename(FILE + '.tmp', FILE);
  });
  return writing;
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const finite = value => (Number.isFinite(+value) ? +value : null);
const approved = () => store.submissions.filter(s => s.status === 'approved');

// A submission is only useful with an event to attach it to and something to
// place: either coordinates, or an address a geocoder can resolve later.
function normalise(input, meta) {
  const eventId = clean(input.eventId, 80);
  const address = clean(input.address, 160);
  const lat = finite(input.lat), lng = finite(input.lng);
  if (!eventId) return { error: 'eventId is required' };
  if (!address && (lat === null || lng === null)) return { error: 'address or lat/lng is required' };
  if (lat !== null && (lat < 37.6 || lat > 37.86)) return { error: 'latitude is outside San Francisco' };
  if (lng !== null && (lng < -122.55 || lng > -122.33)) return { error: 'longitude is outside San Francisco' };
  return {
    submission: {
      id: randomUUID(), status: 'pending', createdAt: new Date().toISOString(),
      eventId, eventTitle: clean(input.eventTitle, 140), eventUrl: clean(input.eventUrl, 240),
      address, venue: clean(input.venue, 80), lat, lng,
      note: clean(input.note, 240),
      submittedBy: clean(input.submittedBy, 60) || 'anonymous',
      source: meta.source, ...meta.extra,
    },
  };
}

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(JSON.stringify(body));
};

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ORIGINS.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Vary': 'Origin' };
}

function authorised(req) {
  const header = req.headers.authorization || '';
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(TOKEN);
  return !!TOKEN && given.length === want.length && timingSafeEqual(given, want);
}

function rateLimited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const hits = (RATE.hits.get(key) || []).filter(t => now - t < RATE.windowMs);
  hits.push(now);
  RATE.hits.set(key, hits);
  if (RATE.hits.size > 4000) RATE.hits.clear();
  return hits.length > RATE.max;
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (req.method === 'GET' && path === '/addresses.json') {
    return json(res, 200, {
      updatedAt: store.updatedAt,
      addresses: approved().map(({ id, eventId, eventUrl, address, venue, lat, lng, approvedAt, source }) =>
        ({ id, eventId, eventUrl, address, venue, lat, lng, approvedAt, source })),
    }, cors);
  }

  if (req.method === 'POST' && path === '/addresses') {
    if (rateLimited(req)) return json(res, 429, { error: 'slow down' }, cors);
    let input;
    try { input = await readBody(req); } catch (error) { return json(res, 400, { error: error.message }, cors); }
    const fromBot = authorised(req);
    const { error, submission } = normalise(input, {
      source: fromBot ? clean(input.source, 24) || 'discord' : 'city',
      extra: fromBot ? { discordUserId: clean(input.discordUserId, 32), discordMessageUrl: clean(input.discordMessageUrl, 240) } : {},
    });
    if (error) return json(res, 400, { error }, cors);
    // One pending submission per event per source keeps the review queue clean.
    store.submissions = store.submissions.filter(s => !(s.status === 'pending' && s.eventId === submission.eventId && s.source === submission.source));
    store.submissions.push(submission);
    await persist();
    console.log(`[address] pending ${submission.id} · ${submission.eventId} · ${submission.source} · ${submission.address || submission.lat + ',' + submission.lng}`);
    return json(res, 202, { ok: true, id: submission.id, status: 'pending' }, cors);
  }

  if (!authorised(req)) return json(res, 404, { error: 'not found' }, cors);

  if (req.method === 'GET' && path === '/addresses/pending') {
    return json(res, 200, { pending: store.submissions.filter(s => s.status === 'pending') });
  }

  const review = path.match(/^\/addresses\/([\w-]{6,40})\/review$/);
  if (req.method === 'POST' && review) {
    let input;
    try { input = await readBody(req); } catch (error) { return json(res, 400, { error: error.message }); }
    const submission = store.submissions.find(s => s.id === review[1]);
    if (!submission) return json(res, 404, { error: 'unknown submission' });
    if (submission.status !== 'pending') return json(res, 409, { error: 'already ' + submission.status, submission });
    const decision = input.decision === 'approve' ? 'approved' : 'rejected';
    Object.assign(submission, {
      status: decision, reviewedBy: clean(input.reviewedBy, 60), reviewedAt: new Date().toISOString(),
      ...(decision === 'approved' ? { approvedAt: new Date().toISOString() } : {}),
      ...(input.lat != null && input.lng != null ? { lat: finite(input.lat), lng: finite(input.lng) } : {}),
    });
    await persist();
    console.log(`[address] ${decision} ${submission.id} by ${submission.reviewedBy || 'moderator'}`);
    return json(res, 200, { ok: true, submission });
  }

  return json(res, 404, { error: 'not found' }, cors);
});

server.listen(PORT, '127.0.0.1', () => console.log(`address service on 127.0.0.1:${PORT} · ${store.submissions.length} submissions · ${approved().length} approved`));
const stop = () => server.close();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
