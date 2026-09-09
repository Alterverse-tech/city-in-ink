/**
 * chrona-connect — Chrona's account, friends, and multiplayer layer as one
 * dependency-free ES module.
 *
 * Drop this file into any browser game. It talks to the same authoritative
 * services the Chrona product runs against, so a game that imports it inherits
 * the account system rather than forking one.
 *
 *   import { createChronaConnect } from './chrona-connect.js'
 *   const chrona = createChronaConnect()
 *   await chrona.ready
 *
 * Three services, each usable on its own:
 *
 *   chrona.auth      Google / Discord / X / email-code sign-in and the profile.
 *   chrona.friends   People the signed-in player already knows, via X Following
 *                    and shared membership of the official Discord.
 *   chrona.presence  Authoritative multiplayer rooms (lazy; see `presence.js`).
 *
 * Nothing here touches the DOM. `chrona-connect-ui.js` is an optional panel
 * built on exactly this public surface; a game can ignore it and render its own.
 *
 * SECURITY INVARIANTS — these are load-bearing, not style. Read
 * references/integration.md before changing any of them.
 *
 *   1. Provider credentials (the X / Discord access tokens) never reach browser
 *      storage, a URL, a log, or the public account snapshot. They are handed
 *      once, in memory, to the friends linker and then dropped.
 *   2. Every sensitive write is pinned to the session that started it, so a
 *      sign-in that lands mid-flight cannot inherit another account's request.
 *   3. Friend discovery binds the viewer to `auth.uid()` inside a
 *      security-definer RPC. The browser never names whose friends it wants.
 *   4. One PKCE verifier exists per browser profile. A lease serializes sign-in
 *      flows so a second tab cannot silently destroy the first one's exchange.
 */

/* ------------------------------------------------------------------ config */

/**
 * Chrona's public browser configuration. These are publishable values — the
 * same ones the production bundle ships — not secrets. Authorization for every
 * sensitive operation is enforced server-side by Supabase RLS, the
 * security-definer RPCs, and the Edge Functions.
 */
const DEFAULTS = Object.freeze({
  supabaseUrl: 'https://smdiiagjaegzspdiigoh.supabase.co',
  supabasePublishableKey: 'sb_publishable_QkaWkXSVk0M26D8_mlHZsg_Atqn6_QE',
  functions: Object.freeze({
    // Deployed compatibility slugs. Their historical names preserve linked
    // identities, encrypted tokens, and Following snapshots; do not "tidy" them.
    x: 'cybercity-x',
    discord: 'cybercity-discord',
    worlds: 'chrona-smp',
  }),
  /** Authoritative multiplayer control plane; allocates one authority session. */
  controlPlaneUrl: 'https://multiplayer.13-216-49-19.sslip.io',
  /** Namespaces browser storage so two games on localhost cannot collide. */
  storageNamespace: 'chrona',
  timeouts: Object.freeze({
    authSettings: 5_000,
    authUser: 10_000,
    functions: 20_000,
    xSync: 60_000,
  }),
})

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

function mergeKnown(base, override) {
  const result = { ...base }
  if (!isPlainObject(override)) return result
  for (const [key, value] of Object.entries(override)) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue
    result[key] = isPlainObject(base[key]) && isPlainObject(value)
      ? mergeKnown(base[key], value)
      : value
  }
  return result
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function normalizeHttpsOrigin(value, label) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    throw new Error(`chrona-connect: ${label} must be a valid URL`)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const secure = url.protocol === 'https:'
  if ((!secure && !(url.protocol === 'http:' && local)) || url.username || url.password) {
    throw new Error(`chrona-connect: ${label} must use https (localhost may use http)`)
  }
  return url.origin
}

function validatePublishableKey(value) {
  const key = String(value || '')
  const publishable = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
  const legacyAnonJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)
  if (!publishable && !legacyAnonJwt) {
    throw new Error('chrona-connect: supabasePublishableKey is not a Supabase publishable/anon key')
  }
  return key
}

function validateSlug(value, label) {
  const slug = String(value || '')
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    throw new Error(`chrona-connect: ${label} must be a valid Edge Function slug`)
  }
  return slug
}

function validateNamespace(value) {
  const name = String(value || '')
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(name)) {
    throw new Error('chrona-connect: storageNamespace must be lowercase letters, digits, - or _')
  }
  return name
}

function validateTimeout(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`chrona-connect: ${label} must be a positive integer`)
  }
  return value
}

/** Merge the caller's overrides onto the defaults and validate the result. */
export function resolveConfig(...overrides) {
  const merged = overrides.reduce((current, override) => mergeKnown(current, override), DEFAULTS)
  return deepFreeze({
    supabaseUrl: normalizeHttpsOrigin(merged.supabaseUrl, 'supabaseUrl'),
    supabasePublishableKey: validatePublishableKey(merged.supabasePublishableKey),
    controlPlaneUrl: normalizeHttpsOrigin(merged.controlPlaneUrl, 'controlPlaneUrl'),
    storageNamespace: validateNamespace(merged.storageNamespace),
    functions: {
      x: validateSlug(merged.functions?.x, 'functions.x'),
      discord: validateSlug(merged.functions?.discord, 'functions.discord'),
      worlds: validateSlug(merged.functions?.worlds, 'functions.worlds'),
    },
    timeouts: Object.fromEntries(Object.keys(DEFAULTS.timeouts).map(key => [
      key, validateTimeout(merged.timeouts?.[key], `timeouts.${key}`),
    ])),
  })
}

/* ------------------------------------------------------------------ errors */

/** A stable error shape shared by every call in this module. */
export class ChronaError extends Error {
  constructor(message, { code = 'request_failed', status = 0, cause = undefined } = {}) {
    super(message)
    this.name = 'ChronaError'
    this.code = code
    this.status = status
    if (cause !== undefined) this.cause = cause
  }
}

const isChronaError = value => value instanceof ChronaError

/** Normalize both `{ error: "text" }` and `{ error: { message, code } }`. */
function readErrorPayload(payload) {
  if (!payload || typeof payload !== 'object') return {}
  const error = payload.error
  if (typeof error === 'string') return { message: error, code: payload.error_code || payload.code }
  if (error && typeof error === 'object') {
    return { message: error.message, code: error.code || payload.code }
  }
  return {
    message: payload.message || payload.msg || payload.error_description,
    code: payload.error_code || payload.code,
  }
}

/* ----------------------------------------------------------------- storage */

/** Storage that never throws, so private mode degrades instead of crashing. */
function safeStorage(kind) {
  let storage = null
  try { storage = kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage } catch {}
  return {
    available: !!storage,
    get(key) { try { return storage?.getItem(key) ?? null } catch { return null } },
    set(key, value) { try { storage?.setItem(key, value); return true } catch { return false } },
    remove(key) { try { storage?.removeItem(key) } catch {} },
  }
}

function randomId(bytes = 18) {
  const source = globalThis.crypto
  if (typeof source?.randomUUID === 'function' && bytes === 18) return source.randomUUID()
  if (typeof source?.getRandomValues === 'function') {
    const buffer = new Uint8Array(bytes)
    source.getRandomValues(buffer)
    return Array.from(buffer, value => value.toString(16).padStart(2, '0')).join('')
  }
  return ''
}

const base64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** RFC 7636 PKCE pair. The verifier stays in this browser; only its hash travels. */
async function createPkcePair() {
  const source = globalThis.crypto
  if (typeof source?.getRandomValues !== 'function' || !source.subtle) {
    throw new ChronaError('This browser cannot perform a secure sign-in (Web Crypto is unavailable).', {
      code: 'crypto_unavailable',
    })
  }
  const buffer = new Uint8Array(64)
  source.getRandomValues(buffer)
  const verifier = base64Url(buffer)
  const digest = await source.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(digest) }
}

/* ------------------------------------------------------- OAuth flow leases */

const OAUTH_FLOW_ID = /^[A-Za-z0-9_-]{12,160}$/
// 'email' no longer acquires a lease — that flow never touches the PKCE slot.
// It stays in the vocabulary so a lease written by an older build still parses
// and gets cleared at boot instead of lingering as an unrecognised record.
const OAUTH_FLOW_KINDS = new Set(['google', 'discord', 'x', 'email'])
const LEASE_TTL_MS = 15 * 60 * 1000

function parseLease(rawValue) {
  try {
    const value = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue
    if (!isPlainObject(value)) return null
    const ownerId = String(value.ownerId || '')
    const flowId = String(value.flowId || '')
    const provider = String(value.provider || '')
    const expiresAt = Number(value.expiresAt)
    if (value.version !== 1 || !OAUTH_FLOW_ID.test(ownerId) || !OAUTH_FLOW_ID.test(flowId)
      || !OAUTH_FLOW_KINDS.has(provider) || !Number.isFinite(expiresAt) || expiresAt <= 0) return null
    return Object.freeze({ version: 1, ownerId, flowId, provider, expiresAt })
  } catch {
    return null
  }
}

/**
 * A browser profile has exactly one PKCE verifier slot per storage key, so two
 * sign-ins started at once would destroy each other's exchange. This lease makes
 * that race explicit and recoverable: the second flow is told the first is busy
 * rather than silently corrupting it.
 *
 * The lease holds random ids, a provider label, and a timestamp. No account
 * data and no credentials ever enter it.
 */
function createFlowLeases({ namespace, shared = safeStorage('local'), tab = safeStorage('session') }) {
  const LEASE_KEY = `${namespace}-auth-flow-lease-v1`
  const TAB_KEY = `${namespace}-auth-flow-tab-v1`
  const CLAIM_KEY = `${namespace}-auth-flow-claim-v1`
  const LOCK_NAME = `${namespace}-auth-flow-lease`

  const same = (left, right) => !!left && !!right
    && left.ownerId === right.ownerId && left.flowId === right.flowId

  function ownerId() {
    const saved = String(tab.get(TAB_KEY) || '')
    if (OAUTH_FLOW_ID.test(saved)) return saved
    const created = String(randomId())
    if (!OAUTH_FLOW_ID.test(created) || !tab.set(TAB_KEY, created)) return ''
    return created
  }

  function active(storage, key, now) {
    const raw = storage.get(key)
    const record = parseLease(raw)
    if (!record || record.expiresAt <= now) {
      if (raw != null) storage.remove(key)
      return null
    }
    return record
  }

  function acquireSync(provider, { replaceExisting = false } = {}) {
    const kind = String(provider || '').trim().toLowerCase()
    const now = Date.now()
    const owner = ownerId()
    if (!owner || !OAUTH_FLOW_KINDS.has(kind)) return { ok: false, reason: 'storage_unavailable' }

    const existing = active(shared, LEASE_KEY, now)
    if (existing && !replaceExisting) return { ok: false, reason: 'busy', lease: existing }

    const flowId = String(randomId())
    if (!OAUTH_FLOW_ID.test(flowId)) return { ok: false, reason: 'storage_unavailable' }
    const lease = Object.freeze({
      version: 1, ownerId: owner, flowId, provider: kind, expiresAt: now + LEASE_TTL_MS,
    })
    const encoded = JSON.stringify(lease)
    if (!shared.set(LEASE_KEY, encoded)) return { ok: false, reason: 'storage_unavailable' }
    const winner = active(shared, LEASE_KEY, now)
    if (!same(winner, lease) || !tab.set(CLAIM_KEY, encoded)) {
      if (same(winner, lease)) shared.remove(LEASE_KEY)
      return { ok: false, reason: 'busy' }
    }
    return { ok: true, lease }
  }

  function owns(lease) {
    const now = Date.now()
    return same(lease, active(shared, LEASE_KEY, now)) && same(lease, active(tab, CLAIM_KEY, now))
  }

  function claimSync(expectedFlowId = '') {
    const now = Date.now()
    const mine = active(tab, CLAIM_KEY, now)
    const shell = active(shared, LEASE_KEY, now)
    if (!mine) return { status: shell ? 'conflict' : 'none' }
    if ((expectedFlowId && mine.flowId !== expectedFlowId) || !same(mine, shell)) {
      return { status: 'conflict', lease: mine }
    }
    return { status: 'claimed', lease: mine }
  }

  function releaseSync(flowId = '') {
    const mine = parseLease(tab.get(CLAIM_KEY))
    if (!mine || (flowId && mine.flowId !== flowId)) return false
    if (same(mine, parseLease(shared.get(LEASE_KEY)))) shared.remove(LEASE_KEY)
    tab.remove(CLAIM_KEY)
    return true
  }

  async function withLock(work) {
    const locks = globalThis.navigator?.locks
    if (locks && typeof locks.request === 'function') {
      try { return await locks.request(LOCK_NAME, { mode: 'exclusive' }, work) } catch {}
    }
    return work()
  }

  return Object.freeze({
    acquire: (provider, options) => withLock(async () => {
      const result = acquireSync(provider, options)
      if (!result.ok) return result
      // localStorage has no compare-and-swap. Yield once and re-read the last
      // writer so two fallback acquisitions cannot both believe they won.
      await new Promise(resolve => setTimeout(resolve, 32))
      if (owns(result.lease)) return result
      releaseSync(result.lease.flowId)
      return { ok: false, reason: 'busy' }
    }),
    claim: expectedFlowId => withLock(() => claimSync(expectedFlowId)),
    release: flowId => withLock(() => releaseSync(flowId)),
  })
}

/* --------------------------------------------------------------- transport */

/** One JSON fetch with a bounded timeout and a normalized failure shape. */
async function requestJson(url, {
  method = 'GET', headers = {}, body, timeoutMs = 15_000, signal, fallbackMessage = 'Request failed',
  timeoutMessage = 'The request timed out. Please try again.', friendlyMessages = null,
} = {}) {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) abortFromCaller()
    else signal.addEventListener('abort', abortFromCaller, { once: true })
  }
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs) : 0

  let response
  try {
    response = await fetch(url, {
      method,
      credentials: 'omit',
      signal: controller.signal,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (timedOut) throw new ChronaError(timeoutMessage, { code: 'request_timeout' })
    if (signal?.aborted) throw new ChronaError('The request was cancelled', { code: 'request_aborted', cause: error })
    throw new ChronaError(fallbackMessage, { code: 'request_failed', cause: error })
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }

  let payload = null
  try { payload = await response.json() } catch {}
  if (response.ok) return payload

  const parsed = readErrorPayload(payload)
  const code = parsed.code || `http_${response.status}`
  throw new ChronaError(friendlyMessages?.[code] || parsed.message || fallbackMessage, {
    code,
    status: response.status,
  })
}

/* ------------------------------------------------------------ profile text */

export const DISPLAY_NAME_MAX = 24
export const BIO_MAX = 240

const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} _.-]+$/u
// Control, bidi-override, and zero-width characters. They make a display name
// render as something other than what it is, so they are rejected everywhere.
const HIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ChronaError('Enter a valid email address', { code: 'invalid_email' })
  return email
}

export function normalizeOtp(value) {
  const token = String(value || '').replace(/\D/g, '').slice(0, 6)
  if (!/^\d{6}$/.test(token)) throw new ChronaError('Enter the 6-digit code', { code: 'invalid_otp' })
  return token
}

export function validateDisplayName(value) {
  const name = String(value || '').normalize('NFC').trim()
  if (!name) throw new ChronaError('Enter a display name', { code: 'invalid_display_name' })
  if (name.length > DISPLAY_NAME_MAX) {
    throw new ChronaError(`Display name must be at most ${DISPLAY_NAME_MAX} characters`, { code: 'invalid_display_name' })
  }
  if (!DISPLAY_NAME_PATTERN.test(name) || HIDDEN_TEXT.test(name)) {
    throw new ChronaError('Display name may contain letters, numbers, spaces, periods, hyphens, and underscores', {
      code: 'invalid_display_name',
    })
  }
  return name
}

export function validateBio(value) {
  const bio = String(value || '').normalize('NFC').trim()
  if (bio.length > BIO_MAX) throw new ChronaError(`Bio must be at most ${BIO_MAX} characters`, { code: 'invalid_bio' })
  if (HIDDEN_TEXT.test(bio)) throw new ChronaError('Bio cannot contain hidden control characters', { code: 'invalid_bio' })
  return bio
}

/** A stable, non-identifying name for an account that has never set one. */
export function fallbackDisplayName(userOrId) {
  const id = String(typeof userOrId === 'object' ? userOrId?.id : userOrId || 'account')
  let hash = 2166136261
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `Player-${String(hash >>> 0).padStart(10, '0').slice(-6)}`
}

function providerDisplayName(value) {
  try {
    return validateDisplayName(String(value || '').normalize('NFC').trim().slice(0, DISPLAY_NAME_MAX))
  } catch {
    return ''
  }
}

/** The player's own name and bio, falling back through provider metadata. */
export function profileFromUser(user) {
  if (!user) return { displayName: '', bio: '' }
  const metadata = user.user_metadata || {}
  let displayName
  try {
    displayName = validateDisplayName(metadata.display_name)
  } catch {
    displayName = providerDisplayName(metadata.full_name || metadata.name)
      || providerDisplayName(metadata.user_name || metadata.preferred_username)
      || fallbackDisplayName(user)
  }
  const rawBio = String(metadata.bio || '').normalize('NFC').slice(0, BIO_MAX)
  return { displayName, bio: HIDDEN_TEXT.test(rawBio) ? '' : rawBio }
}

export function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase()
  return provider === 'twitter' ? 'x' : provider
}

export const PROVIDER_LABELS = Object.freeze({ google: 'Google', discord: 'Discord', x: 'X', email: 'Email' })

/** Which provider this account signed in with, preferring the observed one. */
export function authProviderLabel(user, preferredProvider = '') {
  if (!user) return ''
  const preferred = normalizeProvider(preferredProvider)
  const providers = new Set([
    normalizeProvider(user.app_metadata?.provider),
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers.map(normalizeProvider) : []),
    ...(Array.isArray(user.identities) ? user.identities.map(identity => normalizeProvider(identity?.provider)) : []),
  ].filter(Boolean))
  const provider = preferred && providers.has(preferred)
    ? preferred
    : normalizeProvider(user.app_metadata?.provider || user.identities?.[0]?.provider)
  return PROVIDER_LABELS[provider] || ''
}

export function friendlyAuthError(message, brand = 'Third-party') {
  const text = String(message || '')
  if (/provider is not enabled|unsupported provider/i.test(text)) return `${brand} sign-in is not enabled`
  if (/unable to exchange external code/i.test(text)) {
    return `${brand} sign-in could not complete. Check the provider credentials and callback URL.`
  }
  return text || `${brand} sign-in failed. Try an email code instead.`
}

/* --------------------------------------------------------- session helpers */

/**
 * Strip the provider credentials from a session before it can be persisted,
 * published, or logged. Supabase returns them once on the OAuth exchange; they
 * are the friends linker's input and nothing else's.
 */
function splitProviderCredentials(session, preferredProvider = '') {
  if (!isPlainObject(session)) return { session: session || null, credentials: null }
  const { provider_token: providerToken, provider_refresh_token: providerRefreshToken, ...safe } = session
  const provider = normalizeProvider(
    preferredProvider || session.user?.app_metadata?.provider || session.user?.identities?.[0]?.provider,
  )
  const credentials = typeof providerToken === 'string' && providerToken && session.user?.id
    && (provider === 'x' || provider === 'discord')
    ? Object.freeze({
        provider,
        userId: session.user.id,
        accessToken: providerToken,
        refreshToken: typeof providerRefreshToken === 'string' ? providerRefreshToken : '',
      })
    : null
  return { session: safe, credentials }
}

function withExpiry(session) {
  if (!isPlainObject(session)) return null
  const expiresIn = Number(session.expires_in)
  const expiresAt = Number(session.expires_at)
  return {
    ...session,
    expires_at: Number.isFinite(expiresAt) && expiresAt > 0
      ? expiresAt
      : Math.floor(Date.now() / 1000) + (Number.isFinite(expiresIn) ? expiresIn : 3600),
  }
}

/**
 * A one-shot, in-memory relay for provider credentials. It holds a value only
 * until a listener takes it, and drops it unconditionally after `ttlMs`.
 */
function createCredentialRelay({ ttlMs = 60_000 } = {}) {
  const listeners = new Set()
  let pending = null
  let expiry = null
  let disposed = false

  const clear = () => {
    pending = null
    if (expiry !== null) clearTimeout(expiry)
    expiry = null
  }

  function deliver() {
    if (disposed || !pending || listeners.size === 0) return false
    const value = pending
    clear()
    for (const listener of [...listeners]) {
      try { listener(value) } catch {}
    }
    return true
  }

  return Object.freeze({
    publish(credentials) {
      if (disposed || !credentials) return false
      clear()
      pending = credentials
      if (!deliver()) expiry = setTimeout(() => { pending = null; expiry = null }, ttlMs)
      return true
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Credential listener must be a function')
      if (disposed) return () => {}
      listeners.add(listener)
      deliver()
      return () => listeners.delete(listener)
    },
    clear,
    destroy() { disposed = true; clear(); listeners.clear() },
  })
}

/** A monotonic guard for discarding stale asynchronous work. */
function createGenerationGuard() {
  let generation = 0
  return Object.freeze({
    capture: () => generation,
    advance: () => ++generation,
    isCurrent: candidate => candidate === generation,
  })
}

/* -------------------------------------------------------------------- auth */

export const OAUTH_SCOPES = Object.freeze({
  google: '',
  // `guilds` is what makes shared official-Discord membership discoverable.
  discord: 'identify email guilds',
  // `follows.read` + `offline.access` are what make the X Following source work.
  x: 'tweet.read users.read users.email follows.read offline.access',
})

const OAUTH_PROVIDERS = Object.freeze({
  google: Object.freeze({ label: 'Google', scopes: OAUTH_SCOPES.google, queryParams: { prompt: 'select_account' } }),
  discord: Object.freeze({ label: 'Discord', scopes: OAUTH_SCOPES.discord }),
  x: Object.freeze({ label: 'X', scopes: OAUTH_SCOPES.x }),
})

const REFRESH_SKEW_SECONDS = 60

/**
 * The account service: sign-in, the session, and the player's profile.
 *
 * Headless by construction. It owns no markup and reads no element ids; a game
 * subscribes to snapshots and renders whatever it likes. Everything the Chrona
 * product enforces around identity is enforced here too — see the invariants at
 * the top of this file.
 */
export function createAuth(config, { redirectTo } = {}) {
  const { supabaseUrl, supabasePublishableKey, storageNamespace, timeouts } = config
  const authUrl = `${supabaseUrl}/auth/v1`
  const local = safeStorage('local')
  const tab = safeStorage('session')
  const leases = createFlowLeases({ namespace: storageNamespace })
  const relay = createCredentialRelay()
  const guard = createGenerationGuard()

  const SESSION_KEY = `${storageNamespace}-session-v1`
  const VERIFIER_KEY = `${storageNamespace}-pkce-verifier`
  const PENDING_KEY = `${storageNamespace}-oauth-pending`
  const METHOD_KEY = `${storageNamespace}-auth-method`
  const EMAIL_KEY = `${storageNamespace}-account-email`

  const subscribers = new Set()
  let session = null
  let initialized = false
  let busy = false
  let statusText = ''
  let errorText = ''
  let refreshTimer = 0
  let destroyed = false
  let activeProvider = normalizeProvider(local.get(METHOD_KEY) || '')
  let pendingProvider = normalizeProvider(tab.get(PENDING_KEY) || '')

  const apiHeaders = () => ({ apikey: supabasePublishableKey })
  const headersFor = accessToken => ({
    ...apiHeaders(),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  })

  function snapshot() {
    return Object.freeze({
      initialized,
      busy,
      status: statusText,
      error: errorText,
      session,
      user: session?.user || null,
      userId: session?.user?.id || '',
      profile: profileFromUser(session?.user),
      provider: activeProvider,
      providerLabel: authProviderLabel(session?.user, activeProvider),
      lastEmail: local.get(EMAIL_KEY) || '',
    })
  }

  function publish() {
    const value = snapshot()
    for (const listener of [...subscribers]) {
      try { listener(value) } catch {}
    }
  }

  function setStatus(text = '', error = '') {
    statusText = text
    errorText = error
    publish()
  }

  function setBusy(value) {
    busy = value
    publish()
  }

  function persist(next) {
    if (!next?.user?.id) {
      local.remove(SESSION_KEY)
      return
    }
    // Only the account session is written. `splitProviderCredentials` has
    // already removed the provider tokens by the time this is reached.
    local.set(SESSION_KEY, JSON.stringify(next))
  }

  function readPersisted() {
    try {
      const value = JSON.parse(local.get(SESSION_KEY) || 'null')
      if (!isPlainObject(value) || !value.access_token || !value.user?.id) return null
      return withExpiry(value)
    } catch {
      return null
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = 0
    if (destroyed || !session?.refresh_token || !session.expires_at) return
    const delayMs = Math.max(5_000, (session.expires_at - REFRESH_SKEW_SECONDS) * 1000 - Date.now())
    refreshTimer = setTimeout(() => { void refreshSession() }, Math.min(delayMs, 0x7fffffff))
  }

  /**
   * Adopt a session. Provider credentials are split off first and delivered to
   * the relay only *after* the public snapshot has switched to the matching
   * user, so a linker can pin its request to this exact account.
   */
  function accept(rawSession, { provider = '' } = {}) {
    const { session: safe, credentials } = splitProviderCredentials(rawSession, provider || pendingProvider)
    const next = safe?.user?.id ? withExpiry(safe) : null
    const changed = (session?.user?.id || '') !== (next?.user?.id || '')
    session = next
    persist(next)
    if (next && (provider || pendingProvider)) rememberProvider(provider || pendingProvider)
    if (!next && changed) rememberProvider('')
    scheduleRefresh()
    publish()
    if (credentials) relay.publish(credentials)
    return next
  }

  function rememberProvider(provider) {
    activeProvider = normalizeProvider(provider)
    if (activeProvider) local.set(METHOD_KEY, activeProvider)
    else local.remove(METHOD_KEY)
  }

  async function refreshSession() {
    const current = session
    if (!current?.refresh_token) return null
    const generation = guard.capture()
    try {
      const payload = await requestJson(`${authUrl}/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: apiHeaders(),
        body: { refresh_token: current.refresh_token },
        timeoutMs: timeouts.authUser,
        fallbackMessage: 'Could not refresh your session',
      })
      if (destroyed || !guard.isCurrent(generation) || session?.user?.id !== current.user?.id) return null
      return accept(payload)
    } catch (error) {
      if (destroyed || !guard.isCurrent(generation)) return null
      // A revoked or expired refresh token is terminal; anything else is
      // transient and the existing access token may still be valid.
      if (error.status === 400 || error.status === 401) {
        guard.advance()
        accept(null)
      }
      return null
    }
  }

  /** A non-expired access token, refreshing first when one is about to lapse. */
  async function accessToken() {
    if (!session?.access_token) return ''
    const expiresAt = Number(session.expires_at) || 0
    if (expiresAt - REFRESH_SKEW_SECONDS <= Math.floor(Date.now() / 1000)) {
      const refreshed = await refreshSession()
      return refreshed?.access_token || ''
    }
    return session.access_token
  }

  /** Read the account behind a specific token, without touching stored state. */
  async function readUser(token, { signal } = {}) {
    const payload = await requestJson(`${authUrl}/user`, {
      headers: headersFor(token),
      timeoutMs: timeouts.authUser,
      signal,
      fallbackMessage: 'Could not validate your session',
    })
    return payload?.user || payload
  }

  /**
   * Pin an operation to the session that started it. The returned token is
   * validated against the live account before the caller uses it, so a sign-in
   * that lands mid-flight cannot inherit this request.
   */
  async function pinnedSession(startedSession, { signal } = {}) {
    if (!startedSession?.access_token || !startedSession?.user?.id) {
      throw new ChronaError('Your session has expired. Please sign in again.', {
        code: 'session_invalid',
        status: 401,
      })
    }
    const token = startedSession.access_token
    const user = await readUser(token, { signal })
    if (user?.id !== startedSession.user.id) {
      throw new ChronaError('The account changed. The request was cancelled.', { code: 'session_changed' })
    }
    return Object.freeze({
      accessToken: token,
      user,
      userId: user.id,
      headers: headersFor(token),
      /** A fetch bound to this exact account, for RPCs and Edge Functions. */
      request: (url, init = {}) => requestJson(url, {
        ...init,
        headers: { ...headersFor(token), ...(init.headers || {}) },
      }),
      updateUser: metadata => requestJson(`${authUrl}/user`, {
        method: 'PUT',
        headers: headersFor(token),
        body: { data: metadata },
        timeoutMs: timeouts.authUser,
        fallbackMessage: 'Could not save profile',
      }).then(payload => payload?.user || payload),
    })
  }

  /* ------------------------------------------------------------ OAuth start */

  function redirectUrlFor(flowId) {
    const base = redirectTo
      ? new URL(redirectTo, location.href)
      : new URL(`${location.origin}${location.pathname}`)
    base.searchParams.set(`${storageNamespace}_auth_flow`, flowId)
    return base.toString()
  }

  async function signInWithProvider(provider) {
    const kind = normalizeProvider(provider)
    const definition = OAUTH_PROVIDERS[kind]
    if (!definition) throw new ChronaError(`Unknown sign-in provider: ${provider}`, { code: 'unknown_provider' })
    if (busy) return false

    setBusy(true)
    setStatus(`Opening ${definition.label} sign-in…`)
    let lease = null
    try {
      // An explicit user action supersedes an abandoned provider page. The
      // displaced callback then fails closed on its stale flow id.
      const acquired = await leases.acquire(kind, { replaceExisting: true })
      if (!acquired.ok) {
        throw new ChronaError(acquired.reason === 'busy'
          ? 'Another sign-in is already open in this browser. Finish or cancel it, then try again.'
          : 'Secure sign-in storage is unavailable in this browser.', { code: acquired.reason })
      }
      lease = acquired.lease

      const { verifier, challenge } = await createPkcePair()
      if (!local.set(VERIFIER_KEY, verifier)) {
        throw new ChronaError('Secure sign-in storage is unavailable in this browser.', {
          code: 'storage_unavailable',
        })
      }
      pendingProvider = kind
      tab.set(PENDING_KEY, kind)
      relay.clear()

      const url = new URL(`${authUrl}/authorize`)
      url.searchParams.set('provider', kind === 'x' ? 'twitter' : kind)
      url.searchParams.set('redirect_to', redirectUrlFor(lease.flowId))
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 's256')
      if (definition.scopes) url.searchParams.set('scopes', definition.scopes)
      for (const [key, value] of Object.entries(definition.queryParams || {})) {
        url.searchParams.set(key, value)
      }
      location.assign(url.toString())
      return true
    } catch (error) {
      if (lease) await leases.release(lease.flowId)
      local.remove(VERIFIER_KEY)
      pendingProvider = ''
      tab.remove(PENDING_KEY)
      relay.clear()
      setBusy(false)
      setStatus('', friendlyAuthError(error?.message, definition.label))
      return false
    }
  }

  /* --------------------------------------------------------- OAuth callback */

  function stripAuthParams({ keepError = false } = {}) {
    if (typeof location === 'undefined' || typeof history === 'undefined') return
    const url = new URL(location.href)
    for (const key of ['code', `${storageNamespace}_auth_flow`]) url.searchParams.delete(key)
    if (!keepError) for (const key of ['error', 'error_code', 'error_description']) url.searchParams.delete(key)
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function redirectErrorFromUrl() {
    if (typeof location === 'undefined') return ''
    const url = new URL(location.href)
    const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '')
    const pick = key => url.searchParams.get(key) || hash.get(key) || ''
    return pick('error_description') || pick('error') || pick('error_code')
  }

  /**
   * Finish a PKCE callback. Runs once, before anything renders, so a failure is
   * visible rather than silently leaving the player signed out.
   */
  async function completeRedirect() {
    if (typeof location === 'undefined') return null
    const providerError = redirectErrorFromUrl()
    if (providerError) {
      stripAuthParams()
      setStatus('', friendlyAuthError(providerError, OAUTH_PROVIDERS[pendingProvider]?.label || 'Third-party'))
      pendingProvider = ''
      tab.remove(PENDING_KEY)
      await leases.release()
      return null
    }

    const url = new URL(location.href)
    const code = url.searchParams.get('code')
    if (!code) return null
    const expectedFlowId = url.searchParams.get(`${storageNamespace}_auth_flow`) || ''

    let claim = null
    try {
      claim = await leases.claim(expectedFlowId)
      if (claim.status === 'conflict') {
        throw new ChronaError('This sign-in belongs to another browser tab or has expired. Start again here.', {
          code: 'flow_conflict',
        })
      }
      const verifier = local.get(VERIFIER_KEY)
      if (!verifier) {
        throw new ChronaError('This sign-in could not be completed in this browser. Start again here.', {
          code: 'pkce_verifier_missing',
        })
      }
      const payload = await requestJson(`${authUrl}/token?grant_type=pkce`, {
        method: 'POST',
        headers: apiHeaders(),
        body: { auth_code: code, code_verifier: verifier },
        timeoutMs: timeouts.authUser,
        fallbackMessage: 'Could not complete sign-in',
      })
      if (!payload?.access_token || !payload?.user?.id) {
        throw new ChronaError('Could not complete sign-in', { code: 'exchange_failed' })
      }
      const accepted = accept(payload, { provider: pendingProvider })
      setStatus('Signed in.')
      return accepted
    } catch (error) {
      setStatus('', friendlyAuthError(error?.message, OAUTH_PROVIDERS[pendingProvider]?.label || 'Third-party'))
      return null
    } finally {
      // The authorization code is single-use, including after a failed exchange.
      local.remove(VERIFIER_KEY)
      pendingProvider = ''
      tab.remove(PENDING_KEY)
      await leases.release(claim?.lease?.flowId || '')
      stripAuthParams()
    }
  }

  /* ----------------------------------------------------------- email codes */

  async function sendEmailCode(rawEmail) {
    if (busy) return false
    let email
    try {
      email = normalizeEmail(rawEmail)
    } catch (error) {
      setStatus('', error.message)
      return false
    }
    setBusy(true)
    setStatus('Sending your sign-in code…')
    try {
      // No sign-in flow lease here on purpose. A lease exists to protect the one
      // PKCE verifier slot, and this flow never touches it: the code request
      // carries no `code_challenge`, and `verifyEmailCode` returns a session
      // from the emailed token alone. Taking one would only let an abandoned
      // provider redirect block email sign-in for the rest of its lease.
      await requestJson(`${authUrl}/otp`, {
        method: 'POST',
        headers: apiHeaders(),
        body: { email, create_user: true },
        timeoutMs: timeouts.authUser,
        fallbackMessage: 'Could not send the sign-in code',
      })
      local.set(EMAIL_KEY, email)
      setStatus('Code sent. Check your inbox.')
      return true
    } catch (error) {
      setStatus('', error?.message || 'Could not send the sign-in code')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function verifyEmailCode(rawEmail, rawCode) {
    if (busy) return false
    let email
    let token
    try {
      email = normalizeEmail(rawEmail)
      token = normalizeOtp(rawCode)
    } catch (error) {
      setStatus('', error.message)
      return false
    }
    setBusy(true)
    setStatus('Verifying your sign-in code…')
    try {
      const payload = await requestJson(`${authUrl}/verify`, {
        method: 'POST',
        headers: apiHeaders(),
        body: { email, token, type: 'email' },
        timeoutMs: timeouts.authUser,
        fallbackMessage: 'The code is invalid or expired',
      })
      if (!payload?.access_token || !payload?.user?.id) {
        throw new ChronaError('The code is invalid or expired', { code: 'otp_invalid' })
      }
      accept(payload, { provider: 'email' })
      setStatus('Signed in.')
      return true
    } catch (error) {
      setStatus('', error?.message || 'The code is invalid or expired')
      return false
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------------------------------------ profile and exit */

  async function saveProfile({ displayName: rawName, bio: rawBio = '' } = {}) {
    const current = session
    if (!current?.user?.id || busy) return false
    let displayName
    let bio
    try {
      displayName = validateDisplayName(rawName)
      bio = validateBio(rawBio)
    } catch (error) {
      setStatus('', error.message)
      return false
    }

    const userId = current.user.id
    setBusy(true)
    setStatus('Saving profile…')
    try {
      const pinned = await pinnedSession(current)
      if (pinned.userId !== userId || session?.user?.id !== userId) {
        throw new ChronaError('Account changed. Profile save cancelled.', { code: 'session_changed' })
      }
      const updated = await pinned.updateUser({ display_name: displayName, bio })
      if (updated?.id !== userId) throw new ChronaError('Could not save profile', { code: 'profile_save_failed' })
      if (session?.user?.id !== userId) {
        throw new ChronaError('Account changed. Profile save cancelled.', { code: 'session_changed' })
      }
      accept({ ...session, user: updated })
      setStatus('Profile saved.')
      return true
    } catch (error) {
      if (session?.user?.id === userId) setStatus('', error?.message || 'Could not save profile')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (busy) return false
    if (!session?.user) return true
    const token = session.access_token
    setBusy(true)
    setStatus('Signing out…')
    try {
      // Best effort: the local session is cleared even when the server call
      // fails, so a player is never stuck signed in on a shared machine.
      await requestJson(`${authUrl}/logout?scope=local`, {
        method: 'POST',
        headers: headersFor(token),
        body: {},
        timeoutMs: timeouts.authUser,
        fallbackMessage: 'Could not sign out',
      }).catch(() => null)
      guard.advance()
      relay.clear()
      accept(null)
      setStatus('Signed out.')
      return true
    } finally {
      setBusy(false)
    }
  }

  /** Which sign-in methods this Supabase project actually has enabled. */
  async function enabledProviders({ signal } = {}) {
    const payload = await requestJson(`${authUrl}/settings`, {
      headers: apiHeaders(),
      timeoutMs: timeouts.authSettings,
      signal,
      fallbackMessage: 'Could not load authentication settings',
    })
    const external = payload?.external || {}
    return Object.freeze({
      google: external.google !== false,
      discord: external.discord !== false,
      x: Object.prototype.hasOwnProperty.call(external, 'x') ? external.x !== false : external.twitter !== false,
      email: external.email !== false,
    })
  }

  /* ------------------------------------------------------------------ boot */

  const ready = (async () => {
    const redirected = await completeRedirect()
    if (destroyed) return auth
    if (!redirected) {
      const stored = readPersisted()
      if (stored) {
        session = stored
        // Trust the stored session only after the server confirms it. An
        // expired one is refreshed; a revoked one is dropped.
        const token = await accessToken()
        if (token) {
          try {
            const user = await readUser(token)
            if (!destroyed && user?.id === session?.user?.id) accept({ ...session, user })
          } catch (error) {
            if (!destroyed && (error.status === 401 || error.status === 403)) accept(null)
          }
        } else if (!destroyed) {
          accept(null)
        }
      }
    }
    if (destroyed) return auth
    // Reaching a page load at all means any provider flow this tab started is
    // over — it either came back with a code above, or was abandoned. Release
    // the lease so an abandoned redirect cannot block the next sign-in for the
    // rest of its TTL. `release` only touches a claim this tab owns, so a flow
    // live in another tab is left alone.
    await leases.release()
    initialized = true
    scheduleRefresh()
    publish()
    return auth
  })()

  const auth = Object.freeze({
    ready,
    get session() { return session },
    get user() { return session?.user || null },
    get userId() { return session?.user?.id || '' },
    get profile() { return profileFromUser(session?.user) },
    get initialized() { return initialized },
    snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Account subscriber must be a function')
      subscribers.add(listener)
      listener(snapshot())
      return () => subscribers.delete(listener)
    },
    /**
     * One-shot X / Discord provider credentials, in memory only. The friends
     * service is the intended consumer; a game should not need this.
     */
    onProviderCredentials: listener => relay.subscribe(listener),
    signInWithProvider,
    sendEmailCode,
    verifyEmailCode,
    saveProfile,
    signOut,
    enabledProviders,
    accessToken,
    pinnedSession,
    clearMessages: () => setStatus('', ''),
    destroy() {
      destroyed = true
      guard.advance()
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = 0
      relay.destroy()
      subscribers.clear()
    },
  })

  return auth
}

/* ----------------------------------------------------------------- friends */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const AVATAR_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:webp|jpe?g|png)$/i
const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/

export const FRIEND_SOURCES = Object.freeze(['x', 'discord'])

export const FRIEND_SOURCE_LABELS = Object.freeze({
  x: 'You follow them on X',
  discord: 'You share the official Discord',
})

export const X_FRIENDS_PARTIAL_NOTICE = 'Showing matches from your currently synced X Following.'

const FRIENDS_REFRESH_MS = 30_000
const LINK_RETRY_TTL_MS = 5 * 60_000

/** A profile avatar in Chrona storage, or nothing. The path must be the owner's own. */
export function profileAvatarUrl(playerId, avatarPath, supabaseUrl) {
  const id = String(playerId || '')
  const [owner, file, extra] = String(avatarPath || '').split('/')
  if (!UUID.test(id) || extra !== undefined
    || owner?.toLowerCase() !== id.toLowerCase() || !AVATAR_FILE.test(file || '')) return ''
  return `${supabaseUrl}/storage/v1/object/public/profile-avatars/${encodeURIComponent(owner)}/${encodeURIComponent(file)}`
}

/**
 * An avatar URL is rendered into the game, so its host is allow-listed rather
 * than trusted. Anything else — including a redirect target the server chose —
 * is dropped instead of loaded.
 */
export function safeAvatarUrl(value, supabaseUrl) {
  try {
    const url = new URL(String(value || ''))
    const supabase = new URL(String(supabaseUrl || ''))
    const host = url.hostname.toLowerCase()
    const providerHost = host === 'twimg.com' || host.endsWith('.twimg.com')
      || host === 'cdn.discordapp.com' || host === 'lh3.googleusercontent.com'
    const providerAvatar = url.protocol === 'https:' && !url.port && providerHost
    const localSupabase = supabase.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(supabase.hostname.toLowerCase())
    const supabaseAvatar = url.origin === supabase.origin
      && (url.protocol === 'https:' || (url.protocol === 'http:' && localSupabase))
    if (url.username || url.password || (!providerAvatar && !supabaseAvatar)) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function safeText(value, maxLength) {
  const text = String(value || '').normalize('NFC').trim().slice(0, maxLength)
  return text && !HIDDEN_TEXT.test(text) ? text : ''
}

function safeTimestamp(value) {
  const timestamp = Date.parse(String(value || ''))
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function normalizeFriend(value, supabaseUrl) {
  const playerId = String(value?.playerId || '')
  if (!UUID.test(playerId)) return null
  const displayName = safeText(value?.displayName, 48)
  if (!displayName) return null

  const rawUsername = String(value?.xUsername || '').replace(/^@/, '').trim()
  const provider = normalizeProvider(value?.provider)
  const rawSources = new Set((Array.isArray(value?.sources) ? value.sources : []).map(normalizeProvider))
  const storedAvatar = profileAvatarUrl(playerId, value?.avatarPath, supabaseUrl)

  return Object.freeze({
    playerId: playerId.toLowerCase(),
    displayName,
    avatarUrl: storedAvatar || safeAvatarUrl(value?.avatarUrl ?? value?.providerAvatarUrl, supabaseUrl) || null,
    xUsername: X_USERNAME.test(rawUsername) ? rawUsername : null,
    provider: Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, provider) ? provider : null,
    sources: Object.freeze(FRIEND_SOURCES.filter(source => rawSources.has(source))),
  })
}

const byDisplayName = (left, right) =>
  left.displayName.localeCompare(right.displayName, 'en', { sensitivity: 'base' })
  || left.playerId.localeCompare(right.playerId)

/** Validate and sort whatever the discovery RPC returned. Server output is input. */
export function normalizeFriendsResponse(value, supabaseUrl) {
  const rawConnected = new Set((Array.isArray(value?.connectedSources) ? value.connectedSources : [])
    .map(normalizeProvider))
  const seen = new Set()
  const friends = []
  for (const raw of Array.isArray(value?.friends) ? value.friends : []) {
    const friend = normalizeFriend(raw, supabaseUrl)
    if (!friend || seen.has(friend.playerId)) continue
    seen.add(friend.playerId)
    friends.push(friend)
  }
  const followingSync = isPlainObject(value?.followingSync)
    ? Object.freeze({
        status: safeText(value.followingSync.status, 24) || 'unknown',
        lastSyncAt: safeTimestamp(value.followingSync.lastSyncAt),
        isPartial: value.followingSync.isPartial === true,
      })
    : null
  return Object.freeze({
    sourcesRequired: value?.sourcesRequired === true,
    connectedSources: Object.freeze(FRIEND_SOURCES.filter(source => rawConnected.has(source))),
    followingSync,
    friends: Object.freeze(friends.sort(byDisplayName)),
  })
}

function isRetryableLinkError(error) {
  const code = String(error?.code || '')
  return Number(error?.status || 0) >= 500
    || ['request_timeout', 'request_failed', 'functions_fetch_error', 'functions_relay_error'].includes(code)
}

/**
 * Friend discovery, and the linking of the two sources that feed it.
 *
 * Two account-level relationship sources, both discovery signals rather than a
 * mutual request system:
 *
 *   x        accounts that appear in the viewer's saved X Following snapshot;
 *   discord  accounts that, like the viewer, are in the official Discord.
 *
 * The browser never says whose friends it wants. `chrona_social_friends` is a
 * security-definer RPC that takes the viewer from `auth.uid()` alone.
 */
export function createFriends(config, { auth }) {
  if (!auth || typeof auth.subscribe !== 'function') {
    throw new TypeError('createFriends requires the auth service')
  }
  const { supabaseUrl, supabasePublishableKey, functions, timeouts } = config
  const restUrl = `${supabaseUrl}/rest/v1`
  const functionsUrl = `${supabaseUrl}/functions/v1`

  const subscribers = new Set()
  const handledGrants = new Set()

  let active = true
  let currentUserId = auth.userId
  let state = 'idle'
  let result = null
  let statusText = ''
  let syncText = ''
  let errorText = ''
  let linkErrorText = ''
  let lastRequestedAt = 0
  let loadSerial = 0
  let loadController = null
  let linkSerial = 0
  let linkController = null
  let retryTimer = 0
  let pendingRetry = null

  function snapshot() {
    return Object.freeze({
      state,
      visible: !!currentUserId,
      friends: result?.friends || Object.freeze([]),
      count: result?.friends?.length || 0,
      connectedSources: result?.connectedSources || Object.freeze([]),
      sourcesRequired: result?.sourcesRequired === true,
      followingPartial: result?.followingSync?.isPartial === true,
      followingSync: result?.followingSync || null,
      syncing: !!syncText,
      status: syncText || statusText,
      error: [linkErrorText, errorText].filter(Boolean).join(' '),
      canRetryLink: !!pendingRetry,
    })
  }

  function publish() {
    if (!subscribers.size) return
    const value = snapshot()
    for (const listener of [...subscribers]) {
      try { listener(value) } catch {}
    }
  }

  function clearRetry() {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = 0
    pendingRetry = null
  }

  /**
   * Keep an unsaved provider grant in memory, and only in memory, so a player
   * can retry after a transient failure. It is dropped after five minutes
   * whether or not anyone retried.
   */
  function keepForRetry(credentials) {
    clearRetry()
    pendingRetry = credentials
    retryTimer = setTimeout(() => {
      const expired = pendingRetry
      retryTimer = 0
      pendingRetry = null
      if (!active || auth.userId !== expired?.userId) return
      linkErrorText = `${PROVIDER_LABELS[expired.provider]} authorization expired before it could be saved. `
        + `Sign in with ${PROVIDER_LABELS[expired.provider]} again.`
      publish()
    }, LINK_RETRY_TTL_MS)
  }

  function cancelLoad({ resetState = true } = {}) {
    loadSerial++
    loadController?.abort()
    loadController = null
    if (resetState && state === 'loading') state = result ? 'ready' : 'idle'
  }

  function cancelLink() {
    linkSerial++
    linkController?.abort()
    linkController = null
    syncText = ''
  }

  function resetForUser(userId) {
    cancelLoad({ resetState: false })
    cancelLink()
    clearRetry()
    currentUserId = userId
    state = 'idle'
    result = null
    statusText = ''
    syncText = ''
    errorText = ''
    linkErrorText = ''
    lastRequestedAt = 0
    publish()
  }

  /** The viewer-bound discovery RPC. It accepts no viewer, room, or mode. */
  async function callFriendsRpc(pinned, { signal } = {}) {
    const payload = await pinned.request(`${restUrl}/rpc/chrona_social_friends`, {
      method: 'POST',
      headers: { apikey: supabasePublishableKey },
      body: { p_limit: 100 },
      timeoutMs: timeouts.functions,
      signal,
      fallbackMessage: 'Could not load people you may know',
      friendlyMessages: {
        '42501': 'Your session has expired. Please sign in again.',
        authentication_required: 'Your session has expired. Please sign in again.',
      },
    })
    if (!isPlainObject(payload) || typeof payload.sourcesRequired !== 'boolean'
      || !Array.isArray(payload.connectedSources) || !Array.isArray(payload.friends)
      || payload.friends.length > 100) {
      throw new ChronaError('The social service returned an invalid response', {
        code: 'friends_invalid_response',
        status: 502,
      })
    }
    return payload
  }

  async function refresh({ force = false, quiet = false } = {}) {
    const userId = auth.userId
    if (!userId || userId !== currentUserId) return null
    if (!force && lastRequestedAt && Date.now() - lastRequestedAt < FRIENDS_REFRESH_MS) return result

    const startedSession = auth.session
    cancelLoad({ resetState: false })
    const serial = loadSerial
    const controller = new AbortController()
    loadController = controller
    lastRequestedAt = Date.now()
    state = 'loading'
    if (!quiet) statusText = ''
    errorText = ''
    publish()

    try {
      const pinned = await auth.pinnedSession(startedSession, { signal: controller.signal })
      if (!active || serial !== loadSerial || pinned.userId !== userId || auth.userId !== userId) return null
      const payload = await callFriendsRpc(pinned, { signal: controller.signal })
      if (!active || serial !== loadSerial || auth.userId !== userId || currentUserId !== userId) return null
      result = normalizeFriendsResponse(payload, supabaseUrl)
      state = 'ready'
      statusText = result.connectedSources.length
        ? `Connected through ${result.connectedSources.map(source => PROVIDER_LABELS[source]).join(' and ')}.`
        : ''
      errorText = ''
      publish()
      return result
    } catch (error) {
      if (!active || serial !== loadSerial || controller.signal.aborted || auth.userId !== userId) return null
      state = 'error'
      statusText = ''
      errorText = error?.message || 'Could not load people you may know'
      publish()
      return null
    } finally {
      if (serial === loadSerial && loadController === controller) loadController = null
    }
  }

  function invokeFunction(pinned, slug, body, { signal, timeoutMs = timeouts.functions, timeoutMessage } = {}) {
    return pinned.request(`${functionsUrl}/${slug}`, {
      method: 'POST',
      headers: { apikey: supabasePublishableKey },
      body,
      timeoutMs,
      signal,
      fallbackMessage: `${slug} request failed`,
      ...(timeoutMessage ? { timeoutMessage } : {}),
    })
  }

  /** One automatic link attempt per account and provider; retries are explicit. */
  function rememberGrant(userId, provider) {
    const key = `${userId}:${provider}`
    if (handledGrants.has(key)) return false
    handledGrants.add(key)
    return true
  }

  /**
   * Turn a one-shot provider credential into a durable friend source.
   *
   * The credential arrives in memory from the account service and leaves this
   * function the same way. Only the server-side linker sees it, and the X
   * function is the only thing that ever stores one, encrypted.
   */
  async function linkSource(credentials, { retry = false } = {}) {
    if (!isPlainObject(credentials)) return null
    const provider = normalizeProvider(credentials.provider)
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : ''
    const refreshToken = typeof credentials.refreshToken === 'string' ? credentials.refreshToken : ''
    const userId = String(credentials.userId || '')
    if (!FRIEND_SOURCES.includes(provider) || !accessToken || !userId) return null
    if (auth.userId !== userId) return null
    if (!retry && !rememberGrant(userId, provider)) return null
    if (retry) clearRetry()

    const startedSession = auth.session
    // A discovery request may already be in flight from boot. It cannot see the
    // source being linked now, and must not race this call's errors.
    cancelLoad()
    cancelLink()
    const serial = linkSerial
    const controller = new AbortController()
    linkController = controller
    linkErrorText = ''
    syncText = provider === 'x'
      ? 'Connecting your X Following…'
      : 'Checking your Discord membership…'
    publish()
    let saved = false

    try {
      if (provider === 'x' && !refreshToken) {
        throw new ChronaError('X did not return a renewable token. Sign in with X again to sync your Following.', {
          code: 'x_refresh_token_missing',
        })
      }
      const pinned = await auth.pinnedSession(startedSession, { signal: controller.signal })
      if (!active || serial !== linkSerial || pinned.userId !== userId || auth.userId !== userId) return null

      if (provider === 'discord') {
        const linked = await invokeFunction(pinned, functions.discord, {
          action: 'guild_link',
          providerAccessToken: accessToken,
        }, { signal: controller.signal })
        if (!active || serial !== linkSerial || auth.userId !== userId) return null
        saved = true
        clearRetry()
        syncText = ''
        statusText = linked?.inOfficialGuild
          ? 'Discord is connected as a friend source.'
          : 'Discord is connected. Join the official Discord to use it as a friend source.'
      } else {
        const linked = await invokeFunction(pinned, functions.x, {
          action: 'provider_link',
          providerAccessToken: accessToken,
          providerRefreshToken: refreshToken,
        }, { signal: controller.signal })
        if (!active || serial !== linkSerial || auth.userId !== userId) return null
        saved = true
        clearRetry()

        if (linked?.shouldInitialSync === false) {
          syncText = ''
          statusText = 'X Following is already connected.'
        } else {
          syncText = 'Syncing your X Following…'
          publish()
          const synced = await invokeFunction(pinned, functions.x, { action: 'sync', initialOnly: true }, {
            signal: controller.signal,
            timeoutMs: timeouts.xSync,
            timeoutMessage: 'X Following sync is taking longer than expected. It may continue in the background; refresh friends shortly.',
          })
          if (!active || serial !== linkSerial || auth.userId !== userId) return null
          syncText = ''
          if (synced?.status === 'partial') {
            statusText = X_FRIENDS_PARTIAL_NOTICE
          } else {
            const fetched = Number(synced?.fetched)
            statusText = Number.isFinite(fetched)
              ? `X Following synced · ${fetched.toLocaleString('en-US')}`
              : 'X Following synced.'
          }
        }
      }

      publish()
      await refresh({ force: true, quiet: true })
      return true
    } catch (error) {
      if (!active || serial !== linkSerial || controller.signal.aborted || auth.userId !== userId) return null
      syncText = ''
      const canRetry = !saved && isRetryableLinkError(error)
      if (canRetry) keepForRetry({ provider, accessToken, refreshToken, userId })
      const base = error?.message || `Could not connect ${PROVIDER_LABELS[provider]}`
      linkErrorText = canRetry ? `${base} Retry the connection to try again.` : base
      publish()
      return null
    } finally {
      if (serial === linkSerial && linkController === controller) linkController = null
    }
  }

  function retryLink() {
    const pending = pendingRetry
    if (!pending || pending.userId !== auth.userId) return Promise.resolve(null)
    return linkSource(pending, { retry: true })
  }

  const unsubscribeAuth = auth.subscribe(next => {
    const nextUserId = next.userId || ''
    if (nextUserId !== currentUserId) {
      resetForUser(nextUserId)
      if (nextUserId && next.initialized) void refresh({ force: true, quiet: true })
      return
    }
    if (nextUserId && next.initialized && !linkController && !result && !lastRequestedAt) {
      void refresh({ force: true, quiet: true })
    }
  })

  const unsubscribeCredentials = auth.onProviderCredentials(credentials => {
    if (active) void linkSource(credentials)
  })

  return Object.freeze({
    snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Friends subscriber must be a function')
      subscribers.add(listener)
      listener(snapshot())
      return () => subscribers.delete(listener)
    },
    get friends() { return result?.friends || [] },
    refresh: options => refresh({ force: true, ...options }),
    linkSource,
    retryLink,
    destroy() {
      if (!active) return
      active = false
      cancelLoad({ resetState: false })
      cancelLink()
      clearRetry()
      subscribers.clear()
      unsubscribeAuth?.()
      unsubscribeCredentials?.()
    },
  })
}

/* ----------------------------------------------------------------- facade */

/**
 * Build the whole Chrona layer in one call.
 *
 *   const chrona = createChronaConnect()
 *   await chrona.ready
 *   chrona.auth.subscribe(state => { ... })
 *
 * Options:
 *   supabaseUrl, supabasePublishableKey, controlPlaneUrl   point at another deployment
 *   storageNamespace   isolate browser storage when two games share an origin
 *   redirectTo         where a provider should return to (defaults to this page)
 *   friends: false     skip friend discovery entirely
 *
 * Multiplayer is not built here. Call `chrona.presence({ gameId })` when a game
 * actually needs it; that import is deferred so an account-only game never
 * downloads the netcode client.
 */
export function createChronaConnect(options = {}) {
  const { redirectTo, friends: wantFriends = true, ...overrides } = options || {}
  const config = resolveConfig(overrides)
  const auth = createAuth(config, { redirectTo })
  const friends = wantFriends ? createFriends(config, { auth }) : null

  let presenceClient = null
  let presenceWork = null
  let presenceMode = null
  let worldSession = null

  const connect = Object.freeze({
    config,
    auth,
    friends,
    /** Resolves once the sign-in callback is settled and the session is known. */
    ready: auth.ready.then(() => connect),

    /**
     * Lazily build the multiplayer client. Repeat calls return the same one.
     * `gameId` must be registered with the control plane — see
     * references/operator-setup.md.
     *
     * Passing `worldId` switches on Worlds mode: a seat lease is taken in that
     * World and every player who calls `enterWorld()` converges on the same
     * room, with no room code changing hands. Without it the client is in rooms
     * mode, where `host()` opens a new room and `join(code)` enters a known one.
     */
    presence({ worldId = '', livemode = false, ...presenceOptions } = {}) {
      // One presence client per session: the authority allows one connection
      // per account, so a second one would just replace the first. Repeat calls
      // return the same client — but only when they ask for the same thing.
      // Silently handing back a rooms-mode client to a caller that asked for a
      // World would look exactly like multiplayer being broken.
      const wanted = `${worldId.toLowerCase()}:${livemode}`
      if (presenceMode !== null && presenceMode !== wanted) {
        throw new ChronaError(
          'This session already has a presence client in a different mode. '
          + 'Call destroy() on the chrona-connect instance and build a new one to switch between rooms and Worlds mode.',
          { code: 'presence_mode_conflict' },
        )
      }
      presenceMode = wanted
      if (presenceClient) return Promise.resolve(presenceClient)
      if (presenceWork) return presenceWork
      presenceWork = Promise.all([
        import('./chrona-presence.js'),
        worldId ? import('./chrona-worlds.js') : null,
      ])
        .then(([presenceModule, worldsModule]) => {
          const world = worldsModule
            ? worldsModule.createWorldSession(config, { auth, worldId, livemode })
            : null
          presenceClient = presenceModule.createPresence(config, { auth, world, ...presenceOptions })
          worldSession = world
          return presenceClient
        })
        .catch(error => {
          presenceWork = null
          presenceMode = null
          throw error
        })
      return presenceWork
    },

    /**
     * The Worlds this account can enter, for letting a player pick one or for
     * confirming a `worldId` before using it. `livemode` selects the payment
     * environment; a World created in test mode does not exist in live mode.
     */
    worlds({ livemode = false, signal } = {}) {
      return import('./chrona-worlds.js')
        .then(module => module.listWorlds(config, { auth, livemode, signal }))
    },

    destroy() {
      presenceClient?.destroy()
      // Releasing the seat matters: it is capacity someone else could use.
      void worldSession?.release()
      worldSession?.destroy()
      presenceClient = null
      presenceWork = null
      presenceMode = null
      worldSession = null
      friends?.destroy()
      auth.destroy()
    },
  })

  return connect
}

export default createChronaConnect
