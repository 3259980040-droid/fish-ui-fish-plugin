/**
 * Root of the Fish workspace panel: the grouped page navigation, the mode-state
 * header (mode, pause flag, daily budget, active persona), and the workbench
 * status line. The header owns the one `status` read that decides whether the
 * workbench is offline; the active page loads its own content against the same
 * source.
 *
 * Navigation keeps the existing page registration: one local `page` state and
 * the operating views, arranged in the four owner-facing groups. A group that
 * has no operating view yet shows nothing, so no placeholder entry is presented
 * as a working page.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconApiOutlineRegular, IconFolderOpenOutlineRegular, IconNewChatOutlineRegular,
  IconPersonalizationOutlineRegular, IconPlayOutlineRegular, IconRefreshOutlineRegular,
  IconSettingsOutlineRegular, IconSkillOutlineRegular, IconSlidersTwoOutlineRegular,
  IconThinkOutlineRegular, IconWarningOutlineRegular, StateDot, Tag, type IconProps,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FishFailure, FishPanelProps } from './contract/slots.ts'
import type { FishInstance, FishInstances, FishModeState } from './contract/workbench.ts'
import { FishInstanceBar } from './FishInstanceBar.tsx'
import { FishChatPage } from './pages/FishChatPage.tsx'
import { FishMemoryPage } from './pages/FishMemoryPage.tsx'
import { FishLibraryPage } from './pages/FishLibraryPage.tsx'
import { FishPersonasPage } from './pages/FishPersonasPage.tsx'
import { FishSettingsPage } from './pages/FishSettingsPage.tsx'
import { FishTasksPage } from './pages/FishTasksPage.tsx'
import { FishExtensionsPage } from './pages/FishExtensionsPage.tsx'
import { FishSkillsPage } from './pages/FishSkillsPage.tsx'
import { FishModelsPage } from './pages/FishModelsPage.tsx'
import { parseInstances, parseStatus } from './parsers.ts'
import { createInstanceWorkbench } from './workbench-client.ts'
import type { FishKey } from './locales.ts'
import css from './FishPanel.module.css'

/**
 * The pages of the panel; the expression library lives inside Memory and the
 * old Channels page is now the group section of Settings.
 */
type FishPage =
  | 'chat' | 'tasks' | 'personas' | 'memory' | 'library' | 'settings'
  | 'models' | 'extensions' | 'skills'

/** One entry of the grouped workspace navigation. */
interface FishNavEntry {
  readonly value: FishPage
  readonly label: FishKey
  readonly icon: ComponentType<IconProps>
}

/** One owner-facing navigation group. */
interface FishNavGroup {
  readonly id: string
  readonly label: FishKey
  readonly entries: readonly FishNavEntry[]
}

/**
 * The four owner-facing groups. Only pages that already operate are listed;
 * Workspace and connection maintenance arrive with their own tickets.
 */
const NAV_GROUPS: readonly FishNavGroup[] = [
  {
    id: 'daily',
    label: 'nav.group.daily',
    entries: [
      { value: 'chat', label: 'nav.chat', icon: IconNewChatOutlineRegular },
      { value: 'tasks', label: 'nav.tasks', icon: IconPlayOutlineRegular },
    ],
  },
  {
    id: 'capability',
    label: 'nav.group.capability',
    entries: [
      { value: 'personas', label: 'nav.personas', icon: IconPersonalizationOutlineRegular },
      { value: 'models', label: 'nav.models', icon: IconSlidersTwoOutlineRegular },
      { value: 'extensions', label: 'nav.extensions', icon: IconApiOutlineRegular },
      { value: 'skills', label: 'nav.skills', icon: IconSkillOutlineRegular },
    ],
  },
  {
    id: 'data',
    label: 'nav.group.data',
    entries: [
      { value: 'memory', label: 'nav.memory', icon: IconThinkOutlineRegular },
      { value: 'library', label: 'nav.library', icon: IconFolderOpenOutlineRegular },
    ],
  },
  {
    id: 'system',
    label: 'nav.group.system',
    entries: [
      { value: 'settings', label: 'nav.settings', icon: IconSettingsOutlineRegular },
    ],
  },
]

/** Id of one page's navigation button, and of the region it controls. */
function pageIds(page: FishPage): { readonly nav: string; readonly panel: string } {
  return { nav: `fish-nav-${page}`, panel: `fish-page-${page}` }
}

/**
 * Render the Fish workspace panel.
 * @param props - the framework's main-panel props, the injected workbench face, and localized copy.
 * @returns the header, the grouped navigation, and the active page.
 */
type FishWorkspaceProps = Pick<FishPanelProps, 'call' | 't' | 'formatTimestamp' | 'readSelectedInstance' | 'saveSelectedInstance' | 'useResource' | 'requestTurns'>

export function FishPanel(props: FishWorkspaceProps): ReactNode {
  const { call, t } = props
  const [catalog, setCatalog] = useState<FishInstances | null>(null)
  const [selectedId, setSelectedId] = useState(props.readSelectedInstance)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const version = useRef(0)
  const load = useCallback(async (): Promise<void> => {
    const request = ++version.current
    const reply = await call('instances.list')
    if (version.current !== request) return
    const parsed = reply.ok ? parseInstances(reply.value) : reply
    if (parsed.ok) { setCatalog(parsed.value); setFailure(null) }
    else setFailure(parsed.failure)
    setLoading(false)
  }, [call])
  useEffect(() => {
    setLoading(true)
    void load()
    return () => { version.current++ }
  }, [load, attempt])
  const instance = catalog?.instances.find(item => item.id === selectedId)
    ?? catalog?.instances.find(item => item.id === catalog.initial_instance_id)
  const instanceId = instance?.id
  const instanceCall = useMemo(() => instanceId === undefined ? null : createInstanceWorkbench(call, instanceId), [call, instanceId])
  const select = (id: string): void => { setSelectedId(id); props.saveSelectedInstance(id) }
  const updated = (item: FishInstance, choose: boolean): void => {
    version.current++
    setCatalog(current => current === null ? current : { ...current,
      instances: current.instances.some(row => row.id === item.id)
        ? current.instances.map(row => row.id === item.id ? item : row) : [...current.instances, item] })
    if (choose) select(item.id)
  }
  if (catalog !== null && instance !== undefined && instanceCall !== null) {
    return (
      <section className={css.panel} aria-label={t('title')} data-testid="fish-panel">
        <FishInstanceBar call={instanceCall} t={t} instances={catalog.instances} selected={instance}
          onSelect={select} onUpdated={updated} onRefresh={load} />
        {failure !== null && <div className={clsx(css.banner, css.error)} role="alert">{t('common.failed', { error: failure.message })}</div>}
        <FishInstancePanel key={instance.id} {...props} call={instanceCall} instance={instance} onInstanceChanged={load} />
      </section>
    )
  }
  return (
    <section className={css.panel} aria-label={t('title')} data-testid="fish-panel">
      <header className={css.header}>
        <div className={css.heading}>
          <h1 className={css.title}>{t('title')}</h1>
          <span className={css.status} role="status">
            <StateDot state={loading ? 'ongoing' : 'error'} />
            {t(loading ? 'instance.loading' : 'instance.unavailable')}
          </span>
        </div>
        {!loading && <Button size="sm" variant="outline" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>}
      </header>
      {failure !== null && <div className={clsx(css.banner, css.error)} role="alert">{t('common.failed', { error: failure.message })}</div>}
    </section>
  )
}

/** All page callbacks close over this instance's caller rather than the selected conversation. */
function FishInstancePanel(props: FishWorkspaceProps & {
  readonly instance: FishInstance
  readonly onInstanceChanged: () => Promise<void>
}): ReactNode {
  const { call, formatTimestamp, t, onInstanceChanged } = props
  const [page, setPage] = useState<FishPage>('chat')
  // Distinguishes "no status read yet" from a read that failed, so the first
  // paint reports `loading` instead of an offline error.
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [state, setMode] = useState<FishModeState | null>(null)
  const requestRefresh = useCallback(async (nextNotice: string | null) => {
    setLoading(true)
    setNotice(null)
    const reply = await call('status')
    if (reply.ok) {
      const parsed = parseStatus(reply.value)
      if (parsed.ok) {
        setMode(parsed.value)
        setFailure(null)
        setNotice(nextNotice)
        await onInstanceChanged()
      } else {
        setFailure(parsed.failure)
        setNotice(t('status.error'))
      }
    } else {
      setFailure(reply.failure)
      setNotice(t('status.error'))
    }
    setLoading(false)
  }, [call, t, onInstanceChanged])
  useEffect(() => {
    void requestRefresh(null)
  }, [requestRefresh, attempt, page])
  const retry = (): void => {
    setAttempt(current => current + 1)
  }
  const pageProps = { call, formatTimestamp, t, reportRefresh: requestRefresh,
    useResource: props.useResource, requestTurns: props.requestTurns, instanceId: props.instance.id }
  const offline = failure?.offline === true
  return (
    <section className={css.instancePanel} aria-label={props.instance.name}>
      <header className={css.header}>
        <div className={css.heading}>
          <h1 className={css.title}>{props.instance.name}</h1>
          <span className={css.status} role="status" aria-live="polite">
            {loading
              ? <><StateDot state="ongoing" /><span>{t('status.busy')}</span></>
              : failure === null
                ? <><StateDot state={props.instance.enabled ? 'done' : 'warning'} /><span>{notice ?? t('status.ready')}</span></>
                : <><StateDot state="error" /><span className={css.statusError}>{notice ?? t('status.error')}</span></>}
          </span>
        </div>
        <div className={css.facts}>
          <Tag tone="neutral">{t('instance.current', { id: props.instance.id })}</Tag>
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
          {!props.instance.enabled && <Tag tone="warning">{t('paused')}</Tag>}
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
      <div className={css.workspace}>
        <nav className={css.nav} aria-label={t('pages.label')}>
          {NAV_GROUPS.map(group => (
            <div key={group.id} className={css.navGroup}>
              <span className={css.navGroupTitle}>{t(group.label)}</span>
              {group.entries.map((entry) => {
                const Glyph = entry.icon
                const active = entry.value === page
                const ids = pageIds(entry.value)
                return (
                  <button
                    key={entry.value}
                    type="button"
                    id={ids.nav}
                    className={clsx(css.navItem, active && css.navItemActive)}
                    aria-current={active ? 'page' : undefined}
                    aria-controls={active ? ids.panel : undefined}
                    onClick={() => { setPage(entry.value) }}
                  >
                    <Glyph size={16} className={css.navIcon} />
                    <span>{t(entry.label)}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div
          className={css.content}
          id={pageIds(page).panel}
          role="region"
          aria-labelledby={pageIds(page).nav}
        >
          {page === 'chat' && <FishChatPage {...pageProps} />}
          {page === 'personas' && <FishPersonasPage {...pageProps} />}
          {page === 'models' && <FishModelsPage {...pageProps} />}
          {page === 'extensions' && <FishExtensionsPage {...pageProps} />}
          {page === 'skills' && <FishSkillsPage {...pageProps} />}
          {page === 'memory' && <FishMemoryPage {...pageProps} />}
          {page === 'library' && <FishLibraryPage {...pageProps} />}
          {page === 'tasks' && <FishTasksPage {...pageProps} />}
          {page === 'settings' && <FishSettingsPage {...pageProps} />}
        </div>
      </div>
    </section>
  )
}
