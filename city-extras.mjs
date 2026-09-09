// Add-on layer, loaded after the game: everything that can sit on top of the
// public TW API instead of patching the original file.
//
//   · Discord entry in the top-right corner
//   · idle birds drift around downtown instead of parking in mid-air
//   · fly close to another player and a small card offers to follow them on X
//
// Nothing here throws if the game is missing a hook; each feature checks for
// what it needs and quietly stays off.
const DISCORD_INVITE = 'https://discord.gg/TAZsCKnaPr';
const DOWNTOWN = { lat: 37.7915, lng: -122.4005, radius: 620 };  // Financial District / Downtown core
const IDLE_AFTER = 6;        // seconds without input before the bird takes itself for a wander
const NEAR_PLAYER = 90;      // metres: close enough to read someone's handle
const LEAVE_PLAYER = 150;    // metres: hysteresis so the card does not blink

const styles = `
#tw-discord { position: fixed; top: 12px; right: 14px; z-index: 64; display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 13px; border: 1px solid #34262f55; border-radius: 2px; background: #f6ecd8ee; color: #34262f;
  font: 700 12px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; text-transform: uppercase;
  text-decoration: none; cursor: pointer; backdrop-filter: blur(6px); }
#tw-discord:hover { background: #fff; border-color: #34262f; }
#tw-discord svg { width: 17px; height: 17px; flex: none; }
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
.tw-heat-detail { margin: -6px 0 8px; font: 500 12px/1.4 "Avenir Next", "PingFang SC", sans-serif; color: #6a5960; }
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
  a.innerHTML = `${DISCORD_LOGO}<span class="tw-dc-text">Find events &amp; ask for addresses<small>Join the Discord</small></span>`;
  document.body.appendChild(a);
}

/* ------------------------------------------------- idle wandering downtown */
// When nobody is steering, the bird circles the downtown core rather than
// holding a straight line out over the water. Any real input hands control
// straight back — this only ever runs while the game's own autopilot is idle.
function installIdleRoam(TW, city) {
  const nav = TW.nav, GEO = window.__sfGeo;
  if (!nav || !GEO || typeof nav.tick !== 'function') return;
  const centre = GEO.Hn(DOWNTOWN.lng, DOWNTOWN.lat, 0);
  const roam = { idle: 0, angle: Math.random() * Math.PI * 2, wobble: 0 };
  const originalTick = nav.tick.bind(nav);
  const pressed = (input) => !!(input && (input.forward || input.backward || input.left || input.right || input.up || input.down || input.boost));

  nav.tick = (dt) => {
    originalTick(dt);
    if (nav.phase !== 'idle' || !city.freeFlightEnabled) { roam.idle = 0; return; }
    // The player is flying manually: stand down and reset the timer.
    if (roam.driving === undefined) roam.driving = false;
    if (pressed(city.flightInput) && !roam.driving) { roam.idle = 0; return; }
    roam.idle += dt;
    if (roam.idle < IDLE_AFTER) { roam.driving = false; return; }

    roam.driving = true;
    const P = city.flightCharacter.position;
    const dx = centre.x - P.x, dz = centre.z - P.z;
    const dist = Math.hypot(dx, dz);
    roam.wobble += dt * 0.35;
    // Outside the core: head back. Inside: lazy circle with a drifting radius.
    const inward = Math.atan2(dx, dz);
    const desired = dist > DOWNTOWN.radius
      ? inward
      : inward + Math.PI / 2 + Math.sin(roam.wobble) * 0.55 + Math.atan((DOWNTOWN.radius * 0.62 - dist) / 90);
    const err = Math.atan2(Math.sin(desired - city.flightCharacter.rotation.y), Math.cos(desired - city.flightCharacter.rotation.y));
    const input = city.flightInput;
    const cruiseY = 150 + Math.sin(roam.wobble * 0.7) * 34;
    input.left = err > 0.05;
    input.right = err < -0.05;
    input.boost = false;
    input.forward = Math.abs(err) < 0.7;
    input.backward = false;
    input.up = P.y < cruiseY - 6;
    input.down = P.y > cruiseY + 6;
  };

  // Any key or pointer the player uses is a hand-back.
  const release = () => { roam.idle = 0; roam.driving = false; };
  for (const type of ['keydown', 'pointerdown', 'wheel']) window.addEventListener(type, release, { capture: true, passive: true });
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
const BILLBOARD_MIN = 3;      // events at one address before the tower goes up
const BILLBOARD_MAX = 7;      // panels; the rest are summarised on the cap
const PANEL = { w: 30, h: 17, gap: 6, base: 16 };

// The bundle exposes Texture but not CanvasTexture; this is the same thing.
function canvasTexture(T, canvas) {
  const texture = new T.Texture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
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

  const draw = () => {
    root.clear();
    const centre = { x: 0, z: 0 };   // the spawn side of downtown; panels face it
    for (const venue of TW.state.venues) {
      const members = (venue.members || []).filter((e) => e.onMap && e.claimed);
      if (members.length < BILLBOARD_MIN) continue;
      const anchor = members[0];
      const shown = members.slice().sort((a, b) => a.startDate - b.startDate).slice(0, BILLBOARD_MAX);
      const facing = Math.atan2(centre.x - anchor.world.x, centre.z - anchor.world.z);

      const tower = new T.Group();
      tower.position.set(anchor.world.x, 0, anchor.world.z);
      tower.rotation.y = facing;
      const top = (anchor.roof || 0) + PANEL.base + shown.length * (PANEL.h + PANEL.gap);

      // The mast the panels hang from.
      const mast = new T.Mesh(
        new T.CylinderGeometry(0.9, 0.9, top - (anchor.roof || 0) + 26, 6),
        city.createSolidMaterial('sign-mast', '#34262f'),
      );
      mast.position.set(-PANEL.w / 2 - 1.6, (anchor.roof || 0) + (top - (anchor.roof || 0) + 26) / 2, 0);
      tower.add(mast);

      shown.forEach((event, index) => {
        const panel = new T.Mesh(new T.PlaneGeometry(PANEL.w, PANEL.h), billboardMaterial(T, city, canvasTexture(T, TW.drawPoster(event))));
        panel.position.set(0, (anchor.roof || 0) + PANEL.base + index * (PANEL.h + PANEL.gap) + PANEL.h / 2, 0);
        panel.userData.ev = event;
        tower.add(panel);
        // A thin lip under each panel picks up the light like a real sign box.
        const lip = new T.Mesh(new T.BoxGeometry(PANEL.w + 1.4, 0.9, 1.6), city.createSolidMaterial('sign-lip', '#f6ecd8'));
        lip.position.set(0, panel.position.y - PANEL.h / 2 - 0.6, 0.4);
        tower.add(lip);
      });

      const cap = new T.Mesh(
        new T.PlaneGeometry(PANEL.w * 0.62, PANEL.h * 0.62),
        billboardMaterial(T, city, canvasTexture(T, capCanvas(venue, members.length - shown.length))),
      );
      cap.position.set(0, top + PANEL.h * 0.42, 0);
      tower.add(cap);
      root.add(tower);
    }
  };

  draw();
  // Rebuild whenever the fleet changes (a refresh, or an event ending).
  const originalRebuild = TW.rebuildWorld;
  if (typeof originalRebuild === 'function') TW.rebuildWorld = () => { originalRebuild(); try { draw(); } catch (error) { console.error('[TW signage]', error); } };
  return root;
}

/* ------------------------------------------------------------------- boot */
(function boot(n) {
  const TW = window.TW, city = window.__sfCity;
  if (TW && TW.state && TW.state.ready && city) {
    try {
      injectStyles();
      mountDiscord();
      installIdleRoam(TW, city);
      installNeighbourCard(TW, city);
      buildBillboards(TW, city);
    } catch (error) { console.error('[TW extras]', error); }
  } else if (n < 1500) setTimeout(() => boot(n + 1), 60);
})(0);
