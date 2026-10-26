/**
 * Extensions: the real Fish plugin registry, including MCP, HTTP APIs, CLI
 * bridges, and DSH native packages.
 *
 * A saved manifest, a successful discovery test, and an enabled extension are
 * three different facts, so the page never renders one as another. The list and
 * every detail field come from `plugins.list`; "test" runs the real discovery
 * and shows the tools the extension itself reported, while enabling goes
 * through `plugins.enable` and therefore keeps the backend's refusal reason
 * when the extension was not tested yet. Tools listed here are the ones Fish can
 * really call; tests and calls are written to the registry event log shown at
 * the bottom.
 *
 * Selection, draft, and registry rows stay separate: a background read after a
 * write never writes into an open draft.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, Checkbox, IconEditOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconTrashOutlineRegular, IconWarningOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishKey } from '../locales.ts'
import type { FishPlugin, FishPluginEvent, FishPluginKind } from '../contract/workbench.ts'
import { parsePlugins, parsePluginSaved, parsePluginTest } from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { FishToolControls } from './FishToolControls.tsx'
import { PageHint } from './PageHint.tsx'
import css from './pages.module.css'

/** The six kinds the registry accepts, in form order. */
const KINDS: readonly FishPluginKind[] = ['mcp_stdio', 'mcp_http', 'mcp_sse', 'cli', 'http', 'dsh']

/** Localized long label of one plugin kind. */
const KIND_LABEL: Readonly<Record<FishPluginKind, FishKey>> = {
  mcp_stdio: 'extensions.kind.mcp_stdio',
  mcp_http: 'extensions.kind.mcp_http',
  mcp_sse: 'extensions.kind.mcp_sse',
  cli: 'extensions.kind.cli',
  http: 'extensions.kind.http',
  dsh: 'extensions.kind.dsh',
}

/** Compact list tag of one plugin kind. */
const KIND_TAG: Readonly<Record<FishPluginKind, FishKey>> = {
  mcp_stdio: 'extensions.kindTag.mcp_stdio',
  mcp_http: 'extensions.kindTag.mcp_http',
  mcp_sse: 'extensions.kindTag.mcp_sse',
  cli: 'extensions.kindTag.cli',
  http: 'extensions.kindTag.http',
  dsh: 'extensions.kindTag.dsh',
}

/** The two roles the registry authorizes. */
const ROLES = ['qq', 'research'] as const

/** Localized role label. */
const ROLE_LABEL: Readonly<Record<string, FishKey>> = {
  qq: 'extensions.role.qq',
  research: 'extensions.role.research',
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One argument per non-empty line. */
function lines(text: string): readonly string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
}

/** One editable extension manifest; `source` is null for a new extension. */
interface PluginDraft {
  readonly source: FishPlugin | null
  readonly id: string
  readonly name: string
  readonly kind: FishPluginKind
  readonly command: string
  readonly argsText: string
  readonly url: string
  readonly timeout: string
  readonly roles: readonly string[]
  readonly ownerOnly: boolean
  readonly allowedToolsText: string
  readonly toolsText: string
  readonly apiKey: string
  readonly secretsText: string
}

/** The fields a plugin kind actually uses. */
function usesUrl(kind: FishPluginKind): boolean {
  return kind === 'mcp_http' || kind === 'mcp_sse' || kind === 'http'
}

/** A blank draft for a new extension. */
function blankDraft(): PluginDraft {
  return {
    source: null, id: '', name: '', kind: 'mcp_stdio', command: '', argsText: '', url: '',
    timeout: '60', roles: ['qq'], ownerOnly: true, allowedToolsText: '', toolsText: '[]', apiKey: '', secretsText: '',
  }
}

/** A draft opened from one registered extension. */
function draftOf(plugin: FishPlugin): PluginDraft {
  return {
    source: plugin, id: plugin.id, name: plugin.name, kind: plugin.kind,
    command: plugin.command, argsText: plugin.args.join('\n'), url: plugin.url,
    timeout: String(plugin.timeout), roles: plugin.roles, ownerOnly: plugin.owner_only,
    allowedToolsText: (plugin.allowed_tools ?? []).join('\n'),
    toolsText: JSON.stringify(plugin.tools, null, 2), apiKey: '', secretsText: '',
  }
}

/** Whether the draft differs from the row it came from (a new draft is dirty once filled). */
function isDirty(draft: PluginDraft): boolean {
  const source = draft.source
  if (source === null) {
    return draft.id !== '' || draft.name !== '' || draft.command !== '' || draft.argsText !== ''
      || draft.url !== '' || draft.timeout !== '60' || !draft.ownerOnly
      || draft.toolsText !== '[]' || draft.apiKey !== '' || draft.secretsText !== '' || draft.allowedToolsText !== '' || draft.roles.join(',') !== 'qq'
  }
  return draft.toolsText !== JSON.stringify(source.tools, null, 2) || draft.apiKey !== '' || draft.secretsText !== '' || draft.name !== source.name
    || draft.kind !== source.kind
    || draft.command !== source.command
    || lines(draft.argsText).join('\n') !== source.args.join('\n')
    || draft.url !== source.url
    || draft.timeout !== String(source.timeout)
    || draft.ownerOnly !== source.owner_only
    || draft.allowedToolsText !== (source.allowed_tools ?? []).join('\n')
    || [...draft.roles].sort().join(',') !== [...source.roles].sort().join(',')
}

/** Where a failure belongs on the page. */
type FailureWhere = 'load' | 'editor' | 'detail'

/** One failure next to the object that produced it. */
interface PageFailure {
  readonly message: string
  readonly where: FailureWhere
}

/** Work in flight; the matching controls stay disabled until it settles. */
type Busy = 'save' | 'test' | 'toggle' | 'remove'

/** A draft-losing action waiting for the owner to confirm. */
type PendingAction =
  | { readonly kind: 'select'; readonly id: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'cancel' }

/** Result tag of the last real discovery test. */
function testTone(plugin: FishPlugin): 'success' | 'danger' | 'warning' {
  if (plugin.test_ok === false) return 'danger'
  return plugin.test_ok === true ? 'success' : 'warning'
}

/** Localized label of the last real discovery test. */
function testLabel(plugin: FishPlugin, t: FishPageProps['t']): string {
  if (plugin.test_ok === false) return t('extensions.lastTestFailed')
  return plugin.test_ok === true ? t('extensions.lastTestOk') : t('extensions.neverTested')
}

/**
 * Render the extensions page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the registry list, the selected extension's real fields, and its events.
 */
export function FishExtensionsPage({ call, t, formatTimestamp }: FishPageProps): ReactNode {
  const [plugins, setPlugins] = useState<readonly FishPlugin[]>([])
  const [events, setEvents] = useState<readonly FishPluginEvent[]>([])
  const [active, setActive] = useState<readonly string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<PluginDraft | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [testRoles, setTestRoles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [failure, setFailure] = useState<PageFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // A late reply from an older read must not replace a newer registry row.
  const loadEpoch = useRef(0)

  /** Re-read the registry and its real event log; never touches an open draft. */
  const load = useCallback(async (): Promise<void> => {
    const epoch = ++loadEpoch.current
    setLoading(true)
    try {
      const reply = await call('plugins.list')
      if (epoch !== loadEpoch.current) return
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'load' })
        return
      }
      const parsed = parsePlugins(reply.value)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'load' })
        return
      }
      setPlugins(parsed.value.plugins)
      setEvents(parsed.value.events)
      setActive(parsed.value.active)
      setSelectedId(previous => previous !== null && !parsed.value.plugins.some(plugin => plugin.id === previous)
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
    return () => { loadEpoch.current += 1 }
  }, [load])

  const selected = selectedId === null ? null : plugins.find(plugin => plugin.id === selectedId) ?? null

  /** Close the editor and show one registry row. */
  const finishSelect = (id: string): void => {
    setEditor(null)
    setPending(null)
    setConfirming(null)
    setSelectedId(id)
    setFailure(null)
    setNotice(null)
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

  /** Select one registry row. */
  const selectPlugin = (id: string): void => {
    if (id === selectedId && editor === null) return
    guarded({ kind: 'select', id }, () => { finishSelect(id) })
  }

  /** Open a blank manifest. */
  const startNew = (): void => {
    guarded({ kind: 'new' }, () => {
      setEditor(blankDraft())
      setSelectedId(null)
      setPending(null)
      setConfirming(null)
      setFailure(null)
      setNotice(null)
    })
  }

  /** Open one stored manifest in the form. */
  const editPlugin = (plugin: FishPlugin): void => {
    if (busy !== null) return
    setEditor(draftOf(plugin))
    setSelectedId(plugin.id)
    setPending(null)
    setConfirming(null)
    setFailure(null)
    setNotice(null)
  }

  /** Leave the form; an unsaved draft asks first. */
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
      setEditor(blankDraft())
      setSelectedId(null)
    } else {
      setEditor(null)
    }
  }

  /** Store the manifest, then keep the editor closed and re-read the registry. */
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (editor === null || busy !== null) return
    const draft = editor
    const id = draft.id.trim()
    const name = draft.name.trim()
    if (id === '') {
      setFailure({ message: t('extensions.needId'), where: 'editor' })
      return
    }
    if (name === '') {
      setFailure({ message: t('extensions.needName'), where: 'editor' })
      return
    }
    if (draft.roles.length === 0) {
      setFailure({ message: t('extensions.needRoles'), where: 'editor' })
      return
    }
    const target = usesUrl(draft.kind) ? draft.url.trim() : draft.command.trim()
    if (target === '') {
      setFailure({ message: t('extensions.needTarget'), where: 'editor' })
      return
    }
    let declaredTools: unknown
    const secrets: Record<string, string> = {}
    try {
      if (draft.kind === 'cli' || draft.kind === 'http') {
        declaredTools = JSON.parse(draft.toolsText)
        if (!Array.isArray(declaredTools) || declaredTools.length === 0) throw new Error(t('extensions.needTools'))
      }
      for (const line of lines(draft.secretsText)) {
        const separator = line.indexOf('=')
        if (separator < 1) throw new Error(t('extensions.envHint'))
        secrets[line.slice(0, separator).trim()] = line.slice(separator + 1)
      }
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'editor' })
      return
    }
    const rawTimeout = Number(draft.timeout)
    const timeout = Number.isFinite(rawTimeout) ? Math.max(3, Math.min(240, Math.round(rawTimeout))) : 60
    // A changed executable or URL is a new discovery target: the backend voids
    // the old tools, and it refuses to save an enabled plugin without a test.
    const connectionChanged = draft.source === null
      || draft.kind !== draft.source.kind
      || draft.command.trim() !== draft.source.command
      || lines(draft.argsText).join('\n') !== draft.source.args.join('\n')
      || draft.url.trim() !== draft.source.url
      || draft.toolsText !== JSON.stringify(draft.source.tools, null, 2)
    const enabled = draft.source !== null && draft.source.enabled && !connectionChanged
    const selectedTools = lines(draft.allowedToolsText)
    const manifest: Record<string, unknown> = {
      id, name, kind: draft.kind, roles: draft.roles, enabled,
      owner_only: draft.ownerOnly, timeout,
      allowed_tools: selectedTools.length === 0 ? null : selectedTools,
    }
    if (declaredTools !== undefined) manifest.tools = declaredTools
    if (draft.apiKey.trim() !== '') manifest.api_key = draft.apiKey.trim()
    if (Object.keys(secrets).length > 0) manifest.secrets = secrets
    if (usesUrl(draft.kind)) manifest.url = target
    else manifest.command = target
    if (draft.kind === 'mcp_stdio' || draft.kind === 'cli') manifest.args = lines(draft.argsText)
    setBusy('save')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('plugins.save', { manifest })
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'editor' })
        return
      }
      const parsed = parsePluginSaved(reply.value)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'editor' })
        return
      }
      setNotice(connectionChanged && draft.source?.enabled === true
        ? t('extensions.savedNeedsTest', { name })
        : t('extensions.saved', { name }))
      setEditor(null)
      setPending(null)
      setSelectedId(parsed.value)
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'editor' })
    } finally {
      setBusy(null)
    }
  }

  /** Run the real discovery for one extension through the chosen role. */
  const runTest = async (plugin: FishPlugin): Promise<void> => {
    if (busy !== null) return
    const roles = plugin.roles.length === 0 ? ['research'] : plugin.roles
    const requested = testRoles[plugin.id]
    const role = requested !== undefined && roles.includes(requested) ? requested : roles[0] ?? 'research'
    setBusy('test')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('plugins.test', { id: plugin.id, role })
      if (!reply.ok) {
        // The registry records the real reason; re-read so the row shows it.
        setFailure({ message: reply.failure.message, where: 'detail' })
        await load()
        return
      }
      const parsed = parsePluginTest(reply.value)
      if (!parsed.ok) {
        setFailure({ message: parsed.failure.message, where: 'detail' })
        await load()
        return
      }
      setNotice(t('extensions.tested', { count: parsed.value.tools.length }))
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'detail' })
    } finally {
      setBusy(null)
    }
  }

  /** Enable or disable one extension; the backend's refusal stays visible. */
  const toggle = async (plugin: FishPlugin, enabled: boolean): Promise<void> => {
    if (busy !== null) return
    setBusy('toggle')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('plugins.enable', { id: plugin.id, enabled })
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'detail' })
        await load()
        return
      }
      setNotice(t(enabled ? 'extensions.enabledNotice' : 'extensions.disabledNotice', { name: plugin.name }))
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'detail' })
    } finally {
      setBusy(null)
    }
  }

  /** Remove one registry entry and its installed native package, if any. */
  const remove = async (plugin: FishPlugin): Promise<void> => {
    if (busy !== null) return
    setBusy('remove')
    setFailure(null)
    setNotice(null)
    try {
      const reply = await call('plugins.remove', { id: plugin.id })
      if (!reply.ok) {
        setFailure({ message: reply.failure.message, where: 'detail' })
        await load()
        return
      }
      setNotice(t('extensions.removed', { name: plugin.name }))
      setConfirming(null)
      setEditor(null)
      setSelectedId(null)
      await load()
    } catch (error) {
      setFailure({ message: reasonOf(error), where: 'detail' })
    } finally {
      setBusy(null)
    }
  }

  const formDisabled = busy !== null
  const availableTestRoles = selected === null ? [] : (selected.roles.length === 0 ? ['research'] : selected.roles)
  const requestedTestRole = selected === null ? undefined : testRoles[selected.id]
  const testRole = requestedTestRole !== undefined && availableTestRoles.includes(requestedTestRole)
    ? requestedTestRole
    : availableTestRoles[0] ?? 'research'

  return (
    <div className={css.split} aria-label={t('pages.extensions')}>
      <div className={css.listColumn}>
        <div className={css.columnHead}>
          <h2 className={css.sectionTitle}>{t('pages.extensions')}</h2>
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
            t('extensions.toolsHint'), t('extensions.testHint'),
            t('extensions.enableHint'), t('extensions.kindHint'),
          ]}
        />
        <div className={css.listTools}>
          <Button size="md" variant="outline" icon={<IconPlusOutlineRegular size={16} />}
            disabled={formDisabled} onClick={startNew}>
            {t('extensions.add')}
          </Button>
          <span className={clsx(css.rowMeta, css.listCount)}>
            {t('extensions.count', { count: plugins.length })}
          </span>
        </div>
        {failure?.where === 'load' && <p className={css.inlineError} role="alert">
          <IconWarningOutlineRegular size={14} />{t('extensions.loadFailed', { error: failure.message })}
        </p>}
        <div className={css.scrollArea}>
          {plugins.length === 0 && !loading && <p className={css.muted}>{t('extensions.empty')}</p>}
          <ul className={css.rows}>
            {plugins.map((plugin) => {
              const isSelected = plugin.id === selectedId
              const inFlight = active.some(key => key.startsWith(`${plugin.id}:`))
              return (
                <li key={plugin.id}>
                  <button
                    type="button"
                    className={clsx(css.row, isSelected && css.rowSelected)}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => { selectPlugin(plugin.id) }}
                  >
                    <span className={css.rowTitle}>{plugin.name}</span>
                    <span className={css.rowMeta}>
                      {inFlight && <Tag tone="info">{t('extensions.inFlight')}</Tag>}
                      <Tag tone={plugin.enabled ? 'success' : 'neutral'}>
                        {t(plugin.enabled ? 'extensions.enabledNow' : 'extensions.disabledNow')}
                      </Tag>
                      <Tag tone={testTone(plugin)}>{testLabel(plugin, t)}</Tag>
                      <Tag tone="info">{t(KIND_TAG[plugin.kind])}</Tag>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        {notice !== null && <p className={css.inlineNotice} role="status">{notice}</p>}
      </div>

      <div className={css.detailColumn}>
        <FishToolControls call={call} t={t} />
        {editor !== null ? <section className={css.personaCard} aria-label={t('extensions.edit')}>
          <div className={css.detailHead}>
            <div className={css.section}>
              <span className={css.label}>
                {editor.source === null ? t('extensions.new') : t('extensions.edit')}
              </span>
              <h3 className={css.personaName}>
                {editor.source === null ? t('extensions.new') : editor.name}
              </h3>
              {editor.source !== null && <span className={css.personaVersion}>{editor.source.id}</span>}
            </div>
            <Button size="sm" variant="ghost" disabled={formDisabled} onClick={cancelEdit}>
              {t('cancel')}
            </Button>
          </div>
          {pending !== null && <div className={css.prompt} role="alert">
            <span>{t('extensions.unsaved')}</span>
            <div className={css.promptActions}>
              <Button size="sm" variant="outline" onClick={() => { setPending(null) }}>{t('extensions.keepEditing')}</Button>
              <Button size="sm" variant="primary" onClick={confirmPending}>{t('extensions.discard')}</Button>
            </div>
          </div>}
          <form className={css.form} onSubmit={(event) => { void submit(event) }}>
            <div className={css.fieldRow}>
              <label className={css.field}>
                <span className={css.label}>{t('extensions.id')}</span>
                <Input
                  value={editor.id}
                  aria-label={t('extensions.id')}
                  placeholder="my_mcp"
                  disabled={formDisabled || editor.source !== null}
                  onChange={(event) => {
                    const value = event.target.value
                    setEditor(current => current === null ? current : { ...current, id: value })
                  }}
                />
                <span className={css.hint}>{t('extensions.idHint')}</span>
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('extensions.name')}</span>
                <Input
                  value={editor.name}
                  aria-label={t('extensions.name')}
                  placeholder={t('extensions.namePlaceholder')}
                  disabled={formDisabled}
                  onChange={(event) => {
                    const value = event.target.value
                    setEditor(current => current === null ? current : { ...current, name: value })
                  }}
                />
              </label>
            </div>
            <label className={css.field}>
              <span className={css.label}>{t('extensions.kind')}</span>
              <select
                className={css.select}
                value={editor.kind}
                aria-label={t('extensions.kind')}
                disabled={formDisabled}
                onChange={(event) => {
                  const value = event.target.value as FishPluginKind
                  setEditor(current => current === null ? current : { ...current, kind: value })
                }}
              >
                {KINDS.map(kind => <option key={kind} value={kind}>{t(KIND_LABEL[kind])}</option>)}
              </select>
            </label>
            {usesUrl(editor.kind) ? <label className={css.field}>
              <span className={css.label}>{t('extensions.url')}</span>
              <Input
                value={editor.url}
                aria-label={t('extensions.url')}
                placeholder="https://127.0.0.1:8000/mcp"
                disabled={formDisabled}
                onChange={(event) => {
                  const value = event.target.value
                  setEditor(current => current === null ? current : { ...current, url: value })
                }}
              />
              <span className={css.hint}>{t('extensions.urlHint')}</span>
            </label> : <>
              <label className={css.field}>
                <span className={css.label}>{t('extensions.command')}</span>
                <Input
                  value={editor.command}
                  aria-label={t('extensions.command')}
                  placeholder="C:\\Program Files\\nodejs\\node.exe"
                  disabled={formDisabled}
                  onChange={(event) => {
                    const value = event.target.value
                    setEditor(current => current === null ? current : { ...current, command: value })
                  }}
                />
                <span className={css.hint}>{t('extensions.commandHint')}</span>
              </label>
              {editor.kind !== 'dsh' && <label className={css.field}>
                <span className={css.label}>{t('extensions.args')}</span>
                <textarea
                  className={css.textarea}
                  rows={3}
                  value={editor.argsText}
                  aria-label={t('extensions.args')}
                  disabled={formDisabled}
                  onChange={(event) => {
                    const value = event.target.value
                    setEditor(current => current === null ? current : { ...current, argsText: value })
                  }}
                />
                <span className={css.hint}>{t('extensions.argsHint')}</span>
              </label>}
            </>}
            <div className={css.fieldRow}>
              <label className={css.field}>
                <span className={css.label}>{t('extensions.timeout')}</span>
                <Input
                  type="number"
                  min={3}
                  max={240}
                  step={1}
                  value={editor.timeout}
                  aria-label={t('extensions.timeout')}
                  disabled={formDisabled}
                  onChange={(event) => {
                    const value = event.target.value
                    setEditor(current => current === null ? current : { ...current, timeout: value })
                  }}
                />
              </label>
              <div className={css.field}>
                <span className={css.label}>{t('extensions.ownerOnly')}</span>
                <Checkbox
                  checked={editor.ownerOnly}
                  label={t('extensions.ownerOnly')}
                  disabled={formDisabled}
                  onChange={(value) => {
                    setEditor(current => current === null ? current : { ...current, ownerOnly: value })
                  }}
                />
                <span className={css.hint}>{t('extensions.ownerOnlyHint')}</span>
              </div>
            </div>
            <fieldset className={css.fieldset}>
              <span className={css.label}>{t('extensions.roles')}</span>
              <div className={css.weekdayRow}>
                {ROLES.map(role => <Checkbox
                  key={role}
                  checked={editor.roles.includes(role)}
                  label={t(ROLE_LABEL[role] ?? 'extensions.roles')}
                  disabled={formDisabled}
                  onChange={(value) => {
                    setEditor((current) => {
                      if (current === null) return current
                      const roles = value
                        ? [...current.roles, role]
                        : current.roles.filter(item => item !== role)
                      return { ...current, roles }
                    })
                  }}
                />)}
              </div>
              <span className={css.hint}>{t('extensions.rolesHint')}</span>
            </fieldset>
            {(editor.kind === 'cli' || editor.kind === 'http') && <label className={css.field}>
              <span className={css.label}>{t('extensions.toolDefinitions')}</span>
              <textarea className={css.textarea} rows={10} value={editor.toolsText} disabled={formDisabled}
                aria-label={t('extensions.toolDefinitions')}
                placeholder={'[{"name":"my_tool","description":"...","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}]'}
                onChange={(event) => {
                  const value = event.target.value
                  setEditor(current => current === null ? current : { ...current, toolsText: value })
                }} />
              <span className={css.hint}>{t('extensions.toolDefinitionsHint')}</span>
            </label>}
            {usesUrl(editor.kind) && <label className={css.field}>
              <span className={css.label}>{t('extensions.apiKey')}</span>
              <Input type="password" value={editor.apiKey} disabled={formDisabled} aria-label={t('extensions.apiKey')}
                onChange={(event) => {
                  const value = event.target.value
                  setEditor(current => current === null ? current : { ...current, apiKey: value })
                }} />
              <span className={css.hint}>{t('extensions.apiKeyHint')}</span>
            </label>}
            {(editor.kind === 'cli' || editor.kind === 'mcp_stdio') && <label className={css.field}>
              <span className={css.label}>{t('extensions.env')}</span>
              <textarea className={css.textarea} rows={3} value={editor.secretsText} disabled={formDisabled} aria-label={t('extensions.env')}
                onChange={(event) => {
                  const value = event.target.value
                  setEditor(current => current === null ? current : { ...current, secretsText: value })
                }} />
              <span className={css.hint}>{t('extensions.envHint')}</span>
            </label>}
            <label className={css.field}>
              <span className={css.label}>{t('extensions.allowedTools')}</span>
              <textarea
                className={css.textarea}
                rows={2}
                value={editor.allowedToolsText}
                aria-label={t('extensions.allowedTools')}
                placeholder="search_pages"
                disabled={formDisabled}
                onChange={(event) => {
                  const value = event.target.value
                  setEditor(current => current === null ? current : { ...current, allowedToolsText: value })
                }}
              />
              <span className={css.hint}>{t('extensions.allowedToolsHint')}</span>
            </label>
            {failure?.where === 'editor' && <p className={css.inlineError} role="alert">
              <IconWarningOutlineRegular size={14} />{failure.message}
            </p>}
            <div className={css.formActions}>
              <Button type="submit" size="md" variant="primary" disabled={formDisabled}>
                {busy === 'save' ? t('extensions.saving') : t('extensions.save')}
              </Button>
            </div>
          </form>
        </section> : selected !== null ? <section className={css.personaCard} aria-label={t('extensions.detail')}>
          <div className={css.detailHead}>
            <div className={css.section}>
              <span className={css.label}>{t('extensions.detail')}</span>
              <h3 className={css.personaName}>{selected.name}</h3>
              <p className={css.stageLine}>
                <Tag tone="info">{t(KIND_TAG[selected.kind])}</Tag>
                <Tag tone={selected.enabled ? 'success' : 'neutral'}>
                  {t(selected.enabled ? 'extensions.enabledNow' : 'extensions.disabledNow')}
                </Tag>
                <Tag tone={testTone(selected)}>{testLabel(selected, t)}</Tag>
                <span className={css.personaVersion}>{selected.id}</span>
              </p>
            </div>
            <div className={css.detailActions}>
              <Button size="md" variant="outline" icon={<IconEditOutlineRegular size={16} />}
                disabled={formDisabled} onClick={() => { editPlugin(selected) }}>
                {t('extensions.edit')}
              </Button>
              <Button size="md" variant="outline" disabled={formDisabled} onClick={() => { void runTest(selected) }}>
                {busy === 'test' ? t('extensions.testing') : t('extensions.test')}
              </Button>
              <Button size="md" variant={selected.enabled ? 'outline' : 'primary'}
                disabled={formDisabled} onClick={() => { void toggle(selected, !selected.enabled) }}>
                {busy === 'toggle'
                  ? t('extensions.enabling')
                  : t(selected.enabled ? 'extensions.disable' : 'extensions.enable')}
              </Button>
              <Button size="md" variant="outline" icon={<IconTrashOutlineRegular size={16} />}
                disabled={formDisabled} onClick={() => { setConfirming(selected.id) }}>
                {t('extensions.remove')}
              </Button>
            </div>
          </div>
          <div className={css.searchRow}>
            <span className={css.label}>{t('extensions.testRole')}</span>
            <select
              className={clsx(css.select, css.compactSelect)}
              value={testRole}
              aria-label={t('extensions.testRole')}
              disabled={formDisabled}
              onChange={(event) => {
                const value = event.target.value
                setTestRoles(current => ({ ...current, [selected.id]: value }))
              }}
            >
              {availableTestRoles
                .map(role => <option key={role} value={role}>{t(ROLE_LABEL[role] ?? 'extensions.roles')}</option>)}
            </select>
            {selected.kind === 'dsh' && <span className={css.hint}>{t('extensions.nativeHint')}</span>}
          </div>
          {confirming === selected.id && <div className={css.prompt} role="alert">
            <span>{t('extensions.removeConfirm')}</span>
            <div className={css.promptActions}>
              <Button size="sm" variant="outline" onClick={() => { setConfirming(null) }}>{t('cancel')}</Button>
              <Button size="sm" variant="primary" onClick={() => { void remove(selected) }}>
                {busy === 'remove' ? t('extensions.removing') : t('extensions.removeYes')}
              </Button>
            </div>
          </div>}
          {failure?.where === 'detail' && <p className={css.inlineError} role="alert">
            <IconWarningOutlineRegular size={14} />{failure.message}
          </p>}
          <dl className={css.facts}>
            <dt>{t('extensions.id')}</dt>
            <dd>{selected.id}</dd>
            <dt>{t('extensions.kind')}</dt>
            <dd>{t(KIND_LABEL[selected.kind])}</dd>
            <dt>{t('extensions.roles')}</dt>
            <dd>{selected.roles.length === 0
              ? t('common.nothing')
              : selected.roles.map(role => t(ROLE_LABEL[role] ?? 'extensions.roles')).join('、')}</dd>
            <dt>{t('extensions.timeout')}</dt>
            <dd>{t('extensions.timeoutValue', { seconds: String(selected.timeout) })}</dd>
            {usesUrl(selected.kind) ? <>
              <dt>{t('extensions.url')}</dt>
              <dd>{selected.url === '' ? t('common.nothing') : selected.url}</dd>
            </> : <>
              <dt>{t('extensions.command')}</dt>
              <dd>{selected.command === '' ? t('common.nothing') : selected.command}</dd>
              {selected.kind !== 'dsh' && <>
                <dt>{t('extensions.args')}</dt>
                <dd>{selected.args.length === 0 ? t('common.nothing') : selected.args.join(' ')}</dd>
              </>}
            </>}
            <dt>{t('extensions.ownerOnly')}</dt>
            <dd>{selected.owner_only ? t('extensions.ownerOnlyYes') : t('extensions.ownerOnlyNo')}</dd>
            <dt>{t('extensions.allowedTools')}</dt>
            <dd>{selected.allowed_tools === null
              ? t('extensions.allTools')
              : t('extensions.selectedTools', { count: selected.allowed_tools.length })}</dd>
            <dt>{t('extensions.lastTest')}</dt>
            <dd>{testLabel(selected, t)}
              {selected.last_test !== null && ` · ${formatTimestamp(selected.last_test)}`}</dd>
            {selected.last_error !== '' && <>
              <dt>{t('extensions.lastError')}</dt>
              <dd>{selected.last_error}</dd>
            </>}
            <dt>{t('extensions.version')}</dt>
            <dd>{selected.server_version !== ''
              ? selected.server_version
              : selected.package_version !== ''
                ? selected.package_version
                : t('extensions.noVersion')}</dd>
            {selected.server_name !== '' && <>
              <dt>{t('extensions.serverName')}</dt>
              <dd>{selected.server_name}</dd>
            </>}
            {selected.package_name !== '' && <>
              <dt>{t('extensions.package')}</dt>
              <dd>{selected.package_name}</dd>
            </>}
            {selected.installed_roles.length > 0 && <>
              <dt>{t('extensions.installedRoles')}</dt>
              <dd>{selected.installed_roles.map(role => t(ROLE_LABEL[role] ?? 'extensions.roles')).join('、')}</dd>
            </>}
          </dl>
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('extensions.tools', { count: selected.tools.length })}</h3>
            {selected.tools.length === 0
              ? <p className={css.muted}>{t('extensions.toolsEmpty')}</p>
              : <ul className={css.rows}>
                {selected.tools.map(tool => (
                  <li key={tool.name} className={css.toolRow}>
                    <span className={css.toolName}>{tool.name}</span>
                    <span className={css.toolDesc}>
                      {tool.description === '' ? t('common.nothing') : tool.description}
                    </span>
                  </li>
                ))}
              </ul>}
          </section>
        </section> : <p className={css.muted} role="status">
          {loading ? t('extensions.loading') : t('extensions.select')}
        </p>}

        {editor === null && <section className={css.section} aria-label={t('extensions.events', { count: events.length })}>
          <h3 className={css.sectionTitle}>{t('extensions.events', { count: events.length })}</h3>
          {events.length === 0
            ? <p className={css.muted}>{t('extensions.eventsEmpty')}</p>
            : <div className={css.eventsScroll}>
              <ul className={css.eventList}>
                {events.map((event, index) => (
                  <li key={`${String(event.ts)}:${event.plugin}:${event.action}:${String(index)}`}
                    className={css.eventRow}>
                    <span className={css.eventHead}>
                      <Tag tone={event.ok ? 'success' : 'danger'}>
                        {t(event.ok ? 'extensions.eventOk' : 'extensions.eventFailed')}
                      </Tag>
                      <span>{formatTimestamp(event.ts)}</span>
                      <span className={css.mono}>{event.action}</span>
                      <span className={css.mono}>
                        {event.plugin === '' ? t('common.nothing') : event.plugin}
                      </span>
                      {event.role !== '' && <span>{event.role}</span>}
                    </span>
                    {event.detail !== '' && <span className={css.eventDetail}>{event.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>}
        </section>}
      </div>
    </div>
  )
}
