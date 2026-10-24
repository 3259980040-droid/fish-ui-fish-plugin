/**
 * Collapsed page help: the explanatory small print that used to sit under every
 * control, kept behind one disclosure so the surface stays quiet and the copy
 * stays editable in `locales.ts`.
 */
import type { ReactNode } from 'react'
import css from './pages.module.css'

/** Props of the page help disclosure. */
export interface PageHintProps {
  /** Summary label, normally the localized `common.help`. */
  readonly label: string
  /** One already-localized line per hint; empty entries are dropped. */
  readonly items: readonly string[]
}

/**
 * Render the page help disclosure.
 * @param props - the summary label and the localized hint lines.
 * @returns a closed `details` element, or null when there is nothing to show.
 */
export function PageHint({ label, items }: PageHintProps): ReactNode {
  const lines = items.filter(item => item !== '')
  if (lines.length === 0) return null
  return (
    <details className={css.help}>
      <summary className={css.helpSummary}>{label}</summary>
      <ul className={css.helpList}>
        {lines.map(line => <li key={line}>{line}</li>)}
      </ul>
    </details>
  )
}
