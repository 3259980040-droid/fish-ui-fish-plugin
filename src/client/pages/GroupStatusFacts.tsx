/**
 * Read-only truth of one whitelisted group as the backend policy decides it:
 * the engine that reads the message, and the listen, reply, and learn flags.
 * It is the one place that reports it: the Channels page is gone and Settings
 * shows these rows beside the switches that write them.
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FishChannelGroup } from '../contract/workbench.ts'
import css from './pages.module.css'

/** Props of the group status facts. */
export interface GroupStatusFactsProps {
  /** The group whose real policy is shown. */
  readonly group: FishChannelGroup
  /** Localized copy of the `fish` namespace. */
  readonly t: TranslateNS<'fish'>
}

/** The engine name of a group, or a dash when the backend reports none. */
export function engineText(engine: string, t: TranslateNS<'fish'>): string {
  return engine === '' ? t('common.nothing') : engine
}

/**
 * Render the four real status rows of one group.
 * @param props - the group and the localized copy.
 * @returns a definition list of engine, listen, reply, and learn.
 */
export function GroupStatusFacts({ group, t }: GroupStatusFactsProps): ReactNode {
  const flag = (on: boolean): string => t(on ? 'common.on' : 'common.off')
  return (
    <dl className={css.facts}>
      <dt>{t('settings.engine')}</dt>
      <dd>{engineText(group.engine, t)}</dd>
      <dt>{t('settings.listen')}</dt>
      <dd>{flag(group.listen)}</dd>
      <dt>{t('settings.reply')}</dt>
      <dd>{flag(group.reply)}</dd>
      <dt>{t('settings.learn')}</dt>
      <dd>{flag(group.learn)}</dd>
    </dl>
  )
}
