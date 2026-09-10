// The city's authored palettes follow San Francisco's wall clock, including
// daylight saving time. These are deliberate local-time art transitions, not
// an astronomical sunrise/sunset model: dawn 05:30–07:30, dusk 17:30–19:30.
export const SF_TIME_ZONE = 'America/Los_Angeles';
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: SF_TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const stops = [[0, 'night'], [330, 'night'], [390, 'dusk'], [450, 'day'],
  [1050, 'day'], [1110, 'dusk'], [1170, 'night'], [1440, 'night']];

export function sanFranciscoLighting(date = new Date()) {
  const parts = Object.fromEntries(clock.formatToParts(date).map(part => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
  const index = stops.findIndex((stop, i) => i > 0 && minutes < stop[0]);
  const [start, from] = stops[index - 1], [end, to] = stops[index];
  const t = (minutes - start) / (end - start), mix = t * t * (3 - 2 * t);
  return { timeZone: SF_TIME_ZONE, localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    from, to, mix: from === to ? 0 : mix, label: mix < 0.5 ? from : to };
}

// Install immediately after constructing the city. Wrapping the two palette
// entry points also covers React's initial "day" effect, streamed geometry and
// cinematic lighting, without resetting the camera, tour, controls or physics.
export function installCityTime(city, { scope = globalThis.window, now = () => new Date() } = {}) {
  if (!city || !scope?.document || typeof city.captureTourPalette !== 'function' ||
      typeof city.applyTourPalette !== 'function' || typeof city.applyPalette !== 'function') return null;
  if (city.sfLocalTime) return city.sfLocalTime;
  const document = scope.document;
  const original = { applyPalette: city.applyPalette, applyTourPalette: city.applyTourPalette,
    notifyCinematicTour: city.notifyCinematicTour, dispose: city.dispose };
  let palettes, materialCount = -1, lastSecond = -1, timer, stopped = false, paused = false;
  const state = { timeZone: SF_TIME_ZONE, localTime: '', from: '', to: '', mix: 0, label: '', update, dispose };
  city.sfLocalTime = state;
  function label() {
    if (!state.label) return;
    city.palette = state.label;
    document.documentElement.dataset.palette = state.label;
  }
  function update(force = false) {
    if (stopped || paused || document.hidden || city.disposed) return;
    const date = now(), second = Math.floor(date.getTime() / 1000);
    const count = city.materialRecords?.length || 0;
    if (!force && second === lastSecond && count === materialCount) { label(); return; }
    if (!palettes || count !== materialCount) {
      palettes = Object.fromEntries(['day', 'dusk', 'night'].map(name => [name, city.captureTourPalette(name)]));
      materialCount = count;
    }
    const light = sanFranciscoLighting(date);
    original.applyTourPalette.call(city, palettes[light.from], palettes[light.to], light.mix);
    Object.assign(state, light); lastSecond = second; label();
  }
  const applyPalette = function () { palettes = undefined; update(true); };
  const applyTourPalette = function () { update(); };
  const notify = function (...args) { label(); return original.notifyCinematicTour?.apply(this, args); };
  const disposeCity = function (...args) { dispose(); return original.dispose?.apply(this, args); };
  city.applyPalette = applyPalette; city.applyTourPalette = applyTourPalette;
  city.notifyCinematicTour = notify; city.dispose = disposeCity;
  function schedule() {
    scope.clearTimeout(timer);
    if (!stopped && !paused && !document.hidden && !city.disposed) {
      timer = scope.setTimeout(() => { update(); schedule(); }, 1000);
    }
  }
  const visible = () => { if (!document.hidden) update(true); schedule(); };
  const hide = () => { paused = true; scope.clearTimeout(timer); };
  const show = () => { paused = false; update(true); schedule(); };
  const geometry = event => { if (event.detail?.city === city) update(true); };
  function dispose() {
    if (stopped) return;
    stopped = true; scope.clearTimeout(timer);
    document.removeEventListener('visibilitychange', visible);
    scope.removeEventListener('pagehide', hide); scope.removeEventListener('pageshow', show);
    scope.removeEventListener('sf-city-geometry-updated', geometry);
    for (const [name, wrapper] of Object.entries({ applyPalette, applyTourPalette,
      notifyCinematicTour: notify, dispose: disposeCity })) if (city[name] === wrapper) city[name] = original[name];
    if (city.sfLocalTime === state) delete city.sfLocalTime;
  }
  document.addEventListener('visibilitychange', visible);
  scope.addEventListener('pagehide', hide); scope.addEventListener('pageshow', show);
  scope.addEventListener('sf-city-geometry-updated', geometry);
  update(true); schedule();
  return state;
}

if (typeof window !== 'undefined') window.__sfInstallCityTime = installCityTime;
