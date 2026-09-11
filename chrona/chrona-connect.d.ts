/** Type declarations for chrona-connect. The runtime is plain ES modules. */

export declare class ChronaError extends Error {
  readonly code: string
  readonly status: number
}

export type ChronaProvider = 'google' | 'discord' | 'x' | 'email'
export type FriendSource = 'x' | 'discord'

export interface ChronaConfigInput {
  supabaseUrl?: string
  supabasePublishableKey?: string
  controlPlaneUrl?: string
  /** Isolates browser storage. Give each game on a shared origin its own. */
  storageNamespace?: string
  functions?: { x?: string; discord?: string; worlds?: string }
  timeouts?: Partial<Record<'authSettings' | 'authUser' | 'functions' | 'xSync', number>>
}

export interface ChronaConfig {
  readonly supabaseUrl: string
  readonly supabasePublishableKey: string
  readonly controlPlaneUrl: string
  readonly storageNamespace: string
  readonly functions: { readonly x: string; readonly discord: string; readonly worlds: string }
  readonly timeouts: Readonly<Record<'authSettings' | 'authUser' | 'functions' | 'xSync', number>>
}

export interface ChronaUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
  identities?: Array<Record<string, unknown>>
}

export interface ChronaSession {
  access_token: string
  refresh_token?: string
  expires_at?: number
  user: ChronaUser
}

export interface ChronaProfile {
  /** Always non-empty and safe to render as text once signed in. */
  displayName: string
  bio: string
}

export interface AuthState {
  /** False until the session is resolved; render a neutral state until then. */
  initialized: boolean
  busy: boolean
  status: string
  error: string
  session: ChronaSession | null
  user: ChronaUser | null
  /** '' when signed out. */
  userId: string
  profile: ChronaProfile
  provider: ChronaProvider | ''
  providerLabel: string
  lastEmail: string
}

export interface PinnedSession {
  readonly accessToken: string
  readonly user: ChronaUser
  readonly userId: string
  readonly headers: Record<string, string>
  request<T = unknown>(url: string, init?: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
    timeoutMs?: number
    signal?: AbortSignal
    fallbackMessage?: string
    timeoutMessage?: string
    friendlyMessages?: Record<string, string> | null
  }): Promise<T>
  updateUser(metadata: Record<string, unknown>): Promise<ChronaUser>
}

export interface ChronaAuth {
  readonly ready: Promise<ChronaAuth>
  readonly session: ChronaSession | null
  readonly user: ChronaUser | null
  readonly userId: string
  readonly profile: ChronaProfile
  readonly initialized: boolean
  snapshot(): Readonly<AuthState>
  /** Fires immediately with the current state, then on every change. */
  subscribe(listener: (state: Readonly<AuthState>) => void): () => void
  onProviderCredentials(listener: (credentials: {
    provider: FriendSource
    userId: string
    accessToken: string
    refreshToken: string
  }) => void): () => void
  signInWithProvider(provider: 'google' | 'discord' | 'x'): Promise<boolean>
  sendEmailCode(email: string): Promise<boolean>
  verifyEmailCode(email: string, code: string): Promise<boolean>
  saveProfile(profile: { displayName: string; bio?: string }): Promise<boolean>
  signOut(): Promise<boolean>
  enabledProviders(options?: { signal?: AbortSignal }): Promise<Readonly<Record<ChronaProvider, boolean>>>
  /** A non-expired access token, refreshing first when one is about to lapse. */
  accessToken(): Promise<string>
  /** Pin an operation to one account; fails if the signed-in account changed. */
  pinnedSession(session: ChronaSession | null, options?: { signal?: AbortSignal }): Promise<PinnedSession>
  clearMessages(): void
  destroy(): void
}

export interface ChronaFriend {
  readonly playerId: string
  readonly displayName: string
  /** Host-allow-listed, or null. */
  readonly avatarUrl: string | null
  readonly xUsername: string | null
  readonly provider: ChronaProvider | null
  /** Why this person is known: X Following, shared Discord, or both. */
  readonly sources: readonly FriendSource[]
}

export interface FriendsState {
  state: 'idle' | 'loading' | 'ready' | 'error'
  visible: boolean
  friends: readonly ChronaFriend[]
  count: number
  connectedSources: readonly FriendSource[]
  /** True when no friend source is connected yet. */
  sourcesRequired: boolean
  followingPartial: boolean
  followingSync: { status: string; lastSyncAt: string | null; isPartial: boolean } | null
  syncing: boolean
  status: string
  error: string
  canRetryLink: boolean
}

export interface ChronaFriends {
  readonly friends: readonly ChronaFriend[]
  snapshot(): Readonly<FriendsState>
  subscribe(listener: (state: Readonly<FriendsState>) => void): () => void
  refresh(options?: { quiet?: boolean }): Promise<unknown>
  retryLink(): Promise<unknown>
  destroy(): void
}

export interface PresenceOptions {
  /** Must be registered with the control plane. */
  gameId: string
  /** Switches on Worlds mode: everyone entering this World shares one room. */
  worldId?: string
  /** Payment environment the World lives in. Test mode by default. */
  livemode?: boolean
  /** Omit for the newest release. There is no 'latest' literal. */
  gameVersion?: string
  protocolVersion?: number
  maxPlayers?: number
  defaultName?: string
  interpolationDelayMs?: number
  maxExtrapolationMs?: number
  /** A remote jump larger than this teleports instead of interpolating. */
  snapDistance?: number
  controlPlaneUrl?: string
}

export interface PresencePlayer {
  id: string
  name: string
  self: boolean
  connected: boolean
  x: number
  y: number
  z: number
  yaw: number
  speed: number
  lastProcessedInput?: number
}

export interface PresenceState {
  state: 'offline' | 'connecting' | 'room'
  roomCode: string | null
  selfId: string | null
  players: readonly PresencePlayer[]
  count: number
  ping: number
  gameId: string
  /** Last authority snapshot timestamp; null before a snapshot, absent on older hosts. */
  serverTimeMs?: number | null
}

export interface RemoteSample {
  id: string
  position: { x: number; y: number; z: number }
  yaw: number
  velocity?: { x: number; y: number; z: number }
}

export type PresenceEvent = 'state' | 'roster' | 'snapshot' | 'joined' | 'left' | 'error' | 'session-replaced'

export interface ChronaWorld {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly visibility: string
  readonly gameId: string
  readonly capacity: number | null
  readonly role: string
}

export interface ChronaPresence {
  /**
   * Worlds mode. Reserves a seat in the configured World and joins the room it
   * is bound to, so every player who calls this lands together. Needs `worldId`
   * on `presence()`; throws otherwise.
   */
  enterWorld(options?: Record<string, unknown>): Promise<{ roomCode: string; selfId: string; world: ChronaWorld | null }>
  snapshot(): Readonly<PresenceState>
  subscribe(listener: (state: Readonly<PresenceState>) => void): () => void
  on(event: PresenceEvent, listener: (detail: Record<string, unknown>) => void): () => void
  host(options?: { maxPlayers?: number }): Promise<{ roomCode: string; selfId: string }>
  join(roomCode: string, options?: Record<string, unknown>): Promise<{ roomCode: string; selfId: string }>
  leave(): Promise<void>
  state(): PresenceState['state']
  roomCode(): string | null
  selfId(): string | null
  players(): readonly PresencePlayer[]
  ping(): number
  displayName(): string
  /** Call on a fixed 25 ms accumulator. Returns -1 when the room is not ready. */
  sendInput(input: { x?: number; y?: number; z?: number; yaw?: number; char?: 0 | 1 }): number
  /** The interpolated transform of one remote player, for this frame. */
  sample(id: string): RemoteSample | undefined
  destroy(): void
}

export interface ChronaConnect {
  readonly config: ChronaConfig
  readonly auth: ChronaAuth
  /** null when constructed with `friends: false`. */
  readonly friends: ChronaFriends | null
  readonly ready: Promise<ChronaConnect>
  /** Lazily builds the multiplayer client; repeat calls return the same one. */
  presence(options: PresenceOptions): Promise<ChronaPresence>
  /** The Worlds this account can enter. */
  worlds(options?: { livemode?: boolean; signal?: AbortSignal }): Promise<ChronaWorld[]>
  destroy(): void
}

export interface ChronaConnectOptions extends ChronaConfigInput {
  /** Where a provider should return to. Defaults to the current page. */
  redirectTo?: string
  /** false skips friend discovery entirely. */
  friends?: boolean
}

/** Build the whole Chrona layer. Must run on every page load. */
export declare function createChronaConnect(options?: ChronaConnectOptions): ChronaConnect
export default createChronaConnect

export declare function createAuth(config: ChronaConfig, options?: { redirectTo?: string }): ChronaAuth
export declare function createFriends(config: ChronaConfig, deps: { auth: ChronaAuth }): ChronaFriends
export declare function resolveConfig(...overrides: ChronaConfigInput[]): ChronaConfig

export declare const DISPLAY_NAME_MAX: number
export declare const BIO_MAX: number
export declare const OAUTH_SCOPES: Readonly<Record<'google' | 'discord' | 'x', string>>
export declare const PROVIDER_LABELS: Readonly<Record<ChronaProvider, string>>
export declare const FRIEND_SOURCES: readonly FriendSource[]
export declare const FRIEND_SOURCE_LABELS: Readonly<Record<FriendSource, string>>
export declare const X_FRIENDS_PARTIAL_NOTICE: string

export declare function normalizeEmail(value: unknown): string
export declare function normalizeOtp(value: unknown): string
export declare function validateDisplayName(value: unknown): string
export declare function validateBio(value: unknown): string
export declare function fallbackDisplayName(userOrId: unknown): string
export declare function profileFromUser(user: ChronaUser | null | undefined): ChronaProfile
export declare function normalizeProvider(value: unknown): string
export declare function authProviderLabel(user: ChronaUser | null | undefined, preferred?: string): string
export declare function friendlyAuthError(message: unknown, brand?: string): string
export declare function safeAvatarUrl(value: unknown, supabaseUrl: string): string
export declare function profileAvatarUrl(playerId: unknown, avatarPath: unknown, supabaseUrl: string): string
export declare function normalizeFriendsResponse(value: unknown, supabaseUrl: string): Readonly<{
  sourcesRequired: boolean
  connectedSources: readonly FriendSource[]
  followingSync: { status: string; lastSyncAt: string | null; isPartial: boolean } | null
  friends: readonly ChronaFriend[]
}>
