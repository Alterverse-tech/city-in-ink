#!/usr/bin/env node
// Renders the social trailer: the bird flies the city while captions explain
// what the week is, what you get and who you meet. The game itself is the
// renderer — a standalone build (dist-local/) is loaded in headless Chromium,
// its animation loop is stopped, and every frame is produced by hand: one
// fixed simulation step, one render, one screenshot. That is what makes the
// output smooth and repeatable even on a machine without a GPU (software
// WebGL renders a frame in milliseconds; only reading the pixels back is
// slow, about 1.4 s per 720p frame here), and it is why the shots never
// depend on wall-clock time.
//
//   node scripts/trailer.mjs                       # 1280x720, 24 fps → dist-trailer/
//   node scripts/trailer.mjs --width 1920 --height 1080 --workers 2
//   node scripts/trailer.mjs --shots city,airship  # a preview of two shots
//
// Needs: a built dist-local/ (npm run build:local), Playwright with Chromium
// (npx playwright install chromium; or point --playwright at an installed
// module), and ffmpeg with libx264 (--ffmpeg, $FFMPEG, PATH, or the binary
// that ships in the imageio-ffmpeg Python package).
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const WIDTH = Number(args.width) || 1280, HEIGHT = Number(args.height) || 720, FPS = Number(args.fps) || 24;
const WORKERS = Math.max(1, Number(args.workers) || 2);
const DIR = path.resolve(args.dir || 'dist-local');
const OUT = path.resolve(args.out || `dist-trailer/sf-tech-week-city-${HEIGHT}p.mp4`);
const FRAMES = path.resolve(args.frames || 'dist-trailer/frames');
const PORT = Number(args.port) || 8791;
const ONLY = typeof args.shots === 'string' ? args.shots.split(',') : null;

/* ------------------------------------------------------------ the script */
// One caption per shot. `seconds` is the shot's length; `setup` runs once at
// its start (a setup of null continues the previous shot without a cut);
// `inputs` are the flight keys held during the shot; `show` names the game UI
// that stays visible (card, nav chip, neighbour card).
export const SHOTS = [
  { id: 'title', seconds: 3.2, setup: 'vantage', inputs: { backward: true }, overlay: { h1: 'SF TECH WEEK CITY', k: 'Fly the week · Oct 5–11 · San Francisco' } },
  { id: 'city', seconds: 6, setup: null, inputs: { backward: true },
    caption: { k: '01 · The city', t: 'Every Tech Week event, in the city where it happens.', s: 'A bird’s-eye San Francisco. Open it in your browser — nothing to install.' } },
  { id: 'airship', seconds: 7, setup: 'flyToFeatured', inputs: {},
    caption: { k: '02 · Airships', t: 'Airships fly over the busiest events.', s: 'Pick one and your bird flies there.' } },
  { id: 'card', seconds: 6, setup: null, inputs: {}, show: ['card'], captionSide: 'right',
    caption: { k: '03 · One click', t: 'RSVP in one click.', s: 'Venue not public yet? The Discord knows — and someone there gets you in.' } },
  { id: 'posters', seconds: 6, setup: 'posterWall', inputs: { backward: true },
    caption: { k: '04 · Posters', t: 'Every event gets its poster in the city.', s: 'On the building where it happens. Fly a block and read what’s on.' } },
  { id: 'friends', seconds: 6, setup: 'friends', inputs: { backward: true }, show: ['neighbour'], companion: true,
    caption: { k: '05 · Who’s flying', t: 'See who is flying beside you.', s: 'Follow them on X, or fly beside them for a chat.' } },
  { id: 'beak', seconds: 6, setup: 'canyon', inputs: { forward: true }, view: 'fpv',
    caption: { k: '06 · Beak cam', t: 'Chase cam or beak cam. Buildings are solid.', s: 'Pick your line through downtown.' } },
  { id: 'cruise', seconds: 6, setup: 'cruise', inputs: {}, show: ['nav'], view: 'chase',
    caption: { k: '07 · Auto-cruise', t: 'Press T and your bird tours the hottest events for you.', s: 'Sit back; take over with any key.' } },
  { id: 'end', seconds: 5, setup: null, inputs: {}, show: ['nav'],
    overlay: { h1: 'SF TECH WEEK CITY', k: 'Oct 5–11 · San Francisco', u: 'chrona.world', s: 'In your browser, no download · Discord: discord.gg/GPPgjHE7GF' } },
];

/* --------------------------------------------------------- in the page */
// Everything below `installTrailer` runs inside the game page. It is sent as
// source text, so it may use only what the page has: the city (`__sfCity`),
// the Tech Week layer (`TW`), three.js (`__SF_THREE`) and the add-ons' wall
// index and signage.
function installTrailer(cfg) {
  const c = window.__sfCity, TW = window.TW, T = window.__SF_THREE, GEO = window.__sfGeo;
  const stopLoop = () => { if (c.animationFrame) { cancelAnimationFrame(c.animationFrame); c.animationFrame = 0; } };
  stopLoop(); for (const ms of [50, 300, 1000, 3000]) setTimeout(stopLoop, ms);
  // The engine's own loop, should it ever restart, must not advance anything.
  const realSim = c.updateSimulation; let stepping = false;
  c.updateSimulation = function (dt) { if (!stepping) return; return realSim.call(c, dt); };
  const stepSim = dt => { stepping = true; try { realSim.call(c, dt); } finally { stepping = false; } };
  c.renderer.setPixelRatio(1); c.onResize?.();
  TW.nav.stop(true);
  if (cfg.bird && TW.BIRDS[cfg.bird]) TW.applyBird(cfg.bird);

  // A fixed light instead of San Francisco's clock: dusk sliding into night.
  c.sfLocalTime?.dispose?.();
  let pal = null, palCount = -1;
  const light = mix => {
    const count = c.materialRecords?.length || 0;
    if (!pal || count !== palCount) { pal = { dusk: c.captureTourPalette('dusk'), night: c.captureTourPalette('night') }; palCount = count; }
    c.applyTourPalette(pal.dusk, pal.night, mix);
    c.palette = mix < 0.5 ? 'dusk' : 'night'; document.documentElement.dataset.palette = c.palette;
  };

  const style = document.createElement('style');
  style.textContent = `
html.trailer .tw-panel, html.trailer .address-search, html.trailer .tw-flight-shortcuts, html.trailer .flight-hint, html.trailer #tw-toast,
html.trailer #tw-guide, html.trailer #tw-linkbox, html.trailer .tw-masthead, html.trailer .gull-telemetry, html.trailer #tw-digest, html.trailer .corner-tools { display: none !important; }
html.trailer:not(.trailer-card) #tw-card { display: none !important; }
html.trailer:not(.trailer-nav) .tw-nav { display: none !important; }
html.trailer:not(.trailer-neighbour) #tw-neighbour { display: none !important; }
html.trailer #tw-neighbour { bottom: 150px; }
#trailer-caption { position: fixed; left: 36px; bottom: 40px; z-index: 200; max-width: 640px; box-sizing: border-box; padding: 16px 20px 18px;
  background: #f6ecd8f2; color: #34262f; border: 1px solid #34262f55; border-radius: 2px; box-shadow: 0 10px 30px #34262f33; opacity: 0; }
#trailer-caption.right { left: auto; right: 36px; }
#trailer-caption .k { font: 700 11px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .14em; text-transform: uppercase; opacity: .72; margin-bottom: 9px; }
#trailer-caption .t { font: 700 28px/1.18 Georgia, "Times New Roman", serif; }
#trailer-caption .s { margin-top: 8px; font: 500 15px/1.45 "Avenir Next", "PingFang SC", sans-serif; opacity: .88; }
#trailer-overlay { position: fixed; inset: 0; z-index: 210; display: grid; place-items: center; text-align: center; opacity: 0; pointer-events: none; }
#trailer-overlay .box { padding: 36px 52px 34px; background: #f6ecd8f4; color: #34262f; border: 1px solid #34262f55; box-shadow: 0 16px 50px #34262f40; max-width: 78vw; }
#trailer-overlay h1 { margin: 0; font: 700 64px/1.05 Georgia, "Times New Roman", serif; letter-spacing: .01em; }
#trailer-overlay .k { font: 700 13px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .2em; text-transform: uppercase; margin-top: 16px; opacity: .78; }
#trailer-overlay .u { margin-top: 18px; font: 700 30px/1.2 ui-monospace, Menlo, Consolas, monospace; }
#trailer-overlay .s { margin-top: 10px; font: 500 16px/1.45 "Avenir Next", "PingFang SC", sans-serif; opacity: .85; }
#trailer-companion { position: fixed; z-index: 120; transform: translate(-50%, -100%); padding: 5px 9px; background: #34262f; color: #f6ecd8;
  font: 700 12px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; border-radius: 2px; pointer-events: none; }`;
  document.head.appendChild(style);
  document.documentElement.classList.add('trailer');
  const caption = document.createElement('div'); caption.id = 'trailer-caption'; caption.innerHTML = '<div class="k"></div><div class="t"></div><div class="s"></div>'; document.body.appendChild(caption);
  const overlay = document.createElement('div'); overlay.id = 'trailer-overlay'; overlay.innerHTML = '<div class="box"><h1></h1><div class="k"></div><div class="u"></div><div class="s"></div></div>'; document.body.appendChild(overlay);

  const featured = () => TW.state.events.find(e => e.featured) || TW.state.events.find(e => e.ship) || TW.state.events[0];
  const place = (x, y, z, heading) => {
    TW.nav.stop(true); c.clearFlightInput();
    c.flightCharacter.position.set(x, y, z); c.flightCharacter.rotation.set(0, heading, 0);
    c.flightVelocity.set(0, 0, 0); c.gullSpeed = 0; c.flightTurnVelocity = 0;
    c.yaw = heading + Math.PI; c.pitch = 0.14; c.radius = 13;
    c.target.copy(c.flightCharacter.position).add(new T.Vector3(0, 0.55, 0)); c.applyOrbit();
  };
  const towards = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  const roofAt = (x, z) => window.__twWalls ? window.__twWalls.roofAt(x, z) : -Infinity;

  let companion = null;
  const companionOn = () => {
    if (companion) return;
    const body = c.gullPose.clone(true); body.visible = true; body.scale.setScalar(0.95); body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
    const mats = { white: c.createSolidMaterial('gull-white', '#e9c46a'), head: c.createSolidMaterial('gull-white', '#e9c46a'),
      gray: c.createSolidMaterial('gull-gray', '#c6583c'), ink: c.createSolidMaterial('gull-ink', '#34262f'), beak: c.createSolidMaterial('gull-beak', '#d3a34f') };
    body.traverse(m => { if (m.isMesh && m.userData.twSlot) m.material = mats[m.userData.twSlot] || m.material; });
    const root = new T.Group(); root.add(body); c.scene.add(root);
    const names = [['Left shoulder', 'Left wrist and primaries'], ['Right shoulder', 'Right wrist and primaries']];
    const wings = names.map(([p, t]) => ({ pivot: body.getObjectByName(p), tip: body.getObjectByName(t) }));
    const label = document.createElement('div'); label.id = 'trailer-companion'; label.textContent = '@ada_builds'; document.body.appendChild(label);
    companion = { root, body, wings, label, v: new T.Vector3() };
    window.__sfNet = { players: [{ id: 'ada', name: 'ada_builds', handle: 'ada_builds', self: false, connected: true, position: root.position, metres: 9 }], count: 2, state: 'room', flyBeside() {} };
  };
  const companionOff = () => {
    if (!companion) return;
    c.scene.remove(companion.root); companion.label.remove(); companion = null; window.__sfNet = null;
    document.getElementById('tw-neighbour')?.remove();
  };
  const companionFollow = (t) => {
    if (!companion) return;
    const h = c.flightCharacter.rotation.y, P = c.flightCharacter.position;
    // A little ahead and to the right, where the chase camera can see it.
    const side = 6 + Math.sin(t * 0.9) * 0.6, ahead = 8 + Math.sin(t * 0.6) * 1.5, up = 0.6 + Math.sin(t * 1.3) * 0.5;
    companion.root.position.set(P.x + Math.cos(h) * side + Math.sin(h) * ahead, P.y + up, P.z - Math.sin(h) * side + Math.cos(h) * ahead);
    companion.root.rotation.set(0, h, 0);
    companion.body.rotation.copy(c.flightPose.rotation);
    c.gullWings.forEach((w, i) => { const mine = companion.wings[i]; if (!mine?.pivot) return; mine.pivot.rotation.copy(w.pivot.rotation); mine.tip?.rotation.copy(w.tip.rotation); });
    const v = companion.v.copy(companion.root.position); v.y += 1.6; v.project(c.camera);
    const on = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
    companion.label.style.display = on ? '' : 'none';
    if (on) { companion.label.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; companion.label.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`; }
  };

  // A street canyon downtown for the beak-cam dive: open along the heading,
  // tall on both sides.
  const findCanyon = () => {
    const F = GEO.Hn(-122.4005, 37.7915, 0);
    let best = null;
    for (let dx = -360; dx <= 360; dx += 12) for (let dz = -360; dz <= 360; dz += 12) {
      const x = F.x + dx, z = F.z + dz;
      if (Number.isFinite(roofAt(x, z))) continue;
      for (let k = 0; k < 8; k++) {
        const h = k * Math.PI / 4, fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
        let open = true, tall = 0, n = 0;
        for (let d = 0; d <= 280 && open; d += 10) {
          const px = x + fx * d, pz = z + fz * d;
          if (Number.isFinite(roofAt(px, pz))) open = false;
          for (const s of [-24, 24]) { n++; const r = roofAt(px + rx * s, pz + rz * s); if (r > 45) tall++; }
        }
        if (!open) continue;
        const score = tall / n;
        if (!best || score > best.score) best = { x, z, h, score };
      }
    }
    return best;
  };

  const setups = {
    vantage() {
      const ev = featured(); const A = ev.ship?.position || ev.world;
      const E = GEO.Hn(-122.3977, 37.7993, 0);                     // Embarcadero, so downtown stands behind the ship
      const d = new T.Vector3(E.x - A.x, 0, E.z - A.z).normalize();
      const v = { x: A.x + d.x * 560, z: A.z + d.z * 560 };
      const under = roofAt(v.x, v.z);
      place(v.x, Math.max(A.y + 30, Number.isFinite(under) ? under + 40 : 0, 120), v.z, towards(v, A));
    },
    flyToFeatured() {
      const ev = featured(); const A = ev.ship?.position || ev.world;
      const P = c.flightCharacter.position;
      const d = new T.Vector3(P.x - A.x, 0, P.z - A.z); if (d.length() < 1) d.set(1, 0, 0); d.normalize();
      const v = { x: A.x + d.x * 430, z: A.z + d.z * 430 };
      const under = roofAt(v.x, v.z);
      place(v.x, Math.max(A.y + 20, Number.isFinite(under) ? under + 40 : 0, 110), v.z, towards(v, A));
      TW.flyTo(ev);
    },
    posterWall() {
      const signs = window.__twSigns; let pick = null;
      for (const ev of TW.state.events) {
        if (!signs?.anchorPoint?.(ev)) continue;              // a poster that is actually up (covers only load online)
        const vp = signs.visitPoint(ev); if (!vp) continue;
        const score = ev.rsvp || 0;
        if (!pick || score > pick.score) pick = { ev, vp, score };
      }
      if (pick) {
        const { vp } = pick, back = 52;
        const x = vp.x - Math.sin(vp.face) * back, z = vp.z - Math.cos(vp.face) * back;
        const under = roofAt(x, z);
        place(x, Math.max(vp.y + 4, Number.isFinite(under) ? under + 10 : 0), z, vp.face);
        TW.select(pick.ev, { look: false });
        return;
      }
      // Offline no cover arrives and no facade panel goes up: glide at the
      // host's hoarding instead, the big poster on its plinth near the event.
      const board = c.scene.getObjectByName('Host hoarding');
      if (!board || !board.children.length) { setups.vantage(); return; }
      const face = board.rotation.y, dist = 150;
      const x = board.position.x + Math.sin(face) * dist, z = board.position.z + Math.cos(face) * dist;
      const under = roofAt(x, z), boardY = board.children[0].position.y || 31;
      place(x, Math.max(boardY + 2, Number.isFinite(under) ? under + 12 : 0), z, face + Math.PI);
      TW.select(featured(), { look: false });
    },
    friends() {
      const ev = featured(); const A = ev.ship?.position || ev.world;
      const N = GEO.Hn(-122.4103, 37.8060, 0);                     // North Beach: fly from the ship towards the bay side of the hills
      const d = new T.Vector3(N.x - A.x, 0, N.z - A.z).normalize();
      const v = { x: A.x + d.x * 260, z: A.z + d.z * 260 };
      const h = Math.atan2(d.x, d.z);
      const under = roofAt(v.x, v.z);
      place(v.x, Math.max(A.y + 10, Number.isFinite(under) ? under + 35 : 0, 130), v.z, h);
      companionOn();
    },
    canyon() {
      const best = findCanyon();
      if (!best) { setups.vantage(); return; }
      place(best.x, 34, best.z, best.h);
      c.pitch = 0.05;
    },
    cruise() {
      TW.nav.startTour(0);
      const tgt = TW.nav.target; if (!tgt) return;
      const P = c.flightCharacter.position;
      const d = new T.Vector3(P.x - tgt.x, 0, P.z - tgt.z); if (d.length() < 1) d.set(0, 0, 1); d.normalize();
      const v = { x: tgt.x + d.x * 480, z: tgt.z + d.z * 480 };
      const under = roofAt(v.x, v.z);
      const ev = TW.nav.ev;
      c.flightCharacter.position.set(v.x, Math.max(tgt.y + 50, Number.isFinite(under) ? under + 40 : 0), v.z);
      c.flightCharacter.rotation.set(0, towards(v, tgt), 0); c.flightVelocity.set(0, 0, 0); c.gullSpeed = 0;
      c.yaw = c.flightCharacter.rotation.y + Math.PI; c.pitch = 0.14; c.radius = 13;
      c.target.copy(c.flightCharacter.position).add(new T.Vector3(0, 0.55, 0)); c.applyOrbit();
      if (ev) TW.nav.start(ev);
    },
  };

  const setText = (el, sel, text) => { const n = el.querySelector(sel); n.textContent = text || ''; n.style.display = text ? '' : 'none'; };
  window.__trailer = {
    setup(name) { setups[name]?.(); },
    frame(f) {
      const html = document.documentElement;
      html.classList.toggle('trailer-card', !!f.show?.includes('card'));
      html.classList.toggle('trailer-nav', !!f.show?.includes('nav'));
      html.classList.toggle('trailer-neighbour', !!f.show?.includes('neighbour'));
      if (f.view && TW.state.view !== f.view) TW.setView(f.view);
      if (f.companion) companionOn(); else companionOff();
      c.clearFlightInput(); for (const k of Object.keys(f.inputs || {})) c.setFlightInput(k, !!f.inputs[k]);
      light(f.mix);
      const n = Math.max(1, Math.ceil(f.dt / 0.04));   // the engine clamps one step at 50 ms
      for (let i = 0; i < n; i++) stepSim(f.dt / n);
      companionFollow(f.t);
      if (f.caption) { setText(caption, '.k', f.caption.k); setText(caption, '.t', f.caption.t); setText(caption, '.s', f.caption.s); caption.classList.toggle('right', f.captionSide === 'right'); }
      caption.style.opacity = f.caption ? f.captionOpacity : 0;
      if (f.overlay) { setText(overlay, 'h1', f.overlay.h1); setText(overlay, '.k', f.overlay.k); setText(overlay, '.u', f.overlay.u); setText(overlay, '.s', f.overlay.s); }
      overlay.style.opacity = f.overlay ? f.overlayOpacity : 0;
      c.render();
      return { x: Math.round(c.flightCharacter.position.x), y: Math.round(c.flightCharacter.position.y), z: Math.round(c.flightCharacter.position.z), view: TW.state.view, nav: TW.nav.phase, radius: c.radius, cam: Math.round(c.camera.position.distanceTo(c.flightCharacter.position)) };
    },
  };
  return { events: TW.state.events.length, signs: window.__twSigns?.count() || 0, walls: window.__twWalls?.count || 0 };
}

/* ------------------------------------------------------------- helpers */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
function serve(dir, port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.join(dir, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    try {
      if (!file.startsWith(dir)) throw new Error('outside');
      const info = await stat(file); if (!info.isFile()) throw new Error('dir');
      res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

async function loadPlaywright() {
  for (const spec of [args.playwright, process.env.TRAILER_PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(spec.startsWith('/') ? pathToFileURL(spec).href : spec); } catch {}
  }
  throw new Error('Playwright not found: npm i -g playwright && npx playwright install chromium, or pass --playwright <path to playwright/index.mjs>');
}
function findFfmpeg() {
  const candidates = [args.ffmpeg, process.env.FFMPEG, 'ffmpeg'];
  try { candidates.push(execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim()); } catch {}
  for (const bin of candidates.filter(Boolean)) { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return bin; } catch {} }
  throw new Error('ffmpeg with libx264 not found: pass --ffmpeg <path> or `pip install imageio-ffmpeg`');
}
const smooth = (t, edge = 0.5) => Math.max(0, Math.min(1, t / edge));

/* ----------------------------------------------------------------- main */
async function main() {
  const shots = SHOTS.filter(s => !ONLY || ONLY.includes(s.id));
  if (!shots.length) throw new Error('no shots selected');
  // Frames, with a cut wherever a shot has its own setup.
  let frameNo = 0; const total = shots.reduce((n, s) => n + Math.round(s.seconds * FPS), 0);
  const sequences = []; let seq = null, tGlobal = 0;
  for (const shot of shots) {
    if (shot.setup || !seq) { seq = { setup: shot.setup, frames: [] }; sequences.push(seq); }
    const n = Math.round(shot.seconds * FPS);
    for (let i = 0; i < n; i++) {
      const t = i / FPS, edgeIn = smooth(t), edgeOut = smooth(shot.seconds - t);
      seq.frames.push({ index: frameNo++, id: shot.id, t, dt: 1 / FPS, inputs: shot.inputs, show: shot.show, view: shot.view, companion: !!shot.companion,
        caption: shot.caption, captionSide: shot.captionSide, captionOpacity: Math.min(edgeIn, edgeOut),
        overlay: shot.overlay, overlayOpacity: shot.id === 'end' ? smooth(t, 0.8) : Math.min(smooth(t, 0.6), smooth(shot.seconds - t, 0.6)),
        mix: 0.15 + 0.85 * (tGlobal + t) / (total / FPS) });
    }
    tGlobal += shot.seconds;
  }
  // Sequences are independent, so they are dealt across workers by length.
  const buckets = Array.from({ length: Math.min(WORKERS, sequences.length) }, () => ({ frames: 0, sequences: [] }));
  for (const s of [...sequences].sort((a, b) => b.frames.length - a.frames.length)) { const b = buckets.sort((x, y) => x.frames - y.frames)[0]; b.sequences.push(s); b.frames += s.frames.length; }
  console.log(`trailer: ${shots.length} shots, ${total} frames at ${WIDTH}x${HEIGHT} ${FPS} fps, ${buckets.length} worker(s)`);

  const ffmpeg = findFfmpeg();
  const { chromium } = await loadPlaywright();
  await rm(FRAMES, { recursive: true, force: true }); await mkdir(FRAMES, { recursive: true }); await mkdir(path.dirname(OUT), { recursive: true });
  const server = await serve(DIR, PORT);
  const launch = () => chromium.launch({ executablePath: process.env.TRAILER_CHROMIUM || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const started = Date.now(); let done = 0;

  const worker = async (bucket, w) => {
    const browser = await launch();   // its own process: two workers in one browser queue on the same renderer
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      try { localStorage.setItem('sf-ink-guide', '1'); localStorage.setItem('sf-ink-bird', JSON.stringify({ bird: 'parrot', name: 'you' })); } catch {}
      // The streamed geometry says when the last tile is in; the wall index and the signage follow it.
      window.addEventListener('sf-city-geometry-updated', e => { window.__trailerGeometryComplete = !!e.detail?.complete; });
    });
    const page = await context.newPage();
    page.on('pageerror', e => console.error(`[w${w}] page error:`, e.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.TW?.state?.ready && window.__twWalls && window.__sfCity?.freeFlightEnabled, null, { timeout: 240000 });
    // The full programme, the last geometry tile, the wall index built from it
    // and the signage planned on it all arrive after the city is ready.
    await page.waitForFunction(() => window.TW.state.events.length > 60, null, { timeout: 120000 }).catch(() => {});
    await page.waitForFunction(() => window.__trailerGeometryComplete === true, null, { timeout: 180000 }).catch(() => console.warn(`[w${w}] geometry streaming did not report completion; continuing`));
    let last = ''; for (let i = 0; i < 120; i++) {
      const now = await page.evaluate(() => `${window.__twWalls?.count || 0}/${window.__twSigns?.count() || 0}`);
      if (!now.startsWith('0/') && !now.endsWith('/0') && now === last) break;
      last = now; await page.waitForTimeout(1000);
    }
    const info = await page.evaluate(installTrailer, { bird: 'parrot' });
    console.log(`[w${w}] city ready: ${info.events} events, ${info.signs} signed venues, ${info.walls} walls`);
    for (const s of bucket.sequences) {
      if (s.setup) await page.evaluate(name => window.__trailer.setup(name), s.setup);
      for (const f of s.frames) {
        const t0 = Date.now();
        const state = await page.evaluate(f => window.__trailer.frame(f), f);
        const t1 = Date.now();
        await page.screenshot({ type: 'jpeg', quality: 92, path: path.join(FRAMES, `f${String(f.index).padStart(5, '0')}.jpg`) });
        if (process.env.TRAILER_DEBUG) console.log(`[w${w}] f${f.index} ${f.id} step ${t1 - t0} ms, shot ${Date.now() - t1} ms`, JSON.stringify(state));
        done++;
        if (done % 24 === 0 || done === total) {
          const elapsed = (Date.now() - started) / 1000, eta = elapsed / done * (total - done);
          console.log(`frame ${done}/${total} (${f.id}) · ${elapsed.toFixed(0)} s elapsed · ~${eta.toFixed(0)} s left`);
        }
      }
    }
    await context.close(); await browser.close();
  };
  await Promise.all(buckets.map(worker));
  server.close();

  console.log('encoding', OUT);
  await new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.jpg'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS), OUT], { stdio: 'inherit' });
    p.on('exit', code => code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code)));
  });
  const poster = path.join(path.dirname(OUT), 'poster.jpg');
  await writeFile(poster, await readFile(path.join(FRAMES, `f${String(Math.min(total - 1, Math.round(FPS * 6))).padStart(5, '0')}.jpg`)));
  if (!args['keep-frames']) await rm(FRAMES, { recursive: true, force: true });
  console.log(`done: ${OUT} (${((await stat(OUT)).size / 1e6).toFixed(1)} MB), poster ${poster}, ${((Date.now() - started) / 60000).toFixed(1)} min`);
}

main().catch(error => { console.error(error); process.exit(1); });
