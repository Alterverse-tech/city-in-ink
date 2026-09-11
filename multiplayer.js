import { createChronaConnect } from './chrona/chrona-connect.js';
import { mountChronaUI } from './chrona/chrona-connect-ui.js';
import { encodePose, decodePose, INPUT_STEP } from './network-pose.js';
import { PUBLIC_WORLD } from './public-world.js';

// Imported before the original game bundle executes, including OAuth returns.
// Explicit hosting handshake; standalone starts exactly the original account flow.
if (window.__SF_HOST_READY__) await window.__SF_HOST_READY__;
const hosted = !!window.__SF_HOST_CLIENT__;
const chrona = window.__SF_HOST_CLIENT__ || createChronaConnect({ storageNamespace: 'sf-tech-week-ink' });
const readSaved = (storage, key) => { try { return JSON.parse(storage.getItem(key)); } catch { return null; } };
const save = (storage, key, value) => { try { value == null ? storage.removeItem(key) : storage.setItem(key, JSON.stringify(value)); } catch {} };
// Old invitations must not route a player back into a private room.
save(sessionStorage, 'sf-ink-room-intent', null);
const pageURL = new URL(location.href);
if (pageURL.searchParams.has('room')) {
  pageURL.searchParams.delete('room');
  history.replaceState(history.state, '', pageURL);
}
let c, T, tw, presence, connecting = false, disposed = false, errorText = '', authState;
let attemptedUserId = '';
let room = { state: 'offline', roomCode: null, players: [], count: 0, ping: 0 };
let lastSnapshot = 0, lastRoster = '', lastName = '', accumulator = 0, stale = false;
const REMOTE_STALE_MS = 8000;
const connectionActivity = new Map(), representativeIds = new Map();
let lastAuthorityMarker = null;
const remotes = new Map();
const colors = ['#c6583c', '#3f7f8c', '#6b5b95', '#4e8a5a', '#b58026', '#c46a8a'];
const colorFor = id => colors[[...String(id)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 0) % colors.length];

const panel = document.createElement('details');
panel.id = 'sfnet';
panel.open = false;
panel.innerHTML = `<summary><span id="sfnet-summary">Public World · Fly together</span></summary>
  <div class="sfnet-body"><h2>Share the sky.</h2>
    <p id="sfnet-status" role="status">Sign in to automatically join the public World.</p>
    <div id="sfnet-account"></div>
    <div id="sfnet-lobby"><div class="sfnet-row"><button class="sfnet-primary" id="sfnet-enter" type="button">Sign in &amp; enter World</button></div></div>
    <div id="sfnet-connected" hidden><div id="sfnet-world-name"></div>
      <div class="sfnet-row"><button id="sfnet-invite" type="button">Copy game link</button></div>
      <label id="sfnet-invite-label" hidden>Game link<input id="sfnet-link" readonly></label>
      <ul id="sfnet-roster" aria-label="Players in the public World"></ul>
      <button id="sfnet-rendezvous" type="button" hidden>Fly beside another player</button></div>
    <p id="sfnet-error" role="alert" hidden></p>
    <button id="sfnet-retry" type="button" hidden>Reconnect to World</button>
    <p class="sfnet-note">One public World · No total player cap.<br>A new shard opens after 500 players. Players see others in their shard.<br>Event RSVPs, claims and venue edits remain local.</p>
  </div>`;
document.body.append(panel);
const $ = id => document.getElementById(`sfnet-${id}`);
$('world-name').textContent = PUBLIC_WORLD.name;
const accountUI = hosted ? { root: document.createElement('div'), open() {}, close() {} } : mountChronaUI(chrona, { container: $('account'), floating: false,
  title: 'Your flight account', signedOutText: 'Sign in and automatically join everyone in the public World.' });
if (hosted) $('account').textContent = 'Signed in through Chrona · Manage your account in the platform.';
// Game-specific layout only; the copied Chrona runtime remains unchanged.
const accountLayout = document.createElement('style');
accountLayout.textContent = `
  .scrim { align-items: start; padding: 48px 18px 24px; }
  .panel { max-height: min(720px, calc(100vh - 72px)); max-height: min(720px, calc(100dvh - 72px)); }
`;
accountUI.root.append(accountLayout);
for (const type of ['keydown', 'keyup']) panel.addEventListener(type, event => event.stopPropagation());
panel.addEventListener('pointerdown', () => c?.clearFlightInput());
panel.addEventListener('focusin', () => c?.clearFlightInput());

function setError(message) { errorText = message || ''; renderUI(); }
function gameURL() { return new URL(location.pathname, location.origin).href; }
function renderUI() {
  const online = room.state === 'room';
  const busy = connecting || room.state === 'connecting';
  panel.dataset.online = String(online && !stale);
  const visiblePlayers = connectedPlayers();
  $('summary').textContent = online ? `Public World · ${visiblePlayers.length} flying${stale ? ' · reconnecting' : ''}` : busy ? 'Entering the public World…' : 'Public World · Fly together';
  $('status').textContent = busy ? 'Joining everyone in the public World…' : stale ? 'Connection interrupted. Waiting for the server; you can also reconnect below.'
    : online ? `${visiblePlayers.length} players in this shard · ${room.ping || '—'} ms · World has no total player cap.`
    : authState?.userId ? 'Enter the public World to fly with everyone.' : 'Sign in to automatically join the public World. Solo flight is always available.';
  $('lobby').hidden = online;
  $('connected').hidden = !online;
  for (const button of panel.querySelectorAll('#sfnet-lobby button')) button.disabled = busy;
  $('enter').textContent = authState?.userId ? (busy ? 'Entering World…' : 'Enter public World') : 'Sign in & enter World';
  $('retry').hidden = !stale || !online;
  $('retry').disabled = busy;
  $('error').hidden = !errorText;
  $('error').textContent = errorText;
  const roster = JSON.stringify(visiblePlayers.map(p => [p.id, p.name, p.self]));
  if (roster !== lastRoster) {
    lastRoster = roster;
    $('roster').replaceChildren(...visiblePlayers.map(player => {
      const li = document.createElement('li'), dot = document.createElement('i'), name = document.createElement('span'), suffix = document.createElement('small');
      dot.style.background = colorFor(player.id);
      name.textContent = player.name || 'Player';
      suffix.textContent = player.self ? 'you' : 'in this shard';
      li.append(dot, name, suffix); return li;
    }));
  }
  $('rendezvous').hidden = !visiblePlayers.some(p => !p.self);
}

const gameReady = new Promise(resolve => {
  let checks = 0;
  const check = () => {
    if (disposed) return;
    if (window.TW?.state.ready && window.__sfCity?.gullPose && window.__SF_THREE) {
      c = window.__sfCity; T = window.__SF_THREE; tw = window.TW;
      attachScene(); resolve(true);
    } else if (++checks < 1200) setTimeout(check, 100);
    else { setError('The city did not finish loading. Reload to retry.'); resolve(false); }
  };
  check();
});

function applyAccountName() {
  if (!tw || !authState?.userId || !authState.initialized) return;
  const name = authState.profile.displayName;
  if (lastName === name) return;
  lastName = name; tw.state.user.name = name;
  tw.applyBird(tw.state.user.bird); // also refreshes the original name chip
  const field = document.getElementById('tw-m-name');
  if (field && !field.value) field.value = name;
}

async function ensureFlight() {
  if (!c.freeFlightEnabled) {
    if (c.flightAvatar !== 'gull') c.setFlightAvatar('gull');
    const launch = document.querySelector('.gull-launch, .flight-launch');
    if (launch) launch.click(); else c.setFlightMode(true);
    for (let tries = 0; !c.freeFlightEnabled && tries < 40; tries++) await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!c.freeFlightEnabled) throw new Error('Enter flight mode, then try joining again.');
}

async function connect() {
  if (connecting) return;
  setError('');
  if (!chrona.auth.userId) {
    if (tw) save(localStorage, 'sf-ink-bird', { bird: tw.state.user.bird, name: tw.state.user.name });
    accountUI.open(); return;
  }
  attemptedUserId = chrona.auth.userId;
  const joiningUserId = attemptedUserId;
  connecting = true; renderUI();
  try {
    if (!await gameReady || disposed) return;
    if (chrona.auth.userId !== joiningUserId) return;
    const worlds = await chrona.worlds({ livemode: PUBLIC_WORLD.livemode });
    const world = hosted ? worlds[0] : worlds.find(entry => entry.id === PUBLIC_WORLD.id);
    if (!world || (!hosted && world.visibility !== 'public') || world.gameId !== PUBLIC_WORLD.gameId) {
      throw new Error('The public World is unavailable. Please try again later.');
    }
    if (disposed || chrona.auth.userId !== joiningUserId) return;
    if (!presence) {
      presence = await chrona.presence({ gameId: world.gameId, worldId: world.id,
        livemode: world.livemode ?? PUBLIC_WORLD.livemode, snapDistance: 2, interpolationDelayMs: 250 });
      presence.subscribe(receiveRoom);
      presence.on('snapshot', noteSnapshot);
      presence.on('error', event => setError(event.message || 'The connection failed. Try joining again.'));
      presence.on('session-replaced', () => { panel.open = true; setError('This account joined elsewhere. Use a different account for the second player.'); });
    }
    await ensureFlight();
    await presence.enterWorld();
    $('link').value = gameURL();
    lastSnapshot = performance.now(); stale = false; errorText = '';
    accountUI.close();
    tw.toast(`${PUBLIC_WORLD.name} · You are flying in the public World.`);
  } catch (error) {
    panel.open = true;
    setError(error.message || 'Unable to enter the public World. Please try again.');
  } finally { connecting = false; renderUI(); }
}

$('enter').addEventListener('click', () => void connect());
$('retry').addEventListener('click', () => void connect());
$('invite').addEventListener('click', async () => {
  const url = gameURL(); $('link').value = url;
  try { await navigator.clipboard.writeText(url); tw?.toast('Game link copied. Your friend signs in and automatically joins the public World.'); }
  catch { $('invite-label').hidden = false; $('link').focus(); $('link').select(); }
});
async function flyBeside(playerId) {
  const candidates = connectedPlayers().filter(p => !p.self && p.lastProcessedInput > 0 && decodePose(presence?.sample(p.id)));
  const target = (playerId && candidates.find(p => p.id === playerId)) || candidates[0];
  const pose = target && decodePose(presence.sample(target.id));
  if (!pose) return setError('Waiting for another player’s first position.');
  try { await ensureFlight(); } catch (error) { setError(error.message); return; }
  tw.nav.stop(true);
  const old = c.flightCharacter.position.clone();
  c.flightCharacter.position.set(pose.position.x + Math.cos(pose.yaw) * 8, pose.position.y + 3, pose.position.z - Math.sin(pose.yaw) * 8);
  c.target.add(c.flightCharacter.position.clone().sub(old));
  c.flightCharacter.rotation.y = pose.yaw; c.yaw = pose.yaw + Math.PI;
  c.flightVelocity.set(Math.sin(pose.yaw) * 22, 0, Math.cos(pose.yaw) * 22);
  c.applyOrbit(); panel.open = false; c.focusScene(); setError('');
  tw.toast(`Flying beside ${target.name || 'a player'}.`);
}
$('rendezvous').addEventListener('click', () => void flyBeside());

const unsubscribeAuth = chrona.auth.subscribe(next => {
  const previousUserId = authState?.userId;
  const changed = previousUserId !== next.userId;
  // A World lease is tied to its account. Reinitialize on logout/account switch
  // so a new account can never reuse the previous account's seat.
  if (next.initialized && previousUserId && changed) {
    disposed = true; clearRemotes(); publishRoster(); chrona.destroy(); location.reload(); return;
  }
  authState = next; applyAccountName(); renderUI();
  if (next.initialized && next.userId && next.userId !== attemptedUserId && !connecting) {
    queueMicrotask(() => { if (!disposed && chrona.auth.userId && chrona.auth.userId !== attemptedUserId && !connecting) void connect(); });
  }
  if (changed && !next.userId && next.initialized) { lastName = ''; clearRemotes(); publishRoster(); }
});

let labels, originalSimulation, originalRender, simulationWrapper, renderWrapper;
function makeRemote(player) {
  const root = new T.Group(); root.name = `Online bird ${player.id}`;
  const body = c.gullPose.clone(true); body.visible = true; body.scale.setScalar(1); body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
  // The shared protocol has no species field. Every remote is the same original
  // gull model; names and coloured tags identify players, independent of local skins.
  const materials = {
    white: c.createSolidMaterial('gull-white', '#f4edda'), head: c.createSolidMaterial('gull-white', '#f4edda'),
    gray: c.createSolidMaterial('gull-gray', '#9babb5'), ink: c.createSolidMaterial('gull-ink', '#443944'), beak: c.createSolidMaterial('gull-beak', '#d3a34f'),
  };
  body.traverse(mesh => {
    if (mesh.isMesh && mesh.userData.twSlot) mesh.material = materials[mesh.userData.twSlot] || mesh.material;
    if (mesh.userData.twBill) mesh.scale.z = 1;
  });
  root.add(body); c.scene.add(root); root.visible = false;
  const label = document.createElement('div'); label.className = 'sfnet-player-label'; label.hidden = true;
  label.style.setProperty('--player-color', colorFor(player.id)); labels.append(label);
  const wings = [-1, 1].map(side => ({ side, pivot: body.getObjectByName(side < 0 ? 'Left shoulder' : 'Right shoulder'), tip: body.getObjectByName(side < 0 ? 'Left wrist and primaries' : 'Right wrist and primaries') }));
  const remote = { root, body, label, wings, previousYaw: null, turn: 0, position: new T.Vector3(), projection: new T.Vector3() };
  remotes.set(player.id, remote); return remote;
}
function removeRemote(id) {
  const remote = remotes.get(id); if (!remote) return;
  // Clone meshes share geometry and palette materials with the local bird.
  remote.root.removeFromParent(); remote.label.remove(); remotes.delete(id);
}
function clearRemotes() { for (const id of remotes.keys()) removeRemote(id); }

function recordConnectionActivity(players) {
  const active = new Set(), now = performance.now();
  for (const player of players || []) {
    if (!player || player.connected !== true) continue;
    active.add(player.id);
    const previous = connectionActivity.get(player.id);
    const sequence = Number.isFinite(player.lastProcessedInput) ? player.lastProcessedInput : null;
    if (!previous || (sequence !== null && sequence !== previous.sequence)) {
      connectionActivity.set(player.id, { sequence, advancedAt: now, firstSeenAt: previous?.firstSeenAt ?? now });
    }
  }
  for (const id of connectionActivity.keys()) if (!active.has(id)) connectionActivity.delete(id);
}

function connectedPlayers() {
  if (disposed || stale || room.state !== 'room') return [];
  const now = performance.now();
  return distinctPlayers((room.players || []).filter(player => {
    if (!player || player.connected !== true) return false;
    const activity = connectionActivity.get(player.id);
    // Flight sends inputs while hovering too. A frozen input sequence is a
    // stalled connection; an unmoving position alone is never an offline signal.
    return player.self || !activity || activity.sequence === null || now - activity.advancedAt <= REMOTE_STALE_MS;
  }));
}

function pruneRemotes() {
  const active = new Set(connectedPlayers().filter(player => !player.self).map(player => player.id));
  for (const id of remotes.keys()) if (!active.has(id)) removeRemote(id);
}

function receiveRoom(next) {
  room = next;
  if (next.state !== 'room') {
    stale = false; accumulator = 0; lastAuthorityMarker = null;
    connectionActivity.clear(); representativeIds.clear(); clearRemotes();
  } else {
    recordConnectionActivity(next.players);
    pruneRemotes();
  }
  // A hidden tab can stop rendering. Departures must remove both 3D objects and
  // the add-on's cached positions as soon as the presence notification arrives.
  publishRoster(); renderUI();
}

function noteSnapshot(event) {
  const next = presence?.snapshot?.() || { ...room, ...event };
  if (next.state !== 'room') { receiveRoom(next); return; }
  const stamp = next.serverTimeMs !== undefined ? next.serverTimeMs : event?.serverTimeMs;
  // Older hosts lack the authority stamp. Input sequence changes are a safe
  // fallback heartbeat; replaying the same cached frame must not refresh it.
  const marker = Number.isFinite(stamp) ? `server:${stamp}` : stamp === null ? null
    : JSON.stringify((next.players || []).map(player => [player.id, player.connected, player.lastProcessedInput]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  if (marker !== null && marker !== lastAuthorityMarker) {
    lastAuthorityMarker = marker; lastSnapshot = performance.now(); stale = false;
  }
  receiveRoom(next);
}

function updateRemotes(dt, time) {
  const active = new Set();
  for (const player of connectedPlayers()) {
    if (player.self) continue;
    active.add(player.id);
    const pose = player.lastProcessedInput > 0 && decodePose(presence.sample(player.id));
    let remote = remotes.get(player.id);
    if (!pose) { if (remote) { remote.root.visible = false; remote.label.hidden = true; } continue; }
    remote ||= makeRemote(player);
    remote.root.visible = true; remote.position.copy(pose.position); remote.root.position.copy(remote.position); remote.root.rotation.y = pose.yaw;
    const speed = Math.hypot(pose.velocity.x, pose.velocity.z);
    const turn = remote.previousYaw == null ? 0 : Math.atan2(Math.sin(pose.yaw - remote.previousYaw), Math.cos(pose.yaw - remote.previousYaw)) / Math.max(dt, 0.001);
    remote.previousYaw = pose.yaw;
    remote.turn += (Math.max(-0.52, Math.min(0.52, -turn * 0.48)) - remote.turn) * Math.min(1, dt * 6);
    remote.body.rotation.set(-Math.atan2(pose.velocity.y, Math.max(12, speed)), 0, remote.turn, 'YXZ');
    const phase = time * (speed > 55 ? 13.5 : 8), amplitude = speed < 2 ? 0.035 : 0.42;
    for (const wing of remote.wings) {
      if (wing.pivot) wing.pivot.rotation.z = wing.side * (0.1 + Math.sin(phase) * amplitude);
      if (wing.tip) wing.tip.rotation.z = wing.side * (0.1 + Math.sin(phase - 0.65) * amplitude * 0.52);
    }
    const metres = c.flightCharacter.position.distanceTo(remote.position);
    const handle = (player.handle || '').replace(/^@+/, '');
    remote.label.textContent = `${handle ? '@' + handle : (player.name || 'Player')} · ${metres > 1000 ? (metres / 1000).toFixed(1) + ' km' : Math.round(metres) + ' m'}`;
  }
  for (const id of remotes.keys()) if (!active.has(id)) removeRemote(id);
  publishRoster();
}
// A read-only view of who is flying and where, for the add-on layer
// (city-extras.mjs draws the "fly beside someone" card from it). Names come
// from the account profile; nothing here is written back to the network.
// One account flying from two tabs is one person, not two: presence gives each
// connection its own entry, which showed the same name three times over and
// inflated the "N flying" count. Collapse by account, keeping your own entry.
function distinctPlayers(list) {
  const byAccount = new Map();
  for (const player of list) {
    const account = String(player.userId || player.accountId || '').trim();
    const name = String(player.handle || player.name || '').normalize('NFC').trim();
    const key = account ? `account:${account}` : name ? `name:${name}` : player.id ? `connection:${player.id}` : player;
    const held = byAccount.get(key);
    // A newly observed session may replace an older one, but alternating input
    // acknowledgements from two live tabs must not recreate the visible bird.
    const time = connectionActivity.get(player.id)?.firstSeenAt ?? 0;
    const heldTime = connectionActivity.get(held?.id)?.firstSeenAt ?? 0;
    if (!held || (player.self && !held.self) || (!held.self && !player.self &&
      (time > heldTime || (time === heldTime && representativeIds.get(key) === player.id)))) byAccount.set(key, player);
  }
  for (const key of representativeIds.keys()) if (!byAccount.has(key)) representativeIds.delete(key);
  for (const [key, player] of byAccount) representativeIds.set(key, player.id);
  return [...byAccount.values()];
}
function publishRoster() {
  const players = connectedPlayers();
  window.__sfNet = {
    players: players.map(player => {
      const remote = remotes.get(player.id);
      return {
        id: player.id, name: player.name || '', handle: player.handle || player.name || '',
        self: !!player.self, connected: !!player.connected, color: colorFor(player.id),
        position: player.self ? c?.flightCharacter?.position : (remote && remote.root.visible ? remote.position : null),
        metres: (!player.self && remote && remote.root.visible && c?.flightCharacter) ? Math.round(remote.position.distanceTo(c.flightCharacter.position)) : null,
      };
    }),
    count: players.length, state: stale ? 'reconnecting' : room.state,
    flyBeside,
  };
}
function updateLabels() {
  const width = c.renderer.domElement.clientWidth, height = c.renderer.domElement.clientHeight;
  for (const remote of remotes.values()) {
    const p = remote.projection.copy(remote.position); p.y += 2.8; p.project(c.camera);
    remote.label.hidden = !remote.root.visible || c.labelsVisible === false || p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
    if (!remote.label.hidden) remote.label.style.transform = `translate(${(p.x * 0.5 + 0.5) * width}px,${(-p.y * 0.5 + 0.5) * height}px) translate(-50%,-100%)`;
  }
}
function attachScene() {
  labels = document.createElement('div'); labels.className = 'sfnet-labels'; c.host.append(labels);
  const saved = readSaved(localStorage, 'sf-ink-bird');
  if (saved?.bird && tw.BIRDS[saved.bird]) tw.applyBird(saved.bird);
  if (saved?.name && !authState?.userId) tw.state.user.name = String(saved.name).slice(0, 28);
  applyAccountName();
  originalSimulation = c.updateSimulation;
  simulationWrapper = function (dt) {
    originalSimulation.call(c, dt);
    if (!presence || room.state !== 'room') { accumulator = 0; return; }
    accumulator += Math.min(Math.max(dt, 0), 0.1);
    while (accumulator >= INPUT_STEP) {
      accumulator -= INPUT_STEP;
      presence.sendInput(encodePose(c.flightCharacter.position, c.flightCharacter.rotation.y, c.freeFlightEnabled));
    }
  };
  c.updateSimulation = simulationWrapper;
  originalRender = c.render;
  let lastTime = performance.now();
  renderWrapper = function () {
    const now = performance.now(), dt = Math.min(0.1, (now - lastTime) / 1000); lastTime = now;
    if (presence && room.state === 'room') updateRemotes(dt, now / 1000);
    originalRender.call(c); updateLabels();
  };
  c.render = renderWrapper;
}
const statusTimer = setInterval(() => {
  stale = room.state === 'room' && performance.now() - lastSnapshot > REMOTE_STALE_MS;
  pruneRemotes(); publishRoster(); renderUI();
}, 1000);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true; clearInterval(statusTimer); unsubscribeAuth(); clearRemotes(); publishRoster(); labels?.remove();
  if (c?.updateSimulation === simulationWrapper) c.updateSimulation = originalSimulation;
  if (c?.render === renderWrapper) c.render = originalRender;
  if (tw) save(localStorage, 'sf-ink-bird', { bird: tw.state.user.bird, name: tw.state.user.name });
  accountUI.destroy?.(); chrona.destroy();
});
