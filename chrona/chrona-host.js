/** chrona.host/v1: explicit, credential-free embedding. Standalone auth is unchanged. */
export const HOST_PROTOCOL = 'chrona.host/v1';
export function validHostInput(p) {
  return p && ['x','y','z','yaw'].every(k => Number.isFinite(p[k])) &&
    Math.abs(p.x) <= 400 && Math.abs(p.z) <= 400 && p.y >= -80 && p.y <= 280 &&
    Math.abs(p.yaw) <= Math.PI * 100 && (p.char === 0 || p.char === 1);
}
const offline = () => ({ state: 'offline', players: [], count: 0, ping: 0 });
const identity = account => ({ initialized: true, userId: account.user?.id || '',
  profile: { displayName: String(account.profile?.displayName || 'Player').slice(0, 80),
    bio: String(account.profile?.bio || '').slice(0, 240) } });

/** Only the trusted platform calls this. binding comes from its authenticated runtime API. */
export function mountChronaHost({ iframe, account, binding, createPresence, onState = () => {}, scope = globalThis }) {
  let closed = false, port, presence, work, timer, lastInput = 0, credits = 4, loads = 0;
  const userId = account.user?.id;
  if (!userId || binding?.protocol !== HOST_PROTOCOL) throw new Error('Hosted integration is not configured');
  const storageKey = `chrona-host-prefs:${userId}:${binding.platformWorldId}`;
  let prefs = {};
  try { const saved = JSON.parse(scope.localStorage.getItem(storageKey) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) prefs = saved; } catch {}
  const send = value => { if (!closed && port) port.postMessage(value); };
  const fail = error => send({ event: 'error', value: { message: error.message || 'Hosted connection failed' } });
  async function connect() {
    if (closed) throw new Error('Hosted session closed');
    if (presence) return presence;
    if (!work) work = (async () => {
      const p = await createPresence(binding);
      if (closed || account.user?.id !== userId) { p.destroy(); throw new Error('Account changed'); }
      presence = p;
      p.subscribe(state => { send({ event: 'state', value: state }); onState(state); });
      p.on('error', fail);
      p.on('session-replaced', e => send({ event: 'session-replaced', value: e }));
      timer = setInterval(() => {
        if (p.state() !== 'room') return;
        const state = p.snapshot();
        const samples = state.players.filter(x => x.connected).slice(0, 500)
          .map(x => [x.id, p.sample(x.id)]);
        send({ event: 'frame', value: { state, samples } });
      }, 25);
      return p;
    })().catch(error => { work = null; throw error; });
    return work;
  }
  let rpcBusy = false;
  async function receive({ data }) {
    if (closed || !data || account.user?.id !== userId) return;
    if (data.op === 'storage' && typeof data.key === 'string' && data.key.length <= 128 &&
      !['__proto__','constructor','prototype'].includes(data.key) && (data.value === null || typeof data.value === 'string' && data.value.length <= 131072)) {
      const next = { ...prefs }; if (data.value === null) delete next[data.key]; else next[data.key] = data.value;
      if (Object.keys(next).length <= 128 && JSON.stringify(next).length <= 524288) {
        try { scope.localStorage.setItem(storageKey, JSON.stringify(next)); prefs = next; }
        catch { fail(new Error('Game preferences could not be saved')); }
      } else fail(new Error('Game preferences exceed the hosted storage limit'));
      return;
    }
    if (data.op === 'input') {
      const now = performance.now(); credits = Math.min(4, credits + (now - lastInput) / 25); lastInput = now;
      if (credits >= 1 && validHostInput(data.input) && presence?.state() === 'room') {
        credits--; const { x,y,z,yaw,char } = data.input; presence.sendInput({x,y,z,yaw,char});
      }
      return;
    }
    if (!Number.isSafeInteger(data.id) || !['enter','leave'].includes(data.op)) return;
    if (rpcBusy) { send({ id: data.id, error: 'A connection operation is already running' }); return; }
    rpcBusy = true;
    try {
      if (data.op === 'enter') {
        if (!binding.world) throw new Error('Multiplayer is disabled for this preview');
        const p = await connect(); await p.enterWorld();
        send({ id: data.id, result: { joined: true } });
      } else { await presence?.leave(); send({ id: data.id, result: { left: true } }); }
    } catch (error) { send({ id: data.id, error: error.message }); }
    finally { rpcBusy = false; }
  }
  function hello(event) {
    if (closed || port || event.source !== iframe.contentWindow || event.origin !== 'null' ||
      event.data?.type !== HOST_PROTOCOL || event.data?.op !== 'hello' ||
      !/^[a-f0-9-]{36}$/i.test(event.data.nonce || '') || event.ports?.length !== 1) return;
    port = event.ports[0]; port.onmessage = receive; port.start();
    send({ event: 'ready', nonce: event.data.nonce, protocol: HOST_PROTOCOL,
      account: identity(account), world: binding.world || null, storage: prefs, platformWorldId: binding.platformWorldId });
  }
  function dispose() {
    if (closed) return;
    send({ event: 'closed', value: 'Hosted session ended' }); closed = true;
    clearInterval(timer); port?.close(); presence?.destroy();
    scope.removeEventListener('message', hello); scope.removeEventListener('pagehide', dispose);
    iframe.removeEventListener('load', loaded); unsubscribe?.();
  }
  const loaded = () => { if (++loads > 1) dispose(); };
  let unsubscribe;
  unsubscribe = account.subscribe(() => {
    if (account.user?.id !== userId) dispose();
    else send({ event: 'account', value: identity(account) });
  });
  scope.addEventListener('message', hello); scope.addEventListener('pagehide', dispose);
  iframe.addEventListener('load', loaded);
  return dispose;
}

/** Explicit hosted-only facade. A failed handshake never falls back to standalone login. */
export function createHostedConnect({ hostOrigin, timeoutMs = 15000, scope = globalThis } = {}) {
  if (scope.parent === scope || new URL(hostOrigin).origin !== hostOrigin || !hostOrigin.startsWith('https://')) {
    throw new Error('A trusted HTTPS host origin is required');
  }
  const channel = new MessageChannel(), nonce = crypto.randomUUID(), pending = new Map();
  const authListeners = new Set(), stateListeners = new Set(), events = new Map();
  let authState = { initialized: false, userId: '', profile: {} }, state = offline(), world, closed = false, seq = 0;
  let samples = new Map(), rosterKey = '', resolveReady, rejectReady;
  let prefs = new Map();
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const emit = (event, value) => { for (const fn of events.get(event) || []) fn(value); };
  function update(value, force = false) {
    state = value;
    const key = JSON.stringify([state.state, state.players.map(p => [p.id,p.name,p.connected])]);
    if (force || key !== rosterKey) { rosterKey = key; for (const fn of stateListeners) fn(state); }
  }
  function destroy(reason = 'Hosted session ended') {
    if (closed) return;
    channel.port1.postMessage({ id: ++seq, op: 'leave' }); closed = true;
    clearTimeout(handshakeTimer); rejectReady(new Error(reason));
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); } pending.clear();
    channel.port1.close(); samples.clear(); update(offline(), true);
    emit('error', { message: reason });
  }
  const handshakeTimer = setTimeout(() => destroy('Chrona host handshake failed; standalone login was not started'), timeoutMs);
  function rpc(op) {
    if (closed) return Promise.reject(new Error('Hosted session ended'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Hosted operation timed out')); }, 30000);
      pending.set(id, { resolve, reject, timer }); channel.port1.postMessage({ id, op });
    });
  }
  channel.port1.onmessage = ({ data }) => {
    if (closed || !data) return;
    if (data.event === 'ready') {
      if (data.nonce !== nonce || data.protocol !== HOST_PROTOCOL) return destroy('Incompatible Chrona host');
      clearTimeout(handshakeTimer); authState = data.account; world = data.world; prefs = new Map(Object.entries(data.storage || {}));
      for (const fn of authListeners) fn(authState); resolveReady(connect);
    } else if (data.event === 'account') { authState = data.value; for (const fn of authListeners) fn(authState); }
    else if (data.event === 'state') update(data.value, true);
    else if (data.event === 'frame') { samples = new Map(data.value.samples); update(data.value.state); emit('snapshot', state); }
    else if (data.event === 'closed') destroy(data.value);
    else if (data.event) emit(data.event, data.value);
    else if (pending.has(data.id)) {
      const p = pending.get(data.id); pending.delete(data.id); clearTimeout(p.timer);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
    }
  };
  channel.port1.start();
  const presence = {
    enterWorld: () => rpc('enter'), leave: () => rpc('leave'), state: () => state.state, snapshot: () => state,
    players: () => state.players, sample: id => samples.get(id) || null,
    subscribe(fn) { stateListeners.add(fn); fn(state); return () => stateListeners.delete(fn); },
    on(event, fn) { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(fn); return () => events.get(event).delete(fn); },
    sendInput(input) { if (closed || state.state !== 'room' || !validHostInput(input)) return -1; channel.port1.postMessage({ op:'input', input }); return ++seq; },
    destroy,
  };
  const connect = { mode: 'hosted', ready, friends: null,
    storage: { get length() { return prefs.size; }, key: i => [...prefs.keys()][i] ?? null,
      getItem: key => prefs.get(String(key)) ?? null,
      setItem(key, value) { key = String(key); value = String(value); if (closed) throw new Error('Hosted session ended'); if (key.length > 128 || value.length > 131072 || ['__proto__','constructor','prototype'].includes(key)) throw new Error('Invalid game preference'); prefs.set(key, value); channel.port1.postMessage({ op:'storage', key, value }); },
      removeItem(key) { key = String(key); prefs.delete(key); if (!closed) channel.port1.postMessage({ op:'storage', key, value:null }); },
      clear() { for (const key of [...prefs.keys()]) this.removeItem(key); },
    },
    auth: { get userId() { return authState.userId; }, get profile() { return authState.profile; },
      subscribe(fn) { authListeners.add(fn); fn(authState); return () => authListeners.delete(fn); } },
    worlds: async () => { await ready; return world ? [{ ...world, visibility: 'hosted' }] : []; },
    presence: async options => { await ready; if (!world || options?.gameId !== world.gameId || options?.worldId !== world.id) throw new Error('Hosted World binding mismatch'); return presence; },
    destroy,
  };
  scope.parent.postMessage({ type: HOST_PROTOCOL, op: 'hello', nonce }, hostOrigin, [channel.port2]);
  return connect;
}
