const FEED_URL = window.__SF_HOST_READY__
  ? 'https://chrona.world/integrations/city-in-ink/events.json'
  : '/events.json';
const BACKUP_FEED_URL = './data/tech-week-first.json';
const FEED_CACHE_TTL = 1000 * 60 * 5;

let clusterFallback = null;
let clusterFallbackAt = 0;
let pendingClusterPromise = null;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function hasCoordinates(ev) {
  if (!ev) return false;
  return Number.isFinite(toNumber(ev.lat)) && Number.isFinite(toNumber(ev.lng));
}

function buildClusterFallback(events) {
  const buckets = new Map();
  for (const event of events) {
    if (!hasCoordinates(event)) continue;

    const key = `${event.venue || event.address || event.neighborhood || 'venue'}::${Math.round(toNumber(event.lat) * 1e5)}::${Math.round(toNumber(event.lng) * 1e5)}`;
    const current = buckets.get(key);
    const crowd = Number(event.rsvp) || 0;
    if (!current) {
      buckets.set(key, { event, crowdSum: crowd, count: 1 });
      continue;
    }

    current.count += 1;
    current.crowdSum += crowd;
    if (crowd > (Number(current.event.rsvp) || 0)) {
      current.event = event;
    }
  }

  let best = null;
  for (const item of buckets.values()) {
    if (!best || item.count > best.count || (item.count === best.count && item.crowdSum > best.crowdSum)) {
      best = item;
    }
  }
  return best?.event ?? null;
}

function withTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('Signal timed out', 'TimeoutError')), ms);
  return controller.signal;
}

async function readLiveFeed() {
  const response = await fetch(FEED_URL, { cache: 'no-store', signal: withTimeoutSignal(4500) });
  if (!response.ok) throw new Error(`events feed HTTP ${response.status}`);
  return response.json();
}

async function readSeedFeed() {
  const response = await fetch(BACKUP_FEED_URL, { cache: 'no-store', signal: withTimeoutSignal(4500) });
  if (!response.ok) throw new Error(`seed events feed HTTP ${response.status}`);
  return response.json();
}

async function refreshClusterFallback() {
  const now = Date.now();
  if (clusterFallback && now - clusterFallbackAt < FEED_CACHE_TTL) return clusterFallback;
  if (pendingClusterPromise) return pendingClusterPromise;

  pendingClusterPromise = (async () => {
    try {
      const raw = await readLiveFeed();
      if (raw && Array.isArray(raw.events)) {
        clusterFallback = buildClusterFallback(raw.events);
      }
    } catch (error) {
      try {
        const backup = await readSeedFeed();
        if (backup && Array.isArray(backup.events)) {
          clusterFallback = buildClusterFallback(backup.events);
        }
      } catch {
        // keep previous best fallback when both endpoints fail
      }
    }
    pendingClusterPromise = null;
    clusterFallbackAt = Date.now();
    return clusterFallback;
  })();

  return pendingClusterPromise;
}

function needsClusterFallback(ev) {
  return !ev || ev.claimed === false || !hasCoordinates(ev);
}

function patchTwApi() {
  const tw = window.TW;
  if (!tw || typeof tw.flyTo !== 'function' || tw.__sfGullClusterRoutePatched) return;
  tw.__sfGullClusterRoutePatched = true;

  const originalFlyTo = tw.flyTo;
  tw.flyTo = function (ev) {
    if (!needsClusterFallback(ev)) {
      return originalFlyTo.call(this, ev);
    }

    if (clusterFallback && hasCoordinates(clusterFallback)) {
      return originalFlyTo.call(this, clusterFallback);
    }

    void refreshClusterFallback().then((target) => {
      if (hasCoordinates(target)) {
        originalFlyTo.call(this, target);
      }
    });
  };
}

(function boot() {
  const tw = window.TW;
  if (tw && tw.flyTo) {
    patchTwApi();
    void refreshClusterFallback();
    return;
  }
  requestAnimationFrame(boot);
})();
