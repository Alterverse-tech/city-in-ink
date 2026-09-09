/** Type declarations for the optional drop-in account panel. */
import type { ChronaConnect } from './chrona-connect.js'

export interface ChronaUIOptions {
  /** Where the trigger is appended. Prefer document.body: a transformed
   *  ancestor becomes a containing block and traps the fixed panel. */
  container?: HTMLElement
  /** false renders the trigger inline instead of fixed to the viewport. */
  floating?: boolean
  title?: string
  signedOutText?: string
  showFriends?: boolean
}

export interface ChronaUI {
  /** The shadow root, for theming via the --cc-* custom properties. */
  readonly root: ShadowRoot
  readonly isOpen: boolean
  open(): void
  close(): void
  destroy(): void
}

export declare function mountChronaUI(chrona: ChronaConnect, options?: ChronaUIOptions): ChronaUI
export default mountChronaUI
