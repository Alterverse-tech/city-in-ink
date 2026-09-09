/** Type declarations for the multiplayer client. */
import type { ChronaAuth, ChronaConfig, ChronaPresence, PresenceOptions } from './chrona-connect.js'

/** The fixed simulation step the authority expects input on. */
export declare const INPUT_STEP_MS: number
export declare function normalizeRoomCode(value: unknown): string
export declare function createPresence(
  config: ChronaConfig,
  options: PresenceOptions & { auth: ChronaAuth },
): ChronaPresence
