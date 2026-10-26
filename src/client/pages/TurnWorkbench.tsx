/** One directory-driven view of an instance's real executions. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseResource } from '@deepseek-ai/dsh-client-resources/client'
import type { FishPageProps } from '../page-props.ts'
import { fishTurnAddress } from '../turn-resources.ts'
import { FishStatsBar } from './FishStatsBar.tsx'
import { TurnTimeline, turnStamp } from './TurnTimeline.tsx'
import { TurnReasoning } from './TurnReasoning.tsx'
import css from './TurnWorkbench.module.css'

/**
 * Paged timeline, selected trace and fixed submission dock. A view selection never cancels an execution.
 * @param props - fixed-instance caller, localized labels and the existing composer.
 * @returns the live workbench.
 */
export function TurnWorkbench({ t, useResource, instanceId, requestTurns, children, viewImage, viewAttachment }: Pick<FishPageProps, 't'> & {
  readonly useResource: UseResource
  readonly instanceId: string
  readonly requestTurns: (instance: string, cursor?: string) => void
  readonly children: ReactNode
  readonly viewImage: (resource: string) => void
  readonly viewAttachment: (id: string, conversation: string) => void
}): ReactNode {
  const [pinned, setPinned] = useState('')
  const [follow, setFollow] = useState(true)
  const directoryResource = useResource<'fish-turns'>(fishTurnAddress(instanceId))
  const directory = directoryResource.value
  const selected = follow ? directory?.runs[0]?.execution ?? '' : pinned
  const detailResource = useResource<'fish-turn'>(selected === '' ? '' : fishTurnAddress(instanceId, selected))
  const selectedDetail = detailResource.value ?? null
  const failure = directoryResource.failure
  const detailFailure = detailResource.failure
  const detailLoading = detailResource.status === 'loading'
  const paging = directoryResource.status === 'live' && directory?.loading_older === true
  const scroll = useRef<HTMLDivElement | null>(null)
  const end = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef(new Map<string, HTMLElement>())
  useEffect(() => { if (follow) end.current?.scrollIntoView({ block: 'end' }) }, [directory, follow])
  const select = (execution: string): void => {
    setFollow(false)
    setPinned(execution)
    rowRefs.current.get(execution)?.scrollIntoView({ block: 'nearest' })
  }
  const latest = (): void => { setFollow(true); end.current?.scrollIntoView({ block: 'end' }) }
  return <div className={css.workbench}>
    <div className={css.readers}>
      <section className={css.left} aria-label={t('turns.title')}>
        <header className={css.readerHead}><h2>{t('turns.title')}</h2>
          <div className={css.controls}><Button size="sm" variant="ghost" icon={<IconRefreshOutlineRegular />}
            aria-label={t('turns.refresh')} onClick={() => { requestTurns(instanceId) }} />
          {!follow && <Button size="sm" variant="outline" onClick={latest}>{t('turns.latest')}</Button>}</div></header>
        {failure !== undefined && <p className={css.error} role="alert">{t('common.failed', { error: failure.message })}</p>}
        <div className={css.timelineLayout}>
          <div ref={scroll} className={css.timeline} onScroll={() => {
            const node = scroll.current
            if (node && node.scrollHeight - node.scrollTop - node.clientHeight > 80 && follow) {
              setPinned(selected); setFollow(false)
            }
          }}>
            {directory === undefined && failure === undefined && <p className={css.empty} role="status">{t('loading')}</p>}
            {directory?.next_cursor != null && <Button size="sm" variant="ghost" disabled={paging}
              onClick={() => { requestTurns(instanceId, directory.next_cursor ?? undefined) }}>{paging ? t('loading') : t('turns.older')}</Button>}
            {directory?.runs.length === 0 && <p className={css.empty}>{t('turns.empty')}</p>}
            {[...(directory?.runs ?? [])].reverse().map(turn => <div key={turn.execution} ref={(node) => {
              if (node) rowRefs.current.set(turn.execution, node); else rowRefs.current.delete(turn.execution)
            }}><TurnTimeline turn={turn} selected={selected === turn.execution} select={() => { select(turn.execution) }}
                t={t} viewImage={viewImage} viewAttachment={viewAttachment} /></div>)}
            <div ref={end} />
          </div>
          <nav className={css.locator} aria-label={t('turns.locate')}>
            {(directory?.runs ?? []).map(turn => <button key={turn.execution} type="button" title={`${turnStamp(turn.created)} · ${turn.execution}`}
              aria-label={t('turns.jump', { id: turn.execution })} aria-current={selected === turn.execution ? 'true' : undefined}
              onClick={() => { select(turn.execution) }}><span /></button>)}
          </nav>
        </div>
        <div className={css.composerDock}>{children}</div>
      </section>
      <aside className={css.right} aria-label={t('turns.reasoning')}>
        <header className={css.readerHead}><h2>{t('turns.reasoning')}</h2></header>
        <div className={css.reasoningScroll} key={selected} aria-busy={detailLoading}>
          {detailFailure !== undefined ? <p className={css.error} role="alert">{t('common.failed', { error: detailFailure.message })}</p>
            : selectedDetail !== null ? <TurnReasoning key={selected} turn={selectedDetail} t={t} />
              : <p className={css.empty}>{t(detailLoading ? 'loading' : 'turns.noSelection')}</p>}
        </div>
      </aside>
    </div>
    <FishStatsBar stats={directory?.stats ?? null} turn={selectedDetail} t={t} />
  </div>
}
