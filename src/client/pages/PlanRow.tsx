/**
 * One scheduled plan row: its real state, timing, target, newest instance and
 * that instance's linked main-execution turn. Every value comes from
 * `schedules.list` or `turn.view`; missing data is named instead of guessed, and
 * a missing execution is not rendered as a dead link.
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  Button, IconClockOutlineRegular, IconTrashOutlineRegular,
  IconWarningOutlineRegular, StateDot, Tag, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type { FishTask, FishTurnView } from '../contract/workbench.ts'
import { optionalString } from '../contract/workbench.ts'
import { parseTurnView } from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import css from './pages.module.css'

/** Callbacks the page supplies for one plan row. */
interface Props {
  readonly call: FishPageProps['call']
  readonly t: FishPageProps['t']
  readonly formatTimestamp: FishPageProps['formatTimestamp']
  readonly task: FishTask
  /** True while this row's edit, run, pause, or delete call is in flight. */
  readonly busy: boolean
  /** Real failure of the last row action, kept beside the row. */
  readonly failure: FishFailure | null
  readonly onEdit: (task: FishTask) => void
  readonly onRun: (task: FishTask) => void
  readonly onPause: (task: FishTask) => void
  readonly onDelete: (task: FishTask) => void
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The dot a plan lifecycle state renders. */
function planDot(state: string): StateDotState {
  switch (state) {
    case 'active':
      return 'done'
    case 'paused':
      return 'warning'
    case 'completed':
      return 'idle'
    default:
      return 'idle'
  }
}

/** The tag tone a plan lifecycle state renders. */
function planTone(state: string): 'success' | 'warning' | 'danger' | 'outline' {
  switch (state) {
    case 'active':
      return 'success'
    case 'paused':
      return 'warning'
    default:
      return 'outline'
  }
}

/** The dot one plan-occurrence state renders. */
function instanceDot(state: string): StateDotState {
  switch (state) {
    case 'sent':
      return 'done'
    case 'due':
    case 'catchup':
    case 'queued':
    case 'running':
    case 'manual':
      return 'ongoing'
    case 'uncertain':
    case 'failed':
      return 'error'
    case 'no_action':
    case 'skipped':
    case 'cancelled':
      return 'idle'
    default:
      return 'idle'
  }
}

/** The tag tone one plan-occurrence state renders. */
function instanceTone(state: string): 'success' | 'warning' | 'danger' | 'outline' {
  switch (instanceDot(state)) {
    case 'done':
      return 'success'
    case 'ongoing':
      return 'warning'
    case 'error':
      return 'danger'
    default:
      return 'outline'
  }
}

/** Localized lifecycle state, falling back to the backend's own token when unknown. */
export function planStateText(t: FishPageProps['t'], state: string): string {
  switch (state) {
    case 'active': return t('tasks.planState.active')
    case 'paused': return t('tasks.planState.paused')
    case 'completed': return t('tasks.planState.completed')
    default: return state === '' ? t('tasks.planState.unknown') : state
  }
}

/** Localized occurrence state, falling back to the backend's own token when unknown. */
function instanceStateText(t: FishPageProps['t'], state: string): string {
  switch (state) {
    case 'due': return t('tasks.instance.due')
    case 'catchup': return t('tasks.instance.catchup')
    case 'queued': return t('tasks.instance.queued')
    case 'running': return t('tasks.instance.running')
    case 'manual': return t('tasks.instance.manual')
    case 'sent': return t('tasks.instance.sent')
    case 'no_action': return t('tasks.instance.no_action')
    case 'uncertain': return t('tasks.instance.uncertain')
    case 'failed': return t('tasks.instance.failed')
    case 'skipped': return t('tasks.instance.skipped')
    case 'cancelled': return t('tasks.instance.cancelled')
    default: return state === '' ? t('tasks.planState.unknown') : state
  }
}

/** Localized turn status, falling back to the backend's own token when unknown. */
function turnStatusText(t: FishPageProps['t'], status: string): string {
  switch (status) {
    case 'queued': return t('tasks.turn.job.queued')
    case 'running': return t('tasks.turn.job.running')
    case 'complete': return t('tasks.turn.job.complete')
    case 'failed': return t('tasks.turn.job.failed')
    case 'cancelled': return t('tasks.turn.job.cancelled')
    default: return status === '' ? t('tasks.planState.unknown') : status
  }
}

/** Localized delivery state; plan turns use uppercase states and chat turns lowercase ones. */
function deliveryStateText(t: FishPageProps['t'], state: string): string {
  switch (state) {
    case 'SUCCEEDED': return t('tasks.turn.deliveryState.succeeded')
    case 'UNKNOWN': return t('tasks.turn.deliveryState.unknown')
    case 'FAILED': return t('tasks.turn.deliveryState.failed')
    case 'BLOCKED': return t('tasks.turn.deliveryState.blocked')
    case 'sent': return t('tasks.turn.deliveryState.sent')
    case 'uncertain': return t('tasks.turn.deliveryState.uncertain')
    case 'failed': return t('tasks.turn.deliveryState.failed')
    default: return state === '' ? t('tasks.planState.unknown') : state
  }
}

/** Localized trigger kind, falling back to the backend's own token when unknown. */
function triggerKindText(t: FishPageProps['t'], kind: string): string {
  switch (kind) {
    case 'message': return t('tasks.turn.kind.message')
    case 'plan': return t('tasks.turn.kind.plan')
    case 'timer': return t('tasks.turn.kind.timer')
    case 'followup': return t('tasks.turn.kind.followup')
    default: return kind
  }
}

/** Purpose text when the backend's localized label is absent. */
function purposeText(t: FishPageProps['t'], task: FishTask): string {
  const label = optionalString(task, 'purposeLabel')
  if (label !== undefined && label !== '') return label
  return task.purpose === 'autonomy' ? t('tasks.purpose.autonomy') : t('tasks.purpose.reminder')
}

/** A timestamp field shown only when the turn recorded a real value. */
function timeText(value: number | null, formatTimestamp: FishPageProps['formatTimestamp']): string {
  return value === null || value === 0 ? '—' : formatTimestamp(value)
}

/**
 * The real record of the newest occurrence's turn.
 * @param props - the parsed view, its loading/error state, and locale helpers.
 * @returns the status, trigger, delivery, and five delivery timestamps.
 */
function TurnCard({ turn, error, loading, t, formatTimestamp, onClose }: {
  readonly turn: FishTurnView | null
  readonly error: string | null
  readonly loading: boolean
  readonly t: FishPageProps['t']
  readonly formatTimestamp: FishPageProps['formatTimestamp']
  readonly onClose: () => void
}): ReactNode {
  if (loading) return <p className={css.muted} role="status">{t('tasks.turn.loading')}</p>
  if (error !== null) {
    return <p className={css.inlineError} role="alert">
      <IconWarningOutlineRegular size={14} />{t('common.failed', { error })}
    </p>
  }
  if (turn === null) return null
  const trigger = [
    turn.trigger.kind === '' ? '' : t('tasks.turn.triggerKind', { kind: triggerKindText(t, turn.trigger.kind) }),
    turn.trigger.reason === '' ? '' : t('tasks.turn.triggerReason', { reason: turn.trigger.reason }),
    turn.trigger.place === '' ? '' : t('tasks.turn.triggerPlace', { place: turn.trigger.place }),
  ].filter(part => part !== '')
  const times = turn.delivery_times === null ? null : [
    t('tasks.turn.time.arrival', { time: turn.delivery_times.arrival === '' ? '—' : formatTimestamp(turn.delivery_times.arrival) }),
    t('tasks.turn.time.started', { time: timeText(turn.delivery_times.started, formatTimestamp) }),
    t('tasks.turn.time.first', { time: timeText(turn.delivery_times.first_output, formatTimestamp) }),
    t('tasks.turn.time.sending', { time: timeText(turn.delivery_times.sending, formatTimestamp) }),
    t('tasks.turn.time.receipt', { time: timeText(turn.delivery_times.receipt, formatTimestamp) }),
  ]
  return <div className={css.card}>
    <div className={css.cardHead}>
      <span className={css.cardTitle}>{t('tasks.turn.title')}</span>
      <Button size="sm" variant="ghost" onClick={onClose}>{t('tasks.turn.hide')}</Button>
    </div>
    <span className={css.rowMeta}>
      <Tag tone={turn.status === 'failed' ? 'danger' : turn.status === 'complete' ? 'success' : 'outline'}>
        {turnStatusText(t, turn.status)}
      </Tag>
      {turn.raw_status !== '' && <span>{turn.raw_status}</span>}
      <code>{turn.execution}</code>
    </span>
    {trigger.length > 0 && <p className={css.cardBody}>{trigger.join(' · ')}</p>}
    {turn.trigger.reference !== '' && <p className={css.cardFoot}>{t('tasks.turn.reference', { reference: turn.trigger.reference })}</p>}
    {turn.delivery === null
      ? <p className={css.cardFoot}>{t('tasks.turn.deliveryNone')}</p>
      : <div className={css.card}>
        <span className={css.rowMeta}>
          <span>{t('tasks.turn.delivery', { state: deliveryStateText(t, turn.delivery.state) })}</span>
          {turn.delivery.target !== '' && <span>{t('tasks.turn.deliveryTarget', { target: turn.delivery.target })}</span>}
          {turn.delivery.bubbles !== null
            ? <span>{t('tasks.turn.deliveryBubbles', { count: turn.delivery.bubbles })}</span>
            : <span>{t('tasks.turn.bubblesMissing')}</span>}
        </span>
        {turn.delivery.receiptId !== '' && <p className={css.cardFoot}>{t('tasks.receipt', { id: turn.delivery.receiptId })}</p>}
        {turn.delivery.receiptMessageId !== '' && <p className={css.cardFoot}>{t('tasks.turn.messageId', { id: turn.delivery.receiptMessageId })}</p>}
        {turn.delivery.error !== '' && <p className={css.inlineError}>{turn.delivery.error}</p>}
      </div>}
    {turn.silent && <p className={css.cardFoot}>{t('tasks.turn.silent')}</p>}
    {times !== null && <p className={css.cardFoot}>{times.join(' · ')}</p>}
    {turn.plan !== null && <p className={css.cardFoot}>{t('tasks.turn.plan', { id: turn.plan.schedule_id, slot: turn.plan.slot })}</p>}
    {turn.error !== '' && <p className={css.inlineError}>{t('tasks.turn.error', { error: turn.error })}</p>}
  </div>
}

/**
 * Render one plan with its real instance and execution link.
 * @param props - the plan, row action state, callbacks, and locale helpers.
 * @returns the plan row.
 */
export function PlanRow({ call, t, formatTimestamp, task, busy, failure, onEdit, onRun, onPause, onDelete }: Props): ReactNode {
  const [openTurn, setOpenTurn] = useState(false)
  const [turn, setTurn] = useState<FishTurnView | null>(null)
  const [turnError, setTurnError] = useState<string | null>(null)
  const [turnLoading, setTurnLoading] = useState(false)
  const state = optionalString(task, 'state') ?? task.status
  const when = optionalString(task, 'when')
  const nextRunDisplay = optionalString(task, 'nextRunDisplay')
  const nextRunAt = optionalString(task, 'nextRunAt')
  // nextRunDisplay is already the real "YYYY-MM-DD HH:mm:ss Asia/Shanghai" text;
  // nextRunAt is the raw ISO value and needs the page timestamp helper.
  const nextRun = nextRunDisplay !== undefined && nextRunDisplay !== ''
    ? nextRunDisplay
    : nextRunAt !== undefined && nextRunAt !== '' ? formatTimestamp(nextRunAt) : undefined
  const engine = optionalString(task, 'engineLabel')
  const latest = task.occurrences === undefined ? undefined : task.occurrences[0]
  const latestState = latest?.state ?? optionalString(task, 'occurrenceState') ?? ''
  const latestNote = latest?.note !== undefined && latest.note !== '' ? latest.note : (optionalString(task, 'result') ?? '')
  const latestReceipt = latest?.receipt_id !== undefined && latest.receipt_id !== ''
    ? latest.receipt_id : (optionalString(task, 'receipt_id') ?? '')
  const execution = latest?.execution ?? ''
  const title = task.title === '' ? task.id : task.title

  // A new occurrence means the previously shown turn is no longer "this one".
  useEffect(() => {
    setOpenTurn(false)
    setTurn(null)
    setTurnError(null)
  }, [execution])

  const toggleTurn = async (): Promise<void> => {
    if (openTurn) { setOpenTurn(false); return }
    setOpenTurn(true)
    if (turn !== null) return
    setTurnLoading(true)
    setTurnError(null)
    try {
      const reply: FishResult<unknown> = await call('turn.view', { execution })
      if (!reply.ok) { setTurnError(reply.failure.message); return }
      const parsed = parseTurnView(reply.value)
      if (parsed.ok) setTurn(parsed.value)
      else setTurnError(parsed.failure.message)
    } catch (error) {
      setTurnError(reasonOf(error))
    } finally {
      setTurnLoading(false)
    }
  }

  return <li className={css.taskRow}>
    <StateDot state={planDot(state)} />
    <div className={css.taskBody}>
      <span className={css.rowTitle}>{title}</span>
      {task.prompt !== '' && <p className={css.cardBody}>{task.prompt}</p>}
      <span className={css.rowMeta}>
        <Tag tone={planTone(state)}>{planStateText(t, state)}</Tag>
        <span>{purposeText(t, task)}</span>
        {optionalString(task, 'targetLabel') !== undefined && <span>{t('tasks.target', { target: optionalString(task, 'targetLabel') ?? '' })}</span>}
        {engine !== undefined && engine !== '' && <span>{engine}</span>}
      </span>
      <span className={css.rowMeta}>
        {when !== undefined && when !== '' && <span>{t('tasks.when', { when })}</span>}
        {nextRun !== undefined && <span><IconClockOutlineRegular size={12} /> {state === 'paused'
          ? t('tasks.nextRunPaused', { time: nextRun })
          : t('tasks.nextRun', { time: nextRun })}</span>}
        {nextRun === undefined && <span>{t('tasks.nextRunNone')}</span>}
      </span>
      <div className={css.card}>
        <span className={css.cardTitle}>{t('tasks.latest')}</span>
        {latest === undefined
          ? <p className={css.muted}>{t('tasks.latestNone')}</p>
          : <>
            <span className={css.rowMeta}>
              <Tag tone={instanceTone(latestState)}>{instanceStateText(t, latestState)}</Tag>
              {latest.display !== '' && <span>{t('tasks.latestDisplay', { time: latest.display })}</span>}
              {latest.attempts > 0 && <span>{t('tasks.attempts', { count: latest.attempts })}</span>}
            </span>
            {latestNote !== '' && <p className={css.cardBody}>{latestNote}</p>}
            {latestReceipt !== '' && <p className={css.cardFoot}>{t('tasks.receipt', { id: latestReceipt })}</p>}
            {execution === ''
              ? <p className={css.cardFoot}>{t('tasks.turn.missing')}</p>
              : <Button size="sm" variant="outline" disabled={busy} onClick={() => { void toggleTurn() }}>
                {openTurn ? t('tasks.turn.hide') : t('tasks.turn.view')}
              </Button>}
            {openTurn && <TurnCard
              turn={turn}
              error={turnError}
              loading={turnLoading}
              t={t}
              formatTimestamp={formatTimestamp}
              onClose={() => { setOpenTurn(false) }}
            />}
          </>}
      </div>
      {task.occurrences !== undefined && task.occurrences.length > 1 && <details>
        <summary>{t('tasks.history')}</summary>
        {task.occurrences.slice(1).map(item => <p key={item.slot} className={css.cardFoot}>
          {item.display !== '' ? item.display : item.slot} · {instanceStateText(t, item.state)}
          {item.note !== '' && ' · ' + item.note}
          {item.receipt_id !== '' && ' · ' + t('tasks.receipt', { id: item.receipt_id })}
          {item.execution !== '' && ' · ' + t('tasks.turn.executionId', { id: item.execution })}
        </p>)}
      </details>}
      {failure !== null && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
      </p>}
    </div>
    <div className={css.rowActions}>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { onEdit(task) }}>{t('tasks.edit')}</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { onRun(task) }}>{t('tasks.runNow')}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { onPause(task) }}>
        {state === 'paused' ? t('tasks.resume') : t('tasks.pause')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<IconTrashOutlineRegular size={14} />}
        aria-label={`${t('tasks.delete')}: ${title}`}
        title={t('tasks.deleteHint')}
        disabled={busy}
        onClick={() => { onDelete(task) }}
      >
        {t('tasks.delete')}
      </Button>
    </div>
  </li>
}
