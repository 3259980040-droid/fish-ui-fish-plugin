/**
 * Root of the Fish workspace panel: the page tabs, the mode-state header
 * (mode, pause flag, daily budget, active persona), and the workbench status
 * line. The header owns the one `status` read that decides whether the
 * workbench is offline; the active page loads its own content against the same
 * source.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconRefreshOutlineRegular, IconWarningOutlineRegular, SegmentedTabs, StateDot, Tag, type SegmentedTab,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FishFailure, FishPanelProps } from './contract/slots.ts'
import { FishChatPage } from './pages/FishChatPage.tsx'
import { FishMemoryPage } from './pages/FishMemoryPage.tsx'
import { FishLibraryPage } from './pages/FishLibraryPage.tsx'
import { FishPersonasPage } from './pages/FishPersonasPage.tsx'
import { FishSettingsPage } from './pages/FishSettingsPage.tsx'
import { FishTasksPage } from './pages/FishTasksPage.tsx'
import { parseStatus } from './parsers.ts'
import css from './FishPanel.module.css'

/**
 * The six pages of the panel; the expression library lives inside Memory and the
 * old Channels page is now the group section of Settings.
 */
type FishPage = 'chat' | 'personas' | 'memory' | 'library' | 'tasks' | 'settings'

/**
 * Render the Fish workspace panel.
 * @param props - the framework's main-panel props, the injected workbench face, and localized copy.
 * @returns the header, the page tabs, and the active page.
 */
export function FishPanel(props: FishPanelProps): ReactNode {
  const { call, useMode, publishMode: publish, formatTimestamp, t } = props
  const [page, setPage] = useState<FishPage>('chat')
  // Distinguishes "no status read yet" from a read that failed, so the first
  // paint reports `loading` instead of an offline error.
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const state = useMode(snapshot => snapshot)
  const requestRefresh = useCallback(async (nextNotice: string | null) => {
    setLoading(true)
    setNotice(null)
    const reply = await call('status')
    if (reply.ok) {
      const parsed = parseStatus(reply.value)
      if (parsed.ok) {
        publish(parsed.value)
        setFailure(null)
        setNotice(nextNotice)
      } else {
        setFailure(parsed.failure)
        setNotice(t('status.error'))
      }
    } else {
      setFailure(reply.failure)
      setNotice(t('status.error'))
    }
    setLoading(false)
  }, [call, t, publish])
  useEffect(() => {
    void requestRefresh(null)
  }, [requestRefresh, attempt, page])
  const retry = (): void => {
    setAttempt(current => current + 1)
  }
  const tabs: readonly [SegmentedTab<FishPage>, ...SegmentedTab<FishPage>[]] = [
    { value: 'chat', id: 'fish-tab-chat', panelId: 'fish-page-chat', label: t('pages.chat') },
    { value: 'personas', id: 'fish-tab-personas', panelId: 'fish-page-personas', label: t('pages.personas') },
    { value: 'memory', id: 'fish-tab-memory', panelId: 'fish-page-memory', label: t('pages.memory') },
    { value: 'library', id: 'fish-tab-library', panelId: 'fish-page-library', label: t('pages.library') },
    { value: 'tasks', id: 'fish-tab-tasks', panelId: 'fish-page-tasks', label: t('pages.tasks') },
    { value: 'settings', id: 'fish-tab-settings', panelId: 'fish-page-settings', label: t('pages.settings') },
  ]
  const pageProps = { call, formatTimestamp, t, reportRefresh: requestRefresh }
  const offline = failure?.offline === true
  const panelId = tabs.find(tab => tab.value === page)?.panelId ?? 'fish-page-chat'
  return (
    <section className={css.panel} aria-label={t('title')} data-testid="fish-panel">
      <header className={css.header}>
        <div className={css.heading}>
          <h1 className={css.title}>{t('title')}</h1>
          <span className={css.status} role="status" aria-live="polite">
            {loading
              ? <><StateDot state="ongoing" /><span>{t('status.busy')}</span></>
              : failure === null
                ? <><StateDot state={state?.paused === true ? 'warning' : 'done'} /><span>{notice ?? t('status.ready')}</span></>
                : <><StateDot state="error" /><span className={css.statusError}>{notice ?? t('status.error')}</span></>}
          </span>
        </div>
        <div className={css.facts}>
          {state !== null && <>
            <Tag tone={state.mode === 'work' ? 'info' : 'neutral'}>{t(state.mode === 'work' ? 'mode.work' : 'mode.chat')}</Tag>
            <span className={css.fact} title={t('limits')}>
              {t('limits')}: {state.daily_limits.unlimited
                ? t('limits.unlimited')
                : `${t('limits.count', { used: state.daily_limits.used, limit: state.daily_limits.limit })} · ${t('limits.remaining', { remaining: state.daily_limits.remaining })}`}
            </span>
            <span className={css.fact} title={state.persona.name}>
              {state.persona.name === '' ? t('persona.none') : t('persona.active', { name: state.persona.name })}
            </span>
          </>}
          {state?.paused === true && <Tag tone="warning">{t('paused')}</Tag>}
          <Button
            size="sm"
            variant="ghost"
            className={css.refresh}
            icon={<IconRefreshOutlineRegular size={14} />}
            aria-label={t('refresh')}
            title={t('refresh')}
            disabled={loading}
            onClick={retry}
          />
        </div>
      </header>
      {failure !== null && (
        <div className={clsx(css.banner, offline ? css.offline : css.error)} role="alert">
          <IconWarningOutlineRegular size={18} className={css.bannerGlyph} />
          <div className={css.bannerText}>
            <strong>{offline ? t('offline.title') : t('error.title')}</strong>
            <span>{offline ? t('offline.body') : t('common.failed', { error: failure.message })}</span>
            {offline && <code className={css.detail}>{failure.message}</code>}
          </div>
          <Button variant="outline" size="sm" onClick={retry}>{t('retry')}</Button>
        </div>
      )}
      <SegmentedTabs<FishPage>
        items={tabs}
        value={page}
        onChange={setPage}
        label={t('pages.label')}
        className={css.tabs}
      />
      <div className={css.body} id={panelId} role="tabpanel" aria-labelledby={`fish-tab-${page}`}>
        {page === 'chat' && <FishChatPage {...pageProps} />}
        {page === 'personas' && <FishPersonasPage {...pageProps} />}
        {page === 'memory' && <FishMemoryPage {...pageProps} />}
        {page === 'library' && <FishLibraryPage {...pageProps} />}
        {page === 'tasks' && <FishTasksPage {...pageProps} />}
        {page === 'settings' && <FishSettingsPage {...pageProps} />}
      </div>
    </section>
  )
}
