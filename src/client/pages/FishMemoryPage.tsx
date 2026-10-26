/**
 * Memory: the one memory read/write view, the summaries in a month / week / day
 * tree, the shared curation program, the graded all-store search, and the
 * expression library.
 *
 * Every row names its real provenance (`scope`): the owner's private chat/client
 * or one group thread. Editing saves the same record by id and reads it back
 * from the same source; merging keeps one record and shows the dropped one's
 * real new status. The tree is a view of one summary store, not a second one:
 * a node can be corrected by asking her to rewrite that paragraph. The curation
 * block shows the run record the daily window, the Fish tool and this button all
 * share, polled by its own run id.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconWarningOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type {
  FishCurationRun, FishDigest, FishExpression, FishMemory, FishOpenEvent, FishRetrievalStatus,
  FishMemoryRevision,
} from '../contract/workbench.ts'
import {
  parseCurationRun, parseCurationStatus, parseDigestRevised, parseDigestRun, parseExpressions, parseMemories,
  parseMemoryMerged, parseMemoryRecord, parseOverview, parseRetrievalStatus, parseMemoryHistory,
} from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { KnowledgeSearch } from './KnowledgeSearch.tsx'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** Poll one curation run every this many milliseconds while it is not settled. */
const POLL_MS = 2000
/** Stop polling after this many reads (about two minutes) and say so. */
const POLL_LIMIT = 60

/** Failure text of a settled reply, or null when it succeeded. */
function failureText<T>(result: FishResult<T>): FishFailure | null {
  return result.ok ? null : result.failure
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether this poll's cleanup already ran, read at call time.
 * @param flag - the live flag the effect cleanup flips.
 * @returns true when a late reply must be dropped.
 */
function cancelled(flag: { readonly current: boolean }): boolean {
  return flag.current
}

/** One week node: the week's own summary, and the days recorded inside it. */
interface DigestWeek {
  readonly key: string
  readonly week?: FishDigest
  readonly days: readonly FishDigest[]
}

/** One month node: the month's own summary, its weeks, and days outside any week. */
interface DigestMonth {
  readonly key: string
  readonly month?: FishDigest
  readonly weeks: readonly DigestWeek[]
  readonly loose: readonly FishDigest[]
}

/** Epoch seconds of a summary's period start, or 0 when the workbench omitted it. */
function startOf(row: FishDigest): number {
  return row.start > 0 ? row.start : 0
}

/** Local month key (YYYY-MM) one summary belongs to. */
function monthKey(row: FishDigest): string {
  if (startOf(row) === 0) return row.day.slice(0, 7)
  const date = new Date(startOf(row) * 1000)
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Newest first by period start, then by period key. */
function newestFirst(left: FishDigest, right: FishDigest): number {
  return startOf(right) - startOf(left) || right.day.localeCompare(left.day)
}

/**
 * Nest the flat summary list into months, weeks, and days.
 * A week belongs to the month it begins in, and a day to the week that contains
 * it, so the three levels always line up with the real calendar rather than with
 * a guess at the period text.
 * @param digests - every stored summary, any level.
 * @returns the month nodes, newest first.
 */
function buildTree(digests: readonly FishDigest[]): readonly DigestMonth[] {
  type MonthBucket = { month?: FishDigest; weeks: Map<string, { week?: FishDigest; days: FishDigest[] }>; loose: FishDigest[] }
  const months = new Map<string, MonthBucket>()
  const bucket = (key: string): MonthBucket => {
    const found = months.get(key)
    if (found !== undefined) return found
    const created = { weeks: new Map<string, { week?: FishDigest; days: FishDigest[] }>(), loose: [] as FishDigest[] }
    months.set(key, created)
    return created
  }
  const rows = [...digests].sort(newestFirst)
  for (const row of rows) {
    if (row.scope === 'month') bucket(row.day).month = row
  }
  for (const row of rows) {
    if (row.scope !== 'week') continue
    const node = bucket(monthKey(row))
    node.weeks.set(row.day, { ...(node.weeks.get(row.day) ?? {}), week: row, days: node.weeks.get(row.day)?.days ?? [] })
  }
  for (const row of rows) {
    if (row.scope !== 'day') continue
    const node = bucket(monthKey(row))
    const start = startOf(row)
    const week = [...node.weeks.entries()].find(([, value]) => value.week !== undefined
      && start >= startOf(value.week) && start < startOf(value.week) + 7 * 86400)
    if (week === undefined) node.loose.push(row)
    else week[1].days.push(row)
  }
  return [...months.entries()]
    .map(([key, value]) => ({
      key,
      ...(value.month === undefined ? {} : { month: value.month }),
      weeks: [...value.weeks.entries()]
        .map(([weekKey, week]) => ({
          key: weekKey, ...(week.week === undefined ? {} : { week: week.week }), days: [...week.days].sort(newestFirst),
        }))
        .sort((left, right) => (right.week?.start ?? 0) - (left.week?.start ?? 0)),
      loose: [...value.loose].sort(newestFirst),
    }))
    .sort((left, right) => (right.month?.start ?? 0) - (left.month?.start ?? 0) || right.key.localeCompare(left.key))
}

/**
 * Render the memory page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns curation, the summary tree, the memories with their sources, the graded search, and expressions.
 */
export function FishMemoryPage({ call, t, formatTimestamp }: FishPageProps): ReactNode {
  const [query, setQuery] = useState('')
  const [memories, setMemories] = useState<readonly FishMemory[] | null>(null)
  const [digests, setDigests] = useState<readonly FishDigest[]>([])
  const [totals, setTotals] = useState<{ readonly memories: number; readonly expressions: number } | null>(null)
  const [events, setEvents] = useState<readonly FishOpenEvent[]>([])
  const [library, setLibrary] = useState<readonly FishExpression[]>([])
  const [recent, setRecent] = useState<readonly FishExpression[]>([])
  const [libraryQuery, setLibraryQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [category, setCategory] = useState('')
  const [readiness, setReadiness] = useState<FishRetrievalStatus | null>(null)
  const [history, setHistory] = useState<readonly FishMemoryRevision[] | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [digesting, setDigesting] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // The one summary being corrected, its note, and the rewrite the workbench sent back.
  const [revising, setRevising] = useState<string | null>(null)
  const [note, setNote] = useState('')
  // Merge keeps one record and marks the other; two clicks, no hidden batch state.
  const [mergeKeep, setMergeKeep] = useState('')
  const [mergeStatus, setMergeStatus] = useState<{ readonly keep: string; readonly drop: string; readonly status: string } | null>(null)
  const [rewriting, setRewriting] = useState(false)
  const [revised, setRevised] = useState<{ readonly key: string; readonly before: string; readonly after: string } | null>(null)
  // Curation: the shared run record, its recent history, and the id being polled.
  const [latestRun, setLatestRun] = useState<FishCurationRun | null>(null)
  const [runs, setRuns] = useState<readonly FishCurationRun[]>([])
  const [curateNote, setCurateNote] = useState('')
  const [activeRun, setActiveRun] = useState<FishCurationRun | null>(null)
  const [curating, setCurating] = useState(false)
  const [forceCurate, setForceCurate] = useState(false)
  const [pollRunId, setPollRunId] = useState<string | null>(null)
  const [pollTimedOut, setPollTimedOut] = useState(false)
  const pollStops = useRef(0)
  const pollCancelled = useRef<boolean>(false)
  // The poller keeps running across filter edits; it refreshes the list the owner now sees.
  const queryRef = useRef('')
  queryRef.current = query

  /**
   * Read every stored memory from the one source.
   * @param term - keyword filter; empty reads the whole memory.
   * @returns the parsed rows, or null when the read failed (the failure is shown).
   */
  const search = async (term: string): Promise<readonly FishMemory[] | null> => {
    setLoading(true)
    try {
      const result = await call('memory.search', term.trim() === '' ? {} : { query: term.trim() })
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return null }
      const parsed = parseMemories(result.ok ? result.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return null }
      setMemories(parsed.value)
      setFailure(null)
      return parsed.value
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
      return null
    } finally {
      setLoading(false)
    }
  }

  /** Index readiness is not this query's channel; it is labelled as readiness only. */
  const loadReadiness = async (): Promise<void> => {
    try {
      const status = await call('memory.status')
      if (!status.ok) { setFailure(status.failure); return }
      const actual = parseRetrievalStatus(status.value)
      if (!actual.ok) { setFailure(actual.failure); return }
      setReadiness(actual.value)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    }
  }

  const loadOverview = async (): Promise<void> => {
    try {
      const result = await call('memory.overview')
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseOverview(result.ok ? result.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setDigests(parsed.value.digests)
      setTotals({ memories: parsed.value.counts.memories.total, expressions: parsed.value.counts.expressions.total })
      setEvents(parsed.value.open_events)
      // The recent rows keep the block populated if the library read is the one that failed.
      setRecent(parsed.value.expressions)
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    }
  }

  /** The recent curation runs are the same records the daily window and the tool write. */
  const loadCuration = async (): Promise<void> => {
    try {
      const reply = await call('memory.curate.status', {})
      const failed = failureText(reply)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseCurationStatus(reply.ok ? reply.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setRuns(parsed.value.runs)
      setLatestRun(parsed.value.latest)
      setCurateNote(parsed.value.note)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    }
  }

  const loadLibrary = async (term: string): Promise<void> => {
    try {
      const result = await call('language.list', term.trim() === '' ? {} : { query: term.trim() })
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseExpressions(result.ok ? result.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setLibrary(parsed.value)
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    }
  }

  // The page opens on every stored memory, the summaries, the run records, and the library.
  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([search(''), loadOverview(), loadCuration(), loadReadiness(), loadLibrary('')])
      } catch (error) {
        // Swallows an unexpected throw: the page reports it instead of rejecting silently.
        setFailure({ message: reasonOf(error), offline: false })
      }
    })()
    // The first read runs once for the page's life; later reads go through the fields.
  }, [])

  // One poll loop per active run id: a settled record stops it, a slow one times out.
  useEffect(() => {
    if (pollRunId === null) return
    pollStops.current = 0
    setPollTimedOut(false)
    // A ref flag: the cleanup flips it and the interval callback reads the current value.
    pollCancelled.current = false
    const timer = setInterval(() => {
      void (async () => {
        if (cancelled(pollCancelled)) return
        pollStops.current += 1
        if (pollStops.current > POLL_LIMIT) {
          setPollRunId(null)
          setPollTimedOut(true)
          return
        }
        try {
          const reply = await call('memory.curate.status', { run_id: pollRunId })
          if (cancelled(pollCancelled)) return
          if (!reply.ok) {
            setFailure(reply.failure)
            setPollRunId(null)
            return
          }
          const parsed = parseCurationStatus(reply.value)
          if (!parsed.ok || parsed.value.run === null) return
          setActiveRun(parsed.value.run)
          if (parsed.value.run.status === 'done' || parsed.value.run.status === 'partial' || parsed.value.run.status === 'failed') {
            setPollRunId(null)
            setRuns(parsed.value.runs)
            setLatestRun(parsed.value.latest)
            await Promise.all([loadOverview(), search(queryRef.current), loadReadiness()])
          }
        } catch {
          // A single unreadable poll is not a verdict; the next one reads again.
        }
      })()
    }, POLL_MS)
    return () => { pollCancelled.current = true; clearInterval(timer) }
    // The poller is keyed by the run id; the reads it triggers use the current handlers.
  }, [pollRunId])

  const mergeInto = async (keep: string, drop: string): Promise<void> => {
    setBusy(drop)
    setNotice(null)
    try {
      const reply = await call('memory.merge', { keep, drop })
      if (!reply.ok) { setFailure(reply.failure); return }
      const parsed = parseMemoryMerged(reply.value)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setFailure(null)
      setMergeKeep('')
      setMergeStatus({ keep: parsed.value.keep, drop: parsed.value.drop, status: parsed.value.drop_status })
      setNotice(t('memory.mergeDone', { keep: parsed.value.keep, drop: parsed.value.drop, status: parsed.value.drop_status }))
      await search(query)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
    finally { setBusy(null) }
  }

  const toggleMemory = async (memory: FishMemory): Promise<void> => {
    setBusy(memory.id)
    setNotice(null)
    try {
      const active = memory.status !== 'disabled' && memory.status !== 'archived'
      const reply = await call(active ? 'memory.disable' : 'memory.enable', { id: memory.id })
      if (!reply.ok) { setFailure(reply.failure); return }
      setFailure(null)
      setNotice(t(active ? 'memory.disabled' : 'memory.enabled'))
      await search(query)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
    finally { setBusy(null) }
  }

  const readHistory = async (id: string): Promise<void> => {
    if (historyId === id) { setHistoryId(null); setHistory(null); return }
    try {
      const reply = await call('memory.history', { id })
      if (!reply.ok) { setFailure(reply.failure); return }
      const parsed = parseMemoryHistory(reply.value)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setHistoryId(id)
      setHistory(parsed.value)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (text.trim() === '') return
    setSaving(true)
    setNotice(null)
    try {
      const params: Record<string, unknown> = { text }
      if (editing !== null) params.id = editing
      if (category.trim() !== '') params.category = category.trim()
      const result = await call('memory.save', params)
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return }
      const saved = parseMemoryRecord(result.ok ? result.value : undefined)
      if (!saved.ok) { setFailure(saved.failure); return }
      setText('')
      setEditing(null)
      setFailure(null)
      setSavedId(saved.value.id)
      // Re-read the same record from the one memory source, then say what came back.
      const rows = await search(query)
      const found = rows?.find(row => row.id === saved.value.id) ?? null
      setNotice(found === null
        ? t('memory.savedMissing')
        : t('memory.savedConfirm', { text: found.text.length > 120 ? `${found.text.slice(0, 120)}…` : found.text }))
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Write the summary of one level for the period happening now.
   * @param scope - day, week, or month.
   */
  const digest = async (scope: 'day' | 'week' | 'month'): Promise<void> => {
    setDigesting(scope)
    setNotice(null)
    try {
      const result = await call('memory.digest.run', { scope, force: true })
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseDigestRun(result.ok ? result.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setDigests(parsed.value.digests)
      setFailure(null)
      setNotice(t('memory.digestDone', { day: parsed.value.digest.day }))
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setDigesting('')
    }
  }

  /**
   * Ask her to rewrite one stored paragraph from the owner's note.
   * @param row - the summary being corrected.
   */
  const reviseRow = async (row: FishDigest): Promise<void> => {
    if (note.trim() === '' || rewriting) return
    setRewriting(true)
    setNotice(null)
    try {
      const result = await call('memory.digest.revise', { scope: row.scope, period: row.day, note: note.trim() })
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseDigestRevised(result.ok ? result.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      const key = `${parsed.value.scope}:${parsed.value.period}`
      setRevised({ key, before: parsed.value.before, after: parsed.value.after })
      setFailure(null)
      setNotice(t('memory.revised', { period: parsed.value.period }))
      setRevising(null)
      setNote('')
      await loadOverview()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setRewriting(false)
    }
  }

  /** Submit one curation run; the returned reference is the record this page polls. */
  const curate = async (): Promise<void> => {
    setCurating(true)
    setNotice(null)
    setPollTimedOut(false)
    try {
      const reply = await call('memory.curate.run', { force: forceCurate })
      const failed = failureText(reply)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseCurationRun(reply.ok ? reply.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setFailure(null)
      setActiveRun(parsed.value)
      setNotice(t(parsed.value.reused ? 'memory.curationReused' : 'memory.curationAccepted', { id: parsed.value.id }))
      if (parsed.value.status === 'queued' || parsed.value.status === 'running') setPollRunId(parsed.value.id)
      await loadCuration()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setCurating(false)
    }
  }

  const complete = async (id: string): Promise<void> => {
    setBusy(id)
    setNotice(null)
    try {
      const result = await call('life.event.done', { id, limit: 10 })
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return }
      setFailure(null)
      setNotice(t('memory.markedDone'))
      await Promise.all([loadOverview(), search(query)])
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setBusy(null)
    }
  }

  const manage = async (entry: FishExpression, status: 'active' | 'disabled'): Promise<void> => {
    setBusy(entry.id)
    setNotice(null)
    try {
      const result = await call('language.manage', { id: entry.id, status })
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return }
      setFailure(null)
      setNotice(t(status === 'active' ? 'memory.adopted' : 'memory.stopped'))
      await loadLibrary(libraryQuery)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setBusy(null)
    }
  }

  /** Provenance text of one row: owner private/client, or that group's thread. */
  const sourceOf = (memory: FishMemory): string => {
    if (memory.scope === 'owner') return t('memory.scope.owner')
    if (memory.scope.startsWith('chat:group:')) return t('memory.scope.group', { group: memory.scope.slice('chat:group:'.length) })
    if (memory.scope === '') return t('common.nothing')
    return t('memory.scope.other', { scope: memory.scope })
  }

  /** Localized lifecycle of one row; an unknown status keeps the backend's raw value. */
  const statusOf = (memory: FishMemory): string => {
    switch (memory.status) {
      case 'active': return t('memory.status.active')
      case 'candidate': return t('memory.status.candidate')
      case 'archived': return t('memory.status.archived')
      case 'disabled': return t('memory.status.disabled')
      case 'merged': return t('memory.status.merged')
      case '': return memory.status_label === '' ? t('common.nothing') : memory.status_label
      default: return memory.status
    }
  }

  /** Localized name of one curation step; unknown steps keep their wire name. */
  const stepOf = (name: string): string => {
    switch (name) {
      case 'accepted': return t('memory.curationStep.accepted')
      case 'range': return t('memory.curationStep.range')
      case 'learn': return t('memory.curationStep.learn')
      case 'tidy': return t('memory.curationStep.tidy')
      case 'digest': return t('memory.curationStep.digest')
      case 'emoji': return t('memory.curationStep.emoji')
      case 'index': return t('memory.curationStep.index')
      case 'run': return t('memory.curationStep.run')
      default: return name
    }
  }

  /**
   * Localized run stage: a settled run stores its own status (`done`) as the
   * stage, an active one stores the step it is running.
   * @param stage - the raw `stage` of one run or one recorded failure.
   * @returns the page's words for that stage.
   */
  const stageOf = (stage: string): string => {
    switch (stage) {
      case '': return t('common.nothing')
      case 'queued': return t('memory.curationState.queued')
      case 'running': return t('memory.curationState.running')
      case 'done': return t('memory.curationState.done')
      case 'partial': return t('memory.curationState.partial')
      case 'failed': return t('memory.curationState.failed')
      default: return stepOf(stage)
    }
  }

  /** Localized step state. */
  const stepStateOf = (state: string): string => {
    switch (state) {
      case 'done': return t('memory.curationState.done')
      case 'running': return t('memory.curationState.running')
      case 'failed': return t('memory.curationState.failed')
      default: return state
    }
  }

  /** Localized requester of one run: daily window, Fish tool, or this page. */
  const requestedByOf = (who: string): string => {
    switch (who) {
      case 'daily': return t('memory.curationBy.daily')
      case 'tool': return t('memory.curationBy.tool')
      case 'client': return t('memory.curationBy.client')
      case '': return t('common.nothing')
      default: return who
    }
  }

  const entries = library.length > 0 ? library : recent
  const tree = buildTree(digests)
  const shownRun = activeRun ?? latestRun

  /** One summary card, with the correct-this-paragraph entry under it. */
  const renderDigest = (row: FishDigest, heading: string): ReactNode => {
    const key = `${row.scope}:${row.day}`
    return (
      <li key={key} className={css.card}>
        <div className={css.cardHead}>
          <span className={css.label}>{heading}</span>
          <span className={css.cardMeta}>
            {t('memory.digestCounts', { memories: row.counts.memories, expressions: row.counts.expressions })}
          </span>
        </div>
        <p className={css.cardBody}>{row.text}</p>
        {revised !== null && revised.key === key && <div className={css.revised}>
          <p className={css.hint}>{t('memory.reviseBefore')}</p>
          <p className={css.cardBody}>{revised.before}</p>
          <p className={css.hint}>{t('memory.reviseAfter')}</p>
          <p className={css.cardBody}>{revised.after}</p>
        </div>}
        <footer className={css.cardMeta}>
          {row.kinds.length > 0 && <span>{t('memory.digestKinds', { kinds: row.kinds.join(' · ') })}</span>}
          <span>{t('memory.digestModel', { calls: row.model_calls })}</span>
          {row.created > 0 && <span>{formatTimestamp(row.created)}</span>}
          <Button size="sm" variant="ghost" disabled={rewriting}
            onClick={() => { setRevising(revising === key ? null : key); setNote('') }}>
            {t('memory.revise')}
          </Button>
        </footer>
        {revising === key && <form className={css.form} onSubmit={(event) => { event.preventDefault(); void reviseRow(row) }}>
          <p className={css.hint}>{t('memory.reviseHint')}</p>
          <textarea
            className={css.textarea}
            rows={3}
            value={note}
            aria-label={t('memory.revise')}
            placeholder={t('memory.revisePlaceholder')}
            onChange={(event) => { setNote(event.target.value) }}
          />
          <div className={css.formActions}>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setRevising(null); setNote('') }}>
              {t('memory.reviseCancel')}
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={rewriting || note.trim() === ''}>
              {rewriting ? t('memory.revising') : t('memory.reviseRun')}
            </Button>
          </div>
        </form>}
      </li>
    )
  }

  /** One curation run record: the same fields the daily window and the tool write. */
  const renderRun = (run: FishCurationRun): ReactNode => (
    <section className={css.card} aria-label={t('memory.curationLatest')}>
      <div className={css.cardHead}>
        <span className={css.label}>{run.id}</span>
        <span className={css.cardMeta}>
          <Tag tone={run.status === 'done' ? 'success' : run.status === 'failed' ? 'danger' : 'quiet'}>
            {run.status_label === '' ? run.status : run.status_label}
          </Tag>
          <Tag tone="outline">{requestedByOf(run.requested_by)}</Tag>
          {run.reused && <Tag tone="warning">{t('memory.curationReusedTag')}</Tag>}
        </span>
      </div>
      <p className={css.hint}>{t('memory.curationStage', { stage: run.stage === '' ? t('common.nothing') : stageOf(run.stage) })}</p>
      <p className={css.hint}>{t('memory.curationRange', {
        start: run.range_start > 0 ? formatTimestamp(run.range_start) : t('common.nothing'),
        end: run.range_end > 0 ? formatTimestamp(run.range_end) : t('common.nothing'),
      })}</p>
      {run.progress.length > 0 && <p className={css.hint}>{t('memory.curationProgress', {
        steps: run.progress.map(step => `${stepOf(step.name)} ${stepStateOf(step.state)}`).join(' → '),
      })}</p>}
      {run.result.completed !== null && run.result.remaining !== null && run.result.batch_count !== null && (
        <p className={css.cardBody} role={pollRunId === run.id ? 'status' : undefined} aria-atomic="true">
          {t('memory.curationBatches', { completed: String(run.result.completed),
            remaining: String(run.result.remaining), batches: String(run.result.batch_count) })}
        </p>
      )}
      {run.status !== 'queued' && run.status !== 'running' && run.result.saved_count > 0 && <p className={css.cardBody}>{t('memory.curationSaved', {
        saved: String(run.result.saved_count), calls: String(run.result.model_calls),
      })}</p>}
      {run.status !== 'queued' && run.status !== 'running' && <p className={css.hint}>{t('memory.curationLearned', {
        messages: String(run.result.new_messages), skipped: String(run.result.skipped_existing),
      })}</p>}
      {run.result.digest !== undefined && <p className={css.hint}>{t('memory.curationDigest', {
        day: run.result.digest.day === '' ? t('common.nothing') : run.result.digest.day,
        state: run.result.digest.state === '' ? t('common.nothing') : run.result.digest.state,
        chars: String(run.result.digest.chars),
      })}</p>}
      {run.result.truncated && <p className={css.hint}>{t('memory.curationTruncated')}</p>}
      {run.result.failure_count > 0 && <section className={css.section}>
        <p className={css.cardTitle}>{t('memory.curationFailures', { count: String(run.result.failure_count) })}</p>
        <ul className={css.rows}>
          {run.result.failures.map((item, index) => (
            <li key={`${item.stage}:${String(index)}`} className={css.hint}>
              {t('memory.curationFailure', { stage: stageOf(item.stage), reason: item.reason })}
            </li>
          ))}
        </ul>
      </section>}
      {run.error !== '' && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{t('memory.curationFailure', { stage: stageOf(run.stage), reason: run.error })}
      </p>}
      {run.result.note !== '' && <p className={css.hint}>{run.result.note}</p>}
      {run.note !== '' && <p className={css.hint}>{run.note}</p>}
      <footer className={css.cardMeta}>
        {run.created > 0 && <span>{t('memory.curationCreated', { time: formatTimestamp(run.created) })}</span>}
        {run.finished > 0 && <span>{t('memory.curationFinished', { time: formatTimestamp(run.finished) })}</span>}
        {pollRunId === run.id && <span>{t('memory.curationPolling')}</span>}
      </footer>
    </section>
  )

  return (
    <div className={css.settings}>
      {notice !== null && <p className={css.inlineNotice} role="status" aria-live="polite">{notice}</p>}
      {failure !== null && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
      </p>}
      <section className={css.section} aria-label={t('memory.curationTitle')}>
        <div className={css.columnHead}>
          <h2 className={css.sectionTitle}>{t('memory.curationTitle')}</h2>
          <label className={css.checkbox}>
            <input type="checkbox" checked={forceCurate} onChange={(event) => { setForceCurate(event.target.checked) }} />
            {' '}{t('memory.curationForce')}
          </label>
          <Button size="sm" variant="outline" disabled={curating}
            onClick={() => { void curate() }}>
            {curating ? t('memory.curationRunning') : t('memory.curationRun')}
          </Button>
        </div>
        <PageHint label={t('common.help')} items={[t('memory.curationHint')]} />
        {pollTimedOut && <p className={css.muted}>{t('memory.curationTimeout')}</p>}
        {shownRun === null
          ? <p className={css.muted}>{t('memory.curationEmpty')}</p>
          : renderRun(shownRun)}
        {runs.length > 1 && <details className={css.tree}>
          <summary className={css.treeSummary}>{t('memory.curationRecent', { count: String(runs.length) })}</summary>
          <ul className={css.rows}>
            {runs.map(run => (
              <li key={run.id} className={css.row}>
                <span className={css.rowTitle}>{run.id}</span>
                <span className={css.rowMeta}>
                  <span>{run.status_label === '' ? run.status : run.status_label}</span>
                  <span>{requestedByOf(run.requested_by)}</span>
                  {run.created > 0 && <span>{formatTimestamp(run.created)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>}
        {readiness !== null && <section className={css.card} role="status">
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('memory.readinessTitle')}</span>
            <Tag tone={readiness.ready ? 'success' : 'quiet'}>
              {t(readiness.mode === 'hybrid' ? 'memory.readinessMode.hybrid' : 'memory.readinessMode.lexical')}
            </Tag>
          </div>
          <p className={css.hint}>{readiness.detail || t(readiness.ready ? 'retrieval.ready' : 'retrieval.notReady')}</p>
          <p className={css.hint}>{t('retrieval.pending', { count: readiness.pending })}</p>
          <p className={css.hint}>{t('memory.readinessNote')}</p>
        </section>}
        {curateNote !== '' && runs.length > 0 && <p className={css.hint}>{curateNote}</p>}
      </section>

      <section className={css.section} aria-label={t('memory.digestTitle')}>
        <div className={css.columnHead}>
          <h2 className={css.sectionTitle}>{t('memory.digestTitle')}</h2>
          <Button size="sm" variant="outline" disabled={digesting !== ''}
            onClick={() => { void digest('month') }}>
            {digesting === 'month' ? t('memory.digestRunning') : t('memory.buildMonth')}
          </Button>
          <Button size="sm" variant="outline" disabled={digesting !== ''}
            onClick={() => { void digest('week') }}>
            {digesting === 'week' ? t('memory.digestRunning') : t('memory.buildWeek')}
          </Button>
          <Button size="sm" variant="outline" icon={<IconRefreshOutlineRegular size={14} />} disabled={digesting !== ''}
            onClick={() => { void digest('day') }}>
            {digesting === 'day' ? t('memory.digestRunning') : t('memory.buildDay')}
          </Button>
        </div>
        <PageHint label={t('common.help')} items={[t('memory.digestNote'), t('memory.reviseHint')]} />
        {totals !== null && <p className={css.muted}>{t('memory.totals', { memories: totals.memories, expressions: totals.expressions })}</p>}
        {tree.length === 0
          ? <p className={css.muted}>{t('memory.digestEmptyMonth')}</p>
          : <ul className={css.rows}>
            {tree.map(node => (
              <li key={node.key}>
                <details className={css.tree} open={node === tree[0]}>
                  <summary className={css.treeSummary}>
                    {t('memory.scope.month')} · {node.key}
                  </summary>
                  {node.month !== undefined
                    ? <ul className={css.cards}>{renderDigest(node.month, node.month.day)}</ul>
                    : <p className={css.muted}>{t('memory.digestEmpty')}</p>}
                  {node.weeks.map(week => (
                    <details key={week.key} className={css.treeWeek}>
                      <summary className={css.treeSummary}>{t('memory.scope.week')} · {week.key}</summary>
                      {week.week !== undefined && <ul className={css.cards}>{renderDigest(week.week, week.week.day)}</ul>}
                      {week.days.length === 0
                        ? <p className={css.muted}>{t('memory.digestEmpty')}</p>
                        : <ul className={css.cards}>{week.days.map(day => renderDigest(day, day.day))}</ul>}
                    </details>
                  ))}
                  {node.loose.length > 0 && <ul className={css.cards}>
                    {node.loose.map(day => renderDigest(day, day.day))}
                  </ul>}
                </details>
              </li>
            ))}
          </ul>}
      </section>

      <section className={css.section} aria-label={t('memory.entries')}>
        <h2 className={css.sectionTitle}>{t('memory.entries')}</h2>
        <form
          className={css.searchRow}
          role="search"
          onSubmit={(event) => { event.preventDefault(); void search(query) }}
        >
          <Input
            type="search"
            icon={<IconSearchOutlineRegular />}
            aria-label={t('memory.search')}
            placeholder={t('memory.searchPlaceholder')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            className={css.grow ?? ''}
          />
          <Button type="submit" size="sm" variant="outline" disabled={loading}>
            {loading ? t('memory.searching') : t('memory.search')}
          </Button>
        </form>
        <p className={css.hint}>{t('memory.searchNote')}</p>
        {events.length > 0 && <section className={css.section} aria-label={t('memory.openEvents', { count: events.length })}>
          <h3 className={css.cardTitle}>{t('memory.openEvents', { count: events.length })}</h3>
          <ul className={css.rows}>
            {events.map(event => (
              <li key={event.id} className={css.row}>
                <span>{event.text}</span>
                <span className={css.cardMeta}>{event.due > 0 ? formatTimestamp(event.due) : event.state}</span>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { void complete(event.id) }}>
                  {t('memory.markDone')}
                </Button>
              </li>
            ))}
          </ul>
        </section>}
        {memories !== null && memories.length === 0 && <p className={css.muted}>{t('memory.empty')}</p>}
        <ul className={css.cards} aria-busy={loading}>
          {memories?.map(memory => (
            <li key={memory.id} className={css.card}>
              <p className={css.cardBody}>{memory.text}</p>
              <p className={css.hint}>{t('memory.sourceLine', {
                scope: sourceOf(memory),
                source: memory.source === '' ? t('common.nothing') : memory.source,
              })}</p>
              <footer className={css.cardMeta}>
                <Tag tone={memory.status === 'merged' || memory.status === 'disabled' || memory.status === 'archived' ? 'quiet' : 'outline'}>
                  {statusOf(memory)}
                </Tag>
                {savedId === memory.id && <Tag tone="success">{t('memory.savedTag')}</Tag>}
                {memory.category !== '' && <Tag tone="outline">{memory.category}</Tag>}
                {memory.evidence_label !== '' && <span>{t('memory.evidenceLine', { label: memory.evidence_label })}</span>}
                {memory.confidence > 0 && <span>{t('memory.confidenceLine', { value: memory.confidence.toFixed(2) })}</span>}
                {memory.subject !== '' && <span>{t('memory.subjectLine', { subject: memory.subject })}</span>}
                {memory.updated !== '' && <span>{t('common.updated', { time: formatTimestamp(memory.updated) })}</span>}
                {memory.source_text !== '' && <span>{memory.source_text.slice(0, 500)}</span>}
                {memory.action !== '' && <span>{t('memory.actionLine', { action: memory.action })}</span>}
              </footer>
              <div className={css.formActions}>
                <Button size="sm" variant="ghost"
                  onClick={() => { setEditing(memory.id); setText(memory.text); setCategory(memory.category); setSavedId(null) }}>
                  {t('memory.edit')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { void readHistory(memory.id) }}>
                  {t('memory.history')}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null}
                  onClick={() => { setMergeKeep(mergeKeep === memory.id ? '' : memory.id) }}>
                  {mergeKeep === memory.id ? t('memory.mergeKeepPicked') : t('memory.mergeKeep')}
                </Button>
                {mergeKeep !== '' && mergeKeep !== memory.id && <Button size="sm" variant="outline" disabled={busy !== null}
                  onClick={() => { void mergeInto(mergeKeep, memory.id) }}>{t('memory.mergeHere')}</Button>}
                {memory.status !== 'merged' && <Button size="sm" variant="outline" disabled={busy !== null}
                  onClick={() => { void toggleMemory(memory) }}>
                  {memory.status === 'disabled' || memory.status === 'archived' ? t('memory.enable') : t('memory.disable')}
                </Button>}
                {memory.kind === 'event' && memory.action === 'open' && <Button size="sm" variant="ghost" disabled={busy !== null}
                  onClick={() => { void complete(memory.id) }}>{t('memory.markDone')}</Button>}
              </div>
              {mergeStatus !== null && mergeStatus.drop === memory.id && <p className={css.hint}>
                {t('memory.mergeStatus', { keep: mergeStatus.keep, status: mergeStatus.status })}
              </p>}
              {historyId === memory.id && history !== null && <div className={css.rows}>
                {history.map(item => <div key={item.revision} className={css.card}>
                  <Tag>{t('memory.revision', { version: item.revision })}</Tag>
                  <p className={css.cardBody}>{item.text}</p>
                  <p className={css.hint}>{item.source_text}</p>
                  <span>{formatTimestamp(item.created)}</span>
                </div>)}
              </div>}
            </li>
          ))}
        </ul>
        <section className={css.settingsCard}>
          <h3 className={css.cardTitle}>{editing === null ? t('memory.add') : t('memory.editTitle')}</h3>
          <form className={css.form} onSubmit={(event) => { void save(event) }}>
            <label className={css.field}>
              <span className={css.label}>{t('common.text')}</span>
              <textarea
                className={css.textarea}
                rows={4}
                value={text}
                placeholder={t('memory.addPlaceholder')}
                onChange={(event) => { setText(event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.label}>{t('memory.category')}</span>
              <Input
                value={category}
                placeholder={t('memory.categoryPlaceholder')}
                onChange={(event) => { setCategory(event.target.value) }}
              />
            </label>
            <p className={css.hint}>{t('memory.deleteNote')}</p>
            <div className={css.formActions}>
              {editing !== null && <Button type="button" onClick={() => { setEditing(null); setText(''); setCategory('') }}>{t('cancel')}</Button>}
              <Button
                type="submit"
                variant="primary"
                icon={<IconPlusOutlineRegular size={14} />}
                disabled={saving || text.trim() === ''}
              >
                {saving ? t('memory.saving') : t('memory.save')}
              </Button>
            </div>
          </form>
        </section>
      </section>

      <section className={css.section} aria-label={t('knowledge.title')}>
        <h2 className={css.sectionTitle}>{t('knowledge.title')}</h2>
        <KnowledgeSearch call={call} t={t} formatTimestamp={formatTimestamp} limit={12} />
      </section>

      <section className={css.section} aria-label={t('memory.expressions')}>
        <h2 className={css.sectionTitle}>{t('memory.expressions')}</h2>
        <form className={css.searchRow} onSubmit={(event) => { event.preventDefault(); void loadLibrary(libraryQuery) }}>
          <Input
            type="search"
            icon={<IconSearchOutlineRegular />}
            aria-label={t('memory.expressions')}
            placeholder={t('memory.expressions')}
            value={libraryQuery}
            onChange={(event) => { setLibraryQuery(event.target.value) }}
            className={css.grow ?? ''}
          />
          <Button type="submit" size="sm" variant="outline">{t('refresh')}</Button>
        </form>
        {entries.length === 0 && <p className={css.muted}>{t('memory.expressionsEmpty')}</p>}
        {entries.map(entry => (
          <section key={entry.id} className={css.settingsCard}>
            <div className={css.settingsRow}>
              <h3 className={css.cardTitle}>{entry.trigger === '' ? entry.kind_label : entry.trigger}</h3>
              <Tag>{entry.status_label}</Tag>
            </div>
            <p className={css.cardBody}>{entry.content}</p>
            {entry.source !== '' && <p className={css.muted}>{entry.source}</p>}
            <div className={css.settingsRow}>
              <span className={css.muted}>{entry.usage}</span>
              {entry.editable
                ? <div className={css.formActions}>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { void manage(entry, 'active') }}>{t('memory.adopt')}</Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { void manage(entry, 'disabled') }}>{t('memory.disable')}</Button>
                </div>
                : <span className={css.muted}>{t('memory.expressionReadonly')}</span>}
            </div>
          </section>
        ))}
      </section>
    </div>
  )
}
