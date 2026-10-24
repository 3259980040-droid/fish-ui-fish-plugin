/**
 * Read-only fault display. Priority: current stage/reason, active aggregates,
 * then recovery/test history. Refresh only reads; it never repeats a send.
 * Uses the settings page's existing 14px headings, 12px metadata and DSW tokens.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure } from '../contract/slots.ts'
import type { FishFaultStatus } from '../contract/workbench.ts'
import type { FishPageProps } from '../page-props.ts'
import type { FishKey } from '../locales.ts'
import { parseFaultStatus } from '../parsers.ts'
import css from './pages.module.css'

/** Localized label for the recorded outcome; an unknown value stays visible. */
function outcomeText(outcome: string, t: FishPageProps['t']): string {
  switch (outcome) {
    case 'silent': return t('faults.silent')
    case 'failed': return t('faults.failed')
    case 'uncertain': return t('faults.uncertain')
    case 'success': return t('faults.success')
    default: return outcome
  }
}

/** Labels only: lifecycle decisions remain in the Python owner. */
function stageText(stage: string, t: FishPageProps['t']): string {
  if (stage === '') return t('faults.stageHistorical')
  const keys: Record<string, FishKey> = { connection: 'faults.stageConnection', receive: 'faults.stageReceive',
    configuration: 'faults.stageConfiguration', binding: 'faults.stageBinding', model: 'faults.stageModel',
    judge: 'faults.stageJudge', prescreen: 'faults.stagePrescreen', delivery: 'faults.stageDelivery',
    survey: 'faults.stageSurvey', generate: 'faults.stageGenerate', storage: 'faults.stageStorage', turn: 'faults.stageTurn' }
  const key = keys[stage]
  return key === undefined ? stage : t(key)
}

/** Human-readable channel label while retaining the source's scope suffix. */
function sourceText(source: string, t: FishPageProps['t']): string {
  if (source === 'qq-channel') return t('faults.sourceChannel')
  if (source === 'owner-private' || source === 'owner_private') return t('faults.sourcePrivate')
  if (source.startsWith('group-fish:')) return t('faults.sourceGroup') + source.slice('group-fish:'.length)
  if (source.startsWith('group-round:')) return t('faults.sourceRound') + source.slice('group-round:'.length)
  return source
}

/**
 * Render current observations and aggregates without interpreting errors again.
 * @param props - parsed backend observations, locale and timestamp formatter.
 * @returns current stages followed by persistent fault and recovery records.
 */
export function FaultStatusFacts(
  { state, t, formatTimestamp }: Pick<FishPageProps, 't' | 'formatTimestamp'> & { readonly state: FishFaultStatus },
): ReactNode {
  const latest = state.latest.filter((row, index, rows) =>
    rows.findIndex(item => item.source === row.source && item.stage === row.stage) === index)
  const active = state.items.filter(row => row.consecutive > 0)
  const recovered = state.items.filter(row => row.consecutive === 0 && row.recovered_at > 0)
  const stamp = (value: number): string => value > 0 ? formatTimestamp(value) : t('common.nothing')
  return <>
    <p className={css.muted}>{t('faults.legend')}</p>
    {state.configuration.map(row => <div key={`${row.source}:${row.code}`} role="alert">
      <Tag tone="danger">{t('faults.configuration')}</Tag>
      <p className={css.cardBody}>{row.reason}</p>
      <span className={css.rowMeta}>{row.source} · {row.code}</span>
    </div>)}
    {latest.length === 0 && <p className={css.muted}>{t('faults.noObservation')}</p>}
    {latest.map(row => <div key={`${row.source}:${row.stage}`}>
      <div className={css.rowMeta}>
        <Tag tone={row.outcome === 'uncertain' ? 'warning' : row.outcome === 'failed' ? 'danger' : 'outline'}>{outcomeText(row.outcome, t)}</Tag>
        <span>{t('faults.stage', { source: sourceText(row.source, t), stage: stageText(row.stage, t) })}</span>
        <span>{stamp(row.updated)}</span>
      </div>
      <p className={css.cardBody}>{row.reason}</p>
      {row.outcome === 'uncertain' && <p className={css.inlineError}>{t('faults.noRetry')}</p>}
    </div>)}
    <h4 className={css.cardTitle}>{t('faults.active', { count: active.length })}</h4>
    {active.length === 0 && <p className={css.muted}>{t('faults.noFaults')}</p>}
    {active.map(row => <article key={`${row.source}:${row.stage}:${row.code}`} aria-label={t('faults.card', { source: row.source, code: row.code })}>
      <div className={css.rowMeta}>
        <Tag tone={row.uncertain ? 'warning' : 'danger'}>{row.uncertain ? t('faults.uncertain') : t('faults.failed')}</Tag>
        <span>{t('faults.stage', { source: sourceText(row.source, t), stage: stageText(row.stage, t) })}</span>
        <span>{row.code}</span>
      </div>
      <p className={css.cardBody}>{row.reason}</p>
      <p className={css.rowMeta}>{t('faults.counts', { count: row.consecutive, total: row.total })}</p>
      <p className={css.rowMeta}>{t('faults.times', { first: stamp(row.first_failed), last: stamp(row.last_failed) })}</p>
      {row.uncertain && <p className={css.inlineError}>{t('faults.noRetry')}</p>}
    </article>)}
    <div>
      <h4 className={css.cardTitle}>{t('faults.reminders')}</h4>
      {(['memory_reminder', 'private_proactive'] as const).map((key) => {
        const value = state.reminders[key]
        return <p key={key} className={css.cardBody}>
          {t(key === 'memory_reminder' ? 'faults.memoryReminder' : 'faults.privateProactive')}
          {' · '}{value.source}={t(value.enabled ? 'common.on' : 'common.off')}
          {' · '}{t(value.effective ? 'faults.effective' : 'faults.notEffective')}
          <br />{value.reason}
        </p>
      })}
    </div>
    <details>
      <summary className={css.helpSummary}>{t('faults.history', { count: recovered.length })}</summary>
      {recovered.map(row => <p className={css.cardBody} key={`${row.source}:${row.stage}:${row.code}`}>
        {t(row.uncertain ? 'faults.recoveryUncertain' : 'faults.recovery', { source: sourceText(row.source, t), code: row.code, time: stamp(row.recovered_at) })}
        {' · '}{t('faults.counts', { count: row.consecutive, total: row.total })}
      </p>)}
    </details>
    <details>
      <summary className={css.helpSummary}>{t('faults.tests')}</summary>
      <p className={css.muted}>{t('faults.testCaution')}</p>
      {state.tests.length === 0 && <p className={css.muted}>{t('faults.noTests')}</p>}
      {state.tests.map(row => <div key={row.case_name}>
        <p className={css.cardBody}>{row.case_name}</p>
        <p className={css.rowMeta}>{t('faults.frequency', { failures: row.failures, runs: row.runs,
          rate: row.runs > 0 ? (100 * row.failures / row.runs).toFixed(1) : '—', consecutive: row.consecutive })}</p>
        <p className={css.rowMeta}>{t('faults.testTimes', { failed: stamp(row.last_failed), passed: stamp(row.last_passed) })}</p>
      </div>)}
    </details>
  </>
}

/**
 * Load fault status independently of settings, which may fail on a missing persona.
 * @param props - existing read-only workbench callback and locale.
 * @returns one settings card with an explicit read failure or parsed observations.
 */
export function FaultStatus({ call, t, formatTimestamp }: FishPageProps): ReactNode {
  const [state, setState] = useState<FishFaultStatus | null>(null)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [loading, setLoading] = useState(false)
  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await call('faults.status')
      const parsed = result.ok ? parseFaultStatus(result.value) : result
      if (!parsed.ok) setFailure(parsed.failure)
      else { setState(parsed.value); setFailure(null) }
    } catch (error) {
      setFailure({ message: error instanceof Error ? error.message : String(error), offline: false })
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  return <section className={css.settingsCard} aria-label={t('faults.title')}>
    <div className={css.settingsRow}>
      <h3 className={css.sectionTitle}>{t('faults.title')}</h3>
      <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={14} />} disabled={loading}
        aria-label={t('faults.refresh')} onClick={() => { void load() }}>{t('refresh')}</Button>
    </div>
    {failure !== null && <p className={css.inlineError} role="alert">{t('faults.readFailed', { error: failure.message })}</p>}
    {loading && state === null && <p className={css.muted}>{t('loading')}</p>}
    {state !== null && <FaultStatusFacts state={state} t={t} formatTimestamp={formatTimestamp} />}
  </section>
}
