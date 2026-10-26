/**
 * Fish's own workspace: browse its real folders, open a text file, edit it, and
 * save through `workspace.write` (the fish_file_write tool). The section is
 * explicit about the folder's ownership, guards unsaved drafts, shows the real
 * save result, and keeps a failed save's draft and Chinese reason in place.
 * Files the workbench read cannot prove complete (400-line read ceiling, or
 * invalid UTF-8 replacement characters) open read-only and say why.
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  Button, IconFolderOpenOutlineRegular, IconRefreshOutlineRegular, IconWarningOutlineRegular, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishWorkspaceEntry } from '../contract/workbench.ts'
import {
  parseWorkspaceFile, parseWorkspaceListing, parseWorkspaceWrite,
} from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import css from './pages.module.css'
import own from './WorkspaceFiles.module.css'

/** Largest line count the workbench's `workspace.read` can return. */
const READ_LINE_LIMIT = 400

/** One opened file and the facts its editor shows. */
interface OpenFile {
  readonly path: string
  readonly name: string
  readonly original: string
  readonly bytes: number | null
  readonly lineCount: number
  readonly editable: boolean
  readonly readOnlyReason: string
}

/** A guarded action waiting for the owner to save or discard the draft. */
type Pending =
  | { readonly kind: 'open'; readonly entry: FishWorkspaceEntry }
  | { readonly kind: 'refresh' }
  | { readonly kind: 'close' }

/** Join a directory shown by `workspace.list` and one entry name with the API's `/` form. */
function joinPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

/** Backend paths come from Windows `Path`; the page keeps one `/`-separated form. */
function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

/** Parent of a relative workspace directory ('' is the workspace root). */
function parentPath(directory: string): string {
  return directory.split('/').slice(0, -1).join('/')
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render the workspace browser and editor.
 * @param props - authenticated workbench calls and localized copy.
 * @returns the file list beside the editor.
 */
export function WorkspaceFiles({ call, t }: Pick<FishPageProps, 'call' | 't'>): ReactNode {
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<readonly FishWorkspaceEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [opened, setOpened] = useState<OpenFile | null>(null)
  const [draft, setDraft] = useState('')
  const [openError, setOpenError] = useState<string | null>(null)
  const [openLoading, setOpenLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const dirty = opened !== null && draft !== opened.original

  const list = async (directory: string): Promise<void> => {
    setListLoading(true)
    setListError(null)
    setPending(null)
    try {
      const reply = await call('workspace.list', directory === '' ? {} : { path: directory })
      if (!reply.ok) { setListError(reply.failure.message); return }
      const parsed = parseWorkspaceListing(reply.value)
      if (!parsed.ok) { setListError(parsed.failure.message); return }
      setEntries(parsed.value.entries)
      setCwd(normalizePath(parsed.value.path))
    } catch (error) {
      setListError(reasonOf(error))
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const reply = await call('workspace.list', {})
        if (!live) return
        if (!reply.ok) { setListError(reply.failure.message); return }
        const parsed = parseWorkspaceListing(reply.value)
        if (!live) return
        if (parsed.ok) { setEntries(parsed.value.entries); setCwd(normalizePath(parsed.value.path)) }
        else setListError(parsed.failure.message)
      } catch (error) {
        if (live) setListError(reasonOf(error))
      } finally {
        if (live) setListLoading(false)
      }
    })()
    return () => { live = false }
    // The first read runs once for the section's life; later reads go through Refresh.
  }, [])

  const openFile = async (entry: FishWorkspaceEntry): Promise<void> => {
    const path = joinPath(cwd, entry.name)
    setOpenLoading(true)
    setOpenError(null)
    setSaveError(null)
    setSaveNotice(null)
    setPending(null)
    try {
      const reply = await call('workspace.read', { path, lines: READ_LINE_LIMIT })
      if (!reply.ok) { setOpenError(reply.failure.message); return }
      const parsed = parseWorkspaceFile(reply.value)
      if (!parsed.ok) { setOpenError(parsed.failure.message); return }
      const text = parsed.value.text.join('\n')
      const truncated = parsed.value.text.length >= READ_LINE_LIMIT
      const invalidUtf8 = parsed.value.text.some(line => line.includes('\uFFFD'))
      const readOnlyReason = truncated
        ? t('workspace.readOnlyLimit')
        : invalidUtf8 ? t('workspace.readOnlyBinary') : ''
      setOpened({
        path: normalizePath(parsed.value.path),
        name: entry.name,
        original: text,
        bytes: entry.bytes,
        lineCount: parsed.value.lines,
        editable: readOnlyReason === '',
        readOnlyReason,
      })
      setDraft(text)
    } catch (error) {
      setOpenError(reasonOf(error))
    } finally {
      setOpenLoading(false)
    }
  }

  const requestOpen = (entry: FishWorkspaceEntry): void => {
    if (entry.directory) {
      void list(joinPath(cwd, entry.name))
      return
    }
    if (dirty) { setPending({ kind: 'open', entry }); return }
    void openFile(entry)
  }

  const requestRefresh = (): void => {
    if (dirty) { setPending({ kind: 'refresh' }); return }
    void list(cwd)
  }

  const requestClose = (): void => {
    if (dirty) { setPending({ kind: 'close' }); return }
    setOpened(null); setDraft(''); setOpenError(null); setSaveError(null); setSaveNotice(null)
  }

  const discardAndContinue = (): void => {
    if (opened !== null) setDraft(opened.original)
    const waiting = pending
    setPending(null)
    if (waiting === null) return
    if (waiting.kind === 'refresh') { void list(cwd); return }
    if (waiting.kind === 'close') { setOpened(null); setDraft(''); setOpenError(null); setSaveError(null); setSaveNotice(null); return }
    if (waiting.entry.directory) { void list(joinPath(cwd, waiting.entry.name)); return }
    void openFile(waiting.entry)
  }

  const save = async (): Promise<void> => {
    if (opened === null || !opened.editable || saving) return
    setSaving(true)
    setSaveError(null)
    setSaveNotice(null)
    try {
      const reply = await call('workspace.write', { path: opened.path, text: draft })
      if (!reply.ok) { setSaveError(reply.failure.message); return }
      const parsed = parseWorkspaceWrite(reply.value)
      if (!parsed.ok) { setSaveError(parsed.failure.message); return }
      if (!parsed.value.ok) {
        setSaveError(parsed.value.error === '' ? t('workspace.saveRefused') : parsed.value.error)
        return
      }
      const bytes = parsed.value.bytes
      setOpened(current => current === null ? current : {
        ...current,
        original: draft,
        bytes,
        lineCount: draft === '' ? 0 : draft.split('\n').length,
      })
      setSaveNotice(t('workspace.saved', { name: opened.name, bytes }))
      await list(cwd)
    } catch (error) {
      setSaveError(reasonOf(error))
    } finally {
      setSaving(false)
    }
  }

  const location = cwd === '' ? t('workspace.root') : cwd
  return <section className={css.detailColumn} aria-label={t('workspace.title')}>
    <div className={css.columnHead}>
      <h2 className={css.sectionTitle}>{t('workspace.title')}</h2>
      <div className={css.headActions}>
        <Button
          size="sm"
          variant="ghost"
          icon={<IconRefreshOutlineRegular size={14} />}
          aria-label={t('workspace.refresh')}
          title={t('workspace.refresh')}
          disabled={listLoading}
          onClick={requestRefresh}
        />
      </div>
    </div>
    <p className={own.note}>{t('workspace.hint')}</p>
    <p className={css.rowMeta}><IconFolderOpenOutlineRegular size={14} /> {t('workspace.path', { path: location })}</p>
    {listError !== null && <p className={css.inlineError} role="alert">
      <IconWarningOutlineRegular size={14} />{t('common.failed', { error: listError })}
    </p>}
    {pending !== null && <div className={own.pending} role="alert">
      <span>{pending.kind === 'open'
        ? t('workspace.unsavedOpen', { name: pending.entry.name })
        : pending.kind === 'refresh' ? t('workspace.unsavedRefresh') : t('workspace.unsavedClose')}</span>
      <div className={own.pendingActions}>
        <Button size="sm" variant="outline" onClick={discardAndContinue}>{t('workspace.discard')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setPending(null) }}>{t('workspace.cancel')}</Button>
      </div>
    </div>}
    <div className={own.columns}>
      <div className={own.listPane}>
        {cwd !== '' && <Button size="sm" variant="ghost" onClick={() => { void list(parentPath(cwd)) }}>{t('workspace.up')}</Button>}
        {listLoading && entries === null && <p className={css.muted} role="status">{t('workspace.loading')}</p>}
        {entries !== null && entries.length === 0 && <p className={css.muted}>{t('workspace.empty')}</p>}
        <ul className={own.fileList}>
          {(entries ?? []).map(entry => <li key={entry.name}>
            <button
              type="button"
              className={own.fileButton}
              aria-current={opened?.path === joinPath(cwd, entry.name) ? 'true' : undefined}
              onClick={() => { requestOpen(entry) }}
            >
              <span className={own.fileName}>{entry.directory ? `${entry.name}/` : entry.name}</span>
              <span className={css.rowMeta}>
                {entry.directory ? t('workspace.folder') : t('workspace.bytes', { bytes: entry.bytes ?? 0 })}
              </span>
            </button>
          </li>)}
        </ul>
      </div>
      <div className={own.editorPane}>
        {openLoading && <p className={css.muted} role="status">{t('workspace.opening')}</p>}
        {openError !== null && <p className={css.inlineError} role="alert">
          <IconWarningOutlineRegular size={14} />{t('common.failed', { error: openError })}
        </p>}
        {opened === null
          ? <p className={css.muted}>{t('workspace.noSelection')}</p>
          : <>
            <div className={css.columnHead}>
              <h3 className={css.cardTitle}>{opened.name}</h3>
              <div className={css.headActions}>
                <span className={css.rowMeta}>{t('workspace.lines', { count: opened.lineCount })}</span>
                <span className={css.rowMeta}>{opened.bytes === null ? '' : t('workspace.bytes', { bytes: opened.bytes })}</span>
                <Button size="sm" variant="ghost" onClick={requestClose}>{t('workspace.close')}</Button>
              </div>
            </div>
            <p className={css.cardFoot}>{t('workspace.filePath', { path: opened.path })}</p>
            {!opened.editable && <p className={own.readOnlyNote} role="status">
              <Tag tone="warning">{t('workspace.readOnly')}</Tag>{opened.readOnlyReason}
            </p>}
            <label className={css.field}>
              <span className={css.label}>{t('workspace.editorLabel')}</span>
              <textarea
                className={own.editor}
                value={draft}
                readOnly={!opened.editable}
                spellCheck={false}
                aria-label={t('workspace.editorLabel')}
                onChange={(event) => { setDraft(event.target.value); setSaveError(null); setSaveNotice(null) }}
              />
            </label>
            {saveError !== null && <p className={css.inlineError} role="alert">
              <IconWarningOutlineRegular size={14} />{t('common.failed', { error: saveError })}
            </p>}
            {saveNotice !== null && <p className={css.inlineNotice} role="status">{saveNotice}</p>}
            <div className={css.formActions}>
              {dirty && <span className={css.rowMeta}>{t('workspace.unsavedShort')}</span>}
              <Button
                size="sm"
                variant="primary"
                disabled={!opened.editable || saving || !dirty}
                onClick={() => { void save() }}
              >
                {saving ? t('workspace.saving') : t('workspace.save')}
              </Button>
            </div>
          </>}
      </div>
    </div>
  </section>
}
