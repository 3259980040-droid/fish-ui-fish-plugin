/**
 * What every Fish page receives from the panel root: the Host workbench face,
 * the locale seat, the timestamp helper, and the refresh request that reloads
 * the status line this page's write may have changed.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FishCall } from './contract/slots.ts'

/** One page's request to re-read the status line; the notice states its outcome. */
export type FishPageRefresh = (notice: string | null) => Promise<void>

/** Props shared by the five Fish pages. */
export interface FishPageProps {
  /** Call one workbench action through the Host proxy. */
  readonly call: FishCall
  /** Localized copy of the `fish` namespace. */
  readonly t: TranslateNS<'fish'>
  /** Timestamp text of a stored record. */
  readonly formatTimestamp: (value: string | number) => string
  /** Re-read the panel header's status after this page's write. */
  readonly reportRefresh: FishPageRefresh
}
