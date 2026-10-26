/** Computer-task history: lifecycle, finish time, and verified downloads. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishDelegatedTask } from '../contract/workbench.ts'
import type { FishPageProps } from '../page-props.ts'
import { parseDelegatedTasks, parseTaskDownload } from '../parsers.ts'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** Task page callbacks and localized copy supplied by the parent registration. */
type Props = Pick<FishPageProps, 'call' | 't' | 'formatTimestamp'>

/** Whether the backend may still be executing or closing this task. */
function active(task: FishDelegatedTask): boolean {
  return ['queued', 'starting', 'running', 'cancel_requested'].includes(task.status)
}

/** The tag tone one lifecycle state renders. */
function toneOf(task: FishDelegatedTask): 'success' | 'warning' | 'danger' | 'outline' {
  switch (task.status) {
    case 'completed':
      return 'success'
    case 'failed':
    case 'unknown':
      return 'danger'
    case 'queued':
    case 'starting':
      return 'warning'
    default:
      return 'outline'
  }
}

/**
 * Render the computer-task records. Delegation itself happens in the private
 * chat, so this view only lists what ran, its state, and its files.
 * @param props - authenticated Workbench calls, locale strings, and the timestamp helper.
 * @returns the record list with status, finish time, and open/download controls.
 */
export function DelegationTasks({ call, t, formatTimestamp }: Props): ReactNode {
  const [tasks, setTasks] = useState<readonly FishDelegatedTask[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const downloadUrls = useRef<string[]>([])
  const hasActive = tasks.some(active)

  useEffect(() => () => {
    for (const url of downloadUrls.current) URL.revokeObjectURL(url)
  }, [])

  const load = async (): Promise<void> => {
    const reply = await call('delegations.list')
    if (!reply.ok) { setError(reply.failure.message); return }
    const parsed = parseDelegatedTasks(reply.value)
    if (!parsed.ok) { setError(parsed.failure.message); return }
    setTasks(parsed.value)
  }

  useEffect(() => {
    let live = true
    const read = async (): Promise<void> => {
      const reply = await call('delegations.list')
      if (!live) return
      if (!reply.ok) { setError(reply.failure.message); return }
      const parsed = parseDelegatedTasks(reply.value)
      if (parsed.ok) setTasks(parsed.value)
      else setError(parsed.failure.message)
    }
    void read()
    const timer = hasActive ? setInterval(() => { void read() }, 2000) : undefined
    return () => { live = false; if (timer !== undefined) clearInterval(timer) }
  }, [call, hasActive])

  const cancel = async (task: FishDelegatedTask): Promise<void> => {
    setError(null)
    const reply = await call('delegations.cancel', { id: task.id })
    if (!reply.ok) setError(reply.failure.message)
    await load()
  }

  const download = async (task: FishDelegatedTask, artifactId: string, previewOnly = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (previewOnly) {
        const reply = await call('delegations.open', { id: task.id, artifact_id: artifactId })
        if (!reply.ok) setError(reply.failure.message)
        return
      }
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let offset: number | null = 0
      let name = ''
      let mediaType = 'application/octet-stream'
      while (offset !== null) {
        const reply = await call('delegations.download', { id: task.id, artifact_id: artifactId, offset })
        if (!reply.ok) { setError(reply.failure.message); return }
        const parsed = parseTaskDownload(reply.value)
        if (!parsed.ok) { setError(parsed.failure.message); return }
        chunks.push(Uint8Array.from(atob(parsed.value.data), character => character.charCodeAt(0)))
        name = parsed.value.name
        mediaType = parsed.value.media_type
        if (parsed.value.next_offset !== null && parsed.value.next_offset <= offset) throw new Error(t('attachment.progressError'))
        offset = parsed.value.next_offset
      }
      const url = URL.createObjectURL(new Blob(chunks, { type: mediaType }))
      // Electron may still be consuming the blob after the click returns.
      downloadUrls.current.push(url)
      const link = document.createElement('a')
      link.href = url; link.download = name
      document.body.append(link); link.click(); link.remove()
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return <section className={css.listColumn} aria-label={t('delegation.title')}>
    <div className={css.columnHead}>
      <h2 className={css.sectionTitle}>{t('delegation.title')}</h2>
      <div className={css.headActions}>
        <Button size="sm" variant="ghost" onClick={() => { void load() }}>{t('refresh')}</Button>
      </div>
    </div>
    <PageHint label={t('common.help')} items={[t('delegation.hint')]} />
    {error !== null && <p className={css.inlineError} role="alert">{error}</p>}
    <div className={css.scrollArea} aria-busy={busy}>
      {tasks.length === 0 && <p className={css.muted}>{t('delegation.empty')}</p>}
      <ul className={css.rows}>
        {tasks.map(task => <li key={task.id} className={css.taskRow}>
          <div className={css.taskBody}>
            <span className={css.rowTitle}>{task.title}</span>
            <span className={css.rowMeta}>
              <Tag tone={toneOf(task)}>{t(`delegation.state.${task.status}`)}</Tag>
              <span>{t(`delegation.files.${task.artifact_status}`)}</span>
              {!active(task) && task.finished !== undefined &&
                <span>{t('delegation.finished', { time: formatTimestamp(task.finished) })}</span>}
            </span>
            {task.error !== '' && <p className={css.inlineError}>{task.error}</p>}
            {task.result !== '' && <details><summary>{t('delegation.result')}</summary><p className={css.cardBody}>{task.result}</p></details>}
            {task.workspace !== '' && <code>{task.workspace}</code>}
            {task.artifacts.length > 0 && <span className={css.cardFoot}>
              {task.artifacts.map(file => <span key={file.id}>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void download(task, file.id, true) }}>
                  {t('delegation.open', { name: file.name })}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void download(task, file.id) }}>
                  {t('delegation.download', { name: file.name })}
                </Button>
              </span>)}
            </span>}

            {active(task) && <Button size="sm" variant="ghost" disabled={task.status === 'cancel_requested'}
              onClick={() => { void cancel(task) }}>{t('delegation.cancel')}</Button>}
          </div>
        </li>)}
      </ul>
    </div>
  </section>
}
