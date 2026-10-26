/**
 * Model services: the one connection source Fish's gateway really reads.
 *
 * Each row is the actual `harness/agents.json` role plus its protected
 * credential reference, and `models.current` also reports what the chat gateway
 * reads right now. Saving returns the stored connection, the effective time,
 * and the uses that read it; testing or discovering models is a separate probe
 * that never saves. A removed credential leaves the address/model in place and
 * turns its uses unconfigured — the page never claims a fallback.
 *
 * The credential is write-only here: the page shows only whether one is set and
 * where it came from, never the value.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, IconEditOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular,
  IconWarningOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishKey } from '../locales.ts'
import type {
  FishModelConnection, FishModelDescription, FishModelProbe,
} from '../contract/workbench.ts'
import { parseModels, parseModelProbe, parseModelRemoved, parseModelSaved } from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** The two roles that own a model connection. */
const ROLES = ['qq', 'research'] as const

/** Localized role label. */
const ROLE_LABEL: Readonly<Record<string, FishKey>> = {
  qq: 'models.role.qq',
  research: 'models.role.research',
}

/** Localized label of a known use; the backend label stays the fallback. */
const USE_LABEL: Readonly<Record<string, FishKey>> = {
  chat: 'models.use.chat',
  memory: 'models.use.memory',
  research: 'models.use.research',
  vision: 'models.use.vision',
  speech: 'models.use.speech',
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Localized label of one use. */
function useLabel(use: string, description: FishModelDescription | null, t: FishPageProps['t']): string {
  const known = USE_LABEL[use]
  if (known !== undefined) return t(known)
  return description?.uses.find(item => item.use === use)?.label ?? use
}

/** One editable connection; `source` is null for a role with no connection yet. */
interface ModelDraft {
  readonly source: FishModelConnection | null
  readonly role: string
  readonly name: string
  readonly base: string
  readonly model: string
  /** Write-only; an empty value keeps the stored credential. */
  readonly key: string
  readonly models: readonly string[]
}

/** A draft opened from one real connection. */
function draftOf(connection: FishModelConnection): ModelDraft {
  return {
    source: connection, role: connection.role, name: connection.name,
    base: connection.base, model: connection.model, key: '', models: [],
  }
}

/** A blank draft for a role that has no connection yet. */
function blankDraft(role: string): ModelDraft {
  return { source: null, role, name: '', base: '', model: '', key: '', models: [] }
}

/** Where a failure belongs on the page. */
interface PageFailure {
  readonly message: string
  readonly where: 'load' | 'editor' | 'card'
  readonly role?: string
}

/** One test probe, attached to the role it tested. */
interface TestProbe {
  readonly role: string
  readonly value: FishModelProbe
}

/** Work in flight; matching controls stay disabled until it settles. */
type Busy = 'save' | 'test' | 'discover' | 'remove'

/**
 * Render the model services page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the real uses, the gateway read, each connection's editor, and probes.
 */
export function FishModelsPage({ call, t }: FishPageProps): ReactNode {
  const [description, setDescription] = useState<FishModelDescription | null>(null)
  const [editor, setEditor] = useState<ModelDraft | null>(null)
  const [probe, setProbe] = useState<TestProbe | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [failure, setFailure] = useState<PageFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // A late reply from an older read must not replace a newer configuration.
  const loadEpoch = useRef(0)

  /** Re-read the stored connections, the uses, and the gateway's own read. */
  const load = useCallback(async (): Promise<void> => {
    const epoch = ++loadEpoch.current
    setLoading(true)
    try {
      const reply = await call('models.current')
      if (epoch !== loadEpoch.current) return
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'load' })
        return
      }
      const parsed = parseModels(reply.value, 'models.current')
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'load' })
        return
      }
      setDescription(parsed.value)
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

  const missingRoles = ROLES.filter(role => description?.connections.some(item => item.role === role) !== true)
  const canAdd = missingRoles.length > 0

  /** Open a blank connection for the first missing role. */
  const startNew = (): void => {
    if (busy !== null || !canAdd) return
    const role = missingRoles[0]
    if (role === undefined) return
    setEditor(blankDraft(role))
    setProbe(null)
    setConfirming(null)
    setFailure(null)
    setNotice(null)
  }

  /** Open the stored connection in the form. */
  const startEdit = (connection: FishModelConnection): void => {
    if (busy !== null || editor !== null) return
    setEditor(draftOf(connection))
    setProbe(null)
    setConfirming(null)
    setFailure(null)
    setNotice(null)
  }

  /** Close the form without writing anything. */
  const cancelEdit = (): void => {
    if (busy !== null) return
    setEditor(null)
    setFailure(null)
    setProbe(null)
  }

  /** Store the form's address/model/name and optional new credential. */
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (editor === null || busy !== null) return
    const draft = editor
    const base = draft.base.trim()
    const model = draft.model.trim()
    if (base === '') {
      setFailure({ message: t('models.needBase'), where: 'editor' })
      return
    }
    if (model === '') {
      setFailure({ message: t('models.needModel'), where: 'editor' })
      return
    }
    setBusy('save')
    setFailure(null)
    setNotice(null)
    try {
      const params: Record<string, unknown> = { role: draft.role, base, model }
      const name = draft.name.trim()
      if (name !== '') params.name = name
      const key = draft.key.trim()
      if (key !== '') params.key = key
      const reply = await call('models.save', params)
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'editor' })
        return
      }
      const parsed = parseModelSaved(reply.value)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'editor' })
        return
      }
      const saved = parsed.value
      const savedName = saved.connection.name !== '' ? saved.connection.name : saved.connection.role
      const applied = saved.applied_uses.length === 0
        ? t('common.nothing')
        : saved.applied_uses.map(use => useLabel(use, description, t)).join('、')
      setNotice(`${t('models.saved', { name: savedName, time: saved.effective_at })} ${t('models.appliedUses', { uses: applied })}`)
      setEditor(null)
      setProbe(null)
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'editor' })
    } finally {
      setBusy(null)
    }
  }

  /** Probe the visible values (draft when open, stored connection otherwise). */
  const runTest = async (connection: FishModelConnection): Promise<void> => {
    if (busy !== null) return
    const draft = editor !== null && editor.role === connection.role ? editor : null
    const base = draft?.base.trim() ?? ''
    const model = draft?.model.trim() ?? ''
    const key = draft?.key.trim() ?? ''
    setBusy('test')
    setFailure(null)
    setNotice(null)
    try {
      const params: Record<string, unknown> = { role: connection.role }
      if (base !== '') params.base = base
      if (model !== '') params.model = model
      if (key !== '') params.key = key
      const reply = await call('models.test', params)
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'card', role: connection.role })
        return
      }
      const parsed = parseModelProbe(reply.value, 'models.test')
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'card', role: connection.role })
        return
      }
      setProbe({ role: connection.role, value: parsed.value })
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'card', role: connection.role })
    } finally {
      setBusy(null)
    }
  }

  /** Ask the backend for the real model list; never fills a model on its own. */
  const discover = async (): Promise<void> => {
    if (editor === null || busy !== null) return
    const base = editor.base.trim()
    if (base === '') {
      setFailure({ message: t('models.needBase'), where: 'editor' })
      return
    }
    const role = editor.role
    const key = editor.key.trim()
    setBusy('discover')
    setFailure(null)
    setNotice(null)
    try {
      const params: Record<string, unknown> = { role, base }
      if (key !== '') params.key = key
      const reply = await call('models.discover', params)
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'editor' })
        return
      }
      const parsed = parseModelProbe(reply.value, 'models.discover')
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'editor' })
        return
      }
      const found = parsed.value
      setEditor(current => current === null || current.role !== role
        ? current
        : { ...current, models: found.models })
      if (!found.ok) {
        setFailure({ message: t('models.discoverFailed', { reason: found.reason }), where: 'editor' })
      } else if (found.models.length === 0) {
        setNotice(found.note !== '' ? found.note : t('models.discoverEmpty'))
      } else {
        setNotice(t('models.discovered', { count: found.models.length }))
      }
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'editor' })
    } finally {
      setBusy(null)
    }
  }

  /** Remove the stored credential; its uses become unconfigured, not redirected. */
  const remove = async (connection: FishModelConnection): Promise<void> => {
    if (busy !== null) return
    setBusy('remove')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('models.remove', { role: connection.role })
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'card', role: connection.role })
        return
      }
      const parsed = parseModelRemoved(reply.value)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'card', role: connection.role })
        return
      }
      const removed = parsed.value
      setNotice(removed.removed
        ? t('models.removed', { note: removed.note })
        : t('models.removeNothing'))
      setConfirming(null)
      if (editor !== null && editor.role === connection.role) setEditor(null)
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'card', role: connection.role })
    } finally {
      setBusy(null)
    }
  }

  const addLabel = t('models.add')

  return (
    <div className={css.settings} aria-label={t('pages.models')}>
      <div className={css.settingsHead}>
        <h2 className={css.sectionTitle}>{t('pages.models')}</h2>
        <div className={css.cardActions}>
          <Button
            size="sm"
            variant="ghost"
            icon={<IconRefreshOutlineRegular size={14} />}
            aria-label={t('refresh')}
            title={t('refresh')}
            disabled={loading || busy !== null}
            onClick={() => { void load() }}
          />
          <Button size="md" variant="outline" disabled={busy !== null || !canAdd || description === null}
            title={canAdd ? undefined : t('models.emptyHint')} onClick={startNew}>
            {addLabel}
          </Button>
        </div>
      </div>
      {description !== null && !canAdd && <p className={css.hint}>{t('models.emptyHint')}</p>}
      {notice !== null && <p className={css.inlineNotice} role="status">{notice}</p>}
      {failure?.where === 'load' && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
      </p>}
      {loading && description === null && <p className={css.muted} role="status">{t('models.loading')}</p>}
      <PageHint
        label={t('common.help')}
        items={[
          t('models.useHint'), t('models.saveHint'), t('models.discoveryHint'),
          t('models.removeHint'), t('models.neverFallsBack'),
        ]}
      />

      {description !== null && <>
        <section className={css.settingsCard} aria-label={t('models.uses')}>
          <h3 className={css.cardTitle}>{t('models.uses')}</h3>
          <ul className={css.rows}>
            {description.uses.map(item => (
              <li key={item.use} className={css.taskRow}>
                <div className={css.taskBody}>
                  <span className={css.rowTitle}>
                    <Tag tone={item.ready ? 'success' : 'warning'}>
                      {t(item.ready ? 'models.ready' : 'models.notReady')}
                    </Tag>
                    {' '}
                    {useLabel(item.use, description, t)}
                  </span>
                  <span className={css.rowMeta}>
                    {item.supported
                      ? t('models.useReads', {
                        connection: item.connection === '' ? t('models.none') : item.connection,
                        model: item.model === '' ? t('models.none') : item.model,
                      })
                      : t('models.unsupported')}
                  </span>
                  {!item.supported && item.reason !== '' && <span className={css.hint}>{item.reason}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className={css.settingsCard} aria-label={t('models.gateway')}>
          <h3 className={css.cardTitle}>{t('models.gateway')}</h3>
          {description.gateway === undefined
            ? <p className={css.muted}>{t('common.nothing')}</p>
            : description.gateway.error !== ''
              ? <p className={css.inlineError} role="alert">
                <IconWarningOutlineRegular size={14} />{t('models.gatewayError', { error: description.gateway.error })}
              </p>
              : <dl className={css.facts}>
                <dt>{t('models.base')}</dt>
                <dd>{description.gateway.base === '' ? t('models.none') : description.gateway.base}</dd>
                <dt>{t('models.model')}</dt>
                <dd>{description.gateway.model === '' ? t('models.none') : description.gateway.model}</dd>
                <dt>{t('models.key')}</dt>
                <dd>{description.gateway.has_key ? t('models.keySet') : t('models.gatewayNoKey')}</dd>
              </dl>}
        </section>

        {editor !== null && editor.source === null && <section className={css.settingsCard} aria-label={t('models.new')}>
          <div className={css.settingsHead}>
            <h3 className={css.cardTitle}>{t('models.new')}</h3>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={cancelEdit}>{t('cancel')}</Button>
          </div>
          {editorForm(editor, true)}
        </section>}

        {description.connections.length === 0 && <p className={css.muted}>{t('models.empty')}</p>}
        {description.connections.map((connection) => {
          const draft = editor !== null && editor.role === connection.role ? editor : null
          const cardProbe = probe !== null && probe.role === connection.role ? probe.value : null
          return <section key={connection.role} className={css.settingsCard} aria-label={connection.name || connection.role}>
            <div className={css.settingsHead}>
              <div className={css.settingsText}>
                <h3 className={css.cardTitle}>{connection.name === '' ? connection.role : connection.name}</h3>
                <span className={css.rowMeta}>
                  <Tag tone="info">{t(ROLE_LABEL[connection.role] ?? 'models.role')}</Tag>
                  <Tag tone={connection.has_key ? 'success' : 'warning'}>
                    {t(connection.has_key ? 'models.keySet' : 'models.keyMissing')}
                  </Tag>
                  {connection.has_key && connection.key_source !== '' &&
                    <span>{t('models.keySource', { source: connection.key_source })}</span>}
                </span>
              </div>
              <div className={css.cardActions}>
                <Button size="md" variant="outline" icon={<IconEditOutlineRegular size={16} />}
                  disabled={busy !== null || editor !== null} onClick={() => { startEdit(connection) }}>
                  {t('models.edit')}
                </Button>
                <Button size="md" variant="outline" disabled={busy !== null || editor !== null}
                  onClick={() => { void runTest(connection) }}>
                  {busy === 'test' ? t('models.testing') : t('models.test')}
                </Button>
                <Button size="md" variant="outline" icon={<IconTrashOutlineRegular size={16} />}
                  disabled={busy !== null || editor !== null} onClick={() => { setConfirming(connection.role) }}>
                  {t('models.remove')}
                </Button>
              </div>
            </div>

            {draft !== null ? editorForm(draft, false) : <dl className={css.facts}>
              <dt>{t('models.base')}</dt>
              <dd>{connection.base === '' ? t('models.none') : connection.base}</dd>
              <dt>{t('models.model')}</dt>
              <dd>{connection.model === '' ? t('models.none') : connection.model}</dd>
              <dt>{t('models.key')}</dt>
              <dd>{connection.has_key ? t('models.keySet') : t('models.keyMissing')}
                {connection.key_source !== '' && ` · ${t('models.keySource', { source: connection.key_source })}`}</dd>
              {connection.env !== '' && <>
                <dt>{t('models.env')}</dt>
                <dd>{connection.env}</dd>
              </>}
            </dl>}

            {cardProbe !== null && <div className={css.section}>
              <p className={cardProbe.ok ? css.inlineNotice : css.inlineError} role="status">
                {cardProbe.ok
                  ? (cardProbe.discovery
                    ? t('models.testOk', { status: cardProbe.status, count: cardProbe.models.length })
                    : t('models.testNoList'))
                  : t('models.testFailed', { reason: cardProbe.reason })}
              </p>
              {cardProbe.models.length > 0 && <p className={css.hint}>{cardProbe.models.join('、')}</p>}
              {cardProbe.ok && cardProbe.note !== '' && <p className={css.hint}>{cardProbe.note}</p>}
            </div>}

            {confirming === connection.role && <div className={css.prompt} role="alert">
              <span>{t('models.removeConfirm', { name: connection.name === '' ? connection.role : connection.name })}</span>
              <div className={css.promptActions}>
                <Button size="sm" variant="outline" onClick={() => { setConfirming(null) }}>{t('cancel')}</Button>
                <Button size="sm" variant="primary" onClick={() => { void remove(connection) }}>
                  {busy === 'remove' ? t('models.removing') : t('models.removeYes')}
                </Button>
              </div>
            </div>}

            {failure?.where === 'card' && failure.role === connection.role && <p className={css.inlineError} role="alert">
              <IconWarningOutlineRegular size={14} />{failure.message}
            </p>}
          </section>
        })}

        <section className={css.settingsCard} aria-label={t('models.source')}>
          <h3 className={css.cardTitle}>{t('models.source')}</h3>
          <dl className={css.facts}>
            <dt>{t('models.source')}</dt>
            <dd>{description.source === '' ? t('common.nothing') : description.source}</dd>
          </dl>
          {description.note !== '' && <p className={css.hint}>{t('models.note', { note: description.note })}</p>}
        </section>
      </>}
    </div>
  )

  /**
   * Render one connection form, reused for an existing role and a new role.
   * @param draft - the live draft.
   * @param isNew - whether this card creates a role that has no connection.
   * @returns the form card body.
   */
  function editorForm(draft: ModelDraft, isNew: boolean): ReactNode {
    const source = draft.source
    return <form className={css.form} onSubmit={(event) => { void submit(event) }}>
      <div className={css.fieldRow}>
        <label className={css.field}>
          <span className={css.label}>{t('models.role')}</span>
          {isNew ? <select
            className={css.select}
            value={draft.role}
            aria-label={t('models.role')}
            disabled={busy !== null}
            onChange={(event) => {
              const value = event.target.value
              setEditor(current => current === null ? current : { ...current, role: value })
            }}
          >
            {missingRoles.map(role => <option key={role} value={role}>{t(ROLE_LABEL[role] ?? 'models.role')}</option>)}
          </select> : <span className={css.mono}>{t(ROLE_LABEL[draft.role] ?? 'models.role')}</span>}
        </label>
        <label className={css.field}>
          <span className={css.label}>{t('models.name')}</span>
          <Input
            value={draft.name}
            aria-label={t('models.name')}
            placeholder={t('models.namePlaceholder')}
            disabled={busy !== null}
            onChange={(event) => {
              const value = event.target.value
              setEditor(current => current === null ? current : { ...current, name: value })
            }}
          />
        </label>
      </div>
      <label className={css.field}>
        <span className={css.label}>{t('models.base')}</span>
        <Input
          value={draft.base}
          aria-label={t('models.base')}
          placeholder="https://api.deepseek.com"
          disabled={busy !== null}
          onChange={(event) => {
            const value = event.target.value
            setProbe(null)
            setEditor(current => current === null ? current : { ...current, base: value })
          }}
        />
        <span className={css.hint}>{t('models.baseHint')}</span>
      </label>
      <label className={css.field}>
        <span className={css.label}>{t('models.model')}</span>
        <Input
          value={draft.model}
          aria-label={t('models.model')}
          placeholder="deepseek-chat"
          disabled={busy !== null}
          onChange={(event) => {
            const value = event.target.value
            setProbe(null)
            setEditor(current => current === null ? current : { ...current, model: value })
          }}
        />
        <span className={css.hint}>{t('models.modelHint')}</span>
      </label>
      <div className={css.searchRow}>
        <Button type="button" size="sm" variant="outline"
          disabled={busy !== null || draft.base.trim() === '' || source === null}
          title={source === null ? t('models.testNeedsSave') : undefined}
          onClick={() => { void discover() }}>
          {busy === 'discover' ? t('models.discovering') : t('models.discover')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy !== null || source === null}
          title={source === null ? t('models.testNeedsSave') : undefined}
          onClick={() => {
            if (source !== null) void runTest(source)
          }}>
          {busy === 'test' ? t('models.testing') : t('models.test')}
        </Button>
        {source === null && <span className={css.hint}>{t('models.testNeedsSave')}</span>}
      </div>
      {draft.models.length > 0 && <label className={css.field}>
        <span className={css.label}>{t('models.pickModel')}</span>
        <select
          className={css.select}
          value={draft.models.includes(draft.model) ? draft.model : ''}
          aria-label={t('models.pickModel')}
          disabled={busy !== null}
          onChange={(event) => {
            const value = event.target.value
            setProbe(null)
            setEditor(current => current === null ? current : { ...current, model: value })
          }}
        >
          <option value="">{t('models.manualModel')}</option>
          {draft.models.map(model => <option key={model} value={model}>{model}</option>)}
        </select>
      </label>}
      <label className={css.field}>
        <span className={css.label}>{t('models.key')}</span>
        <Input
          type="password"
          value={draft.key}
          aria-label={t('models.key')}
          placeholder="••••••"
          autoComplete="new-password"
          disabled={busy !== null}
          onChange={(event) => {
            const value = event.target.value
            setProbe(null)
            setEditor(current => current === null ? current : { ...current, key: value })
          }}
        />
        <span className={css.hint}>
          {source !== null && source.has_key ? t('models.keySet') : t('models.keyMissing')}
          {' · '}{t('models.keyHint')}
        </span>
      </label>
      {failure?.where === 'editor' && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{failure.message}
      </p>}
      <div className={css.formActions}>
        <Button type="button" size="md" variant="outline" disabled={busy !== null} onClick={cancelEdit}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="md" variant="primary" disabled={busy !== null}>
          {busy === 'save' ? t('models.saving') : t('models.save')}
        </Button>
      </div>
    </form>
  }
}
