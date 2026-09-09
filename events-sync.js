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

async function readSaved() {
  for(const file of ['tech-week-enriched.json','tech-week-first.json']) {
    try { const data=await readJson(new URL('./data/'+file,import.meta.url)); if(validFeed(data))return data; } catch { /* Try the immutable baseline. */ }
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

window.__sfEventFeed = {
  coverUrl,
  async read(seed) {
    const [saved,cache] = await Promise.all([
      readSaved(),
      readJson(window.__SF_HOST_READY__ ? 'https://chrona.world/integrations/city-in-ink/events.json' : '/events.json')
        .catch(()=>({status:'unavailable',error:'Calendar updater is unreachable; using saved public data.'})),
    ]);
    const data = mergePublicFeeds(saved,cache);
    if(data)lastGood=data;
    const live = lastGood;
    showStatus(live ? {...live,error:cache.error} : cache, !!live);
    if (live) return { list: enrichWithFallbackCoordinates(live.events), citizens: [], official: true,
      source: `Official public sources · ${live.events.length} events · ${live.coverage?.complete ? 'full calendar, partial details' : 'partial snapshot'} · saved ${live.fetchedAt}` };
    return { list: enrichWithFallbackCoordinates(seed.events || []), citizens: seed.citizens || [], official: false,
      source: 'sample programme · official sync pending · refresh every 30 min' };
  },
};
