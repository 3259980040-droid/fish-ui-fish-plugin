/** Full stored provider reasoning and execution events for the selected turn. */
import { useState, type ReactNode } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishTurnView } from '../contract/workbench.ts'
import type { FishKey } from '../locales.ts'
import type { FishPageProps } from '../page-props.ts'
import { turnStamp, turnState } from './TurnTimeline.tsx'
import css from './TurnWorkbench.module.css'

/** @param props - selected real trace and locale. @returns independently scrollable reasoning content. */
export function TurnReasoning({ turn, t }: { readonly turn: FishTurnView; readonly t: FishPageProps['t'] }): ReactNode {
  const [copy, setCopy] = useState<boolean | null>(null)
  const trace = turn.trace
  const events = trace?.events ?? []
  const reasoning = trace?.reasoning ?? ''
  const keys: Readonly<Record<string, FishKey>> = { request: 'turns.event.request', first_output: 'turns.event.first_output',
    tool_start: 'turns.event.tool_start', tool_result: 'turns.event.tool_result', final_content: 'turns.event.final_content', execution: 'turns.event.execution' }
  return <>
    <div className={css.detailHeading}><div><p className={css.meta}>{turnStamp(turn.created)}</p><p>{turnState(turn, t)}</p></div>
      <Button size="sm" variant="ghost" disabled={reasoning === '' && events.length === 0}
        onClick={() => { void writeClipboard([reasoning, JSON.stringify(events, null, 2)].filter(Boolean).join('\n\n')).then(setCopy) }}>{t('turns.copy')}</Button></div>
    {copy !== null && <p className={css.meta} role="status">{t(copy ? 'turns.copied' : 'turns.copyFailed')}</p>}
    {trace === null || trace.state === 'missing' ? <p className={css.meta}>{t('turns.noTrace')}</p> : <>
      <h3 className={css.subheading}>{t('turns.provider')}</h3>
      {reasoning === '' ? <p className={css.meta}>{t('turns.noReasoning')}</p> : <pre className={css.reasoning}>{reasoning}</pre>}
      <h3 className={css.subheading}>{t('turns.tools')}</h3>
      {events.length === 0 && <p className={css.meta}>{t('turns.noTools')}</p>}
      {events.map((event, index) => {
        const label = keys[event.kind]
        return <details className={css.event} key={index} open={event.kind === 'tool_result'}>
          <summary>{label === undefined ? event.kind : t(label)} · {turnStamp(event.at)}</summary>
          <pre>{typeof event.value === 'string' ? event.value : JSON.stringify(event.value, null, 2)}</pre>
        </details> })}
    </>}
    {turn.delivery_times !== null && <details className={css.event}><summary>{t('turns.times')}</summary>
      <dl className={css.times}>{(['arrival', 'started', 'first_output', 'sending', 'receipt'] as const).map(key => <div key={key}>
        <dt>{t(`turns.time.${key}`)}</dt><dd>{typeof turn.delivery_times?.[key] === 'number' ? turnStamp(turn.delivery_times[key])
          : turn.delivery_times?.[key] || t('common.nothing')}</dd></div>)}</dl>
    </details>}
  </>
}
