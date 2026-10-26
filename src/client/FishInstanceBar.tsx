/** Instance selection is a viewing choice; lifecycle changes use explicit host actions. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, Input, Menu, Modal, SegmentedControl, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishCall, FishFailure } from './contract/slots.ts'
import type { FishInstance, FishInstancePreset } from './contract/workbench.ts'
import type { FishPageProps } from './page-props.ts'
import { parseInstance, parseInstancePresets } from './parsers.ts'
import css from './FishPanel.module.css'
import formCss from './pages/pages.module.css'

type PersonaSource = 'empty' | 'write' | 'preset'

/** Management callbacks consume actual host results, never optimistic pause flags. */
interface FishInstanceBarProps {
  readonly call: FishCall
  readonly t: FishPageProps['t']
  readonly instances: readonly FishInstance[]
  readonly selected: FishInstance
  readonly onSelect: (id: string) => void
  readonly onUpdated: (instance: FishInstance, select: boolean) => void
  readonly onRefresh: () => Promise<void>
}

/** The existing workspace gets one host-backed instance selector and small management dialogs. */
export function FishInstanceBar({ call, t, instances, selected, onSelect, onUpdated, onRefresh }: FishInstanceBarProps): ReactNode {
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<'create' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const [source, setSource] = useState<PersonaSource>('empty')
  const [personaName, setPersonaName] = useState('')
  const [body, setBody] = useState('')
  const [presets, setPresets] = useState<readonly FishInstancePreset[]>([])
  const [presetId, setPresetId] = useState('')
  const [presetMenu, setPresetMenu] = useState(false)
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const preset = presets.find(item => `${item.instance_id}:${item.revision}` === presetId)
  useEffect(() => {
    if (dialog !== 'create' || source !== 'preset') { setPresetsLoading(false); return }
    let disposed = false
    setPresetsLoading(true)
    void (async () => {
      const reply = await call('instances.presets')
      if (disposed) return
      const parsed = reply.ok ? parseInstancePresets(reply.value) : reply
      if (parsed.ok) { setPresets(parsed.value); setFailure(null) }
      else setFailure(parsed.failure)
      setPresetsLoading(false)
    })()
    return () => { disposed = true }
  }, [call, dialog, source])

  const open = (kind: 'create' | 'rename'): void => {
    setName(kind === 'rename' ? selected.name : '')
    setPersonaName(''); setBody(''); setSource('empty'); setPresetId('')
    setFailure(null); setValidation(null); setDialog(kind)
  }
  const close = (): void => { if (!busy) setDialog(null) }
  const mutate = async (action: string, params: Record<string, unknown>, choose: boolean): Promise<void> => {
    setBusy(true); setFailure(null)
    const reply = await call(action, params)
    const parsed = reply.ok ? parseInstance(reply.value) : reply
    if (parsed.ok) { onUpdated(parsed.value, choose); setDialog(null) }
    else setFailure(parsed.failure)
    setBusy(false)
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setValidation(null)
    if (name.trim() === '') { setValidation(t('instance.nameRequired')); return }
    if (dialog === 'rename') { void mutate('instances.rename', { id: selected.id, name: name.trim() }, false); return }
    if (source === 'write' && (personaName.trim() === '' || body.trim() === '')) {
      setValidation(t('instance.personaRequired')); return
    }
    if (source === 'preset' && preset === undefined) { setValidation(t('instance.presetRequired')); return }
    const persona = source === 'write' ? { name: personaName.trim(), body }
      : source === 'preset' && preset !== undefined ? { instance_id: preset.instance_id, revision: preset.revision } : undefined
    void mutate('instances.create', { name: name.trim(), running: persona !== undefined,
      ...(persona === undefined ? {} : { persona }) }, true)
  }
  const state = !selected.persona_configured ? 'instance.unconfigured'
    : !selected.enabled ? 'instance.paused' : selected.running ? 'instance.running' : 'instance.starting'
  const formId = 'fish-instance-management-form'
  return (
    <>
      <div className={css.instanceBar}>
        <Menu open={menu} portal selectedId={selected.id} onClose={() => { setMenu(false) }}
          anchor={<Button size="sm" variant="outline" disabled={busy} aria-label={t('instance.select')}
            aria-expanded={menu} onClick={() => { setMenu(value => !value) }}>{selected.name}</Button>}
          items={instances.map(item => ({ id: item.id, disabled: busy,
            label: t('instance.choice', { name: item.name, state: t(!item.persona_configured ? 'instance.unconfigured'
              : !item.enabled ? 'instance.paused' : item.running ? 'instance.running' : 'instance.starting') }) }))}
          onSelect={(id) => { setMenu(false); onSelect(id) }} />
        <span className={css.status} title={selected.status_reason}>
          <StateDot state={!selected.enabled || !selected.persona_configured ? 'warning' : selected.running ? 'done' : 'ongoing'} />
          {selected.status_reason === '' ? t(state) : selected.status_reason}
        </span>
        <div className={css.instanceActions}>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { open('create') }}>{t('instance.new')}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { open('rename') }}>{t('instance.rename')}</Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => { void mutate('instances.set_running', { id: selected.id, running: !selected.enabled }, false) }}>
            {t(selected.enabled ? 'instance.pause' : 'instance.resume')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void onRefresh() }}>{t('refresh')}</Button>
        </div>
      </div>
      {failure !== null && dialog === null && <div className={css.banner} role="alert">
        {t('common.failed', { error: failure.message })}
      </div>}
      <Modal open={dialog !== null} title={t(dialog === 'rename' ? 'instance.rename' : 'instance.new')}
        closeLabel={t('instance.close')} onClose={close} footer={<>
          <Button variant="ghost" disabled={busy} onClick={close}>{t('instance.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy || presetsLoading}>
            {t(busy ? 'instance.saving' : dialog === 'rename' ? 'instance.save' : 'instance.create')}
          </Button>
        </>}>
        <form id={formId} className={css.instanceForm} onSubmit={submit}>
          <label className={formCss.field}><span className={formCss.label}>{t('instance.name')}</span>
            <Input data-modal-autofocus value={name} onChange={(event) => { setName(event.target.value) }} /></label>
          {dialog === 'create' && <>
            <SegmentedControl id="fish-instance-persona-source" value={source} label={t('instance.personaSource')}
              options={[{ value: 'empty', label: t('instance.later') }, { value: 'write', label: t('instance.write') },
                { value: 'preset', label: t('instance.preset') }]} onChange={setSource} />
            <div id={`fish-instance-persona-source-${source}-panel`} role="tabpanel"
              aria-labelledby={`fish-instance-persona-source-${source}`}>
              {source === 'empty' && <p className={formCss.muted}>{t('instance.emptyHint')}</p>}
              {source === 'write' && <div className={css.instanceForm}>
                <label className={formCss.field}><span className={formCss.label}>{t('instance.personaName')}</span>
                  <Input value={personaName} onChange={(event) => { setPersonaName(event.target.value) }} /></label>
                <label className={formCss.field}><span className={formCss.label}>{t('instance.personaBody')}</span>
                  <textarea className={formCss.textarea} rows={8} value={body}
                    onChange={(event) => { setBody(event.target.value) }} /></label>
              </div>}
              {source === 'preset' && <div className={css.instanceForm}>
                <Menu open={presetMenu} portal selectedId={presetId} onClose={() => { setPresetMenu(false) }}
                  anchor={<Button variant="outline" disabled={presetsLoading} onClick={() => { setPresetMenu(value => !value) }}>
                    {presetsLoading ? t('loading') : preset?.name ?? t('instance.pickPreset')}
                  </Button>}
                  items={presets.map(item => ({ id: `${item.instance_id}:${item.revision}`,
                    label: t('instance.presetChoice', { name: item.name, source: item.instance_id }) }))}
                  onSelect={(id) => { setPresetId(id); setPresetMenu(false) }} />
                {!presetsLoading && presets.length === 0 && <p className={formCss.muted}>{t('instance.noPresets')}</p>}
                {preset !== undefined && <textarea className={formCss.textarea} rows={8} readOnly
                  value={preset.body} aria-label={t('instance.personaBody')} />}
              </div>}
            </div>
          </>}
          {validation !== null && <p className={css.statusError} role="alert">{validation}</p>}
          {failure !== null && <p className={css.statusError} role="alert">{t('common.failed', { error: failure.message })}</p>}
        </form>
      </Modal>
    </>
  )
}
