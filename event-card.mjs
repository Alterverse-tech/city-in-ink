// One owner for automatic event selection. Distances are in world metres;
// camera movement and feed object replacement do not count as event changes.
export const EVENT_CARD_TIMING = Object.freeze({
  enter: 160, leave: 320, advantage: 25, settle: 1000,
  read: 6000, featuredRead: 8000, manualRead: 12000, returnEvery: 5,
});

export function createEventCardPolicy(options = {}) {
  const cfg = { ...EVENT_CARD_TIMING, ...options };
  let selectedId = null, switches = 0, holdUntil = 0;
  let candidateId = null, candidateSince = 0, awaySince = null, returnAt = Infinity;
  return {
    selected({ id, featured, reason, now }) {
      const changed = id !== selectedId;
      selectedId = id;
      if (featured) { switches = 0; returnAt = Infinity; }
      if (changed && reason === 'nearby' && !featured) {
        switches++;
        if (switches >= cfg.returnEvery) returnAt = now + cfg.read;
      }
      if (changed || reason === 'manual') {
        holdUntil = now + (reason === 'manual' ? cfg.manualRead : featured ? cfg.featuredRead : cfg.read);
      }
    },
    next({ now, featuredId, candidates, blocked = false }) {
      if (!selectedId) return featuredId ? { id: featuredId, reason: 'default' } : null;
      let nearest = null, currentDistance = Infinity;
      for (const item of candidates) {
        if (!Number.isFinite(item.distance)) continue;
        if (!nearest || item.distance < nearest.distance) nearest = item;
        if (item.id === selectedId) currentDistance = Math.min(currentDistance, item.distance);
      }
      const nextId = nearest && nearest.distance <= cfg.enter ? nearest.id : null;
      if (nextId !== candidateId) { candidateId = nextId; candidateSince = now; }
      const away = !nearest || nearest.distance > cfg.leave;
      if (away) { if (awaySince === null) awaySince = now; }
      else awaySince = null;
      if (blocked || now < holdUntil) return null;
      if (featuredId && selectedId !== featuredId &&
          (now >= returnAt || (awaySince !== null && now - awaySince >= cfg.settle))) {
        return { id: featuredId, reason: now >= returnAt ? 'fifth-return' : 'away' };
      }
      if (!nearest || !nextId || nextId === selectedId || now - candidateSince < cfg.settle) return null;
      // Keep the current card at shared venues until a different poster is
      // clearly closer. This also prevents two adjacent ships from flickering.
      const advantage = Math.min(cfg.advantage, currentDistance * 0.25);
      if (currentDistance <= cfg.enter && currentDistance - nearest.distance < advantage) return null;
      return { id: nextId, reason: 'nearby' };
    },
  };
}

export function eventCardCandidates(events, position, signs) {
  if (!position) return [];
  const result = [];
  for (const ev of events) {
    // Actual poster/airship anchors include altitude. Ground-level event
    // coordinates would select a poster while the player flies far above it.
    const ship = ev.hasVehicle && ev.ship?.visible !== false ? ev.ship?.position : null;
    const poster = signs?.anchorPoint?.(ev);
    let distance = Infinity;
    for (const point of [ship, poster]) {
      if (!point) continue;
      const d = Math.hypot(position.x - point.x, position.y - point.y, position.z - point.z);
      if (d < distance) distance = d;
    }
    if (Number.isFinite(distance)) result.push({ id: ev.id, distance });
  }
  return result;
}

export function installEventCards(TW, city, env = globalThis) {
  const policy = createEventCardPolicy();
  const clock = () => env.performance.now();
  const featured = () => TW.state.events.find(ev => ev.featured);
  const resolve = ev => (ev && TW.state.events.find(item => item.id === ev.id)) || featured() || TW.state.events[0] || null;
  const api = {
    resolve,
    selected(ev, reason = 'manual') {
      if (ev) policy.selected({ id: ev.id, featured: !!ev.featured, reason, now: clock() });
    },
    restore() {
      const current = resolve(TW.state.selected);
      if (current !== TW.state.selected) TW.select(current, { cardSource: 'restore' });
      else if (current) TW.renderCard(current);
    },
    tick() {
      if (!TW.state.ready || env.document.hidden) return;
      if (!TW.state.selected) api.restore();
      const card = env.document.querySelector('#tw-card');
      const modal = env.document.querySelector('#tw-modal');
      const blocked = (modal && !modal.hidden) || card?.matches(':hover') ||
        card?.contains(env.document.activeElement) || TW.nav?.phase === 'travel';
      const decision = policy.next({ now: clock(), featuredId: featured()?.id,
        candidates: eventCardCandidates(TW.state.events, city.flightCharacter?.position, env.__twSigns), blocked });
      if (!decision) return;
      const ev = TW.state.events.find(item => item.id === decision.id);
      if (ev) TW.select(ev, { cardSource: decision.reason });
    },
  };
  const timer = env.setInterval(() => api.tick(), 250);
  api.dispose = () => env.clearInterval(timer);
  return api;
}

if (typeof window !== 'undefined') window.__sfInstallEventCards = installEventCards;
