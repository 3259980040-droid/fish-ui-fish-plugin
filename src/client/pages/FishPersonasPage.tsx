/** Active Agent persona and saved presets. Saving and applying are separate actions. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular,
  Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type { FishPersonaCandidate, FishPersonaCurrent, FishPersonaPreview, FishPersonaRecord } from '../contract/workbench.ts'
import {
  parsePersonaApplied, parsePersonaCurrent, parsePersonaPreview, parsePersonaRecord, parsePersonasCleared, parsePersonas,
} from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** Failure text of a settled reply, or null when it succeeded. */
function failureText<T>(result: FishResult<T>): FishFailure | null {
  return result.ok ? null : result.failure
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render the persona page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the live persona, its collapsed drawer, the new-persona form, and the A/B preview.
 */
export function FishPersonasPage({ call, t, reportRefresh }: FishPageProps): ReactNode {
  const [current, setCurrent] = useState<FishPersonaCurrent | null>(null)
  const [body, setBody] = useState('')
  const [presets, setPresets] = useState<readonly FishPersonaCandidate[]>([])
  const [saving, setSaving] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createBody, setCreateBody] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<FishPersonaRecord | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [preview, setPreview] = useState<FishPersonaPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)

  /** Re-read the persona in force. */
  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const liveReply = await call('personas.current')
      const liveFailed = failureText(liveReply)
      if (liveFailed !== null) {
        setFailure(liveFailed)
        return
      }
      const live = parsePersonaCurrent(liveReply.ok ? liveReply.value : undefined)
      if (!live.ok) {
        setFailure(live.failure)
        return
      }
      setCurrent(live.value)
      setBody(live.value.body)
      const listReply = await call('personas.list')
      if (!listReply.ok) {
        setFailure(listReply.failure)
        return
      }
      const list = parsePersonas(listReply.value)
      if (!list.ok) {
        setFailure(list.failure)
        return
      }
      setPresets(list.value)
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        await load()
      } catch (error) {
        // Swallows an unexpected throw: the page reports it instead of rejecting silently.
        if (live) setFailure({ message: reasonOf(error), offline: false })
      }
    })()
    return () => { live = false }
    // The first read runs once for the page's life; later reads follow a write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Select the Agent's next-turn persona without changing its records or identity.
   * @param revision - the persona revision to apply.
   * @param name - its name, for the receipt when the reply omits one.
   * @returns whether the switch happened.
   */
  const applyRevision = async (revision: string, name: string): Promise<boolean> => {
    const reply = await call('personas.apply', { revision })
    const failed = failureText(reply)
    if (failed !== null) {
      setFailure(failed)
      return false
    }
    const applied = parsePersonaApplied(reply.ok ? reply.value : undefined)
    if (!applied.ok) {
      setFailure(applied.failure)
      return false
    }
    if (!applied.value.ok) {
      setFailure({ message: applied.value.message ?? t('personas.applied', { name }), offline: false })
      return false
    }
    const receipt = t('personas.applied', { name: applied.value.persona?.name ?? name })
    setFailure(null)
    setNotice(receipt)
    await reportRefresh(receipt)
    await load()
    return true
  }

  /** Saving preserves a reusable preset without changing the active persona. */
  const saveDraft = async (): Promise<void> => {
    if (current === null || body.trim() === '') return
    setSaving(true)
    setNotice(null)
    try {
      const reply = await call('personas.save', { name: current.name, body })
      if (!reply.ok) {
        setFailure(reply.failure)
        return
      }
      const saved = parsePersonaRecord(reply.value)
      if (!saved.ok) {
        setFailure(saved.failure)
        return
      }
      await load()
      setNotice(t('personas.savedOnly', { name: saved.value.name }))
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setSaving(false)
    }
  }

  /** Store the edited text as a new version, then switch to it. */
  const applyDraft = async (): Promise<void> => {
    if (current === null || body.trim() === '') return
    setApplying(current.id)
    setNotice(null)
    try {
      let revision = current.id
      if (body !== current.body) {
        const savedReply = await call('personas.save', { name: current.name, body })
        const savedFailed = failureText(savedReply)
        if (savedFailed !== null) {
          setFailure(savedFailed)
          return
        }
        const saved = parsePersonaRecord(savedReply.ok ? savedReply.value : undefined)
        if (!saved.ok) {
          setFailure(saved.failure)
          return
        }
        revision = saved.value.id
      }
      await applyRevision(revision, current.name)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setApplying(null)
    }
  }

  /**
   * Delete every persona except the one in force. The workbench backs the whole
   * archive up under backups/ first and keeps the revisions a window still uses.
   */
  const clearVersions = async (): Promise<void> => {
    if (clearing) return
    setClearing(true)
    setNotice(null)
    try {
      const reply = await call('personas.clear', {})
      const failed = failureText(reply)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parsePersonasCleared(reply.ok ? reply.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      const receipt = [
        t('personas.cleared', { backup: parsed.value.backup, deleted: String(parsed.value.deleted) }),
        parsed.value.protected.length === 0 ? '' : t('personas.clearKept', { count: String(parsed.value.protected.length) }),
      ].filter(part => part !== '').join(' ')
      setFailure(null)
      setNotice(receipt)
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setClearing(false)
    }
  }

  /** Write a new persona; it is stored, not applied. */
  const createPersona = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (createName.trim() === '' || createBody.trim() === '') return
    setCreating(true)
    setNotice(null)
    setCreated(null)
    try {
      const reply = await call('personas.create', { name: createName.trim(), body: createBody })
      const failed = failureText(reply)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const saved = parsePersonaRecord(reply.ok ? reply.value : undefined)
      if (!saved.ok) {
        setFailure(saved.failure)
        return
      }
      setCreated(saved.value)
      setFailure(null)
      await load()
      setNotice(t('personas.created', { name: saved.value.name }))
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setCreating(false)
    }
  }

  /** Answer the same line twice: as the live persona and as the version before it. */
  const runPreview = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const text = previewText.trim()
    if (text === '') return
    setPreviewing(true)
    setPreview(null)
    try {
      const reply = await call('personas.preview', { text })
      const failed = failureText(reply)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parsePersonaPreview(reply.ok ? reply.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setPreview(parsed.value)
      setFailure(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setPreviewing(false)
    }
  }

  const edited = current !== null && body !== current.body
  return (
    <div className={css.page} aria-label={t('pages.personas')}>
      <div className={css.detailHead}>
        <h2 className={css.detailTitle}>{t('pages.personas')}</h2>
        <div className={css.headActions}>
          {notice !== null && <span className={css.inlineNotice} role="status">{notice}</span>}
          <Button
            size="sm"
            variant="ghost"
            icon={<IconRefreshOutlineRegular size={14} />}
            aria-label={t('refresh')}
            title={t('refresh')}
            disabled={loading}
            onClick={() => { void load() }}
          />
        </div>
      </div>
      <PageHint label={t('common.help')} items={[t('personas.currentHint'), t('personas.createHint'), t('personas.clearHint'), t('personas.previewNote')]} />
      {failure !== null && <p className={css.inlineError} role="alert">{t('common.failed', { error: failure.message })}</p>}
      {loading && current === null && <p className={css.muted} role="status">{t('personas.loading')}</p>}

      {current !== null && <section className={css.card} aria-label={t('personas.currentTitle')}>
        <header className={css.cardHead}>
          <div className={css.section}>
            <span className={css.label}>{t('personas.currentTitle')}</span>
            <h3 className={css.cardTitle}>{current.name}</h3>
          </div>
          <Tag tone="success">{t('personas.usedNow')}</Tag>
        </header>
        <label className={css.field}>
          <span className={css.label}>{t('personas.body')}</span>
          <textarea
            className={css.textarea}
            rows={10}
            value={body}
            placeholder={t('personas.bodyPlaceholder')}
            onChange={(event) => { setBody(event.target.value) }}
          />
        </label>
        <div className={css.formActions}>
          {edited && <span className={css.hint}>{t('personas.willSave')}</span>}
          <Button size="sm" variant="outline" disabled={saving || !edited || body.trim() === ''}
            onClick={() => { void saveDraft() }}>
            {saving ? t('personas.saving') : t('personas.savePreset')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<IconCheckCircleFillRegular size={14} />}
            disabled={applying !== null || body.trim() === ''}
            onClick={() => { void applyDraft() }}
          >
            {applying === current.id ? t('personas.applying') : t('personas.apply')}
          </Button>
        </div>
      </section>}

      <section className={css.section} aria-label={t('personas.drawer')}>
        <button
          type="button"
          className={css.drawerHead}
          aria-expanded={drawerOpen}
          onClick={() => { setDrawerOpen(open => !open) }}
        >
          <span className={css.sectionTitle}>{drawerOpen ? '▾' : '▸'} {t('personas.drawer')}</span>
          <span className={css.rowMeta}>{t('personas.presetCount', { count: presets.length })}</span>
        </button>
        {drawerOpen && <div className={css.rows}>
          {presets.map(preset => <div key={preset.id} className={css.card}>
            <div className={css.presetRow}>
              <span className={css.presetName}>
                <span className={css.rowTitle}>{preset.name}</span>
                {preset.id === current?.id && <Tag tone="success">{t('personas.usedNow')}</Tag>}
              </span>
              <Button size="sm" variant="outline" disabled={applying !== null || preset.id === current?.id}
                onClick={() => { void applyRevision(preset.id, preset.name) }}>
                {applying === preset.id ? t('personas.applying') : t('personas.useThis')}
              </Button>
            </div>
            {preset.source !== undefined && <p className={css.hint}>{preset.source}</p>}
            <details>
              <summary>{t('personas.inspectPreset')}</summary>
              <textarea className={css.textarea} value={preset.body} readOnly rows={6}
                aria-label={t('personas.body')} />
            </details>
          </div>)}
          <Button size="sm" variant="outline" icon={<IconTrashOutlineRegular size={14} />}
            disabled={clearing || current === null} onClick={() => { void clearVersions() }}>
            {clearing ? t('personas.clearing') : t('personas.clear')}
          </Button>
          <p className={css.hint}>{t('personas.clearHint')}</p>
        </div>}
      </section>

      <section className={css.section} aria-label={t('personas.create')}>
        <h3 className={css.sectionTitle}>{t('personas.create')}</h3>
        <p className={css.hint}>{t('personas.createHint')}</p>
        <form className={css.form} onSubmit={(event) => { void createPersona(event) }}>
          <label className={css.field}>
            <span className={css.label}>{t('personas.createName')}</span>
            <Input
              value={createName}
              aria-label={t('personas.createName')}
              placeholder={t('personas.createNamePlaceholder')}
              onChange={(event) => { setCreateName(event.target.value) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>{t('personas.createBody')}</span>
            <textarea
              className={css.textarea}
              rows={6}
              value={createBody}
              aria-label={t('personas.createBody')}
              placeholder={t('personas.createBodyPlaceholder')}
              onChange={(event) => { setCreateBody(event.target.value) }}
            />
          </label>
          <div className={css.formActions}>
            {created !== null && <Button
              size="sm"
              variant="outline"
              disabled={applying !== null}
              onClick={() => { void applyRevision(created.id, created.name) }}
            >
              {t('personas.useThis')}
            </Button>}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              icon={<IconPlusOutlineRegular size={14} />}
              disabled={creating || createName.trim() === '' || createBody.trim() === ''}
            >
              {creating ? t('personas.creating') : t('personas.createSave')}
            </Button>
          </div>
        </form>
      </section>

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
          <Button type="submit" variant="primary" size="sm" disabled={previewing || previewText.trim() === ''}>
            {previewing ? t('personas.previewing') : t('personas.previewRun')}
          </Button>
        </form>
        <p className={css.hint}>{t('personas.previewCost', { count: preview?.model_calls ?? 2 })}</p>
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
    </div>
  )
}
