// Fly-to fallback for events that are not in the world.
//
// `TW.flyTo(ev)` only works for an event that placeEvents() gave a world
// position — a ship, a wall sign or the host's hoarding. Any other event
// (no address, no district, not enough RSVPs for a ship) has nowhere to fly
// to, so the gull heads for the busiest cluster of placed events instead:
// the building with the most events, ties broken by RSVPs.
//
// The candidates come from the game's own normalized events (`TW.state`),
// never from a raw feed: the card renderer expects Date objects and the
// computed fields, and a raw feed row used to crash it with
// "Cannot read properties of undefined (reading 'toISOString')".

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function placed(ev) {
  return !!(ev && ev.world);
}

function busiestPlaced(events) {
  const buckets = new Map();
  for (const event of events) {
    if (!placed(event)) continue;
    if (String(event.venueKey || '').startsWith('harbor:')) continue;     // the harbour holding pattern is not a destination
    const key = event.venueKey || `${Math.round(toNumber(event.lat) * 1e5)}::${Math.round(toNumber(event.lng) * 1e5)}`;
    const crowd = Number(event.rsvp) || 0;
    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, { event, crowdSum: crowd, count: 1 });
      continue;
    }
    current.count += 1;
    current.crowdSum += crowd;
    if (crowd > (Number(current.event.rsvp) || 0)) current.event = event;
  }
  let best = null;
  for (const item of buckets.values()) {
    if (!best || item.count > best.count || (item.count === best.count && item.crowdSum > best.crowdSum)) best = item;
  }
  return best ? best.event : null;
}

function patchTwApi() {
  const tw = window.TW;
  if (!tw || typeof tw.flyTo !== 'function' || tw.__sfGullClusterRoutePatched) return;
  tw.__sfGullClusterRoutePatched = true;

  const originalFlyTo = tw.flyTo;
  tw.flyTo = function (ev) {
    if (placed(ev)) return originalFlyTo.call(this, ev);
    const target = busiestPlaced((tw.state && tw.state.events) || []);
    if (target) {
      if (typeof tw.toast === 'function' && ev) tw.toast('No venue yet for that one — heading for the busiest block instead.');
      return originalFlyTo.call(this, target);
    }
    if (ev && typeof tw.select === 'function') tw.select(ev);       // nothing placed yet: at least show the card
  };
}

(function boot() {
  const tw = window.TW;
  if (tw && tw.flyTo) {
    patchTwApi();
    return;
  }
  requestAnimationFrame(boot);
})();
