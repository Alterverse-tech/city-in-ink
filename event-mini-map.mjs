const FEED_URL = 'https://chrona.world/integrations/city-in-ink/events.json';
const BACKUP_FEED_URL = './data/tech-week-first.json';
const UPDATE_INTERVAL_MS = 15 * 60 * 1000;
const PLAYER_TICK_MS = 200;

let events = [];
let mounted = false;
let lastSummary = {
  mapped: 0,
  fallback: 0,
  total: 0
};

const NEIGHBORHOOD_HINTS = {
  'fidi': { lat: 37.7937, lng: -122.4008, label: 'Financial District' },
  'financial district': { lat: 37.7937, lng: -122.4008, label: 'Financial District' },
  'downtown': { lat: 37.79, lng: -122.4025, label: 'Downtown' },
  'downtown sf': { lat: 37.79, lng: -122.4025, label: 'Downtown' },
  'soma': { lat: 37.7838, lng: -122.4011, label: 'South of Market' },
  'south of market': { lat: 37.7838, lng: -122.4011, label: 'South of Market' },
  'mission': { lat: 37.7596, lng: -122.4148, label: 'Mission' },
  'mission bay': { lat: 37.7706, lng: -122.3912, label: 'Mission Bay' },
  'dogpatch': { lat: 37.7590, lng: -122.3919, label: 'Dogpatch' },
  'nob hill': { lat: 37.7930, lng: -122.4160, label: 'Nob Hill' },
  'embarcadero': { lat: 37.7951, lng: -122.3935, label: 'Embarcadero' },
  'jackson square': { lat: 37.7963, lng: -122.3991, label: 'Jackson Square' },
  'hayes valley': { lat: 37.7767, lng: -122.4292, label: 'Hayes Valley' },
  'civic center': { lat: 37.7786, lng: -122.4156, label: 'Civic Center' },
  'golden gate park': { lat: 37.7690, lng: -122.4827, label: 'Golden Gate Park' },
  'fi di': { lat: 37.7937, lng: -122.4008, label: 'Financial District' }
};

const CITY_GULL_BOUNDS = {
  minX: -260,
  maxX: 260,
  minZ: -260,
  maxZ: 260
};

const CITY_MARK_BOUNDS = {
  minLat: 37.70,
  maxLat: 37.83,
  minLng: -122.54,
  maxLng: -122.34
};

let playerTickId = 0;
let playerSummary = {
  source: 'unavailable',
  bearing: 0,
  lat: null,
  lng: null
};

function makeTimeoutController(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('Signal timed out', 'TimeoutError')), ms);
  return controller.signal;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function getCoordsFromNeighborhood(value) {
  if (!value) return null;

  const direct = NEIGHBORHOOD_HINTS[normalizeText(value)] || NEIGHBORHOOD_HINTS[stripNeighborhoodSuffix(value)];
  if (direct) return { ...direct, source: 'neighborhood' };

  const cleaned = stripNeighborhoodSuffix(value).replace(/\s*-\s*/g, ' ').trim();
  return NEIGHBORHOOD_HINTS[cleaned] ? { ...NEIGHBORHOOD_HINTS[cleaned], source: 'neighborhood' } : null;
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

function getCoords(event) {
  const lat = toNumber(event.lat ?? event.latitude ?? event?.location?.lat ?? event?.location?.latitude);
  const lng = toNumber(event.lng ?? event.lon ?? event.longitude ?? event?.location?.lng ?? event?.location?.lon ?? event?.location?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, source: 'event-field' };
  }

  const parsed = getCoordsFromText(event?.locationText ?? event.address ?? event.venue ?? event.neighborhood);
  if (parsed) return parsed;

  return getCoordsFromNeighborhood(event.neighborhood ?? event.venue ?? event.address) || null;
}

function project(lat, lng) {
  const x = ((lng - CITY_MARK_BOUNDS.minLng) / (CITY_MARK_BOUNDS.maxLng - CITY_MARK_BOUNDS.minLng)) * 100;
  const y = ((CITY_MARK_BOUNDS.maxLat - lat) / (CITY_MARK_BOUNDS.maxLat - CITY_MARK_BOUNDS.minLat)) * 100;
  return {
    x: clamp(x, 0, 100),
    y: clamp(y, 0, 100)
  };
}

function projectFromCityCoords(x, z, bounds = CITY_GULL_BOUNDS) {
  const px = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100;
  const pz = ((bounds.maxZ - z) / (bounds.maxZ - bounds.minZ)) * 100;
  return {
    x: clamp(px, 0, 100),
    y: clamp(pz, 0, 100)
  };
}

function scoreEvent(event) {
  const claimed = event.claimed === true;
  const rsvp = Number(event.rsvp) || 0;
  return { claimed, rsvp };
}

function toMarkerGroups(list) {
  const buckets = new Map();
  let mapped = 0;
  let fallback = 0;
  let total = 0;

  for (const e of list) {
    total += 1;
    const coords = getCoords(e);
    if (!coords) continue;

    mapped += 1;
    if (coords.source !== 'event-field') fallback += 1;

    const slot = `${Math.round(coords.lat * 200) / 200},${Math.round(coords.lng * 200) / 200}`;
    const current = buckets.get(slot);
    const s = scoreEvent(e);
    const label = e.venue || e.address || e.title || 'Event';

    if (!current) {
      buckets.set(slot, {
        lat: coords.lat,
        lng: coords.lng,
        count: 1,
        claimedCount: s.claimed ? 1 : 0,
        label,
        sample: e,
        maxRsvp: s.rsvp,
        maxTitle: e.title || '',
        inferred: coords.source !== 'event-field',
        source: coords.source,
        title: e.title || label
      });
      continue;
    }

    current.count += 1;
    if (s.claimed) current.claimedCount += 1;
    if (s.rsvp > current.maxRsvp) {
      current.maxRsvp = s.rsvp;
      current.maxTitle = e.title || '';
      current.label = label;
      current.sample = e;
      current.title = e.title || current.title;
      if (coords.source !== 'event-field') {
        current.inferred = true;
        current.source = coords.source;
      }
    }
  }

  const groups = [...buckets.values()].map((item) => ({
    ...item,
    pct: project(item.lat, item.lng),
    rsvp: item.maxRsvp
  })).sort((a, b) => b.count - a.count);

  lastSummary = { mapped, fallback, total };
  return groups;
}

function normalizePose(v) {
  if (!v) return null;

  const x = toNumber(v.x);
  const y = toNumber(v.lng);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, source: v.source || 'direct' } : null;
}

function getCityBounds(city) {
  const options = [
    city,
    city?.terrain?.bounds,
    city?.terrain?.extent,
    city?.flightArea,
    city?.flightBounds,
    city?.bounds,
    city?.worldBounds,
    city?.cityBounds,
  ];

  for (const candidate of options) {
    if (!candidate || typeof candidate !== 'object') continue;
    const minX = toNumber(candidate.minX ?? candidate.xMin ?? candidate.left ?? candidate.minLng);
    const maxX = toNumber(candidate.maxX ?? candidate.xMax ?? candidate.right ?? candidate.maxLng);
    const minZ = toNumber(candidate.minZ ?? candidate.zMin ?? candidate.bottom ?? candidate.minLat);
    const maxZ = toNumber(candidate.maxZ ?? candidate.zMax ?? candidate.top ?? candidate.maxLat);

    if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
      if (maxX > minX && maxZ > minZ) return { minX, maxX, minZ, maxZ };
    }
  }

  return CITY_GULL_BOUNDS;
}

function extractHeading(pose = {}) {
  const direct = [pose.heading, pose.yaw, pose.direction, pose.rotation, pose.rotationY, pose.rotation?.y];
  for (const candidate of direct) {
    const value = toNumber(candidate);
    if (Number.isFinite(value)) return value;
  }

  return null;
}

function radiansToDegrees(value) {
  return ((value * 180) / Math.PI + 360) % 360;
}

function readGullPose() {
  const city = window.__sfCity;
  if (!city) return null;

  const directPose = city.gullPose || city.pose || city?.state?.user?.pose;
  if (directPose) {
    const lat = toNumber(directPose.lat ?? directPose.latitude);
    const lng = toNumber(directPose.lng ?? directPose.lon ?? directPose.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const heading = extractHeading(directPose);
      return {
        projected: project(lat, lng),
        lat,
        lng,
        headingDeg: heading == null ? 0 : radiansToDegrees(heading),
        source: 'gullPose'
      };
    }
  }

  const fc = city.flightCharacter;
  if (!fc) return null;

  const x = toNumber(fc.position?.x);
  const z = toNumber(fc.position?.z);
  const yaw = extractHeading(fc.rotation || fc) ?? extractHeading(city) ?? null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

  const bounds = getCityBounds(city);
  const projected = projectFromCityCoords(x, z, bounds);

  return {
    projected,
    lat: null,
    lng: null,
    headingDeg: yaw == null ? 0 : radiansToDegrees(yaw),
    source: 'flightCharacter'
  };
}

function applyMapStyles() {
  if (document.getElementById('tw-mini-map-style')) return;

  const style = document.createElement('style');
  style.id = 'tw-mini-map-style';
  style.textContent = `
    #tw-mini-map {
      position: fixed;
      right: 12px;
      bottom: 12px;
      width: 210px;
      z-index: 70;
      color: #f1f6ff;
      border-radius: 12px;
      padding: 6px;
      background: linear-gradient(160deg, rgba(7, 10, 17, 0.88), rgba(16, 24, 35, 0.82));
      border: 1px solid rgba(150, 160, 175, 0.45);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(4px);
      font: 11px/1.2 system-ui, -apple-system, Segoe UI, Arial, sans-serif;
      pointer-events: none;
      transition: opacity .2s ease;
    }

    #tw-mini-map .tw-mini-title {
      margin: 0 0 6px 2px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .02em;
      opacity: 0.95;
      text-transform: uppercase;
      color: #e6ecff;
    }

    #tw-mini-map .tw-mini-map-viewport {
      position: relative;
      width: 172px;
      height: 172px;
      margin: 0 auto;
      border-radius: 50%;
      overflow: hidden;
      border: 1px solid rgba(150, 175, 195, 0.45);
      background:
        radial-gradient(circle at 35% 35%, rgba(22, 44, 64, 0.55) 0 34%, rgba(15, 22, 32, 0.82) 35%),
        radial-gradient(circle at 70% 70%, rgba(18, 62, 78, 0.38) 0 20%, transparent 20.2%),
        radial-gradient(circle at 62% 34%, rgba(25, 46, 34, 0.55) 0 17%, transparent 17.2%),
        repeating-radial-gradient(circle, transparent 0 24px, rgba(89, 119, 153, 0.25) 24px 25px, transparent 25px 43px),
        repeating-linear-gradient(0deg, rgba(120, 150, 185, 0.22) 0 1px, transparent 1px 14px),
        linear-gradient(25deg, rgba(15, 24, 44, 0.35), rgba(9, 18, 32, 0.6));
    }

    #tw-mini-map .tw-mini-terrain-contour {
      position: absolute;
      inset: 0;
      pointer-events: none;
      border-radius: 50%;
      opacity: 0.9;
      overflow: hidden;
      z-index: 1;
    }

    #tw-mini-map .tw-mini-terrain-contour svg {
      width: 100%;
      height: 100%;
      display: block;
      color: rgba(120, 184, 255, 0.6);
    }

    #tw-mini-map .tw-mini-terrain-contour .outline {
      fill: rgba(26, 38, 52, 0.96);
      stroke: rgba(149, 189, 224, 0.45);
      stroke-width: 1.2;
    }

    #tw-mini-map .tw-mini-terrain-contour .contour {
      fill: none;
      stroke: rgba(130, 170, 205, 0.54);
      stroke-width: 1;
      stroke-dasharray: 2 3;
    }

    #tw-mini-map .tw-mini-grid {
      position: absolute;
      inset: 6px;
      pointer-events: none;
      z-index: 2;
    }

    #tw-mini-map .tw-mini-grid::before {
      content: '';
      position: absolute;
      inset: -6px;
      border-radius: 50%;
      border: 1px dashed rgba(183, 201, 224, 0.22);
      z-index: 1;
      pointer-events: none;
    }

    #tw-mini-map .tw-mini-marker {
      position: absolute;
      width: 10px;
      height: 10px;
      margin: -5px 0 0 -5px;
      border-radius: 999px;
      background: #e8f6ff;
      border: 1px solid rgba(255, 255, 255, 0.9);
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.2), 0 0 7px rgba(120, 200, 255, 0.75);
      font-size: 9px;
      color: #0f1e34;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      transition: transform .2s ease;
      z-index: 3;
    }

    #tw-mini-map .tw-mini-marker.claimed {
      background: #5bd18a;
    }

    #tw-mini-map .tw-mini-marker.fallback {
      background: #f7ce72;
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.2), 0 0 7px rgba(247, 206, 114, 0.75);
    }

    #tw-mini-map .tw-mini-marker.many {
      width: 12px;
      height: 12px;
      margin: -6px 0 0 -6px;
    }

    #tw-mini-map .tw-mini-marker span {
      font-size: 8px;
      font-weight: 700;
      margin-left: 1px;
      margin-top: -1px;
      pointer-events: none;
    }

    #tw-mini-map .tw-mini-player {
      position: absolute;
      width: 12px;
      height: 12px;
      margin: -6px 0 0 -6px;
      border-radius: 50%;
      transform: translateZ(0) rotate(0deg);
      z-index: 4;
      pointer-events: none;
      transition: top .08s linear, left .08s linear;
    }

    #tw-mini-map .tw-mini-player::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: 10px;
      height: 10px;
      margin: -5px 0 0 -5px;
      border-radius: 50%;
      border: 2px solid #f6fdff;
      background: linear-gradient(180deg, #fff 0%, #d2ecff 100%);
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25), 0 0 10px rgba(190, 240, 255, 0.8);
    }

    #tw-mini-map .tw-mini-player::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -95%) rotate(var(--heading, 0deg)) translateY(-1px);
      transform-origin: 50% 125%;
      width: 6px;
      height: 7px;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-bottom: 7px solid #fff;
      filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.75));
    }

    #tw-mini-map .tw-mini-caption {
      margin-top: 6px;
      font-size: 10px;
      color: rgba(229, 236, 255, 0.72);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-height: 14px;
      padding: 0 2px;
    }

    #tw-mini-map .tw-mini-caption.warn {
      color: #ffe39d;
    }
  `;
  document.head.appendChild(style);
}

function placePlayerMarker(canvas) {
  let player = canvas.querySelector('.tw-mini-player');
  if (!player) {
    player = document.createElement('span');
    player.className = 'tw-mini-player';
    canvas.appendChild(player);
  }

  const pose = readGullPose();
  if (!pose || !pose.projected) {
    player.hidden = true;
    playerSummary = { source: 'unavailable', bearing: 0, lat: null, lng: null };
    return;
  }

  player.hidden = false;
  player.style.left = `${pose.projected.x}%`;
  player.style.top = `${pose.projected.y}%`;
  player.style.setProperty('--heading', `${pose.headingDeg || 0}deg`);
  playerSummary = {
    source: pose.source,
    bearing: pose.headingDeg || 0,
    lat: Number.isFinite(pose.lat) ? pose.lat : null,
    lng: Number.isFinite(pose.lng) ? pose.lng : null
  };
}

function placeMarkers() {
  const host = document.getElementById('tw-mini-map');
  if (!host) return;

  const canvas = host.querySelector('.tw-mini-grid');
  const caption = host.querySelector('.tw-mini-caption');
  if (!canvas || !caption) return;

  const groups = toMarkerGroups(events);
  canvas.innerHTML = '';

  if (!groups.length) {
    caption.className = 'tw-mini-caption warn';
    caption.textContent = 'No event location available yet';
    placePlayerMarker(canvas);
    return;
  }

  for (const g of groups) {
    const marker = document.createElement('span');
    marker.className = `tw-mini-marker${g.claimedCount > 0 ? ' claimed' : ''}${g.inferred ? ' fallback' : ''}${g.count > 2 ? ' many' : ''}`;
    marker.style.left = `${g.pct.x}%`;
    marker.style.top = `${g.pct.y}%`;

    const text = g.count > 1 ? g.count : '';
    if (text) {
      const s = document.createElement('span');
      s.textContent = text;
      marker.appendChild(s);
    }

    let suffix = '';
    if (g.inferred) {
      suffix = g.source === 'neighborhood' ? ' · neighborhood approx' : ' · approximate';
    }

    marker.title = `${g.label} · ${g.count} event${g.count === 1 ? '' : 's'}${g.claimedCount ? ` (${g.claimedCount} confirmed)` : ''}${suffix}`;
    canvas.appendChild(marker);
  }

  placePlayerMarker(canvas);

  const fallbackText = lastSummary.fallback > 0 ? ` (${lastSummary.fallback} from neighborhood estimate)` : '';
  const exactText = lastSummary.mapped - lastSummary.fallback;
  const exactPhrase = exactText > 0 ? `${exactText} exact` : 'No exact';
  const playerText = playerSummary.source === 'unavailable'
    ? ' · your location pending'
    : ` · gull ${playerSummary.source === 'gullPose' ? 'GPS' : 'local pose'} ${playerSummary.lat && playerSummary.lng ? `(${playerSummary.lat.toFixed(3)}, ${playerSummary.lng.toFixed(3)})` : ''}`;

  caption.className = 'tw-mini-caption';
  caption.textContent = `${lastSummary.mapped}/${lastSummary.total} events mapped · ${exactPhrase}${fallbackText}${playerText}`;
}

function buildTerrainSVG() {
  return [
    '<svg viewBox="0 0 172 172" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
    '<defs>',
    '<filter id="mini-map-soft" x="-20%" y="-20%" width="140%" height="140%">',
    '<feGaussianBlur stdDeviation="0.55" result="blur" />',
    '<feBlend in="SourceGraphic" in2="blur" mode="screen" />',
    '</filter>',
    '</defs>',
    '<g filter="url(#mini-map-soft)">',
    '<path class="outline" d="M22 16 C70 8 90 7 115 13 C154 22 160 70 158 93 C155 118 136 155 93 162 C53 168 24 156 16 117 C9 80 8 46 22 16 Z" />',
    '<path class="contour" d="M26 44 C58 34 105 32 131 52 C147 64 153 87 152 104 C150 126 132 138 102 144 C73 150 42 146 29 130 C18 117 18 95 26 44 Z" />',
    '<path class="contour" d="M37 77 C62 68 98 66 118 79 C139 92 136 112 116 123 C97 134 67 134 45 120 C35 109 31 88 37 77 Z" />',
    '<path class="contour" d="M56 103 C71 101 97 101 110 109 C121 115 121 126 110 133 C100 141 78 142 66 136 C58 130 54 109 56 103 Z" />',
    '<circle class="contour" cx="86" cy="86" r="48" />',
    '<circle class="contour" cx="86" cy="86" r="31" />',
    '<path class="contour" d="M86 20 V146" />',
    '<path class="contour" d="M20 86 H152" />',
    '</g>',
    '</svg>'
  ].join('');
}

async function fetchFeed(url) {
  const response = await fetch(url, { cache: 'no-store', signal: makeTimeoutController(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadEvents() {
  try {
    const live = await fetchFeed(FEED_URL);
    if (live && Array.isArray(live.events) && live.events.length) {
      events = live.events.slice();
      return;
    }
  } catch {
    // fallback below
  }

  try {
    const backup = await fetchFeed(new URL(BACKUP_FEED_URL, import.meta.url));
    if (backup && Array.isArray(backup.events) && backup.events.length) events = backup.events.slice();
    else events = [];
  } catch {
    events = [];
  }
}

async function refreshMap() {
  await loadEvents();
  placeMarkers();
}

function refreshPlayer() {
  const host = document.getElementById('tw-mini-map');
  if (!host) return;

  const canvas = host.querySelector('.tw-mini-grid');
  if (!canvas) return;
  placePlayerMarker(canvas);

  const caption = host.querySelector('.tw-mini-caption');
  if (caption && (events.length || caption.textContent)) {
    const fallbackText = lastSummary.fallback > 0 ? ` (${lastSummary.fallback} from neighborhood estimate)` : '';
    const exactText = lastSummary.mapped - lastSummary.fallback;
    const exactPhrase = exactText > 0 ? `${exactText} exact` : 'No exact';
    const playerText = playerSummary.source === 'unavailable'
      ? ' · your gull position pending'
      : ` · gull ${playerSummary.source === 'gullPose' ? 'live' : 'local'} pose`;
    caption.className = `tw-mini-caption${playerSummary.source === 'unavailable' ? ' warn' : ''}`;
    caption.textContent = `${lastSummary.mapped}/${lastSummary.total} events mapped · ${exactPhrase}${fallbackText}${playerText}`;
  }
}

function install() {
  if (mounted) return;
  mounted = true;

  applyMapStyles();

  const host = document.createElement('aside');
  host.id = 'tw-mini-map';
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = [
    '<div class="tw-mini-title">Mini map</div>',
    '<div class="tw-mini-map-viewport">',
    '<div class="tw-mini-terrain-contour">',
    buildTerrainSVG(),
    '</div>',
    '<div class="tw-mini-grid"></div>',
    '</div>',
    '<div class="tw-mini-caption">Loading event locations…</div>'
  ].join('');

  document.body.appendChild(host);

  void refreshMap();
  playerTickId = window.setInterval(refreshPlayer, PLAYER_TICK_MS);
  setTimeout(() => { void refreshMap(); refreshPlayer(); }, 3000);
}

(function boot() {
  const tick = () => {
    if (document.body) {
      install();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
})();
