// Build-only helpers. The small runtime below is injected into the existing TW
// closure, so local, hosted and single-file builds need no new runtime imports.
export function featuredSpawnPoint(anchor, roofAt) {
  const distance = 220; // clear of the featured ship's enlarged hull and banner
  const desiredY = Math.max(60, anchor.y - 12);
  let best = null;
  for (const angle of [Math.PI / 4, 0, Math.PI / 2, -Math.PI / 4, Math.PI, -Math.PI / 2, 3 * Math.PI / 4, -3 * Math.PI / 4]) {
    const x = anchor.x + Math.sin(angle) * distance, z = anchor.z + Math.cos(angle) * distance;
    const roof = roofAt(x, z, 20), y = Math.max(desiredY, Number.isFinite(roof) ? roof + 38 : desiredY);
    const point = { x, y, z, heading: Math.atan2(anchor.x - x, anchor.z - z) };
    if (!best || y < best.y) best = point;
    if (y === desiredY) break;
  }
  return best;
}

function placePlayerAtFeatured() {
  // The baseline normally contains the host's event. Its configured anchor is
  // also available before a delayed/partial programme arrives.
  const event = state.events.find(ev => ev.featured || `${ev.id || ''}${ev.url || ''}${ev.sourceUrl || ''}`.includes(FEATURED_EVENT));
  const fallback = GEO.Hn(CFG.featured.lng, CFG.featured.lat, CFG.featured.y);
  const position = event?.ship?.position || event?.world || fallback;
  const anchor = { x: position.x, z: position.z,
    y: Number.isFinite(event?.ship?.position?.y) ? event.ship.position.y : Number.isFinite(event?.shipY) ? event.shipY : CFG.featured.y };
  const spawn = featuredSpawnPoint(anchor, roofHeightAt);
  c.cancelCinematicTour?.(); c.cameraFlight = undefined;
  c.flightCharacter.position.set(spawn.x, spawn.y, spawn.z);
  c.flightCharacter.rotation.set(0, spawn.heading, 0);
  c.flightVelocity.set(0, 0, 0); c.gullSpeed = 0; c.flightTurnVelocity = 0;
  c.clearFlightInput(); nav.stop(true);
  c.yaw = spawn.heading + Math.PI; c.pitch = 0.1;
  c.radius = window.innerWidth < 720 ? 18 : 13;
  c.target.copy(c.flightCharacter.position).add(V3(0, 0.55, 0));
  c.applyOrbit();
}

function startPlayer() {
  if (TW.playerStart) return;
  const appearance = Object.keys(BIRDS);
  const bird = appearance[Math.min(appearance.length - 1, Math.floor(Math.random() * appearance.length))] || 'gull';
  const started = TW.playerStart = { bird, spawned: false };
  state.welcomed = true;

  // This subscribes only to the existing trusted host facade. It neither asks
  // for a token nor creates/renames an account, and never invents a guest name.
  let auth, unsubscribe, disposed = false;
  const bindAccount = () => {
    const next = window.__SF_HOST_CLIENT__?.auth;
    if (disposed || !next || next === auth) return;
    unsubscribe?.(); auth = next;
    const sync = account => {
      const profile = account?.profile || auth.profile;
      if (!(account?.userId || auth.userId) || account?.initialized === false ||
        typeof profile?.displayName !== 'string' || !profile.displayName.trim()) return;
      state.user.name = profile.displayName;
      refreshMeChip();
    };
    sync();
    if (typeof auth.subscribe === 'function') unsubscribe = auth.subscribe(sync);
  };
  bindAccount();
  if (window.__SF_HOST_READY__) Promise.resolve(window.__SF_HOST_READY__).then(bindAccount).catch(() => {});
  const dispose = event => {
    if (event.persisted) return;
    disposed = true; unsubscribe?.(); window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose);

  applyBird(bird);
  // attachScene() restores this existing account/World-scoped preference after
  // TW.ready. Store the choice now so that restore cannot undo this entry's
  // random appearance. The account name itself is owned by Chrona.
  try { localStorage.setItem('sf-ink-bird', JSON.stringify({ bird, name: state.user.name })); } catch {}
  if (c.flightAvatar !== 'gull') c.setFlightAvatar('gull');
  if (!c.freeFlightEnabled) {
    const launch = document.querySelector('.gull-launch, .flight-launch');
    if (launch) launch.click(); // keep the original UI's flight state in sync
    if (c.flightAvatar !== 'gull') c.setFlightAvatar('gull');
    if (!c.freeFlightEnabled) c.setFlightMode(true);
  }
  enterCity();
  started.spawned = true;
  if (state.selected) renderCard(state.selected);
}

export function wirePlayerStart(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Player start patch target changed: ' + from.slice(0, 90));
    html = html.replace(from, to);
  };
  once('  function enterCity() {', `  ${featuredSpawnPoint.toString()}\n  ${placePlayerAtFeatured.toString()}\n  ${startPlayer.toString()}\n  function enterCity() {`);
  once('applyBird(state.user.bird); const sp = CFG.spawn; c.teleportToAddress(sp.lng, sp.lat, 40); c.flightCharacter.rotation.y = sp.heading; c.yaw = sp.heading + Math.PI; c.flightVelocity.set(0, 0, 0); c.gullSpeed = 0; c.flightTurnVelocity = 0; c.clearFlightInput(); nav.stop(true);',
    'applyBird(state.user.bird); placePlayerAtFeatured();');
  once("setView(state.view); toast(`Welcome, @${state.user.name || 'you'}. Hold movement keys to fly; release them to hover. Select an event to fly there.`);",
    "setView(state.view); toast('Hold movement keys to fly; release them to hover. Select an event to fly there.');");
  once('state.ready = true; updateClock();', 'startPlayer();\n    state.ready = true; updateClock();');
  once("if (qs.get('welcome') !== '0') openWelcome();", '// Player entry happens before ready; no name or avatar chooser interrupts it.');
  once('<button type="button" id="tw-change-bird">Bird &amp; name</button>', '');
  once("    $('#tw-change-bird').addEventListener('click', () => { state.welcomed = false; openWelcome(); });\n", '');
  return html;
}
