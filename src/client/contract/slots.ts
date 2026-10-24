/**
 * Fish slot contract: the registrant-side props composition for the
 * layout-owned `main` panel and the sidebar-owned `sidebar.panellist` icon.
 * Both entries share one workbench face: the Host proxy calls, the mode state
 * source behind `useMode`, and the pure helpers their components need.
 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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
 * The `main` panel face: the shared mode source and the pages' Host operations.
 * `mode` is declared as an observable and a publish function so the generated
 * `useMode` selector hook and a render-time writer derive from one component.
 */
export interface FishPanelInjected {
  /**
   * Reactive mode state: the header binds it to `useMode`; Chat and Settings
   * publish the state their original reply returns so every reader agrees.
   */
  readonly hooks: { readonly mode: HostObservable<FishModeState | null> }
  readonly publishMode: (next: FishModeState) => void
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
