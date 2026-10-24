/**
 * Fish chat: one continuous conversation with her and its composer.
 *
 * The page is the private chat itself, not a list of chats: her history with the
 * owner is one linear window, so the old conversation column is a single
 * collapsed "past conversations" line that opens only when asked for. A group
 * thread is never a conversation here — what happened in a group is a question
 * to her. Above the messages sit the one-line pointer to the group and the
 * collapsed activity stream, which mixes private and group rows in one time
 * order, stamps each row with its full date and time, and names the speaker.
 * Every reply that left a record carries a collapsed why-chain under its bubble.
 *
 * A sent message becomes a delivery job. One poll loop owns the delivery: it
 * reads `chat.job` until the job settles, then reads `chat.snapshot` for the
 * reply. The loop is an effect keyed by the awaited delivery, so a second
 * send restarts it and an unmount cancels the wait between ticks.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, Checkbox, IconNewChatOutlineRegular, IconPaperPlaneOutlineRegular, IconRefreshOutlineRegular,
  IconStopFillRegular, IconTrashOutlineRegular, IconWarningOutlineRegular, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type {
  FishActivityItem, FishChatJob, FishChatSnapshot, FishConversation, FishMessage, FishTrace,
  FishImagePreview, FishAttachment, FishAttachmentConfig, FishAttachmentDetail,
} from '../contract/workbench.ts'
import type { FishKey } from '../locales.ts'
import { parseActivity, parseChatCreated, parseChatDeleted, parseChatJob, parseChatSent, parseChatSnapshot, parseImagePreview, parseAttachmentConfig, parseAttachmentDetail } from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { importAttachment, type AttachmentTransferProgress } from '../attachments.ts'
import css from './pages.module.css'
import chatCss from './FishChatPage.module.css'

/** Delay between one settled poll and the next. */
const POLL_INTERVAL_MS = 1500

/** Longest wait for one job to settle before the poll gives up and reports. */
const POLL_TIMEOUT_MS = 10 * 60 * 1000

/** Rows the activity stream asks for; enough to see what happened without a pager. */
const ACTIVITY_LIMIT = 20
const THOUGHT_PHASE: Readonly<Record<string, FishKey>> = {
  preparing: 'chat.thought.preparing', connecting: 'chat.thought.connecting', thinking: 'chat.thought.thinking',
  replying: 'chat.thought.replying', tool: 'chat.thought.tool', complete: 'chat.thought.complete',
  silent: 'chat.thought.silent', failed: 'chat.thought.failed', uncertain: 'chat.thought.uncertain',
}
const DELIVERY_STATE: Readonly<Record<string, FishKey>> = {
  sent:'chat.delivery.sent', succeeded:'chat.delivery.sent', uncertain:'chat.delivery.uncertain', unknown:'chat.delivery.uncertain',
  failed:'chat.delivery.failed', blocked:'chat.delivery.failed', cancelled:'chat.delivery.cancelled',
  silent:'chat.delivery.noDefault',considered:'chat.delivery.pending',running:'chat.delivery.pending',
  queued:'chat.delivery.pending',processing:'chat.delivery.pending',done:'chat.delivery.sent',
}

/** One in-flight delivery the page is waiting on. */
interface PendingReply {
  readonly jobId: string
  readonly conversationId: string
  /** Changes per attempt so a second send for the same conversation restarts the loop. */
  readonly attempt: number
}

/** Failure text of a settled reply, or null when it succeeded. */
function failureText<T>(result: FishResult<T>): FishFailure | null {
  return result.ok ? null : result.failure
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Row title: the stored title, or the id when the workbench stored none. */
function conversationTitle(conversation: FishConversation): string {
  return conversation.title === '' ? conversation.id : conversation.title
}

/** Source label of one stream row: the private chat, or the group it came from. */
function whereText(item: FishActivityItem, t: FishPageProps['t']): string {
  if (item.place === 'private') return t('chat.activity.where.private')
  return item.group === undefined ? t('chat.activity.where.groupPlain') : t('chat.activity.where.group', { name: item.group })
}

/** Speaker of one stream row: the owner, Fish, or the name the workbench stored. */
function whoText(item: FishActivityItem, t: FishPageProps['t']): string {
  if (['owner', 'in', 'inbound'].includes(item.direction)) return t('chat.fromOwner')
  if (['fish', 'out', 'outbound'].includes(item.direction)) return t('chat.fromFish')
  return item.from
}

/** Segment type of a textless message to the locale key that names it. */
const MEDIA_KEYS: Readonly<Record<string, FishKey>> = {
  image: 'chat.media.image', audio: 'chat.media.audio', video: 'chat.media.video',
  file: 'chat.media.file', face: 'chat.media.face',
}

/** Text of the bubble: the message text, or what the message is when it has none. */
function bubbleText(message: FishMessage, t: FishPageProps['t']): string {
  if (message.text !== '') return message.text
  const labels = (message.kinds ?? []).map(kind => t(MEDIA_KEYS[kind] ?? 'chat.media.other'))
  return labels.length === 0 ? t('chat.media.other') : labels.join('、')
}

/** Two digits, for the date-time stamp below. */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Stamp of one stream row: the full local date and time, never the time alone.
 * The order of a day is only readable when the date is there too, and a stream
 * can span several days.
 * @param at - epoch milliseconds the workbench reported for the row.
 * @returns text like 2024-06-03 21:07.
 */
function stampText(at: number): string {
  const date = new Date(at)
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}


/**
 * Render the collapsed why-chain under one bubble: what the group pre-screen
 * scored, or what a private reply cost. It renders nothing when the workbench
 * recorded nothing, so the panel never shows a guessed value.
 * @param props.trace - the trace the snapshot carried for this message.
 * @param props.t - localized copy of the fish namespace.
 * @returns the disclosure element, or null when there is no line to show.
 */
function TraceChain({ trace, t }: { readonly trace: FishTrace; readonly t: FishPageProps['t'] }): ReactNode {
  // One line only: how long this turn took and what she actually did with it.
  // Scores, dimensions and thresholds are diagnostics and belong to settings.
  const facts: string[] = []
  if (trace.elapsed_ms !== undefined) {
    facts.push(t('chat.trace.elapsed', { seconds: (trace.elapsed_ms / 1000).toFixed(1) }))
  }
  if (trace.tools !== undefined && trace.tools.length > 0) {
    facts.push(t('chat.trace.tools', { tools: trace.tools.join(', ') }))
  }
  if (trace.reason !== undefined) facts.push(t('chat.trace.reason', { reason: trace.reason }))
  const lines: string[] = facts.length > 0 ? [facts.join(' · ')] : []
  if (lines.length === 0) return null
  return (
    <details className={chatCss.trace}>
      <summary className={chatCss.traceSummary}>{t('chat.trace.label')}</summary>
      <ul className={chatCss.traceList}>
        {lines.map(line => <li key={line}>{line}</li>)}
      </ul>
    </details>
  )
}

/** Right rail: every stored thinking record, scrollable, each one opens its own chain. */
function ThoughtRail({ call, t }: { readonly call: FishPageProps['call']; readonly t: FishPageProps['t'] }): ReactNode {
  const [rows, setRows] = useState<readonly Record<string, unknown>[] | null>(null)
  const [openRef, setOpenRef] = useState('')
  const [openText, setOpenText] = useState('')
  // A failed read is not the same fact as an empty list; the rail must say which one it is.
  const [loadError, setLoadError] = useState('')
  const load = async (): Promise<void> => {
    try {
      const reply = await call('chat.thoughts', { limit: 60 }) as Record<string, unknown>
      const list = Array.isArray(reply.reasoning_list) ? reply.reasoning_list : reply.thoughts
      setLoadError('')
      setRows(Array.isArray(list) ? list as Record<string, unknown>[] : [])
    } catch (error) { setLoadError(String(error instanceof Error ? error.message : error)) }
  }
  useEffect(() => { void load() }, [])
  const open = async (reference: string): Promise<void> => {
    if (openRef === reference) { setOpenRef(''); return }
    try {
      const reply = await call('chat.reasoning', { reference }) as Record<string, unknown>
      setOpenText(typeof reply.reasoning === 'string' ? reply.reasoning : '')
      setOpenRef(reference)
    } catch { setOpenText(''); setOpenRef(reference) }
  }
  return <aside className={chatCss.rail} aria-label={t('chat.trace.label')}>
    <div className={chatCss.railHead}>
      <span>{t('chat.trace.label')}</span>
      <Button size="sm" variant="ghost" onClick={() => { void load() }}>{rows === null ? '…' : String(rows.length)}</Button>
    </div>
    <div className={chatCss.railList}>
      {loadError !== '' && <p className={chatCss.inlineError} role="alert">读取思考记录失败：{loadError}</p>}
      {loadError === '' && rows !== null && rows.length === 0 && <p className={css.muted}>{t('common.nothing')}</p>}
      {(rows ?? []).map((row) => {
        const reference = String(row.reference ?? '')
        const when = typeof row.updated === 'number' ? new Date(row.updated * 1000) : null
        const stamp = when === null ? '' : String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0')
        return <div key={reference} className={chatCss.railItem}>
          <button type="button" className={chatCss.railRow} onClick={() => { void open(reference) }}>
            <span className={chatCss.railTime}>{stamp}</span>
            <span className={chatCss.railPreview}>{String(row.preview ?? '')}</span>
          </button>
          {openRef === reference && <pre className={chatCss.railBody}>{openText === '' ? t('common.nothing') : openText}</pre>}
        </div>
      })}
    </div>
  </aside>
}

/**
 * Render the chat page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the conversation list, the message column, and the composer.
 */
export function FishChatPage({ call, t, reportRefresh }: FishPageProps): ReactNode {
  const [snapshot, setSnapshot] = useState<FishChatSnapshot | null>(null)
  // null means the stream could not be read; an empty array means it read back empty.
  const [activity, setActivity] = useState<readonly FishActivityItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<'new' | 'send' | 'cancel' | null>(null)
  const [marked, setMarked] = useState<readonly string[]>([])
  // The private history is one collapsed line now: the page itself is one
  // continuous conversation, so the list only opens when it is asked for.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<readonly FishAttachment[]>([])
  const [importing, setImporting] = useState(false)
  const [transferConfig, setTransferConfig] = useState<FishAttachmentConfig | null>(null)
  const [transferProgress, setTransferProgress] = useState<AttachmentTransferProgress | null>(null)
  const [filePreview, setFilePreview] = useState<FishAttachmentDetail | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = useState<PendingReply | null>(null)
  const [imagePreview, setImagePreview] = useState<FishImagePreview | null>(null)
  const [viewingImage, setViewingImage] = useState(false)
  const [job, setJob] = useState<FishChatJob | null>(null)
  const [attempt, setAttempt] = useState(0)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const submitting = useRef(false)
  const messagesEnd = useRef<HTMLDivElement | null>(null)
  // The conversation the current loop reads back; a ref keeps the loop reading
  // the latest value without making it an effect key.
  const opened = useRef<string | undefined>(undefined)

  const loadSnapshot = async (id?: string): Promise<FishChatSnapshot | null> => {
    const result = await call('chat.snapshot', id === undefined ? {} : { id })
    const failed = failureText(result)
    if (failed !== null) {
      setFailure(failed)
      return null
    }
    const parsed = parseChatSnapshot(result.ok ? result.value : undefined)
    if (!parsed.ok) {
      setFailure(parsed.failure)
      return null
    }
    setSnapshot(parsed.value)
    setFailure(null)
    opened.current = parsed.value.conversation_id
    return parsed.value
  }

  // The stream is a second read: a workbench without the action leaves the
  // section saying so instead of failing the page.
  const loadActivity = async (): Promise<void> => {
    try {
      const result = await call('activity.recent', { limit: ACTIVITY_LIMIT })
      const parsed = result.ok ? parseActivity(result.value) : null
      setActivity(parsed !== null && parsed.ok ? parsed.value : null)
    } catch {
      // Swallows a thrown call: the section reports the stream as unreadable.
      setActivity(null)
    }
  }

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setNotice(null)
    await loadSnapshot(opened.current)
    await loadActivity()
    setLoading(false)
  }

  // The page opens the workbench's current conversation once on mount.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        await loadSnapshot()
      } catch (error) {
        // Swallows an unexpected throw: the page reports it rather than rejecting silently.
        if (live) setFailure({ message: reasonOf(error), offline: false })
      }
      if (live) await loadActivity()
      if (live) setLoading(false)
    })()
    return () => { live = false }
    // The first read runs once for the page's life; later reads go through Refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: 'end' })
  }, [snapshot?.messages.length, pending])

  useEffect(() => {
    if (snapshot === null || pending !== null) return
    let live = true
    const timer = setInterval(() => {
      void loadSnapshot(opened.current).catch((error: unknown) => {
        if (live) setFailure({ message: reasonOf(error), offline: false })
      })
    }, 2000)
    return () => { live = false; clearInterval(timer) }
    // This page owns the idle refresh, including QQ and completed child results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot === null, pending])

  const readJob = async (delivery: PendingReply): Promise<FishChatJob | FishFailure> => {
    const result = await call('chat.job', { job_id: delivery.jobId })
    const failed = failureText(result)
    if (failed !== null) return failed
    const parsed = parseChatJob(result.ok ? result.value : undefined)
    return parsed.ok ? parsed.value : parsed.failure
  }

  // One loop per delivery: `chat.job` until settled, then the reply snapshot.
  // The cleanup aborts the wait between ticks so disposal stops polling.
  useEffect(() => {
    if (pending === null) return
    const controller = new AbortController()
    const deadline = Date.now() + POLL_TIMEOUT_MS
    const waitTick = (): Promise<void> => new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        controller.signal.removeEventListener('abort', timerDone)
        resolve()
      }, POLL_INTERVAL_MS)
      function timerDone(): void {
        clearTimeout(timer)
        resolve()
      }
      controller.signal.addEventListener('abort', timerDone, { once: true })
    })
    void (async () => {
      while (!controller.signal.aborted && Date.now() < deadline) {
        let jobReply: FishChatJob | FishFailure
        try {
          jobReply = await readJob(pending)
        } catch (error) {
          jobReply = { message: reasonOf(error), offline: false }
        }
        if (controller.signal.aborted) return
        if ('message' in jobReply) {
          setJob({ status: 'failed', error: jobReply.message })
          setPending(null)
          return
        }
        setJob(jobReply)
        if (jobReply.status === 'complete') {
          await loadSnapshot(pending.conversationId)
          if (!controller.signal.aborted) await loadActivity()
          if (!controller.signal.aborted) setPending(null)
          return
        }
        if (jobReply.status === 'failed' || jobReply.status === 'cancelled') {
          await loadSnapshot(pending.conversationId)
          setPending(null)
          return
        }
        await loadSnapshot(pending.conversationId)
        await waitTick()
      }
      if (!controller.signal.aborted) {
        setJob({ status: 'failed', error: t('chat.jobUnknown') })
        setPending(null)
      }
    })()
    return () => { controller.abort() }
    // A new delivery (`pending`) or attempt restarts the loop; helpers read current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const startDelivery = (jobId: string, conversationId: string): void => {
    setPending({ jobId, conversationId, attempt })
    setAttempt(current => current + 1)
    setJob({ status: 'queued' })
  }

  const openConversation = async (conversation: FishConversation): Promise<void> => {
    setPending(null)
    setJob(null)
    try {
      await loadSnapshot(conversation.id)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    }
  }

  const removeConversations = async (ids: readonly string[]): Promise<void> => {
    if (ids.length === 0 || deleting !== null) return
    setDeleting(ids.length === 1 ? ids[0] ?? 'batch' : 'batch')
    setNotice(null)
    try {
      const result = await call('chat.delete', { conversation_ids: ids })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const removed = parseChatDeleted(result.ok ? result.value : undefined)
      if (!removed.ok) {
        setFailure(removed.failure)
        return
      }
      setFailure(null)
      setMarked(current => current.filter(id => !ids.includes(id)))
      setPending(null)
      setJob(null)
      // A deleted conversation cannot stay open: fall back to the newest one.
      const next = opened.current !== undefined && ids.includes(opened.current) ? undefined : opened.current
      await loadSnapshot(next)
      setNotice(t('chat.deleted', {
        conversations: String(removed.value.conversations), messages: String(removed.value.messages),
      }))
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setDeleting(null)
    }
  }

  const createConversation = async (): Promise<void> => {
    setBusy('new')
    setNotice(null)
    try {
      const result = await call('chat.new', {})
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const created = parseChatCreated(result.ok ? result.value : undefined)
      if (!created.ok) {
        setFailure(created.failure)
        return
      }
      setPending(null)
      setJob(null)
      await loadSnapshot(created.value.id)
      composer.current?.focus()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setBusy(null)
    }
  }

  const viewImage = async (resource: string, frame = 0): Promise<void> => {
    setViewingImage(true)
    try {
      const reply = await call('media.preview', { resource_id: resource, mode: frame === 0 ? 'original' : 'frame', frame })
      if (!reply.ok) { setFailure(reply.failure); return }
      const parsed = parseImagePreview(reply.value)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setImagePreview(parsed.value)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
    finally { setViewingImage(false) }
  }

  const openImageOriginal = async (resource: string): Promise<void> => {
    try {
      const reply = await call('media.open', { resource_id: resource })
      if (!reply.ok) setFailure(reply.failure)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
  }

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const text = draft.trim()
    const conversationId = snapshot?.conversation_id
    if (text === '' && attachments.length === 0 || conversationId === undefined || submitting.current) return
    submitting.current = true
    setBusy('send')
    setNotice(null)
    try {
      const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
        byte => byte.toString(16).padStart(2, '0')).join('')
      const result = await call('chat.send', { id: conversationId, text, attachments, request_id: requestId })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const sent = parseChatSent(result.ok ? result.value : undefined)
      if (!sent.ok) {
        setFailure(sent.failure)
        return
      }
      setDraft('')
      setAttachments([])
      // Echo the owner's line immediately; the reply snapshot replaces it.
      setSnapshot(current => current === null ? current : {
        ...current,
        messages: [...current.messages, {
          id: `pending-${sent.value.job_id}`, direction: 'owner', text, status: 'queued',
        }],
      })
      startDelivery(sent.value.job_id, conversationId)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      submitting.current = false
      setBusy(null)
    }
  }

  const cancelReply = async (): Promise<void> => {
    if (pending === null) return
    const target = pending
    setBusy('cancel')
    setNotice(null)
    try {
      const result = await call('chat.cancel', { id: target.conversationId })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      setPending(null)
      setJob(null)
      if (await loadSnapshot(target.conversationId) !== null) setNotice(t('chat.cancel'))
      await reportRefresh(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setBusy(null)
    }
  }

  // One stream of private history with her: a group thread is never a row here.
  const conversations = (snapshot?.conversations ?? []).filter(conversation => conversation.kind !== 'group')
  const openId = snapshot?.conversation_id
  const toggleMarked = (id: string, next: boolean): void => {
    setMarked(current => next ? [...current, id] : current.filter(item => item !== id))
  }
  const viewAttachment = async (attachmentId: string): Promise<void> => {
    if (!snapshot) return
    const reply = await call('attachments.detail', { id: snapshot.conversation_id, attachment_id: attachmentId })
    if (!reply.ok) { setFailure(reply.failure); return }
    const parsed = parseAttachmentDetail(reply.value)
    if (!parsed.ok) setFailure(parsed.failure)
    else setFilePreview(parsed.value)
  }
  const openAttachment = async (attachmentId: string): Promise<void> => {
    if (!snapshot) return
    const reply = await call('attachments.open', { id: snapshot.conversation_id, attachment_id: attachmentId })
    if (!reply.ok) setFailure(reply.failure)
  }
  const importFiles = async (files: FileList | null): Promise<void> => {
    const id = snapshot?.conversation_id
    if (!files || !id) return
    setImporting(true)
    try {
      const configReply = await call('attachments.config')
      if (!configReply.ok) { setFailure(configReply.failure); return }
      const config = parseAttachmentConfig(configReply.value)
      if (!config.ok) { setFailure(config.failure); return }
      setTransferConfig(config.value)
      if (attachments.length + files.length > config.value.max_per_message) throw new Error(t('attachment.countLimit', { count: config.value.max_per_message }))
      for (const file of files) {
        if (config.value.original_max_bytes !== null && file.size > config.value.original_max_bytes) throw new Error(t('attachment.sizeLimit', { bytes: config.value.original_max_bytes }))
        const parsed = await importAttachment(call, id, file, setTransferProgress, {
          readError: t('chat.fileError'), progressError: t('attachment.progressError'),
        })
        if (!parsed.ok) { setFailure(parsed.failure); return }
        setAttachments(current => current.some(item => item.id === parsed.value.id) ? current : [...current, parsed.value])
        setNotice(t('attachment.saved', { name: file.name, bytes: parsed.value.size }))
      }
      setTransferProgress(null)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
    finally { setImporting(false); if (picker.current) picker.current.value = '' }
  }
  const failingJob = job?.status === 'failed' && job.error !== undefined && job.error !== ''
  return (
    <div className={chatCss.layout}>
      <div className={chatCss.thread}>
        <div className={chatCss.threadHead}>
          <h2 className={css.sectionTitle}>{t('chat.messages')}</h2>
          <div className={chatCss.threadActions}>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={historyOpen}
              onClick={() => { setHistoryOpen(open => !open) }}
            >
              {historyOpen ? t('chat.historyOpen') : `${t('chat.history')} (${String(conversations.length)})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<IconNewChatOutlineRegular size={14} />}
              disabled={busy !== null}
              onClick={() => { void createConversation() }}
            >
              {busy === 'new' ? t('chat.creating') : t('chat.new')}
            </Button>
            {notice !== null && <span className={chatCss.inlineNotice} role="status">{notice}</span>}
            <Button
              size="sm"
              variant="ghost"
              icon={<IconRefreshOutlineRegular size={14} />}
              aria-label={t('refresh')}
              title={t('refresh')}
              disabled={loading}
              onClick={() => { void refresh() }}
            />
          </div>
        </div>
        {historyOpen && <section className={chatCss.history} aria-label={t('chat.history')}>
          <p className={chatCss.historyNote}>{t('chat.historyOnly')}</p>
          <div className={chatCss.bulkBar}>
            <span className={css.hint}>{t('chat.selected', { count: String(marked.length) })}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconTrashOutlineRegular size={14} />}
              disabled={marked.length === 0 || deleting !== null}
              title={t('chat.deleteHint')}
              onClick={() => { void removeConversations(marked) }}
            >
              {deleting === 'batch' ? t('chat.deleting') : t('chat.deleteSelected')}
            </Button>
          </div>
          {snapshot === null && <p className={css.muted} role="status">{t('loading')}</p>}
          {snapshot !== null && conversations.length === 0 && <p className={css.muted}>{t('chat.emptyList')}</p>}
          <ul className={chatCss.conversationList}>
            {conversations.map((conversation) => {
              const title = conversationTitle(conversation)
              return (
                <li key={conversation.id} className={chatCss.conversationItem}>
                  <Checkbox
                    className={chatCss.conversationCheck}
                    checked={marked.includes(conversation.id)}
                    disabled={deleting !== null}
                    label=""
                    title={t('chat.selectRow', { title })}
                    onChange={(next) => { toggleMarked(conversation.id, next) }}
                  />
                  <button
                    type="button"
                    className={clsx(chatCss.conversationRow, conversation.id === openId && chatCss.conversationActive)}
                    aria-current={conversation.id === openId ? 'true' : undefined}
                    onClick={() => { void openConversation(conversation) }}
                  >
                    <span className={chatCss.conversationTitle}>{title}</span>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={chatCss.conversationDelete}
                    icon={<IconTrashOutlineRegular size={14} />}
                    aria-label={t('chat.deleteRow', { title })}
                    title={t('chat.deleteHint')}
                    disabled={deleting !== null}
                    onClick={() => { void removeConversations([conversation.id]) }}
                  />
                </li>
              )
            })}
          </ul>
        </section>}
        <p className={chatCss.streamNote}>{t('chat.stream.note')}</p>
        {snapshot?.thought !== undefined && <details className={chatCss.activity} open>
          <summary className={chatCss.activitySummary}>{t('chat.thought.title')} · {t(THOUGHT_PHASE[snapshot.thought.phase] ?? 'chat.thought.unknown')}</summary>
          <p className={chatCss.activityEmpty}>{snapshot.thought.origin} · {snapshot.thought.reference || snapshot.thought.session}</p>
          {snapshot.thought.error !== '' && <p className={chatCss.inlineError}>{snapshot.thought.error}</p>}
          <details><summary>{t('chat.thought.reasoning')}</summary>
            <pre className={chatCss.thought}>{snapshot.thought.reasoning || t('chat.thought.noReasoning')}</pre>
          </details>
          <details><summary>{t('chat.thought.tools')}</summary>
            {snapshot.thought.events.map((event, index) => <div key={index}>
              <p className={chatCss.activityEmpty}>{stampText(event.at * 1000)} · {event.kind}</p>
              <pre className={chatCss.thought}>{JSON.stringify(event.value, null, 2)}</pre>
            </div>)}
          </details>
          {snapshot.thought.timing !== undefined && <p className={chatCss.activityEmpty}>
            {t('chat.thought.timing', { arrival: snapshot.thought.timing.arrival,
              started: snapshot.thought.timing.started === null ? '—' : stampText(snapshot.thought.timing.started * 1000),
              first: snapshot.thought.timing.first_output === null ? '—' : stampText(snapshot.thought.timing.first_output * 1000),
              sending: snapshot.thought.timing.sending === null ? '—' : stampText(snapshot.thought.timing.sending * 1000),
              receipt: snapshot.thought.timing.receipt === null ? '—' : stampText(snapshot.thought.timing.receipt * 1000) })}
          </p>}
          {snapshot.thought.timing !== undefined && <p className={snapshot.thought.timing.error === '' ? chatCss.activityEmpty : chatCss.inlineError}>
            {t('chat.delivery.title')}：{t(DELIVERY_STATE[snapshot.thought.timing.outcome] ?? 'chat.delivery.uncertain')}
            {snapshot.thought.timing.error === '' ? '' : ' · '+snapshot.thought.timing.error}
          </p>}
        </details>}
        {snapshot?.context_usage !== undefined && <details className={chatCss.activity}>
          <summary className={chatCss.activitySummary}>{t('chat.context.title')}</summary>
          <p className={chatCss.activityEmpty}>{t('chat.context.estimate', { used: snapshot.context_usage.estimated_input_tokens.toLocaleString() })}</p>
          <p className={chatCss.activityEmpty}>{t('chat.context.ceiling', {
            limit: snapshot.context_usage.input_ceiling.toLocaleString(), window: snapshot.context_usage.model_window.toLocaleString(),
          })}</p>
          <p className={chatCss.activityEmpty}>{snapshot.context_usage.input_tokens === null
            ? t('chat.context.pending')
            : t('chat.context.actual', { input: snapshot.context_usage.input_tokens.toLocaleString(),
              output: (snapshot.context_usage.output_tokens ?? 0).toLocaleString(),
              reported: snapshot.context_usage.usage_reports, requests: snapshot.context_usage.turn_requests })}</p>
          {snapshot.context_usage.trimmed_layers.length > 0 && <p className={chatCss.activityEmpty}>
            {t('chat.context.trimmed', { layers: snapshot.context_usage.trimmed_layers.map(layer => `L${layer}`).join(' / ') })}
          </p>}
        </details>}

        <details className={chatCss.activity}>
          <summary className={chatCss.activitySummary}>
            {t('chat.activity.title')}
            {activity !== null && activity.length > 0 && <span className={chatCss.activityCount}>{activity.length}</span>}
          </summary>
          {activity === null
            ? <p className={chatCss.activityEmpty}>{t('chat.activity.unavailable')}</p>
            : activity.length === 0
              ? <p className={chatCss.activityEmpty}>{t('chat.activity.empty')}</p>
              : <ul className={chatCss.activityList}>
                {activity.map((item) => {
                  const who = whoText(item, t)
                  return (
                    <li key={item.id} className={chatCss.activityRow}>
                      <span className={chatCss.activityWhere}>{whereText(item, t)}</span>
                      {item.at !== undefined && <span className={chatCss.activityTime}>{stampText(item.at)}</span>}
                      {who !== '' && <span className={chatCss.activityWho}>{who}</span>}
                      <span className={chatCss.activityText}>{item.text}</span>
                    </li>
                  )
                })}
              </ul>}
        </details>
        {failure !== null && <p className={chatCss.inlineError} role="alert">
          <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
        </p>}
        {(() => {
          // One block for the current round, kept above the messages so the column
          // stays a clean conversation; older rounds keep no diagnostics here.
          const latest = [...(snapshot?.messages ?? [])].reverse().find(item => item.trace !== undefined)
          if (latest === undefined) return null
          return <div className={chatCss.traceTop}><TraceChain trace={latest.trace as FishTrace} t={t} /></div>
        })()}
        <div className={chatCss.messages} aria-live="polite" aria-busy={loading}>
          {loading && snapshot === null && <p className={css.muted} role="status">{t('loading')}</p>}
          {snapshot !== null && snapshot.messages.length === 0 && <p className={css.muted}>{t('chat.emptyMessages')}</p>}
          {snapshot?.messages.map(message => (
            <article
              key={message.id}
              className={clsx(chatCss.message, ['owner', 'in', 'inbound'].includes(message.direction) ? chatCss.owner : chatCss.fish)}
            >
              <span className={chatCss.author}>
                {['owner', 'in', 'inbound'].includes(message.direction) ? t('chat.fromOwner') : t('chat.fromFish')}
              </span>
              <p className={clsx(chatCss.messageText, message.text === '' && css.muted)}>{bubbleText(message, t)}</p>
              {message.images !== undefined && <div className={css.formActions}>
                {message.images.map(image => <Button key={image.resource_id} size="sm" variant="outline" disabled={viewingImage}
                  onClick={() => { void viewImage(image.resource_id) }}>{t('media.viewImage', { name: image.name })}</Button>)}
              </div>}
              {message.attachments !== undefined && <div className={css.formActions}>
                {message.attachments.map(file => <Button key={file.id} size="sm" variant="outline"
                  onClick={() => { void viewAttachment(file.id) }}>{t('attachment.inspect', { name: file.name })}</Button>)}
              </div>}
              {message.status !== '' && message.status !== 'complete' && (
                <Tag tone={message.status === 'failed' || message.status === 'blocked' ? 'danger' : 'quiet'}>
                  {DELIVERY_STATE[message.status] === undefined ? message.status : t(DELIVERY_STATE[message.status] ?? 'chat.delivery.pending')}
                </Tag>
              )}
              {message.error !== undefined && <p role="alert">{message.error}</p>}
            </article>
          ))}
          {imagePreview !== null && <section className={chatCss.mediaPreview}>
            <div className={css.formActions}>
              <Tag>{imagePreview.width} × {imagePreview.height}</Tag>
              <Button size="sm" variant="outline" onClick={() => { void openImageOriginal(imagePreview.resource_id) }}>{t('media.openOriginal')}</Button>
              {imagePreview.frames > 1 && <>
                <Button size="sm" disabled={viewingImage || imagePreview.frame === 0}
                  onClick={() => { void viewImage(imagePreview.resource_id, imagePreview.frame - 1) }}>{t('media.previousFrame')}</Button>
                <Tag>{t('media.frameOf', { frame: imagePreview.frame + 1, total: imagePreview.frames })}</Tag>
                <Button size="sm" disabled={viewingImage || imagePreview.frame + 1 >= imagePreview.frames}
                  onClick={() => { void viewImage(imagePreview.resource_id, imagePreview.frame + 1) }}>{t('media.nextFrame')}</Button>
              </>}
              <Button size="sm" variant="ghost" onClick={() => { setImagePreview(null) }}>{t('media.closePreview')}</Button>
            </div>
            <img src={imagePreview.preview} alt={t('media.actualImage')} />
            <p className={css.hint}>{t('media.previewNote')}</p>
          </section>}
          {filePreview !== null && <section className={chatCss.mediaPreview}>
            <strong>{filePreview.name}</strong>
            <p>{t('attachment.original', { bytes: filePreview.size })}</p>
            <p>{t(filePreview.processing.complete ? 'attachment.indexComplete' : 'attachment.indexPartial', { chars: filePreview.processing.indexed_chars })}</p>
            {filePreview.processing.parsed_end !== undefined && <p>{t('attachment.byteRange', { start: filePreview.processing.parsed_start ?? 0, end: filePreview.processing.parsed_end })}</p>}
            {filePreview.processing.parsed_pages !== undefined && <p>{t('attachment.pageRange', { read: filePreview.processing.parsed_pages, total: filePreview.processing.total_pages ?? 0 })}</p>}
            {filePreview.processing.parsed_xml_bytes !== undefined && <p>{t('attachment.xmlRange', { read: filePreview.processing.parsed_xml_bytes, total: filePreview.processing.total_xml_bytes ?? 0 })}</p>}
            {filePreview.error !== '' && <p className={chatCss.inlineError}>{filePreview.error}</p>}
            <p className={css.hint}>{t('attachment.coverageNote')}</p>
            <code>{filePreview.path}</code>
            <div className={css.formActions}>
              <Button size="sm" variant="outline" disabled={!filePreview.original_exists} onClick={() => { void openAttachment(filePreview.id) }}>{t('attachment.open')}</Button>
              <Button size="sm" variant="ghost" onClick={() => { void viewAttachment(filePreview.id) }}>{t('refresh')}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setFilePreview(null) }}>{t('media.closePreview')}</Button>
            </div>
            <details><summary>{t('attachment.actualReads', { count: filePreview.reads.length })}</summary>
              {filePreview.reads.map((read, index) => <p key={index} className={css.hint}>{stampText(read.created * 1000)} · {t('attachment.byteRange', { start: read.start, end: read.end })}{read.query === '' ? '' : ' · ' + read.query}</p>)}
            </details>
          </section>}
          <div ref={messagesEnd} />
        </div>
        {pending !== null
          ? <p className={chatCss.job} role="status" aria-live="polite">
            <StateDot state={job?.status === 'running' ? 'ongoing' : 'warning'} />
            {job?.status === 'running' ? t('chat.running') : t('chat.pending')}
            <Button
              size="sm"
              variant="outline"
              icon={<IconStopFillRegular size={10} />}
              disabled={busy !== null}
              onClick={() => { void cancelReply() }}
            >
              {busy === 'cancel' ? t('chat.cancelling') : t('chat.cancel')}
            </Button>
          </p>
          : job !== null && !failingJob && <p className={chatCss.job} role="status" aria-live="polite">
            <StateDot state="done" />
            {t('chat.complete')}
          </p>}
        {job?.status === 'failed' && <p className={chatCss.inlineError} role="alert">
          <IconWarningOutlineRegular size={14} />{t('chat.failed', { error: job.error ?? t('chat.jobUnknown') })}
        </p>}
        {attachments.length > 0 && <div className={css.tags}>
          {attachments.map(item => <span key={item.id}>
            <Button size="sm" variant="outline" onClick={() => { void viewAttachment(item.id) }}>{item.name}</Button>
            <Button size="sm" variant="ghost" icon={<IconTrashOutlineRegular size={12} />} title={t('chat.removeFile')} aria-label={t('chat.removeFile')}
              onClick={() => { setAttachments(current => current.filter(file => file.id !== item.id)) }} />
          </span>)}
        </div>}
        {transferProgress !== null && <p className={css.hint} role="status">{t(transferProgress.finalizing ? 'attachment.finalizing' : 'attachment.uploadProgress', {
          name: transferProgress.name, received: transferProgress.received, total: transferProgress.size,
        })}</p>}
        {transferConfig !== null && <details className={css.hint}><summary>{t('attachment.transferTitle')}</summary>
          <p>{t('attachment.transferHint', { chunk: transferConfig.chunk_bytes, preview: transferConfig.automatic_text_preview_bytes })}</p>
          <p>{t('attachment.controlLimits', { workbench: transferConfig.workbench_control_bytes, tool: transferConfig.tool_control_bytes, image: transferConfig.native_image_bytes })}</p>
          <p>{transferConfig.source}</p>
        </details>}
        <form className={chatCss.composer} onSubmit={(event) => { void send(event) }}>
          <input type="file" multiple hidden ref={picker} onChange={(event) => { void importFiles(event.target.files) }} />
          <Button type="button" size="sm" variant="ghost" disabled={importing || !snapshot?.conversation_id}
            onClick={() => { picker.current?.click() }}>{importing ? t('chat.importingFile') : t('chat.attach')}</Button>
          <textarea
            ref={composer}
            className={chatCss.composerInput}
            aria-label={t('chat.placeholder')}
            placeholder={t('chat.placeholder')}
            rows={3}
            value={draft}
            onChange={(event) => { setDraft(event.target.value) }}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter keeps the newline for multi-line drafts.
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
          />
          <Button
            type="submit"
            variant="primary"
            icon={<IconPaperPlaneOutlineRegular size={14} />}
            disabled={draft.trim() === '' && attachments.length === 0 || snapshot === null || busy !== null || importing}
          >
            {busy === 'send' ? t('chat.sending') : t('chat.send')}
          </Button>
        </form>
      </div>
      <ThoughtRail call={call} t={t} />
    </div>
  )
}
