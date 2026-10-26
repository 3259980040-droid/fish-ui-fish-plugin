/**
 * Persona page: read the persona in force first, edit only when asked.
 *
 * One persona library is the only source: the workbench's `personas.*` actions
 * list it, save a preset, create one, import files as presets, and apply a
 * revision. "Save only" stores a new revision without changing the active one;
 * the saved text stays in the editor instead of being replaced by the active
 * persona. "Save and apply" stores first and applies the stored revision, so a
 * failed apply keeps the saved result and only the apply is retried.
 *
 * Draft, saved revision, selected preset and active revision stay separate: a
 * background read refreshes the list and the active summary but never writes
 * into the editor or another selection.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconCheckCircleFillRegular, IconEditOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconTrashOutlineRegular, IconWarningOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishResult } from '../contract/slots.ts'
import type {
  FishPersonaCandidate, FishPersonaCurrent, FishPersonaPreview, FishPersonaRecord,
} from '../contract/workbench.ts'
import {
  parsePersonaApplied, parsePersonaCandidates, parsePersonaCurrent, parsePersonaPreview, parsePersonaRecord,
  parsePersonas, parsePersonasCleared,
} from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** What one settled reply says when it failed; null when it succeeded. */
function failureOf<T>(result: FishResult<T>): { readonly message: string } | null {
  return result.ok ? null : result.failure
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Short displayed form of a revision id. */
function shortRevision(revision: string): string {
  return revision.length > 8 ? revision.slice(0, 8) : revision
}

/** One editable draft: which preset it started from, and what was last stored. */
interface PersonaEditor {
  /** Preset the draft started from; null for a new persona. */
  readonly sourceId: string | null
  readonly name: string
  readonly body: string
  /** Revision last stored for this draft; null until it was saved. */
  readonly savedId: string | null
  /** Body and name last stored, so the page can tell an edited draft from a saved one. */
  readonly savedBody: string
  readonly savedName: string
}

/** Where a failure belongs on the page. */
type FailureWhere = 'load' | 'editor' | 'list' | 'import' | 'preview'

/** One failure next to the object that produced it. */
interface PageFailure {
  readonly message: string
  readonly where: FailureWhere
}

/** Work in flight; the matching controls stay disabled until it settles. */
type Busy = 'save' | 'apply' | 'preset' | 'import' | 'clear'

/** A draft-losing action waiting for the owner to confirm. */
type PendingAction =
  | { readonly kind: 'select'; readonly id: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'import' }
  | { readonly kind: 'cancel' }

/** A blank draft for a persona the owner is about to write. */
function blankEditor(): PersonaEditor {
  return { sourceId: null, name: '', body: '', savedId: null, savedBody: '', savedName: '' }
}

/** A draft opened from one stored preset, already at its saved state. */
function presetEditor(persona: FishPersonaCandidate): PersonaEditor {
  return {
    sourceId: persona.id, name: persona.name, body: persona.body,
    savedId: persona.id, savedBody: persona.body, savedName: persona.name,
  }
}

/** Whether the draft differs from what the library currently holds for it. */
function isDirty(editor: PersonaEditor): boolean {
  return editor.savedId === null || editor.body !== editor.savedBody || editor.name !== editor.savedName
}

/**
 * Render the persona page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the active persona, the preset library, the editor, import, and the A/B preview.
 */
export function FishPersonasPage({ call, t, reportRefresh }: FishPageProps): ReactNode {
  const [current, setCurrent] = useState<FishPersonaCurrent | null>(null)
  const [presets, setPresets] = useState<readonly FishPersonaCandidate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<PersonaEditor | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState('')
  const [importText, setImportText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [failure, setFailure] = useState<PageFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [preview, setPreview] = useState<FishPersonaPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  // A late reply from an older read must not replace the newer list or active
  // record. The editor is never written by a read at all.
  const loadEpoch = useRef(0)

  /** Re-read the active persona and the preset library. */
  const load = useCallback(async (): Promise<void> => {
    const epoch = ++loadEpoch.current
    setLoading(true)
    try {
      const liveReply = await call('personas.current')
      if (epoch !== loadEpoch.current) return
      const liveFailed = failureOf(liveReply)
      if (liveFailed !== null) {
        setFailure({ message: liveFailed.message, where: 'load' })
        return
      }
      const live = parsePersonaCurrent(liveReply.ok ? liveReply.value : undefined)
      if (!live.ok) {
        setFailure({ message: live.failure.message, where: 'load' })
        return
      }
      const listReply = await call('personas.list')
      if (epoch !== loadEpoch.current) return
      const listFailed = failureOf(listReply)
      if (listFailed !== null) {
        setFailure({ message: listFailed.message, where: 'load' })
        return
      }
      const list = parsePersonas(listReply.ok ? listReply.value : undefined)
      if (!list.ok) {
        setFailure({ message: list.failure.message, where: 'load' })
        return
      }
      setCurrent(live.value)
      setPresets(list.value)
      // Only clear a selection the library no longer has; a newer selection
      // made while the read was in flight stays untouched.
      setSelectedId(previous => previous !== null && previous !== live.value.revision
        && !list.value.some(persona => persona.id === previous) ? null : previous)
      setFailure(previous => previous?.where === 'load' ? null : previous)
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'load' })
    } finally {
      if (epoch === loadEpoch.current) setLoading(false)
    }
  }, [call])

  useEffect(() => {
    void load()
    return () => { loadEpoch.current += 1 }
  }, [load])

  /** The active persona as a preset-shaped object, for the read view. */
  const activeCandidate: FishPersonaCandidate | null = current === null ? null : {
    id: current.revision, name: current.name, body: current.body,
  }
  const activeRevision = current?.revision ?? ''
  const selected = selectedId === null ? null : presets.find(persona => persona.id === selectedId) ?? null
  const viewed = selected ?? activeCandidate
  const viewedIsActive = viewed !== null && viewed.id === activeRevision
  const dirty = editor !== null && isDirty(editor)
  const savedClean = editor !== null && editor.savedId !== null && !dirty
  const retryingApply = savedClean && failure?.where === 'editor'

  /** Show the read view for one preset, discarding a clean editor if needed. */
  const finishSelect = (id: string): void => {
    setEditor(null)
    setImportOpen(false)
    setSelectedId(id)
    setFailure(null)
    setNotice(null)
  }

  /** Run an action now, or ask first when it would drop an unsaved draft. */
  const guarded = (action: PendingAction, run: () => void): void => {
    if (busy !== null) return
    if (editor !== null && isDirty(editor)) {
      setPending(action)
      return
    }
    run()
  }

  /** Select one preset from the library. */
  const selectPreset = (id: string): void => {
    if (id === selectedId && editor === null) return
    guarded({ kind: 'select', id }, () => { finishSelect(id) })
  }

  /** Open a blank draft for a new persona. */
  const startNew = (): void => {
    guarded({ kind: 'new' }, () => {
      setEditor(blankEditor())
      setImportOpen(false)
      setSelectedId(null)
      setFailure(null)
      setNotice(null)
    })
  }

  /** Open the import form without leaving its pasted text behind. */
  const openImport = (): void => {
    guarded({ kind: 'import' }, () => {
      setEditor(null)
      setImportOpen(true)
      setFailure(null)
      setNotice(null)
    })
  }

  /** Open the editor for one stored preset. */
  const editPersona = (persona: FishPersonaCandidate): void => {
    if (busy !== null) return
    setEditor(presetEditor(persona))
    setImportOpen(false)
    setSelectedId(persona.id)
    setPending(null)
    setFailure(null)
    setNotice(null)
  }

  /** Leave the editor; an unsaved draft asks first. */
  const cancelEdit = (): void => {
    if (editor === null) return
    guarded({ kind: 'cancel' }, () => {
      setEditor(null)
      setPending(null)
      setFailure(null)
    })
  }

  /** Apply the owner's confirmation of a draft-losing action. */
  const confirmPending = (): void => {
    if (pending === null) return
    const action = pending
    setPending(null)
    setFailure(null)
    setNotice(null)
    if (action.kind === 'select') {
      finishSelect(action.id)
    } else if (action.kind === 'new') {
      setEditor(blankEditor())
      setImportOpen(false)
    } else if (action.kind === 'import') {
      setEditor(null)
      setImportOpen(true)
    } else {
      setEditor(null)
      setImportOpen(false)
    }
  }

  /**
   * Store the draft through the workbench, then keep its stored text.
   * @param draft - the draft captured when the owner pressed the button.
   * @returns the stored record, or null when it was not stored.
   */
  const storeDraft = async (draft: PersonaEditor): Promise<FishPersonaRecord | null> => {
    const name = draft.name.trim()
    const body = draft.body.trim()
    if (name === '' || body === '') {
      setFailure({ message: t('personas.needNameBody'), where: 'editor' })
      return null
    }
    // A new persona goes through create (which validates name/body); an existing
    // preset saves another version under the same library.
    const action = draft.sourceId === null ? 'personas.create' : 'personas.save'
    const reply = await call(action, { name, body })
    const failed = failureOf(reply)
    if (failed !== null) {
      setFailure({ message: failed.message, where: 'editor' })
      return null
    }
    const parsed = parsePersonaRecord(reply.ok ? reply.value : undefined, action)
    if (!parsed.ok) {
      setFailure({ message: parsed.failure.message, where: 'editor' })
      return null
    }
    const record = parsed.value
    // Keep the server's stored text, not the previous copy. Identity check
    // protects a newer draft if one ever replaced this editor mid-flight.
    setEditor(opened => opened === draft ? {
      ...opened,
      sourceId: record.id,
      name: record.name,
      body: record.body,
      savedId: record.id,
      savedBody: record.body,
      savedName: record.name,
    } : opened)
    return record
  }

  /**
   * Apply one stored revision and re-read the active record.
   * @param revision - stored revision id.
   * @param name - name to report when the reply names no persona.
   * @param where - form area that shows a failure.
   * @returns the failure text, or null when the revision is now active.
   */
  const applyNow = async (revision: string, name: string, where: 'editor' | 'list'): Promise<string | null> => {
    const reply = await call('personas.apply', { revision })
    const failed = failureOf(reply)
    if (failed !== null) {
      setFailure({ message: failed.message, where })
      return failed.message
    }
    const applied = parsePersonaApplied(reply.ok ? reply.value : undefined)
    if (!applied.ok) {
      setFailure({ message: applied.failure.message, where })
      return applied.failure.message
    }
    if (!applied.value.ok) {
      const message = applied.value.message ?? t('personas.applyRefused')
      setFailure({ message, where })
      return message
    }
    const appliedRevision = applied.value.revision !== undefined ? String(applied.value.revision) : revision
    const appliedName = applied.value.persona?.name ?? name
    const receipt = t('personas.applied', { name: appliedName })
    setEditor(null)
    setImportOpen(false)
    setPending(null)
    setSelectedId(appliedRevision)
    setFailure(null)
    setNotice(receipt)
    await reportRefresh(receipt)
    await load()
    return null
  }

  /** Store the edited draft only; the active persona does not change. */
  const saveOnly = async (): Promise<void> => {
    if (editor === null || busy !== null) return
    setBusy('save')
    setFailure(null)
    setNotice(null)
    try {
      const saved = await storeDraft(editor)
      if (saved === null) return
      setSelectedId(saved.id)
      setNotice(t('personas.savedOnly', { name: saved.name }))
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'editor' })
    } finally {
      setBusy(null)
    }
  }

  /**
   * Store the edited draft, then apply the stored revision. A saved draft is
   * applied directly, so a retry after a failed apply does not save twice.
   */
  const saveAndApply = async (): Promise<void> => {
    if (editor === null || busy !== null) return
    setBusy('apply')
    setFailure(null)
    setNotice(null)
    try {
      let revision = editor.savedId
      let name = editor.name
      let savedNow = false
      if (isDirty(editor) || revision === null) {
        const saved = await storeDraft(editor)
        if (saved === null) return
        revision = saved.id
        name = saved.name
        savedNow = true
        setSelectedId(saved.id)
      }
      const applied = await applyNow(revision, name, 'editor')
      if (applied !== null && savedNow) {
        // Partial result: the save landed, only the apply failed. Keep the saved
        // revision and say explicitly that retrying will not save again.
        setFailure({
          message: t('personas.applyFailedSaved', { error: applied }), where: 'editor',
        })
      }
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'editor' })
    } finally {
      setBusy(null)
    }
  }

  /** Apply one existing preset from the read view. */
  const applyPreset = async (persona: FishPersonaCandidate): Promise<void> => {
    if (busy !== null || persona.id === activeRevision) return
    setBusy('preset')
    setFailure(null)
    setNotice(null)
    try {
      await applyNow(persona.id, persona.name, 'list')
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'list' })
    } finally {
      setBusy(null)
    }
  }

  /** Import pasted Markdown/AstrBot JSON/MaiBot TOML as presets; never applies. */
  const runImport = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy !== null) return
    const text = importText.trim()
    if (text === '') {
      setFailure({ message: t('personas.importEmpty'), where: 'import' })
      return
    }
    setBusy('import')
    setFailure(null)
    setNotice(null)
    try {
      const params: Record<string, unknown> = { text }
      const name = importName.trim()
      if (name !== '') params.name = name
      const reply = await call('personas.import', params)
      const failed = failureOf(reply)
      if (failed !== null) {
        setFailure({ message: failed.message, where: 'import' })
        return
      }
      const parsed = parsePersonaCandidates(reply.ok ? reply.value : undefined)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'import' })
        return
      }
      const imported = parsed.value
      setNotice(t('personas.imported', {
        count: imported.length, names: imported.map(persona => persona.name).join('、'),
      }))
      setImportText('')
      setImportName('')
      setImportOpen(false)
      setEditor(null)
      const first = imported[0]
      if (first !== undefined) setSelectedId(first.id)
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'import' })
    } finally {
      setBusy(null)
    }
  }

  /**
   * Delete every persona except the active one. The workbench backs up the
   * archive under backups/ first and keeps the revisions a window still uses.
   */
  const clearVersions = async (): Promise<void> => {
    if (busy !== null) return
    setBusy('clear')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('personas.clear', {})
      const failed = failureOf(reply)
      if (failed !== null) {
        setFailure({ message: failed.message, where: 'list' })
        return
      }
      const parsed = parsePersonasCleared(reply.ok ? reply.value : undefined)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'list' })
        return
      }
      const receipt = [
        t('personas.cleared', { backup: parsed.value.backup, deleted: String(parsed.value.deleted) }),
        parsed.value.protected.length === 0 ? '' : t('personas.clearKept', { count: String(parsed.value.protected.length) }),
      ].filter(part => part !== '').join(' ')
      setNotice(receipt)
      setSelectedId(null)
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'list' })
    } finally {
      setBusy(null)
    }
  }

  /** Answer the same line twice: as the active persona and as the version before it. */
  const runPreview = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const text = previewText.trim()
    if (text === '') return
    setPreviewing(true)
    setPreview(null)
    try {
      const reply = await call('personas.preview', { text })
      const failed = failureOf(reply)
      if (failed !== null) {
        setFailure({ message: failed.message, where: 'preview' })
        return
      }
      const parsed = parsePersonaPreview(reply.ok ? reply.value : undefined)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'preview' })
        return
      }
      setPreview(parsed.value)
      setFailure(previous => previous?.where === 'preview' ? null : previous)
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'preview' })
    } finally {
      setPreviewing(false)
    }
  }

  const primaryLabel = savedClean
    ? (retryingApply ? t('personas.retryApply') : t('personas.applySaved'))
    : t('personas.saveAndApply')
  const formDisabled = busy !== null

  return (
    <div className={css.split} aria-label={t('pages.personas')}>
      <div className={css.listColumn}>
        <div className={css.columnHead}>
          <h2 className={css.sectionTitle}>{t('pages.personas')}</h2>
          <div className={css.headActions}>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconRefreshOutlineRegular size={14} />}
              aria-label={t('refresh')}
              title={t('refresh')}
              disabled={loading || busy !== null}
              onClick={() => { void load() }}
            />
          </div>
        </div>
        <div className={css.activeSummary}>
          <span className={css.label}>{t('personas.currentTitle')}</span>
          <span className={css.activeName}>{current?.name ?? t('personas.loading')}</span>
          {current !== null && <span className={css.personaVersion}>
            {t('personas.version', { revision: shortRevision(current.revision) })}
          </span>}
        </div>
        <PageHint
          label={t('common.help')}
          items={[t('personas.currentHint'), t('personas.saveHint'), t('personas.importHint'), t('personas.previewNote')]}
        />
        <div className={css.listTools}>
          <Button size="md" variant="outline" icon={<IconPlusOutlineRegular size={16} />}
            disabled={formDisabled} onClick={startNew}>
            {t('personas.new')}
          </Button>
          <Button size="md" variant="outline" disabled={formDisabled} onClick={openImport}>
            {t('personas.import')}
          </Button>
          <span className={clsx(css.rowMeta, css.listCount)}>
            {t('personas.presetCount', { count: presets.length })}
          </span>
        </div>
        {failure?.where === 'load' && <p className={css.inlineError} role="alert">
          <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
        </p>}
        <div className={css.scrollArea}>
          {presets.length === 0 && !loading && <p className={css.muted}>{t('personas.presetEmpty')}</p>}
          <ul className={css.rows}>
            {presets.map((persona) => {
              const isActive = persona.id === activeRevision
              const isSelected = persona.id === selectedId
              return (
                <li key={persona.id}>
                  <button
                    type="button"
                    className={clsx(css.row, isSelected && css.rowSelected)}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => { selectPreset(persona.id) }}
                  >
                    <span className={css.rowTitle}>{persona.name}</span>
                    <span className={css.rowMeta}>
                      {isActive && <Tag tone="success">{t('personas.usedNow')}</Tag>}
                      <span className={css.personaVersion}>{shortRevision(persona.id)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <div className={css.section}>
          <Button size="sm" variant="outline" icon={<IconTrashOutlineRegular size={14} />}
            disabled={formDisabled || current === null} onClick={() => { void clearVersions() }}>
            {busy === 'clear' ? t('personas.clearing') : t('personas.clear')}
          </Button>
          <p className={css.hint}>{t('personas.clearHint')}</p>
        </div>
        {notice !== null && <p className={css.inlineNotice} role="status">{notice}</p>}
      </div>

      <div className={css.detailColumn}>
        {editor !== null ? <section className={css.personaCard} aria-label={t('personas.edit')}>
          <div className={css.detailHead}>
            <div className={css.section}>
              <span className={css.label}>
                {editor.sourceId === null ? t('personas.create') : t('personas.edit')}
              </span>
              <h3 className={css.personaName}>
                {editor.sourceId === null ? t('personas.create') : editor.name}
              </h3>
              {editor.sourceId !== null && <span className={css.personaVersion}>
                {t('personas.version', { revision: shortRevision(editor.sourceId) })}
              </span>}
            </div>
            <Button size="sm" variant="ghost" disabled={formDisabled} onClick={cancelEdit}>
              {t('personas.cancelEdit')}
            </Button>
          </div>
          {editor.sourceId === null && <label className={css.field}>
            <span className={css.label}>{t('personas.createName')}</span>
            <Input
              value={editor.name}
              aria-label={t('personas.createName')}
              placeholder={t('personas.createNamePlaceholder')}
              disabled={formDisabled}
              onChange={(event) => {
                const value = event.target.value
                setEditor(opened => opened === null ? opened : { ...opened, name: value })
              }}
            />
          </label>}
          <label className={css.field}>
            <span className={css.label}>{t('personas.body')}</span>
            <textarea
              className={css.textarea}
              rows={12}
              value={editor.body}
              aria-label={t('personas.body')}
              placeholder={t('personas.bodyPlaceholder')}
              disabled={formDisabled}
              onChange={(event) => {
                const value = event.target.value
                setEditor(opened => opened === null ? opened : { ...opened, body: value })
              }}
            />
          </label>
          <p className={css.stageLine}>
            <Tag tone={dirty ? 'warning' : 'success'}>
              {dirty ? t('personas.dirtyStage') : t('personas.savedStage')}
            </Tag>
            {editor.savedId !== null && <span className={css.personaVersion}>
              {t('personas.savedVersion', { revision: shortRevision(editor.savedId) })}
            </span>}
            <span>{t('personas.saveHint')}</span>
          </p>
          {pending !== null && <div className={css.prompt} role="alert">
            <span>{t('personas.discardPrompt')}</span>
            <div className={css.promptActions}>
              <Button size="sm" variant="outline" onClick={() => { setPending(null) }}>
                {t('personas.keepEditing')}
              </Button>
              <Button size="sm" variant="primary" onClick={confirmPending}>
                {t('personas.discardContinue')}
              </Button>
            </div>
          </div>}
          {failure?.where === 'editor' && <p className={css.inlineError} role="alert">
            <IconWarningOutlineRegular size={14} />{failure.message}
          </p>}
          <div className={css.formActions}>
            <Button size="md" variant="outline"
              disabled={formDisabled || !dirty}
              onClick={() => { void saveOnly() }}>
              {busy === 'save' ? t('personas.saving') : t('personas.saveOnly')}
            </Button>
            <Button size="md" variant="primary" icon={<IconCheckCircleFillRegular size={16} />}
              disabled={formDisabled}
              onClick={() => { void saveAndApply() }}>
              {busy === 'apply' ? t('personas.applying') : primaryLabel}
            </Button>
          </div>
        </section> : importOpen ? <section className={css.personaCard} aria-label={t('personas.import')}>
          <div className={css.detailHead}>
            <div className={css.section}>
              <span className={css.label}>{t('personas.import')}</span>
              <h3 className={css.personaName}>{t('personas.import')}</h3>
            </div>
            <Button size="sm" variant="ghost" disabled={formDisabled} onClick={() => { setImportOpen(false) }}>
              {t('cancel')}
            </Button>
          </div>
          <p className={css.hint}>{t('personas.importHint')}</p>
          <form className={css.form} onSubmit={(event) => { void runImport(event) }}>
            <label className={css.field}>
              <span className={css.label}>{t('personas.importName')}</span>
              <Input
                value={importName}
                aria-label={t('personas.importName')}
                placeholder={t('personas.importNamePlaceholder')}
                disabled={formDisabled}
                onChange={(event) => { setImportName(event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.label}>{t('personas.importText')}</span>
              <textarea
                className={css.textarea}
                rows={10}
                value={importText}
                aria-label={t('personas.importText')}
                placeholder={t('personas.importTextPlaceholder')}
                disabled={formDisabled}
                onChange={(event) => { setImportText(event.target.value) }}
              />
            </label>
            {failure?.where === 'import' && <p className={css.inlineError} role="alert">
              <IconWarningOutlineRegular size={14} />{failure.message}
            </p>}
            <div className={css.formActions}>
              <Button type="submit" size="md" variant="primary" disabled={formDisabled}>
                {busy === 'import' ? t('personas.importing') : t('personas.importRun')}
              </Button>
            </div>
          </form>
        </section> : viewed !== null ? <section className={css.personaCard} aria-label={t('personas.presetTitle')}>
          <div className={css.detailHead}>
            <div className={css.section}>
              <span className={css.label}>
                {viewedIsActive ? t('personas.currentTitle') : t('personas.presetTitle')}
              </span>
              <h3 className={css.personaName}>{viewed.name}</h3>
              <p className={css.stageLine}>
                {viewedIsActive && <Tag tone="success">{t('personas.usedNow')}</Tag>}
                <span className={css.personaVersion}>
                  {t('personas.version', { revision: shortRevision(viewed.id) })}
                </span>
                {viewed.source !== undefined && viewed.source !== '' && <span>
                  {t('personas.source', { source: viewed.source })}
                </span>}
              </p>
            </div>
            <div className={css.detailActions}>
              <Button size="md" variant="outline" icon={<IconEditOutlineRegular size={16} />}
                disabled={formDisabled} onClick={() => { editPersona(viewed) }}>
                {t('personas.edit')}
              </Button>
              {!viewedIsActive && <Button size="md" variant="primary" disabled={formDisabled}
                onClick={() => { void applyPreset(viewed) }}>
                {busy === 'preset' ? t('personas.applying') : t('personas.useThis')}
              </Button>}
            </div>
          </div>
          {viewedIsActive && <p className={css.hint}>{t('personas.activeNextTurn')}</p>}
          {failure?.where === 'list' && <p className={css.inlineError} role="alert">
            <IconWarningOutlineRegular size={14} />{failure.message}
          </p>}
          <div className={css.personaBody}>
            {viewed.body === '' ? <span className={css.muted}>{t('personas.bodyEmpty')}</span> : viewed.body}
          </div>
        </section> : <p className={css.muted} role="status">
          {loading ? t('personas.loading') : t('personas.presetEmpty')}
        </p>}

        {editor === null && !importOpen && <>
          <section className={css.section} aria-label={t('personas.preview')}>
            <h3 className={css.sectionTitle}>{t('personas.preview')}</h3>
            <p className={css.hint}>{t('personas.previewNote')}</p>
            <form className={css.searchRow} onSubmit={(event) => { void runPreview(event) }}>
              <Input
                className={css.grow ?? ''}
                value={previewText}
                aria-label={t('personas.previewInput')}
                placeholder={t('personas.previewPlaceholder')}
                onChange={(event) => { setPreviewText(event.target.value) }}
              />
              <Button type="submit" size="md" variant="primary" disabled={previewing || previewText.trim() === ''}>
                {previewing ? t('personas.previewing') : t('personas.previewRun')}
              </Button>
            </form>
            <p className={css.hint}>{t('personas.previewCost', { count: preview?.model_calls ?? 2 })}</p>
            {failure?.where === 'preview' && <p className={css.inlineError} role="alert">
              <IconWarningOutlineRegular size={14} />{failure.message}
            </p>}
            {preview !== null && <div className={css.abGrid}>
              {preview.results.map((side, index) => (
                <article key={side.revision + String(index)} className={css.abCard}>
                  <header className={css.cardHead}>
                    <h4 className={css.cardTitle}>
                      {t(index === 0 ? 'personas.previewLeft' : 'personas.previewRight', { name: side.name })}
                    </h4>
                    <span className={css.rowMeta}>{t('personas.elapsed', { ms: side.elapsed_ms })}</span>
                  </header>
                  {side.error !== undefined
                    ? <p className={css.inlineError}>{side.error}</p>
                    : <p className={css.cardBody}>{side.text === undefined || side.text === '' ? t('personas.previewEmpty') : side.text}</p>}
                </article>
              ))}
            </div>}
          </section>
        </>}
      </div>
    </div>
  )
}
