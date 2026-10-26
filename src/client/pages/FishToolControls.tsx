/** Instance-owned switches: only committed backend values are displayed. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Checkbox, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishToolSettings } from '../contract/workbench.ts'
import type { FishPageProps } from '../page-props.ts'
import { parseToolSettings } from '../parsers.ts'
import css from './pages.module.css'

/** Display and update the real choices of the caller's fixed Fish instance. */
export function FishToolControls({ call, t }: Pick<FishPageProps, 'call' | 't'>): ReactNode {
  const [value, setValue] = useState<FishToolSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const load = useCallback(async (): Promise<void> => {
    const epoch = ++generation.current
    setBusy(true)
    const reply = await call('tools.settings.get')
    if (epoch !== generation.current) return
    if (!reply.ok) setError(reply.failure.message)
    else {
      const parsed = parseToolSettings(reply.value)
      if (!parsed.ok) setError(parsed.failure.message)
      else { setValue(parsed.value); setError(null) }
    }
    setBusy(false)
  }, [call])
  useEffect(() => {
    setValue(null)
    void load()
    return () => { generation.current += 1 }
  }, [load])
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    const epoch = ++generation.current
    setBusy(true)
    const reply = await call('tools.settings.save', { patch })
    if (epoch !== generation.current) return
    if (!reply.ok) setError(reply.failure.message)
    else {
      const parsed = parseToolSettings(reply.value)
      if (!parsed.ok) setError(parsed.failure.message)
      else { setValue(parsed.value); setError(null) }
    }
    setBusy(false)
  }
  return <section className={css.settingsCard}>
    <h3 className={css.cardTitle}>{t('tools.windowTitle')}</h3>
    <p className={css.hint}>{t('tools.windowHint')}</p>
    {error !== null && <p className={css.inlineError} role="alert">{error}</p>}
    {value === null ? <Button disabled={busy} onClick={() => { void load() }}>{t('refresh')}</Button> : <>
      <div className={css.settingsRow}>
        <span>{t('tools.privateSend')}</span>
        <Switch checked={value.settings.send.private} disabled={busy} label={t('tools.privateSend')}
          onChange={(enabled) => { void save({ send: { private: enabled } }) }} />
      </div>
      <div className={css.settingsRow}>
        <span>{t('tools.groupSend')}</span>
        <Switch checked={value.settings.send.group} disabled={busy} label={t('tools.groupSend')}
          onChange={(enabled) => { void save({ send: { group: enabled } }) }} />
      </div>
      <details>
        <summary>{t('tools.groupChoices')}</summary>
        {value.groups.map(group => <div key={group} className={css.settingsRow}>
          <span>{t('tools.oneGroup', { id: group })}</span>
          <Switch checked={value.settings.send.groups[group] !== false} disabled={busy} label={t('tools.oneGroup', { id: group })}
            onChange={(enabled) => { void save({ send: { groups: { [group]: enabled } } }) }} />
        </div>)}
      </details>
      <details>
        <summary>{t('tools.individualTools')}</summary>
        {value.tools.map(tool => <div key={tool.name} className={css.section}>
          <Checkbox checked={value.settings.tools[tool.name] !== false} disabled={busy} label={tool.name}
            onChange={(enabled) => { void save({ tools: { [tool.name]: enabled } }) }} />
          <span className={css.hint}>{tool.description}</span>
          {!tool.enabled && tool.reason !== '' && <span className={css.inlineNotice}>{tool.reason}</span>}
        </div>)}
      </details>
    </>}
  </section>
}
