// Add-on layer, loaded after the game: everything that can sit on top of the
// public TW API instead of patching the original file.
//
//   · Discord entry in the top-right corner
//   · idle birds drift around downtown instead of parking in mid-air
//   · fly close to another player and a small card offers to follow them on X
//
// Nothing here throws if the game is missing a hook; each feature checks for
// what it needs and quietly stays off.
const DISCORD_INVITE = 'https://discord.gg/GPPgjHE7GF';
const DOWNTOWN = { lat: 37.7915, lng: -122.4005, radius: 620 };  // Financial District / Downtown core
const IDLE_AFTER = 6;        // seconds without input before the bird takes itself for a wander
const NEAR_PLAYER = 90;      // metres: close enough to read someone's handle
const LEAVE_PLAYER = 150;    // metres: hysteresis so the card does not blink

const styles = `
#tw-discord { position: fixed; top: 12px; right: 14px; z-index: 64; display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; padding: 0; border: 1px solid #34262f55; border-radius: 2px; background: #f6ecd8ee; color: #34262f;
  font: 700 12px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; text-transform: uppercase;
  text-decoration: none; cursor: pointer; backdrop-filter: blur(6px); }
#tw-discord:hover { background: #fff; border-color: #34262f; }
#tw-discord svg { width: 22px; height: 22px; flex: none; }
#tw-discord small { display: block; font: 500 10px/1.3 ui-monospace, monospace; text-transform: none; letter-spacing: 0; opacity: .72; }
html.tw-fpv #tw-discord { opacity: .35; }
@media (max-width: 720px) { #tw-discord span.tw-dc-text { display: none; } }

#tw-neighbour { position: fixed; left: 50%; bottom: 108px; transform: translateX(-50%); z-index: 66;
  display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid #34262f55; border-radius: 2px;
  background: #f6ecd8f2; color: #34262f; font: 500 13px/1.35 "Avenir Next", "PingFang SC", sans-serif;
  box-shadow: 0 6px 22px #34262f22; animation: tw-neighbour-in .18s ease-out; }
@keyframes tw-neighbour-in { from { opacity: 0; transform: translateX(-50%) translateY(6px); } }
#tw-neighbour i { width: 10px; height: 10px; border-radius: 50%; flex: none; }
#tw-neighbour b { font: 700 14px/1.2 ui-monospace, Menlo, monospace; }
#tw-neighbour small { display: block; opacity: .66; font-size: 11px; }
#tw-neighbour a.tw-follow { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: 1px solid #34262f;
  background: #34262f; color: #f6ecd8; text-decoration: none; font: 700 12px/1 ui-monospace, monospace; }
#tw-neighbour a.tw-follow:hover { background: #12060c; }
#tw-neighbour a.tw-follow svg { width: 12px; height: 12px; fill: currentColor; }
#tw-neighbour button.tw-dismiss { border: 0; background: none; color: #34262f88; font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.tw-cover { display: block; width: 100%; max-height: 220px; object-fit: cover; margin: 10px 0 12px; border: 1px solid #34262f33; background: #34262f11; }

#tw-who { position: fixed; top: 12px; right: 62px; height: 40px; box-sizing: border-box; z-index: 64; display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 12px; border: 1px solid #34262f55; border-radius: 2px; background: #f6ecd8ee; color: #34262f;
  font: 700 12px/1.2 ui-monospace, Menlo, Consolas, monospace; cursor: pointer; backdrop-filter: blur(6px); }
#tw-who:hover { background: #fff; border-color: #34262f; }
#tw-who i { width: 8px; height: 8px; border-radius: 50%; background: #4e8a5a; flex: none; }
#tw-who[data-online="false"] i { background: #9a8c92; }
#tw-who-list { position: fixed; top: 58px; right: 62px; z-index: 65; min-width: 190px; max-height: 46vh; overflow: auto;
  padding: 8px 0; border: 1px solid #34262f55; background: #f6ecd8f5; color: #34262f;
  font: 500 13px/1.5 "Avenir Next", "PingFang SC", sans-serif; box-shadow: 0 8px 24px #34262f26; }
#tw-who-list li { display: flex; align-items: center; gap: 9px; padding: 5px 14px; list-style: none; }
#tw-who-list li i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
#tw-who-list li small { margin-left: auto; opacity: .6; font-size: 11px; }
#tw-who-list p { margin: 4px 14px; opacity: .7; font-size: 12px; }

/* The address box (top 72px) and the events panel (top 142px) overlapped by a
   line; give the panel the room it needs. */
.tw-panel { top: 176px !important; max-height: calc(100vh - 296px) !important; }
/* A quieter screen: the name, its one line, and the controls. Everything that
   merely counted things — events listed, buildings, streets, coordinates, the
   snapshot caption, the data-source note — is gone. */
.tw-masthead > p, #tw-clock, #tw-digest, .tw-masthead .eyebrow, .tw-masthead .tw-brand,
#tw-sync-status, #tw-source, .data-note, .address-search small, #tw-count, .world-label { display: none !important; }
/* The key hints stay for the first while, then get out of the way. */
.flight-hint.tw-hint-fade { opacity: 0 !important; }
/* Our two buttons sit in the free row between the address box and the panel,
   clear of the game's own status chip in the top-right corner. */
#tw-discord { top: 124px !important; right: 28px !important; }
#tw-who { top: 124px !important; right: 76px !important; }
#tw-pause { position: fixed; top: 124px; right: 190px; z-index: 64; height: 40px; padding: 0 12px; border: 1px solid #34262f55; border-radius: 2px;
  background: #f6ecd8ee; color: #34262f; font: 700 12px/1 ui-monospace, Menlo, Consolas, monospace; cursor: pointer; backdrop-filter: blur(6px); }
#tw-pause:hover { background: #fff; border-color: #34262f; }
#tw-who-list { top: 170px !important; right: 76px !important; }
#tw-who-list li small { margin-left: auto; }
#tw-who-list .tw-fly-beside { margin-left: 8px; padding: 4px 8px; border: 1px solid #34262f; background: #34262f; color: #f6ecd8;
  font: 700 10px/1 ui-monospace, Menlo, monospace; letter-spacing: .04em; cursor: pointer; }
#tw-who-list .tw-fly-beside:hover { background: #12060c; }
`;

const X_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L6 22H2.9l7.5-8.6L2.5 2H9l4.5 6.7L18.9 2Zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20Z"/></svg>';
const DISCORD_LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.5A18 18 0 0 0 15.9 3l-.2.4c1.5.4 2.7 1 3.9 1.7a13 13 0 0 0-11.2 0c1.2-.7 2.5-1.4 3.9-1.7L12 3a18 18 0 0 0-4.4 1.5C4.7 8.7 3.9 12.8 4.3 16.8a18 18 0 0 0 5.4 2.7l.9-1.5c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.9 12.9 0 0 0 11 0l.4.3c-.5.4-1.1.7-1.7.9l.9 1.5c1.9-.6 3.7-1.5 5.4-2.7.4-4.6-.7-8.7-2.7-12.3ZM9.7 14.4c-1 0-1.9-1-1.9-2.1 0-1.2.9-2.1 1.9-2.1s2 .9 1.9 2.1c0 1.2-.9 2.1-1.9 2.1Zm4.6 0c-1 0-1.9-1-1.9-2.1 0-1.2.9-2.1 1.9-2.1s1.9.9 1.9 2.1c0 1.2-.8 2.1-1.9 2.1Z"/></svg>';

function injectStyles() {
  const el = document.createElement('style');
  el.id = 'tw-extras-css';
  el.textContent = styles;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ Discord */
function mountDiscord() {
  if (document.getElementById('tw-discord')) return;
  const a = document.createElement('a');
  a.id = 'tw-discord';
  a.href = DISCORD_INVITE;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = 'Find events and ask for addresses on Discord';
  a.innerHTML = DISCORD_LOGO;
  a.setAttribute('aria-label', 'Join the Discord — find events and ask for addresses');
  document.body.appendChild(a);
}

/* ---------------------------------------- the bird flies the city by itself */
// Left alone, the bird tours downtown: it picks a building that has a sign,
// flies to it at sign height, hangs there a moment, picks the next. Any key or
// pointer hands control back at once; a few idle seconds later it resumes.
// Pause (the button, or P) holds it in place until you say otherwise.
const IDLE_RESUME = 6;          // seconds without input before the tour resumes
const VISIT_RADIUS = 70;        // metres: close enough to count as "arrived"
const DWELL = 2.4;              // seconds beside a sign before moving on
const HOP_MAX = 520;            // prefer the next stop within this distance

function installAutoFlight(TW, city) {
  const nav = TW.nav, GEO = window.__sfGeo;
  if (!nav || !GEO || typeof nav.tick !== 'function') return;
  const centre = GEO.Hn(DOWNTOWN.lng, DOWNTOWN.lat, 0);
  const auto = { idle: IDLE_RESUME, driving: false, paused: false, sign: 1, calibrating: undefined, yaw0: 0,
                 target: null, dwell: 0, visited: [], wobble: 0 };
  const originalTick = nav.tick.bind(nav);
  const pressed = (input) => !!(input && (input.forward || input.backward || input.left || input.right || input.up || input.down || input.boost));
  const inCity = (ev) => ev.world && Math.hypot(ev.world.x - centre.x, ev.world.z - centre.z) < DOWNTOWN.radius;

  const nextStop = (from) => {
    const stops = (TW.state.events || []).filter((e) => e.onMap && e.claimed && e.world && inCity(e) && !auto.visited.includes(e));
    if (!stops.length) { auto.visited = []; return null; }
    const near = stops.filter((e) => Math.hypot(e.world.x - from.x, e.world.z - from.z) < HOP_MAX);
    const pool = near.length ? near : stops;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  nav.tick = (dt) => {
    originalTick(dt);
    const P = city.flightCharacter.position;
    const input = city.flightInput;
    if (nav.phase !== 'idle' || !city.freeFlightEnabled) { auto.idle = 0; auto.driving = false; return; }
    if (pressed(input) && !auto.driving) { auto.idle = 0; return; }   // the player is flying

    if (auto.paused) {
      // Hold position: no inputs, and bleed the glide off so it truly hovers.
      auto.driving = false;
      if (city.flightVelocity) city.flightVelocity.multiplyScalar(Math.max(0, 1 - dt * 4));
      return;
    }
    auto.idle += dt;
    if (auto.idle < IDLE_RESUME) { auto.driving = false; return; }
    auto.driving = true;

    // Which way is "left"? Try it once and read the yaw, then trust it.
    const yaw = city.flightCharacter.rotation.y;
    if (auto.calibrating === undefined) { auto.calibrating = 0.25; auto.yaw0 = yaw; }
    if (auto.calibrating > 0) {
      auto.calibrating -= dt;
      input.left = true; input.right = false; input.forward = true; input.backward = false; input.boost = false;
      if (auto.calibrating <= 0) { const moved = Math.atan2(Math.sin(yaw - auto.yaw0), Math.cos(yaw - auto.yaw0)); if (Math.abs(moved) > 0.01) auto.sign = moved > 0 ? 1 : -1; }
      return;
    }

    // Choose a stop, arrive, hang there, move on.
    if (!auto.target) auto.target = nextStop(P);
    let goalX, goalZ, goalY;
    if (auto.target) {
      const tg = auto.target;
      const d = Math.hypot(tg.world.x - P.x, tg.world.z - P.z);
      if (d < VISIT_RADIUS) {
        auto.dwell += dt;
        if (auto.dwell > DWELL) { auto.visited.push(tg); if (auto.visited.length > 12) auto.visited.shift(); auto.target = nextStop(P); auto.dwell = 0; }
      }
      goalX = tg.world.x; goalZ = tg.world.z;
      goalY = Math.max(42, (tg.roof || 60) - 8);          // level with the signs, not above the roof
    } else {
      // Nothing to visit: a slow loop around the core.
      auto.wobble += dt * 0.3;
      goalX = centre.x + Math.cos(auto.wobble) * 300; goalZ = centre.z + Math.sin(auto.wobble) * 300; goalY = 90;
    }
    // Never past the edge of the core — back toward the centre instead.
    const offCentre = Math.hypot(P.x - centre.x, P.z - centre.z);
    if (offCentre > DOWNTOWN.radius) { goalX = centre.x; goalZ = centre.z; }

    const desired = Math.atan2(goalX - P.x, goalZ - P.z);
    const err = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
    const turn = err * auto.sign;
    const near = auto.target && Math.hypot(goalX - P.x, goalZ - P.z) < VISIT_RADIUS;
    input.left = turn > 0.05;
    input.right = turn < -0.05;
    input.forward = !near && Math.abs(err) < 0.9;
    input.backward = false;
    input.boost = offCentre > DOWNTOWN.radius * 1.15 && Math.abs(err) < 0.4;
    input.up = P.y < goalY - 5;
    input.down = P.y > goalY + 5;
  };

  const release = () => {
    auto.idle = 0; auto.calibrating = undefined;
    // Drop whatever the tour was holding so the player's first key is clean.
    if (auto.driving) for (const key of Object.keys(city.flightInput)) city.flightInput[key] = false;
    auto.driving = false;
  };
  for (const type of ['keydown', 'pointerdown', 'wheel']) window.addEventListener(type, (event) => {
    if (type === 'keydown' && (event.key === 'p' || event.key === 'P') && !(event.target instanceof HTMLInputElement)) return;
    release();
  }, { capture: true, passive: true });

  // Pause: a button beside the count, and P.
  const button = document.createElement('button');
  button.id = 'tw-pause'; button.type = 'button';
  const paint = () => { button.textContent = auto.paused ? '▶ Resume' : '⏸ Pause'; button.title = auto.paused ? 'Let the bird tour the city again' : 'Hold the bird where it is'; };
  const toggle = () => { auto.paused = !auto.paused; auto.idle = auto.paused ? 0 : IDLE_RESUME; paint(); };
  button.addEventListener('click', toggle);
  window.addEventListener('keydown', (event) => { if ((event.key === 'p' || event.key === 'P') && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) toggle(); });
  paint();
  document.body.appendChild(button);
  window.__twAutoFlight = auto;
}

/* ------------------------------------------- the card turns the pages for you */
// With no tags on the walls, the card is how the busiest events introduce
// themselves: when you have not picked anything for a while it walks the
// ranking — the host event first — one every few seconds. Any click, key or
// selection of your own stops it, and it waits before starting again.
const CAROUSEL_IDLE = 18000, CAROUSEL_STEP = 7000, CAROUSEL_LENGTH = 12;
function installCardCarousel(TW) {
  let lastTouch = Date.now(), index = -1, timer = 0, ours = null;
  const touched = () => { lastTouch = Date.now(); };
  for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, touched, { capture: true, passive: true });

  const ranked = () => (TW.state.events || [])
    .filter((e) => e.onMap && (e.featured || (e.rsvp || 0) > 0))
    .sort((a, b) => (b.featured ? 1e6 : 0) - (a.featured ? 1e6 : 0) || (b.rsvp || 0) - (a.rsvp || 0))
    .slice(0, CAROUSEL_LENGTH);

  const tick = () => {
    const idle = Date.now() - lastTouch;
    const selected = TW.state.selected;
    // The player chose something themselves: leave it alone.
    if (selected && selected !== ours) { lastTouch = Math.max(lastTouch, Date.now() - CAROUSEL_IDLE + 4000); return; }
    if (idle < CAROUSEL_IDLE) return;
    const list = ranked();
    if (!list.length || typeof TW.select !== 'function') return;
    index = (index + 1) % list.length;
    ours = list[index];
    try { TW.select(ours); } catch (error) { console.error('[TW carousel]', error); }
  };
  timer = setInterval(tick, CAROUSEL_STEP);
  return () => clearInterval(timer);
}

/* --------------------------------------------- fly close to another player */
// The roster comes from the multiplayer layer (multiplayer.js publishes it on
// window.__sfNet). Standalone and single-file builds have no roster, so the
// card simply never appears.
function installNeighbourCard(TW, city) {
  let card = null, current = null;

  const remove = () => { if (card) { card.remove(); card = null; } current = null; };
  const handleOf = (player) => {
    const raw = (player.handle || player.x || player.name || '').trim();
    if (!raw) return '';
    return raw.replace(/^@+/, '').split(/\s+/)[0];
  };

  const show = (player) => {
    const handle = handleOf(player);
    if (!handle) return;
    remove();
    current = player.id;
    card = document.createElement('div');
    card.id = 'tw-neighbour';
    card.innerHTML = `<i style="background:${player.color || '#c6583c'}"></i>
      <span><b>@${handle}</b><small>flying beside you</small></span>
      <a class="tw-follow" href="https://x.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener">${X_LOGO} Follow</a>
      <button type="button" class="tw-dismiss" aria-label="Dismiss">×</button>`;
    card.querySelector('.tw-dismiss').addEventListener('click', remove);
    document.body.appendChild(card);
  };

  setInterval(() => {
    const net = window.__sfNet;
    if (!net || !city.freeFlightEnabled) { if (card) remove(); return; }
    const me = city.flightCharacter && city.flightCharacter.position;
    const others = (net.players || []).filter((p) => !p.self && p.connected && p.position);
    if (!me || !others.length) { if (card) remove(); return; }

    let closest = null, best = Infinity;
    for (const p of others) {
      const d = Math.hypot(p.position.x - me.x, p.position.y - me.y, p.position.z - me.z);
      if (d < best) { best = d; closest = p; }
    }
    if (closest && best < NEAR_PLAYER && closest.id !== current) show(closest);
    else if (card && (best > LEAVE_PLAYER || !closest)) remove();
  }, 700);
}

/* ------------------------------------- Tokyo-style signage on busy buildings */
// A building hosting several events gets a vertical stack of lit panels up its
// corner — Shinjuku signage rather than a queue of airships over the same roof.
const BILLBOARD_MIN = 1;      // every building with a known address gets signage
const BILLBOARD_MAX = 7;      // panels; the rest are summarised on the cap
const SIGN_BUDGET_MS = 6;     // per frame: signage never owns a whole frame
const SIGN_START_DELAY = 900; // ms after the world is ready, so entry stays smooth
const PANEL = { w: 30, h: 17, gap: 6, base: 16 };

// The bundle exposes Texture but not CanvasTexture; this is the same thing.
// Every poster is drawn on a canvas and uploaded to the GPU, which is the
// expensive part — so each event's texture is made once and reused across
// rebuilds instead of being redrawn every time the fleet changes.
const textures = new Map();          // event key → texture, most recently used last
const TEXTURE_CAP = 220;             // live posters at once; the rest are re-drawn when you come back
function canvasTexture(T, canvas) {
  const texture = new T.Texture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
// Half-size copies for wall signs: a sign is read from the street, and four
// times less memory per poster is what lets a few hundred buildings wear one.
function halfSize(canvas) {
  const small = document.createElement('canvas');
  small.width = Math.max(64, canvas.width >> 1); small.height = Math.max(64, canvas.height >> 1);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  return small;
}
function posterTexture(T, TW, event) {
  const key = event.id || event.url || event.title;
  let texture = textures.get(key);
  if (texture) { textures.delete(key); textures.set(key, texture); return texture; }
  texture = canvasTexture(T, halfSize(TW.drawPoster(event)));
  texture.userData.withCover = !!event.coverImg;
  textures.set(key, texture);
  if (textures.size > TEXTURE_CAP) {
    const [oldKey, old] = textures.entries().next().value;
    textures.delete(oldKey); old.dispose();
    for (const mesh of old.userData.meshes || []) if (mesh.material?.uniforms?.map?.value === old) { mesh.material.uniforms.map.value = null; mesh.userData.textured = false; }
  }
  return texture;
}
// A shared blank so far-off signs cost nothing but a quad.
let blankTexture = null;
function blank(T) {
  if (blankTexture) return blankTexture;
  const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8;
  const g = cv.getContext('2d'); g.fillStyle = '#e9dcc4'; g.fillRect(0, 0, 8, 8);
  return (blankTexture = canvasTexture(T, cv));
}
// Covers arrive after the sign was drawn (they load as you approach). Redraw
// the poster with the real image the first time it is available.
function refreshPosterIfCoverArrived(T, TW, mesh) {
  const event = mesh.userData.ev;
  const map = mesh.material?.uniforms?.map;
  if (!event || !map || !event.coverImg || map.value?.userData?.withCover) return;
  const key = event.id || event.url || event.title;
  const fresh = canvasTexture(T, halfSize(TW.drawPoster(event)));
  fresh.userData.withCover = true;
  fresh.userData.meshes = [mesh];
  textures.set(key, fresh);
  map.value = fresh;
}

function billboardMaterial(T, city, texture) {
  const U = city.globalUniforms;
  // Same fog treatment as the airship banners, so the signs sit in the weather.
  return new T.ShaderMaterial({
    uniforms: { map: { value: texture }, uFogColor: U.uFogColor, uFogNear: U.uFogNear, uFogFar: U.uFogFar, uFogMax: U.uFogMax, uCamPos: U.uCamPos, uLight: { value: 1 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: 'uniform sampler2D map; uniform vec3 uFogColor, uCamPos; uniform float uFogNear, uFogFar, uFogMax, uLight; varying vec2 vUv; varying vec3 vW; void main(){ vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y); vec3 col = texture2D(map, uv).rgb * uLight; float fog = smoothstep(uFogNear, uFogFar, distance(vW, uCamPos)) * uFogMax; gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0); }',
    side: T.DoubleSide,
  });
}

// The cap panel: how many events this address is running, in the house style.
function capCanvas(venue, hidden) {
  const cv = document.createElement('canvas');
  cv.width = 480; cv.height = 272;
  const g = cv.getContext('2d');
  g.fillStyle = '#34262f'; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#f6ecd8'; g.lineWidth = 8; g.strokeRect(14, 14, cv.width - 28, cv.height - 28);
  g.fillStyle = '#f6ecd8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 104px Georgia, serif';
  g.fillText(String(venue.members.length), cv.width / 2, 116);
  g.font = '700 27px ui-monospace, Menlo, monospace';
  g.fillText('EVENTS HERE', cv.width / 2, 186);
  if (hidden > 0) { g.font = '500 21px ui-monospace, monospace'; g.fillStyle = '#f6ecd8aa'; g.fillText(`+${hidden} more inside`, cv.width / 2, 224); }
  return cv;
}

function buildBillboards(TW, city) {
  const T = window.__SF_THREE;
  if (!T || !city.scene || !TW.state.venues) return;
  const root = new T.Group();
  root.name = 'Building signage';
  city.scene.add(root);

  // One venue per slice, with a millisecond budget per frame: with signage on
  // every addressed building this would otherwise be a few hundred milliseconds
  // of canvas drawing and texture upload in a single frame — exactly the hitch
  // you feel on entering the world.
  let pending = 0;

  // Signs are painted onto the wall — no mast, no bracket, no lip. We walk
  // outward from the building's mapped point toward the city centre until the
  // roof stops answering: that is the facade, and the panels sit flush on it,
  // descending from the roofline. A short building simply gets fewer panels.
  const SIGN_CLEAR = 0.45;    // metres off the wall, enough to avoid z-fighting
  const SIGN_TOP_GAP = 6;     // panels start this far below the roofline

  const facadeOf = (anchor) => {
    const probe = TW.roofHeightAt;
    const x = anchor.world.x, z = anchor.world.z, ground = anchor.ground || 0;
    const yaw = Math.atan2(-x, -z);            // face the middle of the city
    let edge = 0;
    if (typeof probe === 'function') {
      for (let d = 4; d <= 64; d += 4) {
        const h = probe(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d, 6);
        if (Number.isFinite(h) && h > ground + 3) edge = d; else break;
      }
    }
    const out = edge + SIGN_CLEAR;
    return { x: x + Math.sin(yaw) * out, z: z + Math.cos(yaw) * out, yaw };
  };

  const buildTower = (venue) => {
    const members = (venue.members || []).filter((e) => e.onMap && (e.claimed || e.approxLocation) && !e.wantsVehicle);
    if (members.length < BILLBOARD_MIN) return;
    const anchor = members[0];
    if (!anchor.world) return;
    const shown = members.slice().sort((a, b) => a.startDate - b.startDate).slice(0, BILLBOARD_MAX);
    const ground = anchor.ground || 0, roof = anchor.roof || ground;
    const face = facadeOf(anchor);

    const wall = new T.Group();
    wall.rotation.y = face.yaw;
    wall.position.set(face.x, 0, face.z);

    // Descend from just under the roofline; stop above street level.
    const stepY = PANEL.h + PANEL.gap;
    const floor = ground + 14;
    let y = Math.max(roof - SIGN_TOP_GAP - PANEL.h / 2, floor + PANEL.h / 2);
    let placed = 0;
    for (const event of shown) {
      if (y - PANEL.h / 2 < floor - 0.01 && placed) break;
      const panel = new T.Mesh(new T.PlaneGeometry(PANEL.w, PANEL.h), billboardMaterial(T, city, blank(T)));
      panel.position.set(0, y, 0);
      panel.userData.ev = event; panel.userData.textured = false;
      wall.add(panel);
      y -= stepY;
      placed += 1;
      if (y - PANEL.h / 2 < floor) break;
    }
    if (!placed) return;

    // A building running several events gets a small painted count above the stack.
    if (members.length >= 3) {
      const cap = new T.Mesh(
        new T.PlaneGeometry(PANEL.w * 0.62, PANEL.h * 0.62),
        billboardMaterial(T, city, canvasTexture(T, capCanvas(venue, members.length - placed))),
      );
      cap.position.set(0, Math.min(roof - 1.5, roof - SIGN_TOP_GAP + PANEL.h * 0.35), 0);
      wall.add(cap);
    }
    root.add(wall);
  };

  const draw = () => {
    if (pending) clearTimeout(pending);
    root.clear();
    const queue = (TW.state.venues || []).slice();
    // Yield through the task queue rather than through frames: on a slow GPU a
    // frame can be seconds long, and the signs should not wait for it.
    const step = () => {
      const until = performance.now() + SIGN_BUDGET_MS;
      while (queue.length && performance.now() < until) {
        try { buildTower(queue.shift()); } catch (error) { console.error('[TW signage]', error); }
      }
      pending = queue.length ? setTimeout(step, 0) : 0;
    };
    pending = setTimeout(step, 0);
  };

  // Signs answer to the bird: the ones you are flying at light up and grow a
  // little, the ones across the bay dim — the way a street of signs reads when
  // you walk it rather than when you photograph it from a hill.
  const NEAR_SIGN = 190, MID_SIGN = 520, FAR_SIGN = 900;
  const tmp = new T.Vector3();
  const pulse = () => {
    const cam = city.camera || city.flightCharacter;
    if (!cam || !cam.position) return;
    root.traverse((node) => {
      if (!node.isMesh || !node.userData.ev || !node.material?.uniforms?.uLight) return;
      node.getWorldPosition(tmp);
      const d = tmp.distanceTo(cam.position);
      // Signs are for the street, not the skyline: past the far band they are
      // simply not drawn, and they come up as you fly in.
      node.visible = d < FAR_SIGN;
      if (!node.visible) return;
      if (!node.userData.textured) {
        const texture = posterTexture(T, TW, node.userData.ev);
        (texture.userData.meshes ||= []).push(node);
        node.material.uniforms.map.value = texture; node.userData.textured = true;
      }
      if (d < MID_SIGN * 2) refreshPosterIfCoverArrived(T, TW, node);
      const want = d < NEAR_SIGN ? 1.3 : d < MID_SIGN ? 1.0 : 0.55;
      const u = node.material.uniforms.uLight;
      u.value += (want - u.value) * 0.25;
    });
  };
  setInterval(pulse, 110);

  // Let the city finish its own first frames before signage starts drawing, and
  // then follow the data: the calendar arrives after the world is ready (later
  // still in the single-file build, where the whole feed is inlined), so the
  // venue list we drew from can be empty or half-built at that point. Watch a
  // cheap signature of it rather than trusting one timer.
  let signature = '';
  const sync = () => {
    const venues = TW.state.venues || [];
    let signed = 0;
    for (const venue of venues) for (const member of venue.members || []) if (member.onMap && (member.claimed || member.approxLocation) && !member.wantsVehicle) signed += 1;
    const next = `${venues.length}:${signed}`;
    if (next === signature) return;
    signature = next;
    draw();
  };
  setTimeout(sync, SIGN_START_DELAY);
  const watcher = setInterval(sync, 2500);
  setTimeout(() => clearInterval(watcher), 120000);
  // Rebuild whenever the fleet changes (a refresh, or an event ending).
  const originalRebuild = TW.rebuildWorld;
  if (typeof originalRebuild === 'function') TW.rebuildWorld = () => { originalRebuild(); try { sync(); } catch (error) { console.error('[TW signage]', error); } };
  return root;
}


/* ------------------------------------------------ the network panel goes away */
// The "Public World · N flying" card sat over the skyline and re-rendered its
// roster on every presence update. Multiplayer keeps running; the card only
// comes back if the connection actually needs the player (an error, or a
// reconnect), which is the one time it says something useful.
// A small pill instead of a panel: how many people are flying, and who, only
// when you ask. The panel itself stays hidden unless the connection needs you.
function mountWhoIsHere() {
  if (document.getElementById('tw-who')) return;
  const pill = document.createElement('button');
  pill.id = 'tw-who';
  pill.type = 'button';
  pill.title = 'Who is flying right now';
  pill.innerHTML = '<i></i><span>—</span>';
  document.body.appendChild(pill);

  let list = null;
  const closeList = () => { if (list) { list.remove(); list = null; } };
  const names = () => {
    const players = (window.__sfNet?.players || []).filter((p) => p.connected);
    if (players.length) return players;
    const me = window.TW?.state?.user;
    return me ? [{ id: 'me', self: true, connected: true, name: me.name || 'you', handle: me.handle || '', color: '#34262f' }] : null;
  };

  const renderList = () => {
    if (!list) return;
    list.replaceChildren();
    const players = names();
    if (!players) { const note = document.createElement('p'); note.textContent = 'Nobody else is flying right now.'; list.append(note); return; }
    const sorted = players.slice().sort((a, b) => (a.self ? -1 : b.self ? 1 : (a.metres ?? 1e9) - (b.metres ?? 1e9)));
    for (const player of sorted) {
      const li = document.createElement('li'), dot = document.createElement('i');
      const name = document.createElement('span'), tag = document.createElement('small');
      dot.style.background = player.color || '#c6583c';
      const handle = (player.handle || '').replace(/^@+/, '');
      name.textContent = handle ? '@' + handle : (player.name || 'Player');
      tag.textContent = player.self ? 'you'
        : player.metres == null ? 'somewhere over the city'
        : player.metres > 1000 ? (player.metres / 1000).toFixed(1) + ' km away' : player.metres + ' m away';
      li.append(dot, name, tag);
      if (!player.self && typeof window.__sfNet?.flyBeside === 'function') {
        const go = document.createElement('button');
        go.type = 'button'; go.className = 'tw-fly-beside'; go.textContent = 'Fly beside';
        go.addEventListener('click', (event) => { event.stopPropagation(); window.__sfNet.flyBeside(player.id); closeList(); });
        li.append(go);
      }
      list.append(li);
    }
  };

  pill.addEventListener('click', () => {
    if (list) return closeList();
    list = document.createElement('ul');
    list.id = 'tw-who-list';
    document.body.appendChild(list);
    renderList();
  });
  window.addEventListener('pointerdown', (event) => {
    if (list && !list.contains(event.target) && event.target !== pill && !pill.contains(event.target)) closeList();
  }, true);

  setInterval(() => {
    const players = (window.__sfNet?.players || []).filter((p) => p.connected);
    const online = players.length > 0;
    pill.dataset.online = String(online);
    pill.querySelector('span').textContent = online ? `${players.length} in the city` : 'solo';
    renderList();
  }, 3000);
}

function hideNetPanel() {
  const panel = document.getElementById('sfnet');
  if (!panel) return;
  const error = document.getElementById('sfnet-error');
  const retry = document.getElementById('sfnet-retry');
  const sync = () => {
    const needed = (error && !error.hidden && error.textContent.trim()) || (retry && !retry.hidden);
    panel.style.display = needed ? '' : 'none';
    if (!needed) panel.open = false;
  };
  sync();
  const observer = new MutationObserver(sync);
  for (const node of [error, retry]) if (node) observer.observe(node, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
}

/* ------------------------------------------------------ always a way back out */
// A dialog you cannot dismiss is the worst bug in a game you fly through:
// Escape and a click on the backdrop both close it, whatever opened it.
function installModalEscape() {
  const modal = document.getElementById('tw-modal');
  if (!modal) return;
  const close = () => { if (!modal.hidden) { modal.hidden = true; modal.innerHTML = ''; } };
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!modal.hidden) { event.stopPropagation(); close(); return; }
    const panel = document.getElementById('sfnet');
    if (panel && panel.open) panel.open = false;
  }, true);
  modal.addEventListener('pointerdown', (event) => { if (event.target === modal) close(); });
}

/* --------------------------------------------------- the ships that carry the week */
// The host's event and the week's opening acts fly larger so the eye finds them
// from anywhere over downtown. Five at most: past that, nothing reads as big.
const FEATURED_SCALE = 3.0;
const SPOTLIGHT_SCALE = 2.2;
const SPOTLIGHT_MAX = 5;

function featureShips(TW) {
  const apply = () => {
    const events = TW.state.events || [];
    const featured = events.find((e) => e.featured);
    const others = events
      .filter((e) => e.spotlightPick && !e.featured && e.ship)
      .sort((a, b) => (b.rsvp || 0) - (a.rsvp || 0))
      .slice(0, SPOTLIGHT_MAX - 1);
    for (const [event, scale] of [[featured, FEATURED_SCALE], ...others.map((e) => [e, SPOTLIGHT_SCALE])]) {
      if (!event || !event.ship || event.ship.userData.twScaled) continue;
      event.ship.userData.twScaled = true;
      event.ship.scale.multiplyScalar(scale);
    }
  };
  apply();
  setTimeout(apply, 1200);
  const original = TW.rebuildWorld;
  if (typeof original === 'function') TW.rebuildWorld = () => { original(); try { apply(); } catch (error) { console.error('[TW spotlight]', error); } };
}

/* ------------------------------------- the host's own hoarding, on open ground */
// The host event has no venue yet, so it has no building to wear a sign on.
// Instead it gets a hoarding on the open ground under its ship — the kind that
// stands in an empty lot — which is also the answer to "no address yet".
const HOARDING = { w: 88, h: 50, lift: 6 };

function hostHoarding(TW, city) {
  const T = window.__SF_THREE;
  if (!T || !city.scene) return;
  const group = new T.Group();
  group.name = 'Host hoarding';
  city.scene.add(group);

  const openGroundNear = (x, z, ground) => {
    const probe = TW.roofHeightAt;
    if (typeof probe !== 'function') return { x, z };
    for (let radius = 90; radius <= 420; radius += 60) {
      for (let k = 0; k < 12; k += 1) {
        const angle = k * Math.PI / 6 + radius * 0.11;
        const px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
        const roof = probe(px, pz, HOARDING.w * 0.6);
        if (!Number.isFinite(roof) || roof <= ground + 3) return { x: px, z: pz };
      }
    }
    return { x, z };
  };

  const build = () => {
    const ev = (TW.state.events || []).find((e) => e.featured);
    if (!ev || !ev.world || group.children.length) return;
    const ground = ev.ground || 0;
    const spot = openGroundNear(ev.world.x, ev.world.z, ground);
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = Math.atan2(ev.world.x - spot.x, ev.world.z - spot.z);

    const board = new T.Mesh(new T.PlaneGeometry(HOARDING.w, HOARDING.h), billboardMaterial(T, city, posterTexture(T, TW, ev)));
    board.position.set(0, ground + HOARDING.lift + HOARDING.h / 2, 0);
    board.userData.ev = ev;
    group.add(board);
    const refresh = setInterval(() => { refreshPosterIfCoverArrived(T, TW, board); if (board.material.uniforms.map.value.userData.withCover) clearInterval(refresh); }, 1500);


    // It stands on a low plinth — a wall in an empty lot, not a sign on stilts.
    const plinth = new T.Mesh(new T.BoxGeometry(HOARDING.w + 6, HOARDING.lift, 5), city.createSolidMaterial('sign-mast', '#34262f'));
    plinth.position.set(0, ground + HOARDING.lift / 2, -1.2);
    group.add(plinth);
  };

  setTimeout(build, 1400);
  const original = TW.rebuildWorld;
  if (typeof original === 'function') TW.rebuildWorld = () => { original(); try { build(); } catch (error) { console.error('[TW hoarding]', error); } };
  return group;
}

/* ------------------------------------------------- tapping a sign selects it */
// The game's own picker knows ships and kites; the signs are ours. A tap the
// game did not answer is cast against the signage instead — the nearest panel
// under the pointer, within reading distance, opens its card. A sign is a flat
// rectangle, so the test is a ray against its own plane, no raycaster needed.
const SIGN_PICK_RANGE = 700;   // metres: signs are read from the street, not picked from the skyline
function installSignPicking(TW, city, roots) {
  const T = window.__SF_THREE;
  const el = city.renderer && city.renderer.domElement;
  if (!T || !el) return;
  const origin = new T.Vector3(), dir = new T.Vector3(), local = new T.Vector3(), ldir = new T.Vector3(), inv = new T.Matrix4();
  const hitPanel = (node) => {
    const geo = node.geometry && node.geometry.parameters;
    if (!geo || !Number.isFinite(geo.width) || !Number.isFinite(geo.height)) return null;
    inv.copy(node.matrixWorld).invert();
    local.copy(origin).applyMatrix4(inv);
    ldir.copy(dir).transformDirection(inv);
    if (Math.abs(ldir.z) < 1e-6) return null;
    const t = -local.z / ldir.z;
    if (t <= 0 || t > SIGN_PICK_RANGE) return null;
    const px = local.x + ldir.x * t, py = local.y + ldir.y * t;
    if (Math.abs(px) > geo.width / 2 || Math.abs(py) > geo.height / 2) return null;
    return t;
  };
  let down = null, before = null;
  el.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY, t: performance.now() }; before = TW.state.selected; });
  el.addEventListener('pointerup', (event) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y), held = performance.now() - down.t, was = before;
    down = null; before = null;
    if (moved > 6 || held > 600) return;
    if (TW.state.selected !== was) return;                 // the game's picker already answered this tap
    const cam = city.camera;
    if (!cam || !cam.matrixWorld) return;
    const rect = el.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1, ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    origin.setFromMatrixPosition(cam.matrixWorld);
    dir.set(nx, ny, 0.5).unproject(cam).sub(origin).normalize();
    let best = null;
    for (const root of roots) {
      if (!root) continue;
      root.traverse((node) => {
        if (!node.isMesh || !node.visible || !node.userData.ev) return;
        const t = hitPanel(node);
        if (t !== null && (!best || t < best.t)) best = { t, ev: node.userData.ev };
      });
    }
    if (best) TW.select(best.ev);
  });
}

/* ------------------------------------------------------------------- boot */
(function boot(n) {
  const TW = window.TW, city = window.__sfCity;
  if (TW && TW.state && TW.state.ready && city) {
    try {
      injectStyles();
      setTimeout(() => document.querySelector('.flight-hint')?.classList.add('tw-hint-fade'), 14000);
      mountDiscord();
      hideNetPanel();
      mountWhoIsHere();
      installModalEscape();
      installCardCarousel(TW);
      installAutoFlight(TW, city);
      installNeighbourCard(TW, city);
      const signage = buildBillboards(TW, city);
      featureShips(TW);
      const hoarding = hostHoarding(TW, city);
      installSignPicking(TW, city, [signage, hoarding]);
    } catch (error) { console.error('[TW extras]', error); }
  } else if (n < 1500) setTimeout(() => boot(n + 1), 60);
})(0);
