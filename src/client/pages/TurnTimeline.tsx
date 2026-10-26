/** Actual execution materials and outcomes; no inference about who should reply. */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { isRecord, type FishTurnMaterial, type FishTurnView } from '../contract/workbench.ts'
import type { FishKey } from '../locales.ts'
import type { FishPageProps } from '../page-props.ts'
import css from './TurnWorkbench.module.css'

/** @param at - epoch seconds. @returns full Beijing calendar time, or empty when absent. */
export function turnStamp(at: number | null): string {
  if (at === null) return ''
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(at * 1000))
}

/** @param turn - stored execution. @param t - locale seat. @returns observed state text. */
export function turnState(turn: FishTurnView, t: FishPageProps['t']): string {
  if (turn.merged_into !== '') return t('turns.merged', { id: turn.merged_into })
  if (turn.silent) return t('turns.silent')
  if (turn.delivery?.state === 'uncertain' || turn.delivery?.state === 'unknown') return t('turns.uncertain')
  const keys: Readonly<Record<string, FishKey>> = { running: 'turns.running', queued: 'turns.queued', failed: 'turns.failed',
    cancelled: 'turns.cancelled', complete: 'turns.complete', completed: 'turns.complete' }
  return t(keys[turn.status] ?? 'turns.complete')
}

function segments(material: FishTurnMaterial): readonly unknown[] {
  const value = material.original?.segments
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] }
  catch (_error) { return [] /* Raw segments remain visible in the original record. */ }
}

function Material({ material, t, viewImage, viewAttachment }: {
  readonly material: FishTurnMaterial
  readonly t: FishPageProps['t']
  readonly viewImage: (resource: string) => void
  readonly viewAttachment: (id: string, conversation: string) => void
}): ReactNode {
  const original = material.original
  const senderData = isRecord(material.payload.sender) ? material.payload.sender : {}
  const sender = typeof senderData.display_name === 'string' ? senderData.display_name : typeof original?.sender_id === 'string' ? original.sender_id
    : typeof original?.user_id === 'string' ? original.user_id : ''
  const quote = original?.reply_to
  const labels: Readonly<Record<string, FishKey>> = { desktop: 'turns.source.desktop', 'qq-private': 'turns.source.qq-private', 'qq-group': 'turns.source.qq-group' }
  const sourceLabel = labels[material.source]
  return <section className={css.material}>
    <div className={css.meta}>
      <span>{sourceLabel === undefined ? material.source : t(sourceLabel)}</span>
      {sender !== '' && <span>{t('turns.sender', { id: sender })}</span>}
      <span>{t('turns.destination', { place: material.place })}</span><time>{turnStamp(material.received)}</time>
    </div>
    {(typeof quote === 'string' || typeof quote === 'number') && String(quote) !== '' && String(quote) !== '0'
      && <blockquote className={css.quote}>{t('turns.quoteId', { id: String(quote) })}</blockquote>}
    {material.original_state === 'missing' ? <><p className={css.meta}>{t('turns.originalMissing')}</p><p className={css.text}>{material.preview}</p></>
      : <p className={css.text}>{material.text || t(original === null ? 'turns.noOriginalText' : 'turns.nonText')}</p>}
    {segments(material).map((raw, index) => {
      if (!isRecord(raw)) return null
      const data = isRecord(raw.data) ? raw.data : raw
      const text = typeof data.text === 'string' ? data.text : ''
      if (['reply', 'quote'].includes(String(raw.type))) return <blockquote key={index} className={css.quote}>{t('turns.quote')}：{text || JSON.stringify(raw)}</blockquote>
      const resource = typeof data.resource_id === 'string' ? data.resource_id : ''
      const file = typeof data.attachment_id === 'string' ? data.attachment_id : raw.type === 'file' && typeof data.id === 'string' ? data.id : ''
      if (resource !== '') return <Button key={index} size="sm" variant="outline" onClick={() => { viewImage(resource) }}>{t('media.viewImage', { name: typeof data.name === 'string' ? data.name : resource })}</Button>
      if (file !== '') return <Button key={index} size="sm" variant="outline" onClick={() => { viewAttachment(file, material.conversation) }}>{t('attachment.inspect', { name: typeof data.name === 'string' ? data.name : file })}</Button>
      return null
    })}
    <details className={css.original}><summary>{t('turns.original')}</summary><pre>{JSON.stringify({ ...material, original }, null, 2)}</pre></details>
  </section>
}

/** One real execution, including full originals, actions and separately confirmed deliveries. */
export function TurnTimeline({ turn, selected, select, t, viewImage, viewAttachment }: {
  readonly turn: FishTurnView
  readonly selected: boolean
  readonly select: () => void
  readonly t: FishPageProps['t']
  readonly viewImage: (resource: string) => void
  readonly viewAttachment: (id: string, conversation: string) => void
}): ReactNode {
  const actualTexts = new Set(turn.outputs.filter(output => output.kind === 'message').map(output => output.text))
  const outputs = turn.outputs.filter(output => output.kind !== 'generated' || !actualTexts.has(output.text))
  return <article className={css.turn} data-selected={selected} data-execution={turn.execution}>
    <header className={css.turnHeader}>
      <button type="button" className={css.turnSelect} aria-label={t('turns.select', { id: turn.execution })} aria-pressed={selected} onClick={select}>
        <time>{turnStamp(turn.created)}</time><span>{turnState(turn, t)}</span>
      </button><span className={css.meta}>{t('turns.materials', { count: turn.materials.length })}</span>
    </header>
    {turn.materials.length === 0 && <p className={css.meta}>{t('turns.noMaterials')}</p>}
    {turn.materials.map(material => <Material key={material.seq} material={material} t={t}
      viewImage={viewImage} viewAttachment={viewAttachment} />)}
    {turn.actions.length > 0 && <div className={css.actions}>{turn.actions.map((action, index) => <span key={action.call_id || index}>
      {action.name} · {t(action.state === 'failed' ? 'turns.tool.failed' : action.state === 'succeeded' ? 'turns.tool.succeeded' : 'turns.tool.started')}
    </span>)}</div>}
    {outputs.map((output, index) => <section key={index} className={css.output}>
      <div className={css.meta}><span>{t('chat.fromFish')}</span><span>{output.kind === 'generated' ? t('turns.generated')
        : t(output.state === 'sent' ? 'turns.sent' : output.state === 'uncertain' ? 'turns.uncertain' : output.state === 'queued' ? 'turns.queued' : 'turns.unsent')}</span><span>{output.target}</span></div>
      <p className={css.text}>{output.text}</p>
    </section>)}
    {turn.delivery !== null && <p className={css.meta}>{t('turns.delivery', { state: t(turn.delivery.sent ? 'turns.sent'
      : ['unknown', 'uncertain'].includes(turn.delivery.state) ? 'turns.uncertain' : 'turns.unsent'), target: turn.delivery.target })}</p>}
  </article>
}
