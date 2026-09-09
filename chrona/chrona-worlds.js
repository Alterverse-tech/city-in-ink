/**
 * chrona-worlds — the seat lease that makes everyone entering the same World
 * land in the same authoritative room.
 *
 * Rooms mode (`chrona-presence.js` on its own) has no lobby: `host()` opens a
 * new room and the code has to reach the second player somehow. Worlds mode
 * replaces that with a shared directory. Entering World X is:
 *
 *   1. `claim_slot` — the Worlds service checks capacity and hands out a seat
 *      lease plus the shard this account belongs to;
 *   2. the shard carries the room code everyone else is already in, so a second
 *      player simply joins it;
 *   3. if the shard has no room yet, the first player in creates one and
 *      `bind_room` compare-and-sets that code onto the shard. Two players racing
 *      to be first cannot end up in two rooms — the loser is told the winning
 *      code and joins it.
 *
 * The lease is the reason a World has real capacity limits and a reload does not
 * cost a second seat. It is also why this mode couples a game to Chrona's Worlds
 * product: the game must be a World that exists in the directory.
 *
 * A game never imports this directly. Pass `worldId` to `chrona.presence()` and
 * the presence client loads it.
 */

const LEASE_TTL_STATES = new Set(['active', 'reserved', 'reconnecting'])
const HEARTBEAT_MS = 25_000

const uuid = () => (typeof crypto?.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`)

function tabStorage() {
  try { return globalThis.sessionStorage } catch { return null }
}

function readJson(key) {
  try { return JSON.parse(tabStorage()?.getItem(key) || 'null') } catch { return null }
}

function writeJson(key, value) {
  try {
    if (value == null) tabStorage()?.removeItem(key)
    else tabStorage()?.setItem(key, JSON.stringify(value))
  } catch {}
}

/**
 * One stable id per browser tab. The Worlds service keys a seat to it, so a
 * reload reclaims the same seat instead of buying a second one.
 */
function clientSessionId(namespace) {
  const key = `${namespace}-client-session-v1`
  const existing = readJson(key)
  if (existing?.id && /^[0-9a-f-]{36}$/i.test(existing.id)) return existing.id
  const id = uuid()
  writeJson(key, { id })
  return id
}

/** The Worlds wire protocol lives here and nowhere else. */
function worldsTransport(config, auth) {
  const url = `${config.supabaseUrl}/functions/v1/${config.functions.worlds}`
  const friendly = Object.freeze({
    already_online: 'This account is already connected in another tab.',
    // The deployed function answers `unauthorized`; the older contract used
    // `authentication_required`. Map both so neither leaks a raw code.
    unauthorized: 'Your session has expired. Please sign in again.',
    authentication_required: 'Your session has expired. Please sign in again.',
    insufficient_chronos: 'Not enough Chronos. Top up your wallet and try again.',
    lease_expired: 'Your World reservation expired. Enter the World again.',
    environment_mismatch: 'Your wallet environment changed. Refresh and try again.',
    live_admission_disabled: 'Live World entry is not enabled yet. Test entry remains available.',
    server_full: 'This World is currently full.',
    server_private: 'This World is private.',
    server_unavailable: 'This World is temporarily unavailable.',
    server_owner_required: 'Only the World creator can do that.',
  })

  return async function call(action, fields = {}, { session, signal } = {}) {
    const pinned = await auth.pinnedSession(session ?? auth.session, { signal })
    return pinned.request(url, {
      method: 'POST',
      headers: { apikey: config.supabasePublishableKey },
      body: { action, ...fields },
      timeoutMs: config.timeouts.functions,
      signal,
      fallbackMessage: 'The Worlds service could not be reached',
      timeoutMessage: 'The Worlds service timed out. Please try again.',
      friendlyMessages: friendly,
    })
  }
}

/**
 * List the Worlds this account can enter. Useful for letting a player pick one,
 * and for confirming a `worldId` before trying to enter it.
 *
 * `livemode` selects the payment environment; a World created in test mode does
 * not exist in live mode and vice versa.
 */
export async function listWorlds(config, { auth, livemode = false, worldId = '', signal } = {}) {
  const call = worldsTransport(config, auth)
  const payload = await call('catalog', {
    livemode,
    ...(worldId ? { serverId: worldId } : {}),
  }, { signal })
  const worlds = Array.isArray(payload?.servers) ? payload.servers : []
  return worlds.map(entry => ({
    id: String(entry?.id || ''),
    name: String(entry?.name || ''),
    summary: String(entry?.summary || ''),
    visibility: String(entry?.visibility || ''),
    gameId: String(entry?.gameId || ''),
    buildVersion: entry?.buildVersion ?? null,
    capacity: Number(entry?.capacityLimit ?? entry?.capacity ?? 0) || null,
    role: String(entry?.role || ''),
    raw: entry,
  })).filter(world => world.id)
}

/**
 * The seat lease for one World.
 *
 * `enter()` reclaims the seat this tab already holds before buying a new one, so
 * a reload is free. `bindRoom` is a compare-and-set against the shard's
 * generation — that is what serializes two players who both arrive first.
 */
export function createWorldSession(config, { auth, worldId, livemode = false } = {}) {
  if (!auth || typeof auth.pinnedSession !== 'function') {
    throw new TypeError('createWorldSession requires the auth service')
  }
  const id = String(worldId || '').toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new TypeError('createWorldSession requires a World id (uuid)')
  }

  const call = worldsTransport(config, auth)
  const clientId = clientSessionId(config.storageNamespace)
  const LEASE_KEY = `${config.storageNamespace}-world-lease-v1`

  let active = true
  let current = null
  let leaseSession = null
  let world = null
  let admissionWork = 0
  let heartbeatBusy = false
  let heartbeatTimer = 0

  const storedLease = () => {
    const stored = readJson(LEASE_KEY)
    if (!stored || stored.userId !== auth.userId || stored.worldId !== id
      || stored.clientSessionId !== clientId || stored.livemode !== livemode
      || !stored.lease?.id || !stored.lease?.token) return null
    return stored
  }

  function remember(next) {
    current = next
    if (!next) {
      leaseSession = null
      writeJson(LEASE_KEY, null)
      return
    }
    leaseSession = auth.session
    writeJson(LEASE_KEY, {
      userId: auth.userId,
      worldId: id,
      livemode,
      clientSessionId: clientId,
      server: next.server,
      shard: next.shard,
      lease: next.lease,
    })
  }

  /** Read this World's directory entry so capacity and name are known. */
  async function load({ signal } = {}) {
    const matches = await listWorlds(config, { auth, livemode, worldId: id, signal })
    const match = matches.find(entry => entry.id.toLowerCase() === id)
    if (!match) {
      throw new Error('This World is not available to your account. Check the id and the livemode setting.')
    }
    world = match
    return match
  }

  async function claim({ signal } = {}) {
    const userId = auth.userId
    if (!userId) throw new Error('Sign in to enter this World.')
    const startedSession = auth.session
    const work = ++admissionWork
    const result = await call('claim_slot', {
      livemode, serverId: id, clientSessionId: clientId, requestId: uuid(),
    }, { session: startedSession, signal })
    if (!active || work !== admissionWork || auth.userId !== userId) {
      if (result?.lease) void releaseQuietly(startedSession, result.lease)
      return null
    }
    remember(result)
    startHeartbeat()
    return result
  }

  /** Reclaim the seat this tab already holds — a reload must not cost a second. */
  async function resume({ signal } = {}) {
    const stored = storedLease()
    if (!stored || !auth.userId) return null
    const work = ++admissionWork
    try {
      const result = await call('resume_slot', {
        leaseId: stored.lease.id, clientSessionId: clientId, token: stored.lease.token,
      }, { signal })
      if (!active || work !== admissionWork) return null
      remember(result)
      startHeartbeat()
      return result
    } catch (error) {
      if (error?.code === 'lease_expired') writeJson(LEASE_KEY, null)
      return null
    }
  }

  const releaseQuietly = (session, lease) => call('release_slot', {
    leaseId: lease.id, clientSessionId: clientId, token: lease.token,
  }, { session }).catch(() => {})

  async function heartbeat(state = 'active') {
    if (!current?.lease || heartbeatBusy || !auth.userId) return false
    if (!LEASE_TTL_STATES.has(state)) throw new TypeError(`Unknown lease state: ${state}`)
    const lease = current.lease
    heartbeatBusy = true
    try {
      const data = await call('heartbeat', {
        leaseId: lease.id, clientSessionId: clientId, token: lease.token, state,
      })
      if (current?.lease?.id === lease.id && data?.expiresAt) {
        remember({ ...current, lease: { ...current.lease, expiresAt: data.expiresAt } })
      }
      return true
    } catch (error) {
      if (error?.code === 'lease_expired' && current?.lease?.id === lease.id) {
        remember(null)
        onLeaseLost(error)
      }
      return false
    } finally {
      heartbeatBusy = false
    }
  }

  let onLeaseLost = () => {}

  function startHeartbeat() {
    if (heartbeatTimer) return
    heartbeatTimer = setInterval(() => {
      if (current?.lease) void heartbeat('active')
    }, HEARTBEAT_MS)
  }

  async function release() {
    const releasing = current
    admissionWork++
    const session = leaseSession
    remember(null)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = 0
    if (releasing?.lease) await releaseQuietly(session, releasing.lease)
    return true
  }

  /**
   * Record which authoritative room this shard is bound to, under compare-and-set.
   * The returned `room_code` is authoritative: when it differs from the code just
   * created, another player won the race and this client must join theirs.
   */
  async function bindRoom({ expectedGeneration, expectedRoomCode = null, newRoomCode }) {
    if (!current?.lease) throw new Error('Your World reservation expired.')
    const leaseId = current.lease.id
    const result = await call('bind_room', {
      leaseId,
      clientSessionId: clientId,
      token: current.lease.token,
      expectedGeneration,
      expectedRoomCode,
      newRoomCode,
    })
    if (current?.lease?.id !== leaseId) {
      throw new Error('The World reservation changed while the room was starting.')
    }
    remember({
      ...current,
      shard: { ...current.shard, roomCode: result.room_code, generation: result.room_generation },
    })
    return result
  }

  return Object.freeze({
    worldId: id,
    livemode,
    clientSessionId: clientId,
    get world() { return world },
    get current() { return current },
    load,
    /** Reserve a seat, preferring the one this tab already holds. */
    async enter(options) {
      if (current?.lease) return current
      return (await resume(options)) || claim(options)
    },
    heartbeat,
    bindRoom,
    release,
    onLeaseLost(listener) { onLeaseLost = typeof listener === 'function' ? listener : () => {} },
    destroy() {
      active = false
      admissionWork++
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = 0
    },
  })
}
