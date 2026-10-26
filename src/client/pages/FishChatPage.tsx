/** Client submission, attachment transfer and cancellation inside the execution workbench. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconPaperPlaneOutlineRegular, IconStopFillRegular, IconTrashOutlineRegular, IconWarningOutlineRegular, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type { FishChatJob, FishChatSnapshot, FishImagePreview, FishAttachment, FishAttachmentConfig, FishAttachmentDetail } from '../contract/workbench.ts'
import { parseChatJob, parseChatSent, parseChatSnapshot, parseImagePreview, parseAttachmentConfig, parseAttachmentDetail } from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { importAttachment, type AttachmentTransferProgress } from '../attachments.ts'
import { TurnWorkbench } from './TurnWorkbench.tsx'
import type { UseResource } from '@deepseek-ai/dsh-client-resources/client'
import css from './pages.module.css'
import chatCss from './FishChatPage.module.css'

const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 10 * 60 * 1000
interface PendingReply { readonly jobId: string; readonly conversationId: string; readonly attempt: number }
function failureText<T>(result: FishResult<T>): FishFailure | null { return result.ok ? null : result.failure }
function reasonOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function stampText(at: number): string { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(at)) }

/** @param props - fixed-instance workbench and localized display. @returns the complete chat workbench. */
export function FishChatPage({ call, t, reportRefresh, useResource, requestTurns, instanceId }: FishPageProps & {
  readonly useResource: UseResource
  readonly requestTurns: (instance: string, cursor?: string) => void
  readonly instanceId: string
}): ReactNode {
  const [snapshot, setSnapshot] = useState<FishChatSnapshot | null>(null)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<'send' | 'cancel' | null>(null)
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
    return parsed.value
  }

  useEffect(() => {
    void loadSnapshot().catch((error: unknown) => { setFailure({ message: reasonOf(error), offline: false }) })
    // The desktop conversation is only the submission target, not the execution directory.
  }, [])

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
  }, [pending])

  const startDelivery = (jobId: string, conversationId: string): void => {
    setPending({ jobId, conversationId, attempt })
    setAttempt(current => current + 1)
    setJob({ status: 'queued' })
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

  const attachmentConversation = useRef('')
  const viewAttachment = async (attachmentId: string, conversation = snapshot?.conversation_id): Promise<void> => {
    if (!conversation) return
    const reply = await call('attachments.detail', { id: conversation, attachment_id: attachmentId })
    if (!reply.ok) { setFailure(reply.failure); return }
    const parsed = parseAttachmentDetail(reply.value)
    if (!parsed.ok) setFailure(parsed.failure)
    else { attachmentConversation.current = conversation; setFilePreview(parsed.value) }
  }
  const openAttachment = async (attachmentId: string): Promise<void> => {
    if (!attachmentConversation.current) return
    const reply = await call('attachments.open', { id: attachmentConversation.current, attachment_id: attachmentId })
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
  return <TurnWorkbench useResource={useResource} requestTurns={requestTurns} instanceId={instanceId} t={t}
    viewImage={(resource) => { void viewImage(resource) }}
    viewAttachment={(id, conversation) => { void viewAttachment(id, conversation) }}>
    <div className={chatCss.submissionMeta}>
      {notice !== null && <p className={css.hint} role="status">{notice}</p>}
      {failure !== null && <p className={chatCss.inlineError} role="alert">{t('common.failed', { error: failure.message })}</p>}
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
    </div>
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
  </TurnWorkbench>
}
