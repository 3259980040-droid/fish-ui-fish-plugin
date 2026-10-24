/**
 * Tasks: shared Fish plan CRUD and execution records, including reminders and autonomous opportunities.
 * The scheduled messages one can still
 * create. Computer tasks are delegated by talking to her in the private chat,
 * so this page lists what ran instead of offering a submission form; a
 * scheduled message keeps one timing choice (delay, once at a local date/time,
 * daily, weekly, or fixed interval) mapping one-to-one onto the workbench
 * `schedules.create` selectors. The list refreshes after each accepted write;
 * a refused write renders its reason above the list.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, Checkbox, IconClockOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular,
  IconWarningOutlineRegular, Input, StateDot, Tag, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type { FishTask } from '../contract/workbench.ts'
import { isRecord, optionalString } from '../contract/workbench.ts'
import { parseOpaque, parseTasks } from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'
import { DelegationTasks } from './DelegationTasks.tsx'
import taskCss from './DelegationTasks.module.css'

/** Zone the local wall-clock selectors (`at`, `daily`, `weekly`) are expressed in, matching the console's timestamp zone. */
const TIME_ZONE = 'Asia/Shanghai'

/** The selectors the page can create; each maps to exactly one `schedules.create` field. */
type TimingKind = 'after' | 'at' | 'daily' | 'weekly' | 'every' | 'cron'

/** ISO weekdays selectable for a weekly task, Monday 1 through Sunday 7. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

/** The one timing field a creation carries; at most one member is set. */
type Timing =
  | { readonly after_seconds: number }
  | { readonly at: { readonly date: string; readonly time: string; readonly time_zone: string } }
  | { readonly daily: { readonly time: string; readonly time_zone: string } }
  | { readonly weekly: { readonly time: string; readonly time_zone: string; readonly weekdays: readonly number[] } }
  | { readonly every_seconds: number }
  | { readonly cron: { readonly expression: string; readonly time_zone: string } }

/** Failure text of a settled reply, or null when it succeeded. */
function failureText<T>(result: FishResult<T>): FishFailure | null {
  return result.ok ? null : result.failure
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The dot each task status renders; unknown statuses read as idle. */
function statusDot(status: string): StateDotState {
  switch (status) {
    case 'done':
    case 'complete':
    case 'completed':
      return 'done'
    case 'pending':
    case 'queued':
    case 'scheduled':
    case 'overdue':
      return 'warning'
    case 'running':
      return 'ongoing'
    case 'failed':
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

/** The tag tone each task status renders. */
function statusTone(status: string): 'success' | 'warning' | 'danger' | 'outline' {
  switch (statusDot(status)) {
    case 'done':
      return 'success'
    case 'warning':
    case 'ongoing':
      return 'warning'
    case 'error':
      return 'danger'
    default:
      return 'outline'
  }
}

/** String, number, or array field rendered as short text; undefined when absent. */
function fieldText(task: FishTask, key: string): string | undefined {
  const value = task[key]
  if (typeof value === 'string') return value === '' ? undefined : value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.length === 0 ? undefined : value.map(item => String(item)).join(', ')
  return undefined
}

/** Seconds from now until a task's schedule, when one is recorded. */
function dueText(task: FishTask, formatTimestamp: FishPageProps['formatTimestamp']): string | null {
  for (const key of ['scheduled_at', 'scheduledAt', 'run_at', 'runAt', 'due_at', 'dueAt', 'after', 'when']) {
    const value = task[key]
    if (typeof value === 'string' && value !== '') return formatTimestamp(value)
    if (typeof value === 'number') return formatTimestamp(value)
  }
  return null
}

/** First field of the task whose value is non-empty, or undefined. */
function firstField(task: FishTask, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = fieldText(task, key)
    if (value !== undefined) return value
  }
  return undefined
}

/** `HH:mm` from an `HH:mm`, `HH:mm:ss`, or `HH:mm:ss.SSS` local time. */
function clockOf(time: string): string {
  return time.slice(0, 5)
}

/** A local `HH:mm` time; `HH:mm:ss` is also accepted and sent verbatim. */
function isLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)
}

/** Whether the text is a real `YYYY-MM-DD` calendar date. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Today's local date in `TIME_ZONE` as `YYYY-MM-DD`, the default for a once-at target. */
function todayInZone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}

/**
 * Build the one selector of a creation, or the locale key of the input error.
 * @param kind - the chosen timing kind.
 * @param fields - the form's timing inputs.
 * @returns the selector, or `invalid` naming the failure copy.
 */
function timingOf(
  kind: TimingKind,
  fields: {
    readonly after: string
    readonly date: string
    readonly atTime: string
    readonly time: string
    readonly weekdays: readonly number[]
    readonly interval: string
    readonly cron: string
  },
): { readonly timing: Timing } | { readonly invalid: 'tasks.invalidAfter' | 'tasks.invalidAt' | 'tasks.invalidTime' | 'tasks.invalidWeekdays' | 'tasks.invalidInterval' | 'tasks.invalidCron' } {
  switch (kind) {
    case 'cron': {
      const expression = fields.cron.trim()
      if (expression.split(/\s+/).length !== 5) return { invalid: 'tasks.invalidCron' }
      return { timing: { cron: { expression, time_zone: TIME_ZONE } } }
    }
    case 'after': {
      const seconds = Number(fields.after)
      if (!Number.isSafeInteger(seconds) || seconds <= 0) return { invalid: 'tasks.invalidAfter' }
      return { timing: { after_seconds: seconds } }
    }
    case 'at': {
      const date = fields.date.trim()
      const time = fields.atTime.trim()
      if (!isCalendarDate(date) || !isLocalTime(time)) return { invalid: 'tasks.invalidAt' }
      return { timing: { at: { date, time: clockOf(time), time_zone: TIME_ZONE } } }
    }
    case 'daily': {
      const time = fields.time.trim()
      if (!isLocalTime(time)) return { invalid: 'tasks.invalidTime' }
      return { timing: { daily: { time: clockOf(time), time_zone: TIME_ZONE } } }
    }
    case 'weekly': {
      const time = fields.time.trim()
      if (!isLocalTime(time)) return { invalid: 'tasks.invalidTime' }
      if (fields.weekdays.length === 0) return { invalid: 'tasks.invalidWeekdays' }
      return { timing: { weekly: { time: clockOf(time), time_zone: TIME_ZONE, weekdays: fields.weekdays } } }
    }
    case 'every': {
      const seconds = Number(fields.interval)
      if (!Number.isSafeInteger(seconds) || seconds < 60) return { invalid: 'tasks.invalidInterval' }
      return { timing: { every_seconds: seconds } }
    }
  }
}

/**
 * Render the task page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the task list beside the creation form.
 */
/** Fish's own workspace: the one folder both the owner and Fish can see. */
function WorkspaceFiles({ call, t }: { readonly call: FishPageProps['call']; readonly t: FishPageProps['t'] }): ReactNode {
  const [entries, setEntries] = useState<readonly Record<string, unknown>[] | null>(null)
  const [opened, setOpened] = useState<{ name: string; lines: readonly string[] } | null>(null)
  const [error, setError] = useState('')
  const list = async (): Promise<void> => {
    try {
      const reply = await call('workspace.list', {}) as Record<string, unknown>
      const items = Array.isArray(reply.entries) ? reply.entries as Record<string, unknown>[] : []
      setEntries(items.filter(item => item.directory !== true))
      setError('')
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)) }
  }
  useEffect(() => { void list() }, [])
  const open = async (name: string): Promise<void> => {
    try {
      const reply = await call('workspace.read', { path: name, lines: 80 }) as Record<string, unknown>
      setOpened({ name, lines: Array.isArray(reply.text) ? reply.text as string[] : [] })
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)) }
  }
  return <section className={css.listColumn} aria-label={t('workspace.title')}>
    <h2 className={css.sectionTitle}>{t('workspace.title')}</h2>
    <p className={css.note}>{t('workspace.hint')}</p>
    <Button size="sm" variant="ghost" onClick={() => { void list() }}>{t('workspace.refresh')}</Button>
    {error !== '' && <p className={css.inlineError} role="alert">{error}</p>}
    {entries !== null && entries.length === 0 && <p className={css.muted}>{t('workspace.empty')}</p>}
    <ul className={css.rows}>
      {(entries ?? []).map(item => <li key={String(item.name)} className={css.taskRow}>
        <Button size="sm" variant="ghost" onClick={() => { void open(String(item.name)) }}>{String(item.name)}</Button>
        <span className={css.rowMeta}>{String(item.bytes ?? '')} B</span>
      </li>)}
    </ul>
    {opened !== null && <div className={css.card}>
      <h3 className={css.cardTitle}>{opened.name}</h3>
      <pre className={css.cardBody}>{opened.lines.join('\n')}</pre>
    </div>}
  </section>
}

export function FishTasksPage({ call, t, formatTimestamp }: FishPageProps): ReactNode {
  const [category, setCategory] = useState<'computer' | 'scheduled'>('computer')
  const [tasks, setTasks] = useState<readonly FishTask[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<TimingKind>('after')
  const [afterSeconds, setAfterSeconds] = useState('')
  const [atDate, setAtDate] = useState('')
  const [atTime, setAtTime] = useState('')
  const [clockTime, setClockTime] = useState('')
  const [weekdays, setWeekdays] = useState<readonly number[]>([])
  const [intervalSeconds, setIntervalSeconds] = useState('')
  const [target, setTarget] = useState('owner')
  const [groupId, setGroupId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editingTiming, setEditingTiming] = useState('')
  const [cron, setCron] = useState('')
  const [purpose, setPurpose] = useState<'reminder' | 'autonomy'>('reminder')

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await call('schedules.list')
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseTasks(result.ok ? result.value : undefined)
      if (!parsed.ok) setFailure(parsed.failure)
      else {
        setTasks(parsed.value)
        setFailure(null)
      }
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        await load()
      } catch (error) {
        // Swallows an unexpected throw: the page reports it instead of rejecting silently.
        if (live) setFailure({ message: reasonOf(error), offline: false })
      }
    })()
    return () => { live = false }
    // The first read runs once for the page's life; later reads go through Refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (title.trim() === '') {
      setFormError(t('tasks.invalidTitle'))
      return
    }
    if (prompt.trim() === '') {
      setFormError(t('tasks.invalidPrompt'))
      return
    }
    const chosen = timingOf(kind, { after: afterSeconds, date: atDate, atTime, time: clockTime, weekdays, interval: intervalSeconds, cron })
    if ('invalid' in chosen) {
      setFormError(t(chosen.invalid))
      return
    }
    if (target === 'group' && groupId.trim() === '') {
      setFormError(t('tasks.invalidGroup'))
      return
    }
    setFormError(null)
    setCreating(true)
    setNotice(null)
    try {
      const result = await call(editing === null ? 'schedules.create' : 'schedules.update', {
        ...(editing === null ? {} : { id: editing }),
        purpose,
        title: title.trim(),
        prompt,
        ...(editing === null || JSON.stringify(chosen.timing) !== editingTiming ? chosen.timing : {}),
        target: target === 'group' ? 'group:' + groupId.trim().replace(/^group:/, '') : 'owner',
      })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const accepted = parseOpaque(result.ok ? result.value : undefined)
      if (!accepted.ok) {
        setFailure(accepted.failure)
        return
      }
      setEditing(null)
      setCron('')
      setTitle('')
      setPrompt('')
      setAfterSeconds('')
      setAtTime('')
      setClockTime('')
      setWeekdays([])
      setIntervalSeconds('')
      setGroupId('')
      setFailure(null)
      setNotice(t('tasks.created', { title: title.trim() }))
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setCreating(false)
    }
  }

  const runNow = async (task: FishTask): Promise<void> => {
    setNotice(null)
    try {
      const result = await call('schedules.run', { id: task.id })
      const failed = failureText(result)
      if (failed !== null) { setFailure(failed); return }
      setFailure(null)
      setNotice(t('tasks.runNowDone', { title: task.title === '' ? task.id : task.title }))
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    }
  }

  const remove = async (task: FishTask): Promise<void> => {
    setDeleting(task.id)
    setNotice(null)
    try {
      const result = await call('schedules.delete', { id: task.id })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      setFailure(null)
      setNotice(t('tasks.deleted'))
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setDeleting(null)
    }
  }

  const edit = (task: FishTask): void => {
    const timing = isRecord(task.timing) ? task.timing : {}
    let selected: TimingKind = 'after'
    if ('every_seconds' in timing) selected = 'every'
    if ('at' in timing) selected = 'at'
    if ('daily' in timing) selected = 'daily'
    if ('weekly' in timing) selected = 'weekly'
    if ('cron' in timing) selected = 'cron'
    const selector = timing[selected === 'every' ? 'every_seconds' : selected === 'after' ? 'after_seconds' : selected]
    const values = isRecord(selector) ? selector : {}
    const date = typeof values.date === 'string' ? values.date : ''
    const time = typeof values.time === 'string' ? clockOf(values.time) : ''
    const days = Array.isArray(values.weekdays) ? values.weekdays.filter((day): day is number => typeof day === 'number') : []
    const expression = typeof values.expression === 'string' ? values.expression : ''
    const interval = String(timing.every_seconds ?? '')
    const after = String(timing.after_seconds ?? '')
    const original = timingOf(selected, { after, date, atTime: time, time, weekdays: days, interval, cron: expression })
    setEditingTiming('timing' in original ? JSON.stringify(original.timing) : '')
    setEditing(task.id); setTitle(task.title); setPrompt(task.prompt); setKind(selected)
    setAfterSeconds(after); setAtDate(date); setAtTime(time); setClockTime(time)
    setWeekdays(days); setIntervalSeconds(interval); setCron(expression)
    setPurpose(task.purpose === 'autonomy' ? 'autonomy' : 'reminder')
    const destination = optionalString(task, 'target') ?? 'owner'
    setTarget(destination.startsWith('group:') ? 'group' : 'owner')
    setGroupId(destination.startsWith('group:') ? destination.slice(6) : '')
    setFormError(null)
  }

  const pause = async (task: FishTask): Promise<void> => {
    try {
      const result = await call('schedules.update', { id: task.id, state: task.status === 'paused' ? 'active' : 'paused' })
      if (!result.ok) setFailure(result.failure)
      else await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    }
  }

  const toggleWeekday = (day: number, next: boolean): void => {
    setWeekdays(current => (next ? [...current, day] : current.filter(item => item !== day)).sort((a, b) => a - b))
  }

  return (
    <div className={taskCss.page}>
      <p className={taskCss.note}>{t('tasks.readonlyNote')}</p>
      <div className={taskCss.tabs}>
        <Button size="sm" variant={category === 'computer' ? 'primary' : 'ghost'} onClick={() => { setCategory('computer') }}>{t('delegation.title')}</Button>
        <Button size="sm" variant={category === 'scheduled' ? 'primary' : 'ghost'} onClick={() => { setCategory('scheduled') }}>{t('delegation.scheduled')}</Button>
      </div>
      {category === 'computer' ? <DelegationTasks call={call} t={t} formatTimestamp={formatTimestamp} /> : (
        <div className={css.split}>
          <section className={css.listColumn} aria-label={t('tasks.list')}>
            <div className={css.columnHead}>
              <h2 className={css.sectionTitle}>{t('tasks.list')}</h2>
              <div className={css.headActions}>
                {notice !== null && <span className={css.inlineNotice} role="status">{notice}</span>}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<IconRefreshOutlineRegular size={14} />}
                  aria-label={t('refresh')}
                  title={t('refresh')}
                  disabled={loading}
                  onClick={() => { void load() }}
                />
              </div>
            </div>
            {failure !== null && <p className={css.inlineError} role="alert">
              <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
            </p>}
            <PageHint label={t('common.help')} items={[t('tasks.afterHint'), t('tasks.zoneHint', { zone: TIME_ZONE }), t('tasks.intervalHint'), t('tasks.targetHint')]} />
            <div className={css.scrollArea} aria-busy={loading}>
              {loading && tasks === null && <p className={css.muted} role="status">{t('tasks.loading')}</p>}
              {tasks !== null && tasks.length === 0 && <p className={css.muted}>{t('tasks.empty')}</p>}
              <ul className={css.rows}>
                {tasks?.map((task) => {
                  const due = dueText(task, formatTimestamp)
                  const when = firstField(task, ['when', 'timing', 'rule'])
                  const nextRun = optionalString(task, 'nextRunDisplay')
                  const occurrence = firstField(task, ['occurrence', 'occurrenceState'])
                  const receipt = optionalString(task, 'receipt_id')
                  const taskTarget = optionalString(task, 'target')
                  return (
                    <li key={task.id} className={css.taskRow}>
                      <StateDot state={statusDot(task.status)} />
                      <div className={css.taskBody}>
                        <span className={css.rowTitle}>{task.title === '' ? task.id : task.title}</span>
                        {task.prompt !== '' && <p className={css.cardBody}>{task.prompt}</p>}
                        <span className={css.rowMeta}>{optionalString(task, 'purposeLabel')} · {optionalString(task, 'engineLabel')}</span>
                        {optionalString(task, 'result') !== undefined && <p className={css.cardBody}>{optionalString(task, 'result')}</p>}
                        {Array.isArray(task.occurrences) && task.occurrences.length > 0 && <details>
                          <summary>{t('tasks.history')}</summary>
                          {task.occurrences.filter(isRecord).map((item, index) => <p key={index} className={css.cardFoot}>{String(item.display ?? item.slot ?? '')} · {String(item.state ?? '')} · {String(item.note ?? '')}</p>)}
                        </details>}
                        <span className={css.rowMeta}>
                          {task.status !== '' && <Tag tone={statusTone(task.status)}>{task.status}</Tag>}
                          {when !== undefined && <span>{t('tasks.when', { when })}</span>}
                          {due !== null && <span><IconClockOutlineRegular size={12} /> {t('tasks.nextRun', { time: due })}</span>}
                          {nextRun !== undefined && <span>{t('tasks.nextRun', { time: nextRun })}</span>}
                          {taskTarget !== undefined && <span>{t('tasks.target', { target: taskTarget === 'owner' ? t('tasks.targetOwner') : taskTarget })}</span>}
                        </span>
                        {(occurrence !== undefined || receipt !== undefined) && (
                          <span className={css.cardFoot}>
                            {occurrence !== undefined && t('tasks.occurrence', { state: occurrence })}
                            {occurrence !== undefined && receipt !== undefined && ' · '}
                            {receipt !== undefined && t('tasks.receipt', { id: receipt })}
                          </span>
                        )}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => { edit(task) }}>{t('tasks.edit')}</Button>
                      <Button size="sm" variant="outline" onClick={() => { void runNow(task) }}>{t('tasks.runNow')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => { void pause(task) }}>{task.status === 'paused' ? t('tasks.resume') : t('tasks.pause')}</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<IconTrashOutlineRegular size={14} />}
                        aria-label={`${t('tasks.delete')}: ${task.title === '' ? task.id : task.title}`}
                        title={t('tasks.deleteHint')}
                        disabled={deleting !== null}
                        onClick={() => { void remove(task) }}
                      >
                        {deleting === task.id ? t('tasks.deleting') : t('tasks.delete')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
          <WorkspaceFiles call={call} t={t} />
          <section className={css.detailColumn} aria-label={t('tasks.create')}>
            <div className={css.detailHead}>
              <h2 className={css.detailTitle}>{editing === null ? t('tasks.create') : t('tasks.edit')}</h2>
            </div>
            <form className={css.form} onSubmit={(event) => { void create(event) }}>
              <label className={css.field}>
                <span className={css.label}>{t('tasks.purpose')}</span>
                <select className={css.select} value={purpose} onChange={(event) => { setPurpose(event.target.value === 'autonomy' ? 'autonomy' : 'reminder') }}>
                  <option value="reminder">{t('tasks.purpose.reminder')}</option>
                  <option value="autonomy">{t('tasks.purpose.autonomy')}</option>
                </select>
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('tasks.title')}</span>
                <Input value={title} placeholder={t('tasks.titlePlaceholder')} onChange={(event) => { setTitle(event.target.value) }} />
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('tasks.prompt')}</span>
                <textarea
                  className={css.textarea}
                  rows={6}
                  value={prompt}
                  placeholder={t('tasks.promptPlaceholder')}
                  onChange={(event) => { setPrompt(event.target.value) }}
                />
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('tasks.timing')}</span>
                <select
                  className={css.select}
                  value={kind}
                  aria-label={t('tasks.timing')}
                  onChange={(event) => {
                    setKind(event.target.value as TimingKind)
                    setFormError(null)
                  }}
                >
                  <option value="after">{t('tasks.kind.after')}</option>
                  <option value="at">{t('tasks.kind.at')}</option>
                  <option value="daily">{t('tasks.kind.daily')}</option>
                  <option value="weekly">{t('tasks.kind.weekly')}</option>
                  <option value="every">{t('tasks.kind.every')}</option>
                  <option value="cron">{t('tasks.kind.cron')}</option>
                </select>
              </label>
              {kind === 'cron' && <label className={css.field}><span className={css.label}>{t('tasks.kind.cron')}</span><Input value={cron} placeholder="0 7 * * *" onChange={(event) => { setCron(event.target.value) }} /></label>}
              {kind === 'after' && <label className={css.field}>
                <span className={css.label}>{t('tasks.after')}</span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={afterSeconds}
                  placeholder="60"
                  aria-label={t('tasks.after')}
                  onChange={(event) => { setAfterSeconds(event.target.value) }}
                />
              </label>}
              {kind === 'at' && <div className={css.fieldRow}>
                <label className={css.field}>
                  <span className={css.label}>{t('tasks.date')}</span>
                  <Input
                    type="text"
                    value={atDate}
                    placeholder={todayInZone()}
                    aria-label={t('tasks.date')}
                    onChange={(event) => { setAtDate(event.target.value) }}
                  />
                </label>
                <label className={css.field}>
                  <span className={css.label}>{t('tasks.time')}</span>
                  <Input
                    type="time"
                    value={atTime}
                    aria-label={t('tasks.time')}
                    onChange={(event) => { setAtTime(event.target.value) }}
                  />
                </label>
              </div>}
              {(kind === 'daily' || kind === 'weekly') && <label className={css.field}>
                <span className={css.label}>{t('tasks.time')}</span>
                <Input
                  type="time"
                  value={clockTime}
                  aria-label={t('tasks.time')}
                  onChange={(event) => { setClockTime(event.target.value) }}
                />
              </label>}
              {kind === 'weekly' && <fieldset className={css.fieldset}>
                <legend className={css.label}>{t('tasks.weekdays')}</legend>
                <div className={css.weekdayRow}>
                  {WEEKDAYS.map(day => (
                    <Checkbox
                      key={day}
                      checked={weekdays.includes(day)}
                      label={t(`tasks.weekday.${day}`)}
                      onChange={(next) => { toggleWeekday(day, next) }}
                      className={css.checkbox}
                    />
                  ))}
                </div>
              </fieldset>}
              {kind === 'every' && <label className={css.field}>
                <span className={css.label}>{t('tasks.interval')}</span>
                <Input
                  type="number"
                  min={60}
                  step={1}
                  inputMode="numeric"
                  value={intervalSeconds}
                  placeholder="3600"
                  aria-label={t('tasks.interval')}
                  onChange={(event) => { setIntervalSeconds(event.target.value) }}
                />
              </label>}
              <div className={css.fieldRow}>
                <label className={css.field}>
                  <span className={css.label}>{t('tasks.targetLabel')}</span>
                  <select
                    className={css.select}
                    value={target}
                    aria-label={t('tasks.targetLabel')}
                    onChange={(event) => { setTarget(event.target.value) }}
                  >
                    <option value="owner">{t('tasks.targetOwner')}</option>
                    <option value="group">{t('tasks.targetGroup')}</option>
                  </select>
                </label>
                {target === 'group' && <label className={css.field}>
                  <span className={css.label}>{t('tasks.groupId')}</span>
                  <Input
                    value={groupId}
                    placeholder={t('tasks.groupIdPlaceholder')}
                    aria-label={t('tasks.groupId')}
                    onChange={(event) => { setGroupId(event.target.value) }}
                  />
                </label>}
              </div>
              {formError !== null && <p className={css.inlineError} role="alert">{formError}</p>}
              <div className={css.formActions}>
                {editing !== null && <Button variant="ghost" onClick={() => { setEditing(null); setTitle(''); setPrompt('') }}>{t('tasks.cancelEdit')}</Button>}
                <Button
                  type="submit"
                  variant="primary"
                  icon={<IconPlusOutlineRegular size={14} />}
                  disabled={creating}
                >
                  {creating ? t('tasks.creating') : editing === null ? t('tasks.createAction') : t('tasks.save')}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
