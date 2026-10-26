/**
 * Skills: the owner's real procedure files under `data/skills`.
 *
 * Every row comes from `skills.list`; the body the agent would load comes from
 * `skills.read`, the same read `fish_skill_use` performs. Saving writes a real
 * `SKILL.md` through the backend, so enabling a skill is enough for the next
 * request's tool list — no backend reload is promised or needed, and a running
 * turn is unaffected. A skill is procedure material: the page repeats that it
 * never becomes identity or permission.
 *
 * Import has two real routes: a server path through `skills.import`, or a
 * pasted full SKILL.md whose frontmatter the page lifts before calling
 * `skills.save` (the workbench exposes no text-import action). Deletion removes
 * the folder and its registry entry; disabling only stops listing and loading.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, Checkbox, IconEditOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconTrashOutlineRegular, IconWarningOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishSkill, FishSkillEntry } from '../contract/workbench.ts'
import { parseSkillDeleted, parseSkillEntry, parseSkillRead, parseSkills } from '../parsers.ts'
import { splitSkillText } from '../skill-text.ts'
import type { FishPageProps } from '../page-props.ts'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One editable skill; `source` is null for a new skill. */
interface SkillDraft {
  readonly source: FishSkill | null
  readonly name: string
  readonly description: string
  readonly body: string
  /** Body last read from the backend, so an untouched editor is not dirty. */
  readonly savedBody: string
  /** Value sent with save; preserved for an existing skill, chosen for a new one. */
  readonly enabled: boolean
}

/** A blank draft for a skill the owner is about to write. */
function blankDraft(): SkillDraft {
  return { source: null, name: '', description: '', body: '', savedBody: '', enabled: true }
}

/** A draft opened from one enabled, already-read skill. */
function draftOf(skill: FishSkill, detail: FishSkillEntry): SkillDraft {
  return {
    source: skill, name: skill.name, description: detail.description,
    body: detail.body, savedBody: detail.body, enabled: skill.enabled,
  }
}

/** Whether the draft differs from what the library currently holds for it. */
function isDirty(draft: SkillDraft): boolean {
  const source = draft.source
  if (source === null) {
    return draft.name !== '' || draft.description !== '' || draft.body !== '' || !draft.enabled
  }
  return draft.name !== source.name || draft.description !== source.description || draft.body !== draft.savedBody
}

/** Where a failure belongs on the page. */
type FailureWhere = 'load' | 'detail' | 'editor' | 'import'

/** One failure next to the object that produced it. */
interface PageFailure {
  readonly message: string
  readonly where: FailureWhere
}

/** Work in flight; the matching controls stay disabled until it settles. */
type Busy = 'save' | 'toggle' | 'delete' | 'import'

/** A draft-losing action waiting for the owner to confirm. */
type PendingAction =
  | { readonly kind: 'select'; readonly name: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'import' }
  | { readonly kind: 'cancel' }

/**
 * Render the skills page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the real skill list, its editor/import forms, and the loaded body.
 */
export function FishSkillsPage({ call, t, formatTimestamp }: FishPageProps): ReactNode {
  const [skills, setSkills] = useState<readonly FishSkill[]>([])
  const [note, setNote] = useState('')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [detail, setDetail] = useState<FishSkillEntry | null>(null)
  const [editor, setEditor] = useState<SkillDraft | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importPath, setImportPath] = useState('')
  const [importText, setImportText] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [failure, setFailure] = useState<PageFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Late replies from an older list read or body read must not replace newer state.
  const loadEpoch = useRef(0)
  const readEpoch = useRef(0)

  /** Re-read the real skill folder; never touches an open draft. */
  const load = useCallback(async (): Promise<void> => {
    const epoch = ++loadEpoch.current
    setLoading(true)
    try {
      const reply = await call('skills.list')
      if (epoch !== loadEpoch.current) return
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'load' })
        return
      }
      const parsed = parseSkills(reply.value)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'load' })
        return
      }
      setSkills(parsed.value.skills)
      setNote(parsed.value.note)
      setSelectedName(previous => previous !== null && !parsed.value.skills.some(skill => skill.name === previous)
        ? null
        : previous)
      setFailure(previous => previous?.where === 'load' ? null : previous)
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'load' })
    } finally {
      if (epoch === loadEpoch.current) setLoading(false)
    }
  }, [call])

  useEffect(() => {
    void load()
    return () => {
      loadEpoch.current += 1
      readEpoch.current += 1
    }
  }, [load])

  /** Read one enabled skill's body through the same action the agent uses. */
  const read = useCallback(async (name: string): Promise<void> => {
    const epoch = ++readEpoch.current
    setReading(true)
    setDetail(null)
    try {
      const reply = await call('skills.read', { name })
      if (epoch !== readEpoch.current) return
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'detail' })
        return
      }
      const parsed = parseSkillRead(reply.value)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'detail' })
        return
      }
      setDetail(parsed.value)
      setFailure(previous => previous?.where === 'detail' ? null : previous)
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'detail' })
    } finally {
      if (epoch === readEpoch.current) setReading(false)
    }
  }, [call])

  const selected = selectedName === null ? null : skills.find(skill => skill.name === selectedName) ?? null

  /** Close the editor and show one skill, reading its body only when enabled. */
  const finishSelect = (skill: FishSkill): void => {
    readEpoch.current += 1
    setEditor(null)
    setImportOpen(false)
    setPending(null)
    setConfirming(null)
    setSelectedName(skill.name)
    setDetail(null)
    setFailure(null)
    setNotice(null)
    if (skill.enabled) void read(skill.name)
    else setReading(false)
  }

  /** Run a selection now, or ask first when it would drop an unsaved draft. */
  const guarded = (action: PendingAction, run: () => void): void => {
    if (busy !== null) return
    if (editor !== null && isDirty(editor)) {
      setPending(action)
      return
    }
    run()
  }

  /** Select one real skill row. */
  const selectSkill = (skill: FishSkill): void => {
    if (skill.name === selectedName && editor === null && !importOpen) {
      // A failed body read must stay retryable by pressing the same row again.
      if (skill.enabled && detail === null && !reading) void read(skill.name)
      return
    }
    guarded({ kind: 'select', name: skill.name }, () => { finishSelect(skill) })
  }

  /** Open a blank skill form. */
  const startNew = (): void => {
    guarded({ kind: 'new' }, () => {
      readEpoch.current += 1
      setEditor(blankDraft())
      setImportOpen(false)
      setSelectedName(null)
      setDetail(null)
      setPending(null)
      setConfirming(null)
      setFailure(null)
      setNotice(null)
    })
  }

  /** Open the import form without losing pasted text. */
  const openImport = (): void => {
    guarded({ kind: 'import' }, () => {
      readEpoch.current += 1
      setEditor(null)
      setImportOpen(true)
      setPending(null)
      setConfirming(null)
      setFailure(null)
      setNotice(null)
    })
  }

  /** Open one enabled, loaded skill in the editor. */
  const editSkill = (skill: FishSkill): void => {
    if (busy !== null || detail === null || !skill.enabled) return
    setEditor(draftOf(skill, detail))
    setImportOpen(false)
    setSelectedName(skill.name)
    setPending(null)
    setConfirming(null)
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
    readEpoch.current += 1
    if (action.kind === 'select') {
      const skill = skills.find(item => item.name === action.name)
      if (skill !== undefined) {
        setEditor(null)
        setImportOpen(false)
        setSelectedName(skill.name)
        setDetail(null)
        if (skill.enabled) void read(skill.name)
      }
    } else if (action.kind === 'new') {
      setEditor(blankDraft())
      setImportOpen(false)
      setSelectedName(null)
      setDetail(null)
    } else if (action.kind === 'import') {
      setEditor(null)
      setImportOpen(true)
      setSelectedName(null)
      setDetail(null)
    } else {
      setEditor(null)
    }
  }

  /**
   * Store one skill body through the real backend, then re-read it.
   * @param draft - the draft captured when the owner pressed save.
   * @param imported - true when this save is the pasted-SKILL.md import route.
   */
  const storeDraft = async (draft: SkillDraft, imported = false): Promise<void> => {
    const name = draft.name.trim()
    const description = draft.description.trim()
    if (name === '') {
      setFailure({ message: t('skills.needName'), where: imported ? 'import' : 'editor' })
      return
    }
    if (description === '') {
      setFailure({ message: t('skills.needDescription'), where: imported ? 'import' : 'editor' })
      return
    }
    if (draft.body.trim() === '') {
      setFailure({ message: t('skills.needBody'), where: imported ? 'import' : 'editor' })
      return
    }
    setBusy(imported ? 'import' : 'save')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('skills.save', {
        name, description, body: draft.body, enabled: draft.enabled,
      })
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: imported ? 'import' : 'editor' })
        return
      }
      const parsed = parseSkillEntry(reply.value, 'skills.save')
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: imported ? 'import' : 'editor' })
        return
      }
      const stored = parsed.value
      setNotice(draft.source === null
        ? t(imported ? 'skills.imported' : 'skills.created', { name: stored.name })
        : t('skills.saved', { name: stored.name }))
      setEditor(null)
      setImportOpen(false)
      setPending(null)
      setSelectedName(stored.name)
      setImportText('')
      setImportPath('')
      setDetail(null)
      await load()
      if (stored.enabled) await read(stored.name)
    } catch (error) {
      setFailure({ message: reasonOf(error), where: imported ? 'import' : 'editor' })
    } finally {
      setBusy(null)
    }
  }

  /** Save the form's draft. */
  const saveDraft = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (editor === null || busy !== null) return
    await storeDraft(editor)
  }

  /** Import a SKILL.md file or folder the Fish backend can read. */
  const importFromPath = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy !== null) return
    const path = importPath.trim()
    if (path === '') {
      setFailure({ message: t('skills.importBadPath'), where: 'import' })
      return
    }
    setBusy('import')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('skills.import', { path })
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'import' })
        return
      }
      const parsed = parseSkillEntry(reply.value, 'skills.import')
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'import' })
        return
      }
      const stored = parsed.value
      setNotice(t('skills.imported', { name: stored.name }))
      setImportPath('')
      setImportOpen(false)
      setSelectedName(stored.name)
      setDetail(null)
      await load()
      if (stored.enabled) await read(stored.name)
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'import' })
    } finally {
      setBusy(null)
    }
  }

  /** Import a pasted full SKILL.md through `skills.save` after lifting its header. */
  const importPasted = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy !== null) return
    const text = importText.trim()
    if (text === '') {
      setFailure({ message: t('skills.pasteNoHeader'), where: 'import' })
      return
    }
    const parsed = splitSkillText(text)
    if (!parsed.ok) {
      setFailure({
        message: parsed.reason === 'name'
          ? t('skills.pasteNoName')
          : parsed.reason === 'description'
            ? t('skills.pasteNoDescription')
            : t('skills.pasteNoHeader'),
        where: 'import',
      })
      return
    }
    await storeDraft({
      source: null, name: parsed.name, description: parsed.description,
      body: parsed.body, savedBody: '', enabled: true,
    }, true)
  }

  /** Enable or disable one real skill. */
  const toggle = async (skill: FishSkill, enabled: boolean): Promise<void> => {
    if (busy !== null) return
    setBusy('toggle')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('skills.enable', { name: skill.name, enabled })
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'detail' })
        return
      }
      setNotice(t(enabled ? 'skills.enabledNotice' : 'skills.disabledNotice', { name: skill.name }))
      await load()
      if (enabled) {
        await read(skill.name)
      } else {
        readEpoch.current += 1
        setDetail(null)
        setReading(false)
      }
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'detail' })
    } finally {
      setBusy(null)
    }
  }

  /** Delete one skill folder and its registry entry. */
  const remove = async (skill: FishSkill): Promise<void> => {
    if (busy !== null) return
    setBusy('delete')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('skills.delete', { name: skill.name })
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'detail' })
        return
      }
      const parsed = parseSkillDeleted(reply.value)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'detail' })
        return
      }
      setNotice(t('skills.deleted', { name: parsed.value.name }))
      setConfirming(null)
      setEditor(null)
      setSelectedName(null)
      setDetail(null)
      readEpoch.current += 1
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'detail' })
    } finally {
      setBusy(null)
    }
  }

  const formDisabled = busy !== null

  return (
    <div className={css.split} aria-label={t('pages.skills')}>
      <div className={css.listColumn}>
        <div className={css.columnHead}>
          <h2 className={css.sectionTitle}>{t('pages.skills')}</h2>
          <div className={css.headActions}>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconRefreshOutlineRegular size={14} />}
              aria-label={t('refresh')}
              title={t('refresh')}
              disabled={loading || formDisabled}
              onClick={() => { void load() }}
            />
          </div>
        </div>
        <PageHint
          label={t('common.help')}
          items={[
            t('skills.procedureHint'), t('skills.loadHint'),
            t('skills.disableHint'), t('skills.sourceHint'), t('skills.importHint'),
          ]}
        />
        <div className={css.listTools}>
          <Button size="md" variant="outline" icon={<IconPlusOutlineRegular size={16} />}
            disabled={formDisabled} onClick={startNew}>
            {t('skills.add')}
          </Button>
          <Button size="md" variant="outline" disabled={formDisabled} onClick={openImport}>
            {t('skills.import')}
          </Button>
          <span className={clsx(css.rowMeta, css.listCount)}>
            {t('skills.count', { count: skills.length })}
          </span>
        </div>
        {failure?.where === 'load' && <p className={css.inlineError} role="alert">
          <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
        </p>}
        <div className={css.scrollArea}>
          {skills.length === 0 && !loading && <p className={css.muted}>{t('skills.empty')}</p>}
          <ul className={css.rows}>
            {skills.map((skill) => {
              const isSelected = skill.name === selectedName
              return (
                <li key={skill.name}>
                  <button
                    type="button"
                    className={clsx(css.row, isSelected && css.rowSelected)}
                    aria-current={isSelected ? 'true' : undefined}
                    title={skill.description}
                    onClick={() => { selectSkill(skill) }}
                  >
                    <span className={css.rowTitle}>{skill.name}</span>
                    <span className={css.rowMeta}>
                      <Tag tone={skill.enabled ? 'success' : 'neutral'}>
                        {t(skill.enabled ? 'skills.enabledNow' : 'skills.disabledNow')}
                      </Tag>
                      <span>{t('skills.chars', { chars: skill.chars })}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        {note !== '' && <p className={css.muted}>{t('skills.note', { note })}</p>}
        {notice !== null && <p className={css.inlineNotice} role="status">{notice}</p>}
      </div>

      <div className={css.detailColumn}>
        {editor !== null ? <section className={css.personaCard} aria-label={t('skills.add')}>
          <div className={css.detailHead}>
            <div className={css.section}>
              <span className={css.label}>{editor.source === null ? t('skills.add') : t('skills.edit')}</span>
              <h3 className={css.personaName}>
                {editor.source === null ? t('skills.add') : editor.name}
              </h3>
              {editor.source !== null && <span className={css.personaVersion}>{editor.source.name}</span>}
            </div>
            <Button size="sm" variant="ghost" disabled={formDisabled} onClick={cancelEdit}>
              {t('cancel')}
            </Button>
          </div>
          {pending !== null && <div className={css.prompt} role="alert">
            <span>{t('skills.unsaved')}</span>
            <div className={css.promptActions}>
              <Button size="sm" variant="outline" onClick={() => { setPending(null) }}>{t('skills.keepEditing')}</Button>
              <Button size="sm" variant="primary" onClick={confirmPending}>{t('skills.discard')}</Button>
            </div>
          </div>}
          <form className={css.form} onSubmit={(event) => { void saveDraft(event) }}>
            <label className={css.field}>
              <span className={css.label}>{t('skills.name')}</span>
              <Input
                value={editor.name}
                aria-label={t('skills.name')}
                placeholder={t('skills.namePlaceholder')}
                disabled={formDisabled || editor.source !== null}
                onChange={(event) => {
                  const value = event.target.value
                  setEditor(current => current === null ? current : { ...current, name: value })
                }}
              />
              <span className={css.hint}>{t('skills.nameHint')}</span>
            </label>
            <label className={css.field}>
              <span className={css.label}>{t('skills.description')}</span>
              <Input
                value={editor.description}
                aria-label={t('skills.description')}
                placeholder={t('skills.descriptionPlaceholder')}
                disabled={formDisabled}
                onChange={(event) => {
                  const value = event.target.value
                  setEditor(current => current === null ? current : { ...current, description: value })
                }}
              />
              <span className={css.hint}>{t('skills.descriptionHint')}</span>
            </label>
            <label className={css.field}>
              <span className={css.label}>{t('skills.body')}</span>
              <textarea
                className={css.textarea}
                rows={14}
                value={editor.body}
                aria-label={t('skills.body')}
                placeholder={t('skills.bodyPlaceholder')}
                disabled={formDisabled}
                onChange={(event) => {
                  const value = event.target.value
                  setEditor(current => current === null ? current : { ...current, body: value })
                }}
              />
              <span className={css.hint}>{t('skills.bodyHint')}</span>
            </label>
            {editor.source === null && <Checkbox
              checked={editor.enabled}
              label={t('skills.enabledOnSave')}
              disabled={formDisabled}
              onChange={(value) => {
                setEditor(current => current === null ? current : { ...current, enabled: value })
              }}
            />}
            {failure?.where === 'editor' && <p className={css.inlineError} role="alert">
              <IconWarningOutlineRegular size={14} />{failure.message}
            </p>}
            <div className={css.formActions}>
              <Button type="submit" size="md" variant="primary" disabled={formDisabled}>
                {busy === 'save' ? t('skills.saving') : t('skills.save')}
              </Button>
            </div>
          </form>
        </section> : importOpen ? <section className={css.personaCard} aria-label={t('skills.importPanel')}>
          <div className={css.detailHead}>
            <div className={css.section}>
              <span className={css.label}>{t('skills.importPanel')}</span>
              <h3 className={css.personaName}>{t('skills.importPanel')}</h3>
            </div>
            <Button size="sm" variant="ghost" disabled={formDisabled} onClick={() => { setImportOpen(false) }}>
              {t('cancel')}
            </Button>
          </div>
          <form className={css.form} onSubmit={(event) => { void importFromPath(event) }}>
            <label className={css.field}>
              <span className={css.label}>{t('skills.importPath')}</span>
              <Input
                value={importPath}
                aria-label={t('skills.importPath')}
                placeholder={t('skills.importPathPlaceholder')}
                disabled={formDisabled}
                onChange={(event) => { setImportPath(event.target.value) }}
              />
              <span className={css.hint}>{t('skills.importPathHint')}</span>
            </label>
            <div className={css.formActions}>
              <Button type="submit" size="md" variant="primary" disabled={formDisabled}>
                {busy === 'import' ? t('skills.importing') : t('skills.importRun')}
              </Button>
            </div>
          </form>
          <form className={css.form} onSubmit={(event) => { void importPasted(event) }}>
            <label className={css.field}>
              <span className={css.label}>{t('skills.paste')}</span>
              <textarea
                className={css.textarea}
                rows={10}
                value={importText}
                aria-label={t('skills.paste')}
                placeholder={t('skills.pastePlaceholder')}
                disabled={formDisabled}
                onChange={(event) => { setImportText(event.target.value) }}
              />
              <span className={css.hint}>{t('skills.pasteHint')}</span>
            </label>
            {failure?.where === 'import' && <p className={css.inlineError} role="alert">
              <IconWarningOutlineRegular size={14} />{failure.message}
            </p>}
            <div className={css.formActions}>
              <Button type="submit" size="md" variant="outline" disabled={formDisabled}>
                {busy === 'import' ? t('skills.importing') : t('skills.pasteRun')}
              </Button>
            </div>
          </form>
        </section> : selected !== null ? <section className={css.personaCard} aria-label={t('pages.skills')}>
          <div className={css.detailHead}>
            <div className={css.section}>
              <span className={css.label}>{t('pages.skills')}</span>
              <h3 className={css.personaName}>{selected.name}</h3>
              <p className={css.stageLine}>
                <Tag tone={selected.enabled ? 'success' : 'neutral'}>
                  {t(selected.enabled ? 'skills.enabledNow' : 'skills.disabledNow')}
                </Tag>
                <span>{t('skills.chars', { chars: selected.chars })}</span>
                {selected.updated !== null && <span>{t('skills.updated', { time: formatTimestamp(selected.updated) })}</span>}
              </p>
            </div>
            <div className={css.detailActions}>
              <Button size="md" variant="outline" icon={<IconEditOutlineRegular size={16} />}
                disabled={formDisabled || !selected.enabled || detail === null}
                title={selected.enabled ? undefined : t('skills.enableFirst')}
                onClick={() => { editSkill(selected) }}>
                {t('skills.edit')}
              </Button>
              <Button size="md" variant={selected.enabled ? 'outline' : 'primary'}
                disabled={formDisabled} onClick={() => { void toggle(selected, !selected.enabled) }}>
                {busy === 'toggle'
                  ? t('skills.saving')
                  : t(selected.enabled ? 'skills.disable' : 'skills.enable')}
              </Button>
              <Button size="md" variant="outline" icon={<IconTrashOutlineRegular size={16} />}
                disabled={formDisabled} onClick={() => { setConfirming(selected.name) }}>
                {t('skills.delete')}
              </Button>
            </div>
          </div>
          <dl className={css.facts}>
            <dt>{t('skills.description')}</dt>
            <dd>{selected.description === '' ? t('common.nothing') : selected.description}</dd>
            <dt>{t('skills.path')}</dt>
            <dd>{selected.path === '' ? t('common.nothing') : selected.path}</dd>
            <dt>{t('skills.chars')}</dt>
            <dd>{selected.chars}</dd>
            {selected.updated !== null && <>
              <dt>{t('skills.updatedLabel')}</dt>
              <dd>{formatTimestamp(selected.updated)}</dd>
            </>}
          </dl>
          {confirming === selected.name && <div className={css.prompt} role="alert">
            <span>{t('skills.deleteConfirm', { name: selected.name })}</span>
            <div className={css.promptActions}>
              <Button size="sm" variant="outline" onClick={() => { setConfirming(null) }}>{t('cancel')}</Button>
              <Button size="sm" variant="primary" onClick={() => { void remove(selected) }}>
                {busy === 'delete' ? t('skills.deleting') : t('skills.deleteYes')}
              </Button>
            </div>
          </div>}
          {failure?.where === 'detail' && <p className={css.inlineError} role="alert">
            <IconWarningOutlineRegular size={14} />{failure.message}
          </p>}
          {!selected.enabled && <>
            <p className={css.muted}>{t('skills.disabledBody')}</p>
            <p className={css.hint}>{t('skills.enableFirst')}</p>
          </>}
          {selected.enabled && reading && <p className={css.muted} role="status">{t('skills.loading')}</p>}
          {selected.enabled && !reading && detail !== null && <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('skills.bodyTitle')}</h3>
            <div className={css.personaBody}>
              {detail.body === '' ? t('common.nothing') : detail.body}
            </div>
            {detail.note !== '' && <p className={css.hint}>{t('skills.note', { note: detail.note })}</p>}
          </section>}
        </section> : <p className={css.muted} role="status">
          {loading ? t('skills.loading') : t('skills.select')}
        </p>}
      </div>
    </div>
  )
}
