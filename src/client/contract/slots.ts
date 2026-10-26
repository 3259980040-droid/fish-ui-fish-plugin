/**
 * Fish slot contract: the registrant-side props composition for the
 * layout-owned `main` panel and the sidebar-owned `sidebar.panellist` icon.
 * Both entries share one workbench face and pure helpers. Each mounted
 * instance panel owns its own status response; no mode source is global.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FishMode, FishModeState } from './workbench.ts'

/** An error the pages render as an actionable status line. */
export interface FishFailure {
  /** Workbench, transport, or payload message, kept verbatim. */
  readonly message: string
  /** True when the workbench could not be reached at all (token or connection failure). */
  readonly offline: boolean
}

/** Settled result of one page operation: a value or a renderable failure. */
export type FishResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: FishFailure }

/**
 * The `main` panel face: Host operations and browser-local viewing preference.
 */
export interface FishPanelInjected {
  /** Request a refresh or older page from the registered turn resource. */
  readonly requestTurns: (instance: string, cursor?: string) => void
  /** Last viewed instance id; this preference never changes server routing. */
  readonly readSelectedInstance: () => string | null
  /** Persist a direct viewing choice in this browser. */
  readonly saveSelectedInstance: (id: string) => void
  /**
   * Call one workbench action through the Host proxy.
   * @param action - documented workbench action name.
   * @param params - action parameters.
   * @returns the settled reply; never rejects.
   */
  readonly call: (action: string, params?: Record<string, unknown>) => Promise<FishResult<unknown>>
  /** Timestamp text for a stored memory's `updated` field. */
  readonly formatTimestamp: (value: string | number) => string
}

/** Full props of the Fish main panel. */
export type FishPanelProps = PropsRuntime<'main'>
  & InjectFace<FishPanelInjected>
  & PropsLocale<'fish'>

/** Full props of the sidebar panel icon. */
export type FishIconProps = PropsRuntime<'sidebar.panellist'>
  & PropsLocale<'fish'>

/** Low-level call a page uses when it only needs the shared request path. */
export type FishCall = FishPanelInjected['call']

/** Mode state a page header renders. */
export type FishModeSnapshot = FishModeState | null

/** The two operating modes, in display order. */
export const FISH_MODES: readonly FishMode[] = ['chat', 'work']
