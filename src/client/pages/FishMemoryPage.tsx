/**
 * Memory: the summaries in a month / week / day tree, the stored memories
 * (search, edit, mark an open event done), and the expression library.
 *
 * The tree is the point of this page: the newest month summary shows first, and
 * expanding it walks down to its weeks and their days. Every node can be
 * corrected — the owner writes one line about what is wrong and the workbench
 * asks the model to rewrite that one paragraph, then shows the text before and
 * after. The page itself never writes a summary; it only asks for one.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconWarningOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type { FishDigest, FishExpression, FishMemory, FishOpenEvent, FishRetrievalStatus, FishMemoryRevision } from '../contract/workbench.ts'
import {
  parseDigestRevised, parseDigestRun, parseExpressions, parseMemories, parseMemoryRecord,
  parseOverview, parseRetrievalStatus, parseMemoryHistory,
} from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** Failure text of a settled reply, or null when it succeeded. */
function failureText<T>(result: FishResult<T>): FishFailure | null {
  return result.ok ? null : result.failure
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
 * @returns the summary tree, the stored memories, and the expression library.
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
  const [retrieval, setRetrieval] = useState<FishRetrievalStatus | null>(null)
  const [history, setHistory] = useState<readonly FishMemoryRevision[] | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [digesting, setDigesting] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // The one summary being corrected, its note, and the rewrite the workbench sent back.
  const [revising, setRevising] = useState<string | null>(null)
  const [note, setNote] = useState('')
  // Merge keeps one record and marks the other; two clicks, no hidden batch state.
  const [mergeKeep, setMergeKeep] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [revised, setRevised] = useState<{ readonly key: string; readonly before: string; readonly after: string } | null>(null)

  const search = async (term: string): Promise<void> => {
    setLoading(true)
    try {
      const result = await call('memory.search', term.trim() === '' ? {} : { query: term.trim() })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseMemories(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setMemories(parsed.value)
      const status = await call('memory.status')
      if (!status.ok) { setFailure(status.failure); return }
      const actual = parseRetrievalStatus(status.value)
      if (!actual.ok) { setFailure(actual.failure); return }
      setRetrieval(actual.value)
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setLoading(false)
    }
  }

  const loadOverview = async (): Promise<void> => {
    try {
      const result = await call('memory.overview')
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseOverview(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
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

  const loadLibrary = async (term: string): Promise<void> => {
    try {
      const result = await call('language.list', term.trim() === '' ? {} : { query: term.trim() })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseExpressions(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setLibrary(parsed.value)
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    }
  }

  // The page opens on every stored memory, the summary tree, and the library.
  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([search(''), loadOverview(), loadLibrary('')])
      } catch (error) {
        // Swallows an unexpected throw: the page reports it instead of rejecting silently.
        setFailure({ message: reasonOf(error), offline: false })
      }
    })()
    // The first read runs once for the page's life; later reads go through the fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mergeInto = async (keep: string, drop: string): Promise<void> => {
    try {
      const reply = await call('memory.merge', { keep, drop })
      if (!reply.ok) { setFailure(reply.failure); return }
      setFailure(null)
      setMergeKeep('')
      await search(query)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
  }

  const toggleMemory = async (id: string, active: boolean): Promise<void> => {
    setNotice(null)
    try {
      const reply = await call(active ? 'memory.disable' : 'memory.enable', { id })
      if (!reply.ok) { setFailure(reply.failure); return }
      setFailure(null)
      await search(query)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
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
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const saved = parseMemoryRecord(result.ok ? result.value : undefined)
      if (!saved.ok) {
        setFailure(saved.failure)
        return
      }
      setText('')
      setEditing(null)
      setFailure(null)
      setNotice(t('memory.saved'))
      await search(query)
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
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseDigestRun(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
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
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseDigestRevised(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
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

  const complete = async (id: string): Promise<void> => {
    setBusy(id)
    setNotice(null)
    try {
      const result = await call('life.event.done', { id, limit: 10 })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
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
      if (failed !== null) {
        setFailure(failed)
        return
      }
      setFailure(null)
      setNotice(t(status === 'active' ? 'memory.adopted' : 'memory.stopped'))
      await loadLibrary(libraryQuery)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setBusy(null)
    }
  }

  const entries = library.length > 0 ? library : recent
  const tree = buildTree(digests)

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

  return (
    <div className={css.settings}>
      <section className={css.section} aria-label={t('memory.digestTitle')}>
        <div className={css.columnHead}>
          <h2 className={css.sectionTitle}>{t('memory.digestTitle')}</h2>
          {notice !== null && <span className={css.inlineNotice} role="status">{notice}</span>}
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
        {retrieval !== null && <section className={css.card} role="status">
          <Tag tone={retrieval.last_mode === 'hybrid' ? 'success' : 'quiet'}>{t(retrieval.last_mode === 'hybrid' ? 'retrieval.hybrid' : 'retrieval.lexical')}</Tag>
          <p className={css.hint}>{retrieval.detail || retrieval.last_detail || t(retrieval.ready ? 'retrieval.ready' : 'retrieval.notReady')}</p>
          <p className={css.hint}>{t('retrieval.pending', { count: retrieval.pending })}</p>
        </section>}
        {failure !== null && <p className={css.inlineError} role="alert">
          <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
        </p>}
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
              <footer className={css.cardMeta}>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(memory.id); setText(memory.text); setCategory(memory.category) }}>{t('memory.edit')}</Button>
                {memory.kind === 'event' && memory.action === 'open' && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { void complete(memory.id) }}>{t('memory.markDone')}</Button>}
                {memory.category !== '' && <Tag tone="outline">{memory.category}</Tag>}
                {memory.updated !== '' && <span>{t('common.updated', { time: formatTimestamp(memory.updated) })}</span>}
                {memory.source !== '' && <span>{t('memory.source', { source: memory.source })}</span>}
                <span>{memory.evidence_label} · {memory.status_label}</span>
                {memory.source_text !== '' && <span>{memory.source_text.slice(0, 500)}</span>}
                <Button size="sm" variant="ghost" onClick={() => { void readHistory(memory.id) }}>{t('memory.history')}</Button>
                <Button size="sm" variant="ghost"
                  onClick={() => { setMergeKeep(mergeKeep === memory.id ? '' : memory.id) }}>
                  {mergeKeep === memory.id ? t('memory.mergeKeepPicked') : t('memory.mergeKeep')}
                </Button>
                {mergeKeep !== '' && mergeKeep !== memory.id && <Button size="sm" variant="outline"
                  onClick={() => { void mergeInto(mergeKeep, memory.id) }}>{t('memory.mergeHere')}</Button>}
                <Button size="sm" variant="outline"
                  onClick={() => { void toggleMemory(memory.id, memory.status_label !== t('memory.disabledLabel')) }}>
                  {memory.status_label === t('memory.disabledLabel') ? t('memory.enable') : t('memory.disable')}
                </Button>
                {historyId === memory.id && history !== null && <div className={css.rows}>
                  {history.map(item => <div key={item.revision} className={css.card}>
                    <Tag>{t('memory.revision', { version: item.revision })}</Tag>
                    <p className={css.cardBody}>{item.text}</p>
                    <p className={css.hint}>{item.source_text}</p>
                    <span>{formatTimestamp(item.created)}</span>
                  </div>)}
                </div>}
              </footer>
            </li>
          ))}
        </ul>
        <section className={css.settingsCard}>
          <h3 className={css.cardTitle}>{t('memory.add')}</h3>
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
