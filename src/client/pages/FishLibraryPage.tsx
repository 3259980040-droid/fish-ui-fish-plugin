/**
 * Library: the owner's own documents, from import to a real trial search.
 *
 * Pasted notes use the text form; files use the same chunked original import as
 * chat, so the original stays a file and the index is derived from it. The list
 * shows what the backend really stored (kind, bytes or chars, version, time and
 * the category it sits in). Moving a document into a category calls
 * `library.organize` and shows the returned path. The trial search below runs
 * the graded `knowledge.search` she uses: index → overview → original chunk and
 * original file, with the real lexical/semantic state of that query.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, IconWarningOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure } from '../contract/slots.ts'
import type { FishDocument, FishDocumentDetail, FishRetrievalStatus } from '../contract/workbench.ts'
import {
  parseDocumentDeleted, parseDocumentDetail, parseDocumentOrganized, parseDocumentRecord, parseDocuments,
  parseRetrievalStatus,
} from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { importAttachment, type AttachmentTransferProgress } from '../attachments.ts'
import { KnowledgeSearch } from './KnowledgeSearch.tsx'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** How many hits one trial search asks for; the backend caps it at 50. */
const TRIAL_LIMIT = 10
/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render the library page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the import form, the stored documents with their real actions, and the trial search.
 */
export function FishLibraryPage({ call, t, formatTimestamp }: FishPageProps): ReactNode {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const kind = 'txt'
  const [fileName, setFileName] = useState('')
  const [docs, setDocs] = useState<readonly FishDocument[] | null>(null)
  const [preview, setPreview] = useState<FishDocumentDetail | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<FishRetrievalStatus | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const [transferProgress, setTransferProgress] = useState<AttachmentTransferProgress | null>(null)

  /**
   * Read the stored documents and the index readiness.
   * @returns the parsed list, or null when the list read failed.
   */
  const loadDocs = async (): Promise<readonly FishDocument[] | null> => {
    setLoading(true)
    try {
      const reply = await call('library.list')
      if (!reply.ok) {
        setFailure(reply.failure)
        return null
      }
      const parsed = parseDocuments(reply.value)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return null
      }
      setDocs(parsed.value)
      const status = await call('library.status')
      if (!status.ok) { setFailure(status.failure); return parsed.value }
      const parsedStatus = parseRetrievalStatus(status.value)
      if (!parsedStatus.ok) { setFailure(parsedStatus.failure); return parsed.value }
      setReadiness(parsedStatus.value)
      setFailure(null)
      return parsed.value
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
      return null
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
      // The same import registers the document; report the row the list really holds.
      const rows = await loadDocs()
      const stored = rows?.find(row => row.name === result.value.name) ?? null
      setNotice(stored === null
        ? t('library.importedFileUnlisted', { name: result.value.name })
        : t('library.importedFile', {
          name: stored.name, chars: String(stored.chars), chunks: String(stored.chunks), version: String(stored.version),
        }))
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
      setFolder(parsed.value.folder)
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
      setNotice(parsed.value.original_retained
        ? t('library.deletedRetained', { name: doc.name, chunks: String(parsed.value.chunks) })
        : t('library.deleted', { name: doc.name }))
      if (preview?.doc_id === doc.doc_id) setPreview(null)
      setConfirming(null)
      await loadDocs()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setBusy(null)
    }
  }

  /** Open the original file through the backend's own open action; a refusal is shown verbatim. */
  const openOriginal = async (doc: { readonly doc_id: string }): Promise<void> => {
    setBusy(doc.doc_id)
    setNotice(null)
    try {
      const reply = await call('library.open', { doc_id: doc.doc_id })
      if (!reply.ok) { setFailure(reply.failure); return }
      setFailure(null)
      setNotice(t('library.openedOriginal'))
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
    finally { setBusy(null) }
  }

  /** Move the document into the category the owner typed, then show the returned path. */
  const moveDocument = async (doc: FishDocument): Promise<void> => {
    if (folder.trim() === '') {
      setFailure({ message: t('library.organizeNeedName'), offline: false })
      return
    }
    setBusy(doc.doc_id)
    setNotice(null)
    try {
      const reply = await call('library.organize', { action: 'move', doc_id: doc.doc_id, name: folder.trim() })
      if (!reply.ok) { setFailure(reply.failure); return }
      const parsed = parseDocumentOrganized(reply.value)
      if (!parsed.ok) { setFailure(parsed.failure); return }
      setFailure(null)
      setNotice(t('library.organizeResult', {
        folder: parsed.value.folder === '' ? t('library.folderRoot') : parsed.value.folder,
        path: parsed.value.path,
      }))
      await loadDocs()
      setPreview(null)
    } catch (error) { setFailure({ message: reasonOf(error), offline: false }) }
    finally { setBusy(null) }
  }

  return (
    <div className={css.page}>
      <h2 className={css.sectionTitle}>{t('library.title')}</h2>
      <p className={css.hint}>{t('library.intro')}</p>
      <PageHint label={t('common.help')} items={[t('library.scope'), t('library.importNote'), t('library.trialNote')]} />
      {failure !== null && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
      </p>}
      {notice !== null && <p className={css.inlineNotice} role="status" aria-live="polite">{notice}</p>}
      {readiness !== null && <section className={css.card} role="status">
        <div className={css.cardHead}>
          <span className={css.cardTitle}>{t('library.readinessTitle')}</span>
          <Tag tone={readiness.ready ? 'success' : 'quiet'}>
            {t(readiness.ready ? 'library.readinessReady' : 'library.readinessLexical')}
          </Tag>
        </div>
        <p className={css.hint}>{readiness.detail || t(readiness.ready ? 'retrieval.ready' : 'retrieval.notReady')}</p>
        <p className={css.hint}>{t('retrieval.pending', { count: readiness.pending })}</p>
        <p className={css.hint}>{t('library.readinessNote')}</p>
      </section>}

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
            <span className={css.label}>{t('library.file')}</span>
            <input
              type="file"
              hidden
              ref={picker}
              accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.log,.yaml,.yml,.xml,.html"
              onChange={(event) => { void readFile(event.target.files) }}
            />
            <div className={css.searchRow}>
              <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => { picker.current?.click() }}>
                {t('library.filePick')}
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
                <Tag tone="outline">{doc.kind}</Tag>
                <span>{doc.bytes === undefined
                  ? t('library.chars', { chars: String(doc.chars) })
                  : t('library.bytes', { bytes: String(doc.bytes) })}</span>
                <span>{t('library.chunks', { chunks: String(doc.chunks) })}</span>
                <span>{t('library.version', { version: String(doc.version) })}</span>
                <span>{t('library.folderLine', { folder: doc.folder === '' ? t('library.folderRoot') : doc.folder })}</span>
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
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { void openOriginal(doc) }}>
                      {t('library.openOriginal')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setConfirming(doc.doc_id) }}>
                      {t('library.delete')}
                    </Button>
                  </>}
              </span>
            </li>
          ))}
        </ul>
        {preview !== null && <section className={css.section} aria-label={t('library.detailTitle', { name: preview.name })}>
          <h4 className={css.cardTitle}>
            {t('library.detailTitle', { name: preview.name })} · {t('library.version', { version: String(preview.version) })}
          </h4>
          <p className={css.hint}>{t('library.detailMeta', {
            kind: preview.kind,
            chars: String(preview.chars),
            chunks: String(preview.chunks),
            folder: preview.folder === '' ? t('library.folderRoot') : preview.folder,
          })}</p>
          <p className={css.hint}>{preview.original_path === '' || preview.original_path === undefined
            ? t('library.originalUnavailable')
            : t('library.originalAvailable', { path: preview.original_path })}</p>
          {preview.url !== undefined && preview.url !== '' && <p className={css.hint}>{preview.url}</p>}
          {preview.fetched_at !== undefined && preview.fetched_at !== '' && <p className={css.hint}>{t('library.fetchedAt', { time: preview.fetched_at })}</p>}
          <div className={css.searchRow}>
            <Input value={folder} aria-label={t('library.folder')} placeholder={t('library.folder')} onChange={(event) => { setFolder(event.target.value) }} />
            <Button size="sm" disabled={busy !== null} onClick={() => { void moveDocument(preview) }}>{t('library.organize')}</Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { void openOriginal(preview) }}>{t('library.openOriginal')}</Button>
          </div>
          {preview.preview.length === 0
            ? <p className={css.muted}>{t('library.noChunks')}</p>
            : <>
              <p className={css.cardTitle}>{t('library.detailChunks', { count: String(preview.preview.length) })}</p>
              {preview.preview.map(chunk => (
                <section key={chunk.ord} className={css.card}>
                  <div className={css.cardHead}>
                    <span className={css.cardTitle}>{t('library.chunkHead', { ord: String(chunk.ord) })}</span>
                    <span className={css.muted}>{t('library.chars', { chars: String(chunk.chars) })}</span>
                  </div>
                  <p className={css.cardBody}>{chunk.text}</p>
                </section>
              ))}
            </>}
          <p className={css.hint}>{t('library.detailNote')}</p>
        </section>}
      </section>

      <section className={css.section} aria-label={t('knowledge.title')}>
        <h3 className={css.cardTitle}>{t('library.trialTitle')}</h3>
        <KnowledgeSearch call={call} t={t} formatTimestamp={formatTimestamp} limit={TRIAL_LIMIT} channels={['documents']} />
      </section>
    </div>
  )
}
