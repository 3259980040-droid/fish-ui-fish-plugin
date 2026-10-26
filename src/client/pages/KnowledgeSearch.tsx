/**
 * One graded retrieval block shared by Memory and Library: the same
 * `knowledge.search` she uses, the same index → overview → original levels.
 *
 * Every level is read back from its owning store, so a message shows the real
 * original message, a document shows its real chunk and original path, and a
 * memory shows its real revisions. The block states which channel actually
 * matched (FTS5 lexical, or lexical + semantic only when the vector channel
 * really returned a score) and never turns readiness into a claim of use.
 */
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconSearchOutlineRegular, IconWarningOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type {
  FishDocumentChunk, FishKnowledgeHit, FishKnowledgeMessage, FishKnowledgeOpened, FishKnowledgeRetrieval,
  FishKnowledgeSearch, FishKnowledgeOrigin,
} from '../contract/workbench.ts'
import { parseKnowledgeOpened, parseKnowledgeSearch, parseOpaque } from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import css from './pages.module.css'

/** How many nearby messages one original message read pulls in. */
const MESSAGE_CONTEXT = 5

/** Failure text of a settled reply, or null when it succeeded. */
function failureOf<T>(result: FishResult<T>): FishFailure | null {
  return result.ok ? null : result.failure
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** First characters of one hit's excerpt, flattened for a one-line row. */
function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/** Localized name of one retrieval channel; unknown channels keep their wire name. */
function channelLabel(channel: string, t: FishPageProps['t']): string {
  switch (channel) {
    case 'messages': return t('knowledge.channel.messages')
    case 'catalogs': return t('knowledge.channel.catalogs')
    case 'documents': return t('knowledge.channel.documents')
    case 'memories': return t('knowledge.channel.memories')
    case 'digests': return t('knowledge.channel.digests')
    default: return channel
  }
}

function searchStateLabel(status: string, t: FishPageProps['t']): string {
  switch (status) {
    case 'matched': return t('knowledge.status.matched')
    case 'no-match': return t('knowledge.status.noMatch')
    case 'not-indexed': return t('knowledge.status.notIndexed')
    case 'read-failed': return t('knowledge.status.readFailed')
    default: return ''
  }
}

/** Localized name of one reading level. */
function levelLabel(level: string, t: FishPageProps['t']): string {
  switch (level) {
    case 'index': return t('knowledge.level.index')
    case 'overview': return t('knowledge.level.overview')
    case 'original': return t('knowledge.level.original')
    default: return level
  }
}

export interface KnowledgeSearchProps {
  readonly call: FishPageProps['call']
  readonly t: FishPageProps['t']
  readonly formatTimestamp: FishPageProps['formatTimestamp']
  /** Hits to ask for; the backend accepts 1–50. */
  readonly limit: number
  /**
   * Channels whose hits are listed. Every channel is still searched and the
   * retrieval facts still report all of them, so a filtered view never hides
   * that other stores matched.
   */
  readonly channels?: readonly string[]
}

/**
 * Render the graded retrieval block.
 * @param props - the workbench face, localized copy, and the hit channels to list.
 * @returns the query row, the retrieval facts of this exact query, the hits, and the opened level.
 */
export function KnowledgeSearch({ call, t, formatTimestamp, limit, channels }: KnowledgeSearchProps): ReactNode {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<FishKnowledgeSearch | null>(null)
  const [selected, setSelected] = useState<FishKnowledgeHit | null>(null)
  const [overview, setOverview] = useState<FishKnowledgeOpened | null>(null)
  const [original, setOriginal] = useState<FishKnowledgeOpened | null>(null)
  const [opening, setOpening] = useState<'' | 'overview' | 'original' | 'file'>('')
  // Late replies must not overwrite a newer selection: only the newest ticket wins.
  const ticket = useRef(0)

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const term = query.trim()
    if (term === '') return
    setSearching(true)
    setNotice(null)
    try {
      const reply = await call('knowledge.search', { query: term, limit })
      const failed = failureOf(reply)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseKnowledgeSearch(reply.ok ? reply.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setFailure(null)
      setResult(parsed.value)
      setSelected(null)
      setOverview(null)
      setOriginal(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setSearching(false)
    }
  }

  /**
   * Read one level of one reference back from its owning store.
   * @param hit - the selected index hit.
   * @param level - overview or original.
   * @param wantedPage - page for a catalogue range; ignored elsewhere.
   */
  const open = async (hit: FishKnowledgeHit, level: 'overview' | 'original', wantedPage = 1): Promise<void> => {
    const mine = ticket.current + 1
    ticket.current = mine
    setOpening(level)
    setNotice(null)
    try {
      const reply = await call('knowledge.open', {
        reference: hit.reference,
        level,
        page: wantedPage,
        count: level === 'original' && hit.kind === 'message' ? MESSAGE_CONTEXT : 5,
      })
      const failed = failureOf(reply)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseKnowledgeOpened(reply.ok ? reply.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      if (mine !== ticket.current) return
      setFailure(null)
      if (level === 'overview') setOverview(parsed.value)
      else setOriginal(parsed.value)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setOpening('')
    }
  }

  const select = (hit: FishKnowledgeHit): void => {
    setSelected(hit)
    setOverview(null)
    setOriginal(null)
    setNotice(null)
    if (hit.overview_available) void open(hit, 'overview')
  }

  /** Ask the library to open a document's original file; its refusal is shown verbatim. */
  const openFile = async (document: Extract<FishKnowledgeOpened, { kind: 'document' }>): Promise<void> => {
    setOpening('file')
    setNotice(null)
    try {
      const reply = await call('library.open', { doc_id: document.doc_id })
      const failed = failureOf(reply)
      if (failed !== null) { setFailure(failed); return }
      const parsed = parseOpaque(reply.ok ? reply.value : undefined)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setFailure(null)
      setNotice(t('knowledge.fileOpened'))
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setOpening('')
    }
  }

  const listed = (current: FishKnowledgeSearch | null): readonly FishKnowledgeHit[] => {
    if (current === null) return []
    if (channels === undefined) return current.hits
    return current.hits.filter(hit => channels.includes(hit.channel))
  }

  const retrievalFacts = (retrieval: FishKnowledgeRetrieval): ReactNode => (
    <section className={css.card} aria-label={t('knowledge.title')}>
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{t('knowledge.retrievalFacts')}</span>
        <span className={css.cardMeta}>
          <Tag tone={retrieval.semantic.used ? 'success' : 'quiet'}>
            {t(retrieval.semantic.used ? 'knowledge.hybridUsed' : 'knowledge.lexicalOnly')}
          </Tag>
          {retrieval.fts5 && <Tag tone="outline">{t('knowledge.fts5')}</Tag>}
        </span>
      </div>
      {retrieval.label !== '' && <p className={css.hint}>{retrieval.label}</p>}
      {!retrieval.semantic.used && <p className={css.hint}>
        {t('knowledge.semanticNotUsed', { reason: retrieval.semantic.reason || retrieval.semantic.status || t('common.nothing') })}
      </p>}
      <p className={css.muted}>
        {t('knowledge.hits', { count: String(listed(result).length), total: String(retrieval.matched_total) })}
      </p>
      {retrieval.truncated && <p className={css.hint}>{t('knowledge.truncated', { shown: String(retrieval.limit) })}</p>}
      {retrieval.terms.length > 0 && <p className={css.hint}>{t('knowledge.terms', { terms: retrieval.terms.join(' · ') })}</p>}
      <ul className={css.rows}>
        {Object.entries(retrieval.channels).map(([name, count]) => {
          const state = retrieval.semantic.channels[name]
          return (
            <li key={name} className={css.card}>
              <div className={css.cardHead}>
                <span className={css.cardTitle}>{channelLabel(name, t)}</span>
                <span className={css.cardMeta}>{t('knowledge.channelCount', { count: String(count) })}</span>
              </div>
              <p className={css.hint}>
                {state === undefined
                  ? t('knowledge.channelNoState')
                  : t('knowledge.channelRow', {
                    mode: state.mode === '' ? t('common.nothing') : state.mode,
                    used: state.used ? t('common.on') : t('common.off'),
                  })}
              </p>
              {state !== undefined && state.detail !== '' && <p className={css.hint}>{state.detail}</p>}
              {state !== undefined && searchStateLabel(state.status, t) !== '' && <p className={state.status === 'read-failed' ? css.inlineError : css.hint}>
                {searchStateLabel(state.status, t)}
              </p>}
              {state !== undefined && state.unindexed > 0 && <p className={css.hint}>{t('knowledge.unindexed', { count: String(state.unindexed) })}</p>}
              {state !== undefined && state.pending > 0 && <p className={css.hint}>{t('knowledge.pendingChannel', { count: String(state.pending) })}</p>}
            </li>
          )
        })}
      </ul>
      {retrieval.note !== '' && <p className={css.hint}>{retrieval.note}</p>}
    </section>
  )

  const messageList = (messages: readonly FishKnowledgeMessage[]): ReactNode => (
    <ul className={css.rows}>
      {messages.map(item => (
        <li key={item.id} className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('knowledge.messageId', { id: item.id })}</span>
            <span className={css.cardMeta}>{t('knowledge.messageMeta', {
              time: item.time || t('common.nothing'),
              place: item.place || t('common.nothing'),
              direction: item.direction || t('common.nothing'),
              status: item.status || t('common.nothing'),
            })}</span>
          </div>
          <p className={css.cardBody}>{item.text}</p>
          {item.sender !== '' && <p className={css.hint}>{t('knowledge.sender', { sender: item.sender })}</p>}
          {item.quote !== '' && <p className={css.hint}>{t('knowledge.quote', { quote: item.quote })}</p>}
        </li>
      ))}
    </ul>
  )

  const chunkCard = (chunk: FishDocumentChunk): ReactNode => (
    <section key={chunk.ord} className={css.card}>
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{t('knowledge.chunk', { ord: String(chunk.ord) })}</span>
        <span className={css.cardMeta}>{t('library.chars', { chars: String(chunk.chars) })}</span>
      </div>
      <p className={css.cardBody}>{chunk.text}</p>
    </section>
  )

  const originDetails = (origin: FishKnowledgeOrigin): ReactNode => <>
    <p className={css.hint}>{t('memory.sourceLine', {
      scope: origin.scope || t('common.nothing'), source: origin.source || t('common.nothing'),
    })}</p>
    {origin.sender !== '' && <p className={css.hint}>{t('knowledge.sender', { sender: origin.sender })}</p>}
    {origin.quote !== '' && <p className={css.hint}>{t('knowledge.quote', { quote: origin.quote })}</p>}
    {origin.references.map(reference => <p key={reference} className={css.hint}>{t('knowledge.reference', { reference })}</p>)}
    {origin.parent_version !== '' && <p className={css.hint}>{t('knowledge.parentVersion', { reference: `doc:${origin.parent_version}` })}</p>}
  </>

  const openedView = (opened: FishKnowledgeOpened, level: 'overview' | 'original'): ReactNode => {
    if (opened.kind === 'message') {
      const nearby = opened.context.filter(item => opened.message === null || item.id !== opened.message.id)
      return (
        <section className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('knowledge.message')}</span>
            <span className={css.cardMeta}>{levelLabel(opened.level, t)}</span>
          </div>
          {opened.catalog !== null
            ? <p className={css.hint}>{t('knowledge.catalogRange', {
              from: opened.catalog.from, to: opened.catalog.to, start: opened.catalog.start_time, end: opened.catalog.end_time,
            })}</p>
            : <p className={css.hint}>{t('knowledge.noCatalogRange')}</p>}
          {opened.message !== null && messageList([opened.message])}
          {level === 'original' && <>
            <p className={css.cardTitle}>{t('knowledge.context', { count: String(nearby.length) })}</p>
            {opened.context.length === 0
              ? <p className={css.muted}>{t('knowledge.noContext')}</p>
              : messageList(opened.context)}
            <p className={css.cardTitle}>{t('knowledge.attachments', { count: String(opened.attachments.length) })}</p>
            {opened.attachments.length === 0
              ? <p className={css.muted}>{t('knowledge.noAttachments')}</p>
              : <ul className={css.rows}>{opened.attachments.map((name, index) => <li key={`${name}:${String(index)}`} className={css.hint}>{name}</li>)}</ul>}
          </>}
          {opened.note !== '' && <p className={css.hint}>{opened.note}</p>}
        </section>
      )
    }
    if (opened.kind === 'catalog') {
      return (
        <section className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('knowledge.catalog')}</span>
            <span className={css.cardMeta}>{t('knowledge.page', { page: String(opened.page) })}</span>
          </div>
          {opened.gist !== '' && <p className={css.cardBody}>{opened.gist}</p>}
          {opened.topics !== '' && <p className={css.hint}>{t('knowledge.catalogTopics', { topics: opened.topics })}</p>}
          <p className={css.hint}>{t('knowledge.catalogTime', { start: opened.start_time, end: opened.end_time })}</p>
          {level === 'original' && <>
            <p className={css.cardTitle}>{t('knowledge.messages', { count: String(opened.messages.length) })}</p>
            {opened.messages.length === 0 ? <p className={css.muted}>{t('knowledge.noMessages')}</p> : messageList(opened.messages)}
            <div className={css.formActions}>
              <Button size="sm" variant="ghost" disabled={opened.page <= 1 || opening !== ''}
                onClick={() => { if (selected !== null) void open(selected, 'original', opened.page - 1) }}>
                {t('knowledge.prevPage')}
              </Button>
              <Button size="sm" variant="outline" disabled={opened.next_page === null || opening !== ''}
                onClick={() => { if (selected !== null) void open(selected, 'original', opened.page + 1) }}>
                {t('knowledge.nextPage')}
              </Button>
            </div>
          </>}
          {opened.note !== '' && <p className={css.hint}>{opened.note}</p>}
        </section>
      )
    }
    if (opened.kind === 'document') {
      const chunk = opened.chunk ?? opened.preview[0] ?? null
      return (
        <section className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('knowledge.document')}</span>
            <span className={css.cardMeta}>{levelLabel(opened.level, t)}</span>
          </div>
          <p className={css.cardBody}>{t('knowledge.documentMeta', {
            name: opened.doc_name,
            version: String(opened.version),
            chars: String(opened.chars),
            chunks: String(opened.chunks),
          })}</p>
          {originDetails(opened.origin)}
          {chunk !== null && chunkCard(chunk)}
          <p className={css.hint}>
            {opened.original_exists
              ? t('knowledge.documentOriginal', { path: opened.original_path })
              : opened.original_path === '' ? t('knowledge.documentNoOriginal') : t('knowledge.status.readFailed')}
          </p>
          {!opened.original_exists && opened.original_path !== '' && <p className={css.hint}>{t('knowledge.documentOriginalMissing', { path: opened.original_path })}</p>}
          {opened.url !== '' && <p className={css.hint}>{opened.url}</p>}
          {level === 'original' && opened.preview.length > 1 && <>
            <p className={css.cardTitle}>{t('knowledge.chunkContext')}</p>
            {opened.preview.map(item => chunkCard(item))}
          </>}
          <div className={css.formActions}>
            <Button size="sm" variant="outline" disabled={opening !== '' || !opened.original_exists} onClick={() => { void openFile(opened) }}>
              {t('knowledge.openFile')}
            </Button>
          </div>
          <p className={css.hint}>{t('knowledge.documentScope')}</p>
          {opened.note !== '' && <p className={css.hint}>{opened.note}</p>}
        </section>
      )
    }
    if (opened.kind === 'memory') {
      return (
        <section className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('knowledge.memory')}</span>
            <span className={css.cardMeta}>{levelLabel(opened.level, t)}</span>
          </div>
          {opened.memory !== null && <>
            <p className={css.cardBody}>{opened.memory.text}</p>
            <p className={css.hint}>{t('knowledge.memoryMeta', {
              category: opened.memory.category === '' ? t('common.nothing') : opened.memory.category,
              evidence: opened.memory.evidence_label === '' ? t('common.nothing') : opened.memory.evidence_label,
              status: opened.memory.status === '' ? t('common.nothing') : opened.memory.status,
            })}</p>
            <p className={css.hint}>{t('memory.sourceLine', {
              scope: opened.memory.scope === '' ? t('common.nothing') : opened.memory.scope,
              source: opened.memory.source === '' ? t('common.nothing') : opened.memory.source,
            })}</p>
          </>}
          <p className={css.cardTitle}>{t('knowledge.revisions', { count: String(opened.revisions.length) })}</p>
          {opened.revisions.length === 0
            ? <p className={css.muted}>{t('knowledge.noRevisions')}</p>
            : <ul className={css.rows}>{opened.revisions.map(item => (
              <li key={item.revision} className={css.card}>
                <div className={css.cardHead}>
                  <span className={css.cardTitle}>{t('memory.revision', { version: String(item.revision) })}</span>
                  <span className={css.cardMeta}>{formatTimestamp(item.created)}</span>
                </div>
                <p className={css.cardBody}>{item.text}</p>
                {item.source_text !== '' && <p className={css.hint}>{item.source_text}</p>}
                {item.evidence !== '' && <p className={css.hint}>{item.evidence}</p>}
              </li>
            ))}</ul>}
          {opened.note !== '' && <p className={css.hint}>{opened.note}</p>}
        </section>
      )
    }
    if (opened.kind === 'digest') {
      return (
        <section className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{t('knowledge.digest')}</span>
            <span className={css.cardMeta}>{t('knowledge.digestMeta', {
              scope: opened.digest === null ? t('common.nothing') : opened.digest.scope,
              period: opened.digest === null ? t('common.nothing') : opened.digest.day,
            })}</span>
          </div>
          {opened.digest !== null
            ? <>
              <p className={css.cardBody}>{opened.digest.text}</p>
              <p className={css.hint}>{t('memory.digestCounts', {
                memories: String(opened.digest.counts.memories),
                expressions: String(opened.digest.counts.expressions),
              })}</p>
            </>
            : <p className={css.muted}>{t('knowledge.noDigest')}</p>}
          {opened.note !== '' && <p className={css.hint}>{opened.note}</p>}
        </section>
      )
    }
    return (
      <section className={css.card}>
        <p className={css.cardBody}>{t('knowledge.unsupported')}</p>
        <p className={css.hint}>{t('knowledge.reference', { reference: opened.reference })}</p>
        {opened.note !== '' && <p className={css.hint}>{opened.note}</p>}
      </section>
    )
  }

  return (
    <div className={css.section}>
      <form className={css.searchRow} role="search" onSubmit={(event) => { void search(event) }}>
        <Input
          type="search"
          icon={<IconSearchOutlineRegular />}
          aria-label={t('knowledge.title')}
          placeholder={t('knowledge.placeholder')}
          value={query}
          onChange={(event) => { setQuery(event.target.value) }}
          className={css.grow ?? ''}
        />
        <Button type="submit" size="sm" variant="outline" disabled={searching || query.trim() === ''}>
          {searching ? t('knowledge.running') : t('knowledge.action')}
        </Button>
      </form>
      <p className={css.hint}>{t('knowledge.hint')}</p>
      {failure !== null && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
      </p>}
      {notice !== null && <p className={css.inlineNotice} role="status">{notice}</p>}
      {result !== null && retrievalFacts(result.retrieval)}
      {result !== null && listed(result).length === 0 && <p className={css.muted}>{t('knowledge.empty')}</p>}
      {result !== null && listed(result).length > 0 && <ul className={css.rows}>
        {listed(result).map(hit => (
          <li key={hit.reference}>
            <button
              type="button"
              className={selected?.reference === hit.reference ? `${css.hitRow} ${css.hitRowSelected}` : css.hitRow}
              aria-pressed={selected?.reference === hit.reference}
              onClick={() => { select(hit) }}
            >
              <span className={css.cardMeta}>
                <Tag tone="outline">{channelLabel(hit.channel, t)}</Tag>
                <Tag tone="quiet">{levelLabel(hit.level, t)}</Tag>
                <span>{hit.matched_by.includes('semantic') ? t('knowledge.matched.hybrid') : t('knowledge.matched.fts5')}</span>
                {hit.time !== '' && <span>{hit.time}</span>}
              </span>
              <span className={css.hitText}>{excerpt(hit.snippet)}</span>
              <span className={css.cardMeta}>
                <span>{t('knowledge.reference', { reference: hit.reference })}</span>
                {hit.fused > 0 && <span>{t('knowledge.fused', { score: hit.fused.toFixed(4) })}</span>}
              </span>
              {(hit.origin.scope !== '' || hit.origin.source !== '') && <span className={css.cardMeta}>{t('memory.sourceLine', {
                scope: hit.origin.scope || t('common.nothing'), source: hit.origin.source || t('common.nothing'),
              })}</span>}
              {hit.origin.sender !== '' && <span className={css.cardMeta}>{t('knowledge.sender', { sender: hit.origin.sender })}</span>}
            </button>
          </li>
        ))}
      </ul>}
      {selected !== null && <section className={css.section} aria-label={t('knowledge.opened')}>
        <div className={css.searchRow}>
          <span className={css.cardTitle}>{t('knowledge.opened')}</span>
          <span className={css.grow} />
          <Button size="sm" variant="ghost" disabled={opening !== ''} onClick={() => { select(selected) }}>
            {t('knowledge.openOverview')}
          </Button>
          <Button size="sm" variant="outline" disabled={opening !== '' || !selected.original_available}
            onClick={() => { void open(selected, 'original') }}>
            {t('knowledge.openOriginal')}
          </Button>
        </div>
        {!selected.overview_available && <p className={css.muted}>
          {t('knowledge.overviewMissing', { reason: selected.overview_reason === '' ? t('common.nothing') : selected.overview_reason })}
        </p>}
        {opening !== '' && <p className={css.muted} role="status">{t('knowledge.opening')}</p>}
        {overview !== null && openedView(overview, 'overview')}
        {original !== null && openedView(original, 'original')}
      </section>}
    </div>
  )
}
