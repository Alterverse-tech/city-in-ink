let lastGood = null;
const coverCache = new Map(), coverQueue = [];
let activeCovers = 0;
const coverOrigins = new Set(['https://partiful.imgix.net','https://partiful-posters.imgix.net','https://cdn.tech-week.com','https://firebasestorage.googleapis.com']);
function coverUrl(source) {
  if(!coverOrigins.has(new URL(source).origin))return Promise.reject(new Error('Unsupported public cover origin'));
  if(coverCache.has(source))return coverCache.get(source);
  const promise=new Promise((resolve,reject)=>coverQueue.push({source,resolve,reject}));
  coverCache.set(source,promise); drainCovers(); return promise;
}
function drainCovers() {
  while(activeCovers<4 && coverQueue.length){
    const job=coverQueue.shift(); activeCovers++;
    (async()=>{
      const response=await fetch(job.source,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok || !response.headers.get('content-type')?.startsWith('image/'))throw new Error('Public cover unavailable');
      const blob=await response.blob();if(blob.size>8*1024*1024)throw new Error('Public cover exceeds size limit');
      return URL.createObjectURL(blob);
    })().then(job.resolve,job.reject).finally(()=>{activeCovers--;drainCovers();});
  }
}

const validFeed = data => data?.fetchedAt && Array.isArray(data.events) && data.events.length;
const eventKey = e => e.url?.match(/^https:\/\/partiful\.com\/e\/([\w-]+)/)?.[1] || e.id;

export function mergePublicFeeds(saved, cache) {
  if (!validFeed(saved)) return validFeed(cache) ? cache : null;
  if (!validFeed(cache)) return saved;
  const [older, newer] = [saved, cache].sort((a,b) => Date.parse(a.fetchedAt)-Date.parse(b.fetchedAt));
  // A partial refresh must not erase events absent from that partial response.
  const map = new Map((newer.coverage?.complete ? [] : older.events).map(e => [eventKey(e), e]));
  for (const event of newer.events) {
    const key = eventKey(event), previous = map.get(key);
    if (!previous) { map.set(key,event); continue; }
    const patch = Object.fromEntries(Object.entries(event).filter(([field,value]) =>
      event.fieldSources?.[field] || (value != null && value !== '' && value !== 'unknown' && (!Array.isArray(value) || value.length))));
    map.set(key, {...previous,...patch,id:previous.id,fieldSources:{...previous.fieldSources,...event.fieldSources}});
  }
  const events = [...map.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  return {...newer,events,publicSnapshot:true,coverage:{...newer.coverage,events:events.length,complete:newer.coverage?.complete===true}};
}

async function readJson(url) {
  const response = await fetch(url, {cache:'no-store',signal:AbortSignal.timeout(6000)});
  if(!response.ok) throw new Error(`Calendar HTTP ${response.status}`);
  return response.json();
}

// A snapshot too large for the host's per-file limit ships as ordered raw text
// parts. Join them back into the one document; an incomplete set is an error,
// never a smaller snapshot.
async function readParts(base) {
  const manifest = await readJson(new URL(`./data/${base}.parts.json`, import.meta.url));
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('Snapshot part manifest is empty');
  const texts = await Promise.all(manifest.parts.map(async name => {
    if (!/^[\w.-]+$/.test(name)) throw new Error('Unexpected snapshot part name');
    const response = await fetch(new URL('./data/' + name, import.meta.url), {cache:'no-store', signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Snapshot part HTTP ${response.status}`);
    return response.text();
  }));
  const data = JSON.parse(texts.join(''));
  if (manifest.events != null && data.events?.length !== manifest.events) throw new Error('Snapshot parts are incomplete');
  return data;
}

async function readSaved() {
  for(const read of [() => readParts('tech-week-enriched'), () => readJson(new URL('./data/tech-week-enriched.json',import.meta.url)), () => readJson(new URL('./data/tech-week-first.json',import.meta.url))]) {
    try { const data=await read(); if(validFeed(data))return data; } catch { /* Try the next form, then the immutable baseline. */ }
  }
  return null;
}

const NEIGHBORHOOD_HINTS = {
  'fidi': { lat: 37.7937, lng: -122.4008 },
  'financial district': { lat: 37.7937, lng: -122.4008 },
  'downtown': { lat: 37.79, lng: -122.4025 },
  'downtown sf': { lat: 37.79, lng: -122.4025 },
  'soma': { lat: 37.7838, lng: -122.4011 },
  'south of market': { lat: 37.7838, lng: -122.4011 },
  'mission': { lat: 37.7596, lng: -122.4148 },
  'mission bay': { lat: 37.7706, lng: -122.3912 },
  'dogpatch': { lat: 37.7590, lng: -122.3919 },
  'nob hill': { lat: 37.7930, lng: -122.4160 },
  'embarcadero': { lat: 37.7951, lng: -122.3935 },
  'jackson square': { lat: 37.7963, lng: -122.3991 },
  'hayes valley': { lat: 37.7767, lng: -122.4292 },
  'civic center': { lat: 37.7786, lng: -122.4156 },
  'golden gate park': { lat: 37.7690, lng: -122.4827 },
  'fi di': { lat: 37.7937, lng: -122.4008 }
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function stripNeighborhoodSuffix(value) {
  return normalizeText(value)
    .replace(/\([^\)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCoordsFromText(value) {
  if (!value) return null;
  const match = String(value).match(/(-?\d{1,3}(?:\.\d+)?),?\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;

  const lat = toNumber(match[1]);
  const lng = toNumber(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, source: 'text' };
}

function getCoordsFromNeighborhood(value) {
  if (!value) return null;

  const direct = NEIGHBORHOOD_HINTS[normalizeText(value)] || NEIGHBORHOOD_HINTS[stripNeighborhoodSuffix(value)];
  if (direct) return { ...direct, source: 'neighborhood' };

  const cleaned = stripNeighborhoodSuffix(value).replace(/\s*-\s*/g, ' ').trim();
  return NEIGHBORHOOD_HINTS[cleaned] ? { ...NEIGHBORHOOD_HINTS[cleaned], source: 'neighborhood' } : null;
}

function inferCoords(event) {
  const lat = toNumber(event?.lat ?? event?.latitude);
  const lng = toNumber(event?.lng ?? event?.lon ?? event?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, source: 'event-field' };
  }

  const fromText = getCoordsFromText(event?.locationText ?? event?.address ?? event?.venue ?? event?.neighborhood);
  if (fromText) return fromText;

  return getCoordsFromNeighborhood(event?.neighborhood ?? event?.venue ?? event?.address) || null;
}

function enrichWithFallbackCoordinates(events) {
  if (!Array.isArray(events)) return [];

  return events.map(event => {
    const source = inferCoords(event);
    if (!source) return event;

    const enriched = {
      ...event,
      lat: source.lat,
      lng: source.lng,
      // A neighbourhood centroid is a hint, not an address. The city layer
      // spreads these across the district and never pins them to a building.
      approxLocation: source.source !== 'event-field',
      __inferredLocation: true,
      __inferredLocationSource: source.source
    };

    if (!enriched.locationText && event.neighborhood) {
      enriched.locationText = event.neighborhood;
    }

    return enriched;
  });
}

function showStatus(data, live) {
  let badge = document.getElementById('tw-sync-status');
  if (!badge) {
    badge = document.createElement('div'); badge.id = 'tw-sync-status';
    badge.setAttribute('role', 'status');
    document.body.append(badge);
  }
  const next = data.nextAttemptAt ? new Date(data.nextAttemptAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  badge.textContent = live
    ? `Public snapshot · ${data.events.length} events · ${data.coverage?.complete ? 'full calendar · partial details' : 'partial calendar'} · updater every 30 min`
    : `Sample events · official sync unavailable${next ? ' · retry ' + next : ''}`;
  badge.dataset.state = live ? (data.status || 'stale') : 'unavailable';
  badge.title = [data.error, data.fetchedAt ? `Snapshot saved: ${data.fetchedAt}. Individual fields retain their own source timestamps.` : 'No official data has been imported yet.'].filter(Boolean).join('\n');
}

// Addresses that a moderator approved in Discord (or in-world claims that were
// reviewed there). The service publishes approved entries only.
const ADDRESS_URL = window.__SF_HOST_READY__
  ? 'https://chrona.world/integrations/city-in-ink/addresses.json'
  : '/addresses.json';
let addressCache = { at: 0, list: [] };
async function readApprovedAddresses() {
  if (Date.now() - addressCache.at < 60000) return addressCache.list;
  try {
    const data = await readJson(ADDRESS_URL);
    addressCache = { at: Date.now(), list: Array.isArray(data?.addresses) ? data.addresses : [] };
  } catch { addressCache = { at: Date.now(), list: addressCache.list }; }
  return addressCache.list;
}
function applyApprovedAddresses(events, addresses) {
  if (!addresses.length) return events;
  const byId = new Map(), byUrl = new Map();
  for (const entry of addresses) {
    if (entry.eventId) byId.set(entry.eventId, entry);
    if (entry.eventUrl) byUrl.set(entry.eventUrl, entry);
  }
  return events.map(event => {
    const entry = byId.get(event.id) || byUrl.get(event.url) || byUrl.get(event.sourceUrl);
    if (!entry) return event;
    const patched = { ...event, addressSource: 'community-approved', approvedAddressAt: entry.approvedAt };
    if (entry.address) patched.address = entry.address;
    if (entry.venue) patched.venue = entry.venue;
    if (Number.isFinite(entry.lat) && Number.isFinite(entry.lng)) {
      // A reviewed address is exact: drop the neighbourhood approximation.
      patched.lat = entry.lat; patched.lng = entry.lng; patched.approxLocation = false;
    }
    return patched;
  });
}

// Send an in-world claim to the moderation queue. Nothing is published until a
// moderator approves it in Discord; the claim stays visible locally meanwhile.
async function submitClaim(claim) {
  const response = await fetch(ADDRESS_URL.replace(/addresses\.json$/, 'addresses'), {
    method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(claim),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Address queue returned ' + response.status);
  return response.json();
}

window.__sfEventFeed = {
  coverUrl,
  submitClaim,
  async read(seed) {
    const [saved,cache] = await Promise.all([
      readSaved(),
      readJson(window.__SF_HOST_READY__ ? 'https://chrona.world/integrations/city-in-ink/events.json' : '/events.json')
        .catch(()=>({status:'unavailable',error:'Calendar updater is unreachable; using saved public data.'})),
    ]);
    const approvedAddresses = await readApprovedAddresses();
    const data = mergePublicFeeds(saved,cache);
    if (data && approvedAddresses.length) data.events = applyApprovedAddresses(data.events, approvedAddresses);
    if(data)lastGood=data;
    const live = lastGood;
    showStatus(live ? {...live,error:cache.error} : cache, !!live);
    if (live) return { list: enrichWithFallbackCoordinates(live.events), citizens: [], official: true,
      source: `Official public sources · ${live.events.length} events · ${live.coverage?.complete ? 'full calendar, partial details' : 'partial snapshot'} · saved ${live.fetchedAt}` };
    return { list: enrichWithFallbackCoordinates(seed.events || []), citizens: seed.citizens || [], official: false,
      source: 'sample programme · official sync pending · refresh every 30 min' };
  },
};
