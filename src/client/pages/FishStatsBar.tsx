/** Fish accounting adapters to DSH's shared statistics surface; never reads a DSH session. */
import type { ReactNode } from 'react'
import { StatisticPill, StatisticDetails, IconGaugeOutlineRegular, IconDatabaseOutlineRegular, formatCacheHitPercent, formatTokens, formatExactTokens, formatTokensPerSecond } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishTurnUsage, FishTurnView } from '../contract/workbench.ts'
import type { FishPageProps } from '../page-props.ts'
import css from './TurnWorkbench.module.css'

function UsageDetails({ usage, turn, t }: { readonly usage: FishTurnUsage; readonly turn?: FishTurnView; readonly t: FishPageProps['t'] }): ReactNode {
  const count = (value: number | null): string => value === null ? t('stats.unknown') : formatExactTokens(value, t)
  const prompt = usage.uncached_input_tokens !== null && usage.cache_read_tokens !== null && usage.cache_write_tokens !== null
    ? usage.uncached_input_tokens + usage.cache_read_tokens + usage.cache_write_tokens : usage.input_tokens
  const hit = prompt === null || usage.cache_read_tokens === null ? null : formatCacheHitPercent(usage.cache_read_tokens, prompt)
  return <StatisticDetails>
    <dt>{t('stats.scope')}</dt><dd>{t('stats.mainScope')}</dd>
    <dt>{t('stats.coverage')}</dt><dd>{t(usage.state === 'reported' ? 'stats.reported' : usage.state === 'partial' ? 'stats.partial' : 'stats.unreported')}</dd>
    <dt>{t('stats.requests')}</dt><dd>{usage.request_count} / {usage.closed_steps}</dd>
    <dt>{t('stats.linked')}</dt><dd>{usage.coverage.linked_requests} / {usage.coverage.unlinked_requests}</dd>
    <dt>{t('stats.usageReports')}</dt><dd>{usage.usage_reports}</dd>
    <dt>{t('stats.input')}</dt><dd>{count(usage.input_tokens)}</dd>
    <dt>{t('stats.output')}</dt><dd>{count(usage.output_tokens)}</dd>
    <dt>{t('stats.cacheRead')}</dt><dd>{count(usage.cache_read_tokens)}</dd>
    <dt>{t('stats.cacheWrite')}</dt><dd>{count(usage.cache_write_tokens)}</dd>
    <dt>{t('stats.cacheHit')}</dt><dd>{hit === null ? t('stats.unknown') : `${hit}%`}</dd>
    <dt>{t('stats.speed')}</dt><dd>{turn?.output_speed?.tokens_per_second == null ? t('stats.speedUnknown') : t('stats.tps', { tps: formatTokensPerSecond(turn.output_speed.tokens_per_second) })}</dd>
    <dt>{t('stats.fieldCoverage')}</dt><dd>{Object.entries(usage.field_reports).map(([name, count]) => `${name}: ${count}`).join(' · ')}</dd>
  </StatisticDetails>
}

/** @param props - cumulative and selected-turn accounting. @returns the fixed workbench dock. */
export function FishStatsBar({ stats, turn, t }: {
  readonly stats: FishTurnUsage | null
  readonly turn: FishTurnView | null
  readonly t: FishPageProps['t']
}): ReactNode {
  const label = stats === null ? t('stats.unknown') : t('stats.instance', { turns: stats.turns, steps: stats.closed_steps })
  const total = stats?.input_tokens != null && stats.output_tokens !== null ? stats.input_tokens + stats.output_tokens : null
  const tokens = total === null ? t('stats.unknown') : t('stats.tokenCount', { tokens: formatTokens(total, t) })
  const hit = stats?.cache_read_tokens != null && stats.input_tokens !== null
    ? formatCacheHitPercent(stats.cache_read_tokens, stats.input_tokens) : null
  const usageLabel = hit === null ? tokens : `${tokens} · ${t('stats.cacheLabel', { percent: hit })}`
  return <footer className={css.stats}>
    <StatisticPill stat="fish-instance" icon={<IconGaugeOutlineRegular />} label={label} ariaLabel={label}
      details={stats === null ? undefined : { title: label, content: <UsageDetails usage={stats} t={t} /> }} />
    {stats !== null && <StatisticPill stat="fish-instance-usage" icon={<IconDatabaseOutlineRegular />} label={usageLabel}
      ariaLabel={t('stats.instanceUsage')} details={{ title: t('stats.instanceUsage'), content: <UsageDetails usage={stats} t={t} /> }} />}
    {turn?.usage != null && <StatisticPill stat="fish-turn" icon={<IconDatabaseOutlineRegular />} label={t('stats.turn')} ariaLabel={t('stats.turn')}
      details={{ title: t('stats.turn'), content: <UsageDetails usage={turn.usage} turn={turn} t={t} /> }} />}
  </footer>
}
