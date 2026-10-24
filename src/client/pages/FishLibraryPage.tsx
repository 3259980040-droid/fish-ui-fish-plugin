/**
 * Library: the owner's own documents, from upload to retrieval.
 *
 * Originals use the same chunk import as chat; pasted notes use the text form.
 * The list shows every stored version with its first chunks and its delete. The
 * ask block runs the same `library.search` her private chat runs before it
 * answers, so the owner can see whether she would actually find the passage.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, IconSearchOutlineRegular, IconWarningOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure } from '../contract/slots.ts'
import type { FishDocument, FishDocumentDetail, FishDocumentHit, FishRetrievalStatus } from '../contract/workbench.ts'
import {
  parseDocumentDeleted, parseDocumentDetail, parseDocumentSearch, parseDocumentRecord, parseDocuments, parseRetrievalStatus,
} from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { importAttachment, type AttachmentTransferProgress } from '../attachments.ts'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** How much of a hit the page prints before the owner opens the document. */
const HIT_LEAD_CHARS = 120
/** How many hits one ask asks for; the private chat quotes three. */
const ASK_LIMIT = 10
/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The first characters of a chunk, with an ellipsis when it was cut. */
function lead(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= HIT_LEAD_CHARS ? flat : `${flat.slice(0, HIT_LEAD_CHARS)}…`
}

/**
 * Render the library page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the upload block, the stored documents, and the ask block.
 */
export function FishLibraryPage({ call, t, formatTimestamp }: FishPageProps): ReactNode {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const kind = 'txt'
  const [fileName, setFileName] = useState('')
  const [docs, setDocs] = useState<readonly FishDocument[] | null>(null)
  const [preview, setPreview] = useState<FishDocumentDetail | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly FishDocumentHit[] | null>(null)
  const [retrieval, setRetrieval] = useState<FishRetrievalStatus | null>(null)
  const [folder, setFolder] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const [transferProgress, setTransferProgress] = useState<AttachmentTransferProgress | null>(null)

  const loadDocs = async (): Promise<void> => {
    setLoading(true)
    try {
      const reply = await call('library.list')
      if (!reply.ok) {
        setFailure(reply.failure)
        return
      }
      const parsed = parseDocuments(reply.value)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setDocs(parsed.value)
      const status = await call('library.status')
      if (status.ok) {
        const parsedStatus = parseRetrievalStatus(status.value)
        if (!parsedStatus.ok) { setFailure(parsedStatus.failure); return }
        setRetrieval(parsedStatus.value)
      } else { setFailure(status.failure); return }
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setLoading(false)
    }
  }

  // The page opens on what is already stored; every write re-reads the same list.
  useEffect(() => {
    void (async () => {
      try {
        await loadDocs()
      } catch (error) {
        // Swallows an unexpected throw: the page reports it instead of rejecting silently.
        setFailure({ message: reasonOf(error), offline: false })
      }
    })()
    // The first read runs once for the page's life; later reads follow every write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const readFile = async (files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    setNotice(null)
    try {
      const result = await importAttachment(call, 'library-owner', file, setTransferProgress, {
        readError: t('library.fileError'), progressError: t('attachment.progressError'),
      })
      if (!result.ok) { setFailure(result.failure); return }
      setFileName(file.name)
      setFailure(null)
      setNotice(t('attachment.saved', { name: file.name, bytes: result.value.size }))
      await loadDocs()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setUploading(false)
      setTransferProgress(null)
      if (picker.current !== null) picker.current.value = ''
    }
  }

  const upload = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || text.trim() === '') return
    setUploading(true)
    setNotice(null)
    try {
      const reply = await call('library.upload', { name: name.trim(), text, kind })
      if (!reply.ok) {
        setFailure(reply.failure)
        return
      }
      const parsed = parseDocumentRecord(reply.value)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setFailure(null)
      setNotice(t('library.uploaded', {
        name: parsed.value.name, chars: String(parsed.value.chars), chunks: String(parsed.value.chunks),
      }))
      setText('')
      setFileName('')
      await loadDocs()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setUploading(false)
    }
  }

  const view = async (doc: FishDocument): Promise<void> => {
    if (preview?.doc_id === doc.doc_id) {
      setPreview(null)
      return
    }
    setBusy(doc.doc_id)
    try {
      const reply = await call('library.detail', { doc_id: doc.doc_id })
      if (!reply.ok) {
        setFailure(reply.failure)
        return
      }
      const parsed = parseDocumentDetail(reply.value)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setPreview(parsed.value)
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (doc: FishDocument): Promise<void> => {
    setBusy(doc.doc_id)
    setNotice(null)
    try {
      const reply = await call('library.delete', { doc_id: doc.doc_id })
      if (!reply.ok) {
        setFailure(reply.failure)
        return
      }
      const parsed = parseDocumentDeleted(reply.value)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setFailure(null)
      setNotice(t('library.deleted', { name: doc.name }))
      if (preview?.doc_id === doc.doc_id) setPreview(null)
      setConfirming(null)
      await loadDocs()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setBusy(null)
    }
  }

  const ask = async (): Promise<void> => {
    if (query.trim() === '') return
    setAsking(true)
    try {
      const reply = await call('library.search', { query: query.trim(), limit: ASK_LIMIT })
      if (!reply.ok) {
        setFailure(reply.failure)
        return
      }
      const parsed = parseDocumentSearch(reply.value)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setHits(parsed.value.results)
      setRetrieval(parsed.value.retrieval)
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setAsking(false)
    }
  }

  const openOriginal = async (doc: FishDocument): Promise<void> => {
    try {
      const reply = await call('library.open', { doc_id: doc.doc_id })
      if (!reply.ok) setFailure(reply.failure)
      else setNotice(t('library.openedOriginal'))
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
  }

  const moveDocument = async (doc: FishDocument): Promise<void> => {
    setBusy(doc.doc_id)
    try {
      const reply = await call('library.organize', { action: 'move', doc_id: doc.doc_id, name: folder })
      if (!reply.ok) { setFailure(reply.failure); return }
      await loadDocs()
      setNotice(t('library.organized'))
      setPreview(null)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
    finally { setBusy(null) }
  }

  return (
    <div className={css.page}>
      <h2 className={css.sectionTitle}>{t('library.title')}</h2>
      <p className={css.hint}>{t('library.intro')}</p>
      <PageHint label={t('common.help')} items={[t('library.scope'), t('library.askHint')]} />
      {failure !== null && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{failure.message}
      </p>}
      {retrieval !== null && <section className={css.card} role="status">
        <Tag tone={retrieval.mode === 'hybrid' || retrieval.last_mode === 'hybrid' ? 'success' : 'quiet'}>
          {t(retrieval.mode === 'hybrid' || retrieval.last_mode === 'hybrid' ? 'retrieval.hybrid' : 'retrieval.lexical')}
        </Tag>
        <p className={css.hint}>{retrieval.detail || retrieval.last_detail || t(retrieval.ready ? 'retrieval.ready' : 'retrieval.notReady')}</p>
        <p className={css.hint}>{t('retrieval.pending', { count: retrieval.pending })}</p>
      </section>}
      {notice !== null && <p className={css.inlineNotice} role="status" aria-live="polite">{notice}</p>}

      <section className={css.section} aria-label={t('library.upload')}>
        <h3 className={css.cardTitle}>{t('library.upload')}</h3>
        <form className={css.form} onSubmit={(event) => { void upload(event) }}>
          <label className={css.field}>
            <span className={css.label}>{t('library.name')}</span>
            <Input
              value={name}
              placeholder={t('library.namePlaceholder')}
              onChange={(event) => { setName(event.target.value) }}
            />
          </label>
          <div className={css.field}>
            <span className={css.label}>{t('library.text')}</span>
            <input
              type="file"
              hidden
              ref={picker}
              accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.log,.yaml,.yml,.xml,.html"
              onChange={(event) => { void readFile(event.target.files) }}
            />
            <div className={css.searchRow}>
              <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => { picker.current?.click() }}>
                {t('library.file')}
              </Button>
              <span className={css.muted}>{fileName === '' ? t('library.fileHint') : fileName}</span>
              {transferProgress !== null && <span className={css.hint} role="status">{t(transferProgress.finalizing ? 'attachment.finalizing' : 'attachment.uploadProgress', { name: transferProgress.name, received: transferProgress.received, total: transferProgress.size })}</span>}
              <Tag tone="outline">{kind}</Tag>
            </div>
            <textarea
              className={css.textarea}
              rows={8}
              value={text}
              aria-label={t('library.text')}
              placeholder={t('library.textPlaceholder')}
              onChange={(event) => { setText(event.target.value) }}
            />
          </div>
          <div className={css.formActions}>
            <span className={css.muted}>{t('library.charCount', { chars: String(text.trim().length) })}</span>
            <Button
              type="submit"
              variant="primary"
              disabled={uploading || name.trim() === '' || text.trim() === ''}
            >
              {uploading ? t('library.uploading') : t('library.uploadAction')}
            </Button>
          </div>
        </form>
      </section>

      <section className={css.section} aria-label={t('library.docs')}>
        <div className={css.searchRow}>
          <h3 className={css.cardTitle}>{t('library.docs')}</h3>
          <span className={css.grow} />
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => { void loadDocs() }}>
            {loading ? t('library.loading') : t('refresh')}
          </Button>
        </div>
        {docs !== null && docs.length === 0 && <p className={css.muted}>{t('library.empty')}</p>}
        <ul className={css.rows} aria-busy={loading}>
          {docs?.map(doc => (
            <li key={doc.doc_id} className={css.row}>
              <span className={css.rowTitle}>{doc.name}</span>
              <span className={css.cardMeta}>
                <span>{t('library.version', { version: String(doc.version) })}</span>
                <span>{t('library.chars', { chars: String(doc.chars) })}</span>
                <span>{t('library.chunks', { chunks: String(doc.chunks) })}</span>
                <span>{formatTimestamp(doc.created)}</span>
              </span>
              <span className={css.rowActions}>
                {confirming === doc.doc_id
                  ? <>
                    <span className={css.muted}>{t('library.deleteConfirm')}</span>
                    <span className={css.rowMeta}>
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { void remove(doc) }}>
                        {busy === doc.doc_id ? t('library.deleting') : t('library.deleteYes')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setConfirming(null) }}>{t('cancel')}</Button>
                    </span>
                  </>
                  : <>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { void view(doc) }}>
                      {preview?.doc_id === doc.doc_id ? t('library.hide') : t('library.view')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setConfirming(doc.doc_id) }}>
                      {t('library.delete')}
                    </Button>
                  </>}
              </span>
            </li>
          ))}
        </ul>
        {preview !== null && <section className={css.section} aria-label={t('library.previewTitle', { count: String(preview.preview.length) })}>
          <h4 className={css.cardTitle}>
            {preview.name} · {t('library.previewTitle', { count: String(preview.preview.length) })}
          </h4>
          <p className={css.hint}>{preview.original_path || t('library.originalMissing')}</p>
          {preview.url !== undefined && preview.url !== '' && <p className={css.hint}>{preview.url}</p>}
          {preview.fetched_at !== undefined && preview.fetched_at !== '' && <p className={css.hint}>{t('library.fetchedAt', { time: preview.fetched_at })}</p>}
          <div className={css.formActions}>
            <Button size="sm" disabled={!preview.original_path} onClick={() => { void openOriginal(preview) }}>{t('library.openOriginal')}</Button>
            <Input value={folder} aria-label={t('library.folder')} placeholder={t('library.folder')} onChange={(event) => { setFolder(event.target.value) }} />
            <Button size="sm" disabled={busy !== null} onClick={() => { void moveDocument(preview) }}>{t('library.organize')}</Button>
          </div>
          {preview.preview.map(chunk => (
            <section key={chunk.ord} className={css.card}>
              <div className={css.cardHead}>
                <span className={css.cardTitle}>{t('library.chunkHead', { ord: String(chunk.ord) })}</span>
                <span className={css.muted}>{t('library.chars', { chars: String(chunk.chars) })}</span>
              </div>
              <p className={css.cardBody}>{chunk.text}</p>
            </section>
          ))}
        </section>}
      </section>

      <section className={css.section} aria-label={t('library.ask')}>
        <h3 className={css.cardTitle}>{t('library.ask')}</h3>
        <form className={css.searchRow} role="search" onSubmit={(event) => { event.preventDefault(); void ask() }}>
          <Input
            type="search"
            icon={<IconSearchOutlineRegular />}
            aria-label={t('library.ask')}
            placeholder={t('library.askPlaceholder')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            className={css.grow ?? ''}
          />
          <Button type="submit" size="sm" variant="outline" disabled={asking || query.trim() === ''}>
            {asking ? t('library.asking') : t('library.askAction')}
          </Button>
        </form>
        {hits !== null && hits.length === 0 && <p className={css.muted}>{t('library.noHits')}</p>}
        {hits !== null && hits.length > 0 && <p className={css.muted}>{t('library.hits', { count: String(hits.length) })}</p>}
        {hits?.map(hit => (
          <section key={hit.doc_id + ':' + String(hit.ord)} className={css.card}>
            <div className={css.cardHead}>
              <span className={css.cardTitle}>{hit.doc_name}</span>
              <Tag tone="outline">{t('library.chunkHead', { ord: String(hit.ord) })}</Tag>
            </div>
            <p className={css.cardBody}>{lead(hit.text)}</p>
            <footer className={css.cardMeta}>
              <span>{t('library.hitScore', { score: hit.score.toFixed(1) })}</span>
            </footer>
          </section>
        ))}
      </section>
    </div>
  )
}
