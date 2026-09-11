/**
 * chrona-presence — authoritative multiplayer for a game that already signed
 * its player in with `chrona-connect`.
 *
 * This is a separate module on purpose: it pulls in the netcode client and
 * socket.io, and a game that only wants accounts and friends should never pay
 * for that. `chrona.presence()` imports it lazily.
 *
 * The server is authoritative. A client reports where it thinks it is, the
 * authority clamps that against the movement profile, and every other client
 * sees the clamped result interpolated between snapshots. Nothing here trusts
 * a peer.
 *
 *   const presence = await chrona.presence({ gameId: 'my-game' })
 *   const { roomCode } = await presence.host()      // or presence.join(code)
 *   presence.subscribe(state => renderRoster(state.players))
 *   // every fixed step:
 *   presence.sendInput({ x, y, z, yaw })
 *   // every frame, for each remote player:
 *   const sample = presence.sample(id)
 */
import {
  ControlPlaneClient,
  BrowserControlPlaneIdentityStore,
  BrowserSessionStore,
  SocketIoBridge,
  RemoteEntityInterpolator,
} from './amp/client/index.js'

/** The fixed simulation step the authority expects input on. */
export const INPUT_STEP_MS = 25

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/
const PLAYER_NAME = /^[\p{L}\p{N} _.-]{1,24}$/u

const errorCode = error => String(error?.protocolError?.code || error?.data?.code || error?.code || '')
const matches = (error, pattern) => pattern.test(`${errorCode(error)} ${error?.message || ''}`)
const recoverablePlayerMissing = error => matches(error, /RECOVERABLE_PLAYER_NOT_FOUND/i)

export function normalizeRoomCode(value) {
  const code = String(value || '').trim().toUpperCase()
  return ROOM_CODE.test(code) ? code : ''
}

function normalizePlayerName(value, fallback) {
  const name = String(value || '').normalize('NFC').trim()
  return name.length <= 24 && PLAYER_NAME.test(name) ? name : fallback
}

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t

/**
 * @param config          resolved chrona-connect config (for `controlPlaneUrl`)
 * @param auth            the account service; a signed-in player is required
 * @param gameId          the registered game this room belongs to
 * @param gameVersion     omit to take the newest release; pass a concrete
 *                        version only to pin one. There is no 'latest' literal —
 *                        the control plane rejects it as an invalid request.
 * @param protocolVersion must match the authority build
 * @param maxPlayers      room capacity when this client creates the room
 * @param snapDistance    a remote jump larger than this teleports instead of lerping
 */
export function createPresence(config, {
  auth,
  gameId,
  gameVersion,
  protocolVersion = 1,
  maxPlayers = 16,
  /** Worlds mode: everyone entering this World converges on one room. */
  world = null,
  defaultName = 'Player',
  interpolationDelayMs = 250,
  maxExtrapolationMs = 120,
  snapDistance = 14,
  controlPlaneUrl = config.controlPlaneUrl,
} = {}) {
  if (!auth || typeof auth.subscribe !== 'function') {
    throw new TypeError('createPresence requires the auth service')
  }
  if (!gameId || typeof gameId !== 'string') {
    throw new TypeError('createPresence requires a gameId registered with the control plane')
  }

  const namespace = config.storageNamespace
  const subscribers = new Set()
  const listeners = new Map()

  let state = 'offline'
  let attempt = null
  let attemptWork = 0
  let session = null
  let snapshot = null
  let players = []
  let rosterKey = ''
  let seq = 1
  let synced = false
  let needResync = false
  let rttMs = 0
  let destroyed = false
  let observedUserId = auth.userId
  let observedName = ''
  let pingTimer = 0

  const displayName = () => normalizePlayerName(auth.profile?.displayName, defaultName)

  const interpolator = new RemoteEntityInterpolator({
    getId: entity => entity.id,
    interpolate: (oldest, newest, t) => ({
      ...structuredClone(newest),
      position: {
        x: oldest.position.x + (newest.position.x - oldest.position.x) * t,
        y: oldest.position.y + (newest.position.y - oldest.position.y) * t,
        z: oldest.position.z + (newest.position.z - oldest.position.z) * t,
      },
      yaw: lerpAngle(oldest.yaw, newest.yaw, t),
    }),
    extrapolate: (latest, ms) => ({
      ...structuredClone(latest),
      position: {
        x: latest.position.x + (latest.velocity?.x ?? 0) * ms / 1000,
        y: latest.position.y + (latest.velocity?.y ?? 0) * ms / 1000,
        z: latest.position.z + (latest.velocity?.z ?? 0) * ms / 1000,
      },
    }),
    shouldSnap: (a, b) => Math.hypot(
      a.position.x - b.position.x,
      a.position.y - b.position.y,
      a.position.z - b.position.z,
    ) > snapDistance,
  }, { interpolationDelayMs, maxExtrapolationMs })

  function emit(event, detail = {}) {
    for (const listener of [...(listeners.get(event) || [])]) {
      try { listener(detail) } catch {}
    }
  }

  function publicState() {
    return Object.freeze({
      state,
      roomCode: session?.roomCode ?? null,
      selfId: session?.playerId ?? null,
      players: Object.freeze(players),
      count: players.filter(player => player.connected).length,
      ping: Math.round(rttMs),
      gameId,
      // Authority freshness, not host-frame delivery time. Replayed frames
      // retain this stamp until a real server snapshot arrives.
      serverTimeMs: Number.isFinite(snapshot?.serverTimeMs) ? snapshot.serverTimeMs : null,
    })
  }

  function publish() {
    const value = publicState()
    for (const listener of [...subscribers]) {
      try { listener(value) } catch {}
    }
  }

  function setState(next) {
    if (next !== state) rttMs = 0
    state = next
    publish()
    emit('state', publicState())
  }

  const isCurrent = candidate => !!candidate && !candidate.retired
    && attempt === candidate && candidate.work === attemptWork && auth.userId === candidate.userId

  function superseded() {
    const error = new Error('The multiplayer connection was superseded.')
    error.code = 'connection_superseded'
    return error
  }

  function assertCurrent(candidate) {
    if (!isCurrent(candidate)) throw superseded()
  }

  function clearRuntime() {
    session = null
    snapshot = null
    players = []
    rosterKey = ''
    seq = 1
    synced = false
    needResync = true
    interpolator.clear()
  }

  function onSnapshot(candidate, next) {
    if (!isCurrent(candidate) || state !== 'room' || session !== candidate.roomSession) return
    if (next.gameId !== gameId || next.protocolVersion !== protocolVersion) return
    snapshot = next
    const selfId = next.localPlayerId
    players = next.players.map(player => ({
      id: player.id,
      name: player.displayName,
      self: player.id === selfId,
      connected: player.connected,
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw: player.yaw,
      speed: Math.hypot(player.velocity?.x ?? 0, player.velocity?.y ?? 0, player.velocity?.z ?? 0),
      lastProcessedInput: player.lastProcessedInput,
    }))

    const me = players.find(player => player.self)
    if (me && typeof me.lastProcessedInput === 'number' && (needResync || me.lastProcessedInput >= seq)) {
      seq = me.lastProcessedInput + 1
      needResync = false
    }
    if (me) synced = true

    const nextRosterKey = JSON.stringify(players.map(player => [player.id, player.name, player.connected]))
    if (nextRosterKey !== rosterKey) {
      rosterKey = nextRosterKey
      emit('roster', { players })
    }
    emit('snapshot', { players, selfId, serverTimeMs: Number.isFinite(next.serverTimeMs) ? next.serverTimeMs : null })
    publish()
    interpolator.push(next.serverTimeMs, next.players.filter(player => player.id !== selfId && player.connected))
  }

  async function retire(candidate, { leave = false, clearStore = false } = {}) {
    if (!candidate) return
    candidate.retired = true
    if (clearStore) {
      try { candidate.sessionStore?.clear?.() } catch {}
    }
    const bridge = candidate.bridge
    if (!bridge) return
    if (leave && candidate.roomSession) {
      try { await bridge.leaveRoom() } catch {}
    }
    try { bridge.disconnect?.() } catch {}
    try { bridge.close?.() } catch {}
    if (candidate.bridge === bridge) candidate.bridge = null
  }

  /** Allocate an authority session, then open the realtime socket to it. */
  async function createBridge(candidate) {
    let bridge = null
    try {
      assertCurrent(candidate)
      const control = new ControlPlaneClient(controlPlaneUrl, {
        identityStore: new BrowserControlPlaneIdentityStore(
          sessionStorage, `${namespace}-amp-identity:${candidate.userId}`,
        ),
        // Every control-plane call carries the player's live Supabase token, so
        // the authority knows which account is asking without a second login.
        fetch: async (url, init = {}) => {
          if (!isCurrent(candidate)) throw superseded()
          const token = await auth.accessToken()
          return fetch(url, {
            ...init,
            credentials: 'omit',
            headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          })
        },
      })
      // `gameVersion` is omitted rather than sent as 'latest': the control
      // plane validates the field and rejects any non-version string, then
      // resolves the newest release itself and reports it in the allocation.
      const request = { gameId, protocolVersion, ...(gameVersion ? { gameVersion } : {}) }
      const allocation = await control.allocate(request)
      assertCurrent(candidate)

      const store = new BrowserSessionStore(
        sessionStorage, `${namespace}-amp-room:${candidate.userId}:${gameId}`,
      )
      bridge = new SocketIoBridge(allocation.authorityUrl, {
        sessionStore: store,
        requestTimeoutMs: 15_000,
        ticketRefresh: { source: control.createAllocationSource(request, allocation) },
      })
      candidate.allocation = allocation
      candidate.sessionStore = store
      candidate.bridge = bridge
      bridge.onSnapshot(next => onSnapshot(candidate, next))
      bridge.onError(error => {
        if (!isCurrent(candidate)) return
        emit('error', { code: errorCode(error), message: error.message })
        if (errorCode(error) === 'SESSION_REPLACED') {
          // The same account connected somewhere else. This tab yields rather
          // than fighting for the seat.
          attemptWork++
          attempt = null
          clearRuntime()
          setState('offline')
          void retire(candidate, { clearStore: true })
          emit('session-replaced', {
            message: 'This account connected in another tab. This session was disconnected.',
          })
        }
      })
      await bridge.connect()
      assertCurrent(candidate)
      await bridge.synchronizeClock(2)
      assertCurrent(candidate)
      return bridge
    } catch (error) {
      if (bridge && candidate.bridge !== bridge) {
        try { bridge.disconnect?.() } catch {}
        try { bridge.close?.() } catch {}
      }
      throw error
    }
  }

  function enterRoom(candidate, nextSession) {
    assertCurrent(candidate)
    candidate.roomSession = nextSession
    session = nextSession
    seq = 1
    synced = false
    needResync = true
    interpolator.clear()
    setState('room')
    emit('joined', { roomCode: nextSession.roomCode, selfId: nextSession.playerId })
    return nextSession
  }

  async function enterExisting(candidate, roomCode) {
    const bridge = candidate.bridge
    // A fresh tab has no reconnect token but the same authenticated principal.
    // Recovering first transfers the existing player and drops the old socket.
    try {
      return await bridge.recoverRoom(roomCode)
    } catch (error) {
      if (!recoverablePlayerMissing(error)) throw error
      assertCurrent(candidate)
    }
    return bridge.joinRoom({ roomCode, displayName: displayName() })
  }

  /**
   * Worlds mode. The shard carries the room everyone else is already in, so the
   * common case is a plain join. Only the first player in has to create one, and
   * `bindRoom` is a compare-and-set — when two clients both think they are
   * first, the loser is handed the winning room code and joins that instead of
   * stranding itself in a second room.
   */
  async function openWorldRoom(candidate) {
    const seat = candidate.seat
    const bridge = candidate.bridge
    const existing = seat.current?.shard?.roomCode || null
    const generation = Number(seat.current?.shard?.generation) || 0

    if (existing) {
      try {
        return await enterExisting(candidate, existing)
      } catch (error) {
        // The bound room is gone; fall through and provision a new one.
        if (!matches(error, /ROOM_NOT_FOUND|UNKNOWN_ROOM|NOT_FOUND/i)) throw error
        assertCurrent(candidate)
      }
    }

    const created = await bridge.createRoom({
      gameId,
      displayName: displayName(),
      maxPlayers: Number(seat.current?.shard?.capacity) || candidate.maxPlayers,
    })
    let binding
    try {
      assertCurrent(candidate)
      binding = await seat.bindRoom({
        expectedGeneration: generation,
        expectedRoomCode: existing,
        newRoomCode: created.roomCode,
      })
      assertCurrent(candidate)
    } catch (error) {
      try { await bridge.leaveRoom() } catch {}
      throw error
    }

    const authoritative = String(binding?.room_code || '')
    if (authoritative === created.roomCode) return created

    // Someone else bound first. Leave the orphan room and join theirs.
    try { await bridge.leaveRoom() } catch {}
    if (!ROOM_CODE.test(authoritative)) {
      throw new Error('The World could not establish an authoritative room.')
    }
    assertCurrent(candidate)
    return enterExisting(candidate, authoritative)
  }

  async function openRoom(candidate) {
    if (candidate.seat) return openWorldRoom(candidate)
    if (candidate.roomCode) return enterExisting(candidate, candidate.roomCode)
    return candidate.bridge.createRoom({
      gameId,
      displayName: displayName(),
      maxPlayers: candidate.maxPlayers,
    })
  }

  async function runAttempt(candidate, previous, preferResume) {
    try {
      await retire(previous, { leave: !!previous?.roomSession })
      assertCurrent(candidate)
      const bridge = await createBridge(candidate)
      assertCurrent(candidate)

      if (preferResume) {
        const stored = candidate.sessionStore?.load?.()
        if (stored?.reconnectToken && (!candidate.roomCode || stored.roomCode === candidate.roomCode)) {
          try {
            const resumed = await bridge.resumeStoredRoom()
            if (resumed) return enterRoom(candidate, resumed)
          } catch (error) {
            if (!isCurrent(candidate)) throw error
            candidate.sessionStore?.clear?.()
          }
        }
      }

      assertCurrent(candidate)
      return enterRoom(candidate, await openRoom(candidate))
    } catch (error) {
      const owned = attempt === candidate
      await retire(candidate, { leave: !!candidate.roomSession })
      if (owned && attempt === candidate) {
        attempt = null
        clearRuntime()
        setState('offline')
        emit('error', { code: errorCode(error), message: error?.message || 'The multiplayer connection failed' })
      }
      throw error
    }
  }

  async function connect({ roomCode = '', preferResume = true, capacity = maxPlayers, seat = null } = {}) {
    if (destroyed) throw new Error('This presence client was destroyed.')
    if (!auth.userId) throw new Error('Sign in before joining a room.')
    const wanted = roomCode ? normalizeRoomCode(roomCode) : ''
    if (roomCode && !wanted) throw new Error('That room code is not valid.')

    const previous = attempt
    const candidate = {
      work: ++attemptWork,
      userId: auth.userId,
      seat,
      roomCode: wanted,
      maxPlayers: Math.max(2, Math.min(50, Number(capacity) || maxPlayers)),
      allocation: null,
      bridge: null,
      sessionStore: null,
      roomSession: null,
      retired: false,
    }
    attempt = candidate
    clearRuntime()
    setState('connecting')
    candidate.connectPromise = runAttempt(candidate, previous, preferResume)
    return candidate.connectPromise
  }

  async function leave() {
    attemptWork++
    const leaving = attempt
    attempt = null
    clearRuntime()
    setState('offline')
    await retire(leaving, { leave: !!leaving?.roomSession, clearStore: true })
    emit('left', {})
  }

  const unsubscribeAuth = auth.subscribe(next => {
    const nextUserId = next.userId || ''
    if (nextUserId !== observedUserId) {
      observedUserId = nextUserId
      observedName = displayName()
      void leave()
      return
    }
    // A rename has to reach the other players, so the identity is
    // re-established on the same room rather than waiting for the next join.
    const nextName = displayName()
    if (!session || nextName === observedName) return
    observedName = nextName
    void connect({ roomCode: session.roomCode, preferResume: false }).catch(() => {})
  })

  world?.onLeaseLost(() => {
    emit('error', { code: 'lease_expired', message: 'Your World reservation expired.' })
    void leave()
  })

  pingTimer = setInterval(() => {
    const candidate = attempt
    const bridge = candidate?.bridge
    if (!isCurrent(candidate) || !bridge || state !== 'room' || !bridge.socket?.connected) return
    const started = performance.now()
    bridge.socket.timeout(3000).emitWithAck('clock:ping', { clientTimeMs: Date.now() })
      .then(() => { if (isCurrent(candidate)) rttMs = performance.now() - started })
      .catch(() => {})
  }, 2000)

  return Object.freeze({
    snapshot: publicState,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Presence subscriber must be a function')
      subscribers.add(listener)
      listener(publicState())
      return () => subscribers.delete(listener)
    },
    /** `state`, `roster`, `snapshot`, `joined`, `left`, `error`, `session-replaced`. */
    on(event, listener) {
      if (typeof listener !== 'function') throw new TypeError('Presence listener must be a function')
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(listener)
      return () => listeners.get(event)?.delete(listener)
    },
    /**
     * Worlds mode: reserve a seat in the configured World and join whatever room
     * that World is bound to. Every player who calls this lands together — no
     * room code changes hands. Requires `world` to have been passed in.
     */
    async enterWorld(options = {}) {
      if (!world) {
        throw new Error('enterWorld() needs a worldId — pass one to chrona.presence({ worldId }).')
      }
      const admission = await world.enter()
      if (!admission?.lease) throw new Error('This World did not hand out a seat. Try again in a moment.')
      const entered = await connect({ ...options, seat: world, roomCode: '' })
      void world.heartbeat('active')
      return { roomCode: entered.roomCode, selfId: entered.playerId, world: world.world }
    },
    /** Create a room and return its shareable code. */
    async host(options = {}) {
      const created = await connect({ ...options, roomCode: '' })
      return { roomCode: created.roomCode, selfId: created.playerId }
    },
    /** Join an existing room by its six-character code. */
    async join(roomCode, options = {}) {
      const joined = await connect({ ...options, roomCode })
      return { roomCode: joined.roomCode, selfId: joined.playerId }
    },
    leave,
    state: () => state,
    roomCode: () => session?.roomCode ?? null,
    selfId: () => session?.playerId ?? null,
    players: () => players,
    ping: () => Math.round(rttMs),
    displayName,
    /**
     * Report this client's position for one fixed step. Call it on a 25 ms
     * accumulator, not per frame. Returns the sequence number, or -1 when the
     * room is not ready to accept input yet.
     */
    sendInput({ x = 0, y = 0, z = 0, yaw = 0, char } = {}) {
      const candidate = attempt
      const bridge = candidate?.bridge
      if (!isCurrent(candidate) || !bridge || state !== 'room' || !synced) return -1
      const frame = {
        seq: seq++,
        clientTimeMs: Date.now(),
        durationMs: INPUT_STEP_MS,
        payload: {
          px: +Number(x).toFixed(3),
          py: +Number(y).toFixed(3),
          pz: +Number(z).toFixed(3),
          yaw: +Number(yaw).toFixed(4),
          ...(char === 0 || char === 1 ? { char } : {}),
        },
      }
      bridge.sendInput(frame).catch(error => {
        if (!isCurrent(candidate)) return
        if (matches(error, /INPUT_BACKLOG|STALE_INPUT|INVALID/)) needResync = true
      })
      return frame.seq
    },
    /**
     * The interpolated transform of one remote player, at the presentation time
     * this client should be rendering. Call it per frame, per remote id.
     */
    sample(id) {
      const candidate = attempt
      const bridge = candidate?.bridge
      if (!isCurrent(candidate) || !bridge || !snapshot) return undefined
      return interpolator.sample(id, bridge.estimatedServerTime())
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      attemptWork++
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = 0
      const closing = attempt
      attempt = null
      clearRuntime()
      unsubscribeAuth?.()
      subscribers.clear()
      listeners.clear()
      void retire(closing, { leave: !!closing?.roomSession })
    },
  })
}
