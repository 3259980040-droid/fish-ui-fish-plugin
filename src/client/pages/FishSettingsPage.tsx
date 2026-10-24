/**
 * Settings: the operating mode, the pause flag, the daily message budget, the
 * real channel status *with its switches*, and the two switches that matter
 * (pause, computer.work). The old Channels page is merged in here — group
 * participation and the private route are settings, and having them on a second
 * tab meant two places to look for one policy.
 * The owner account holds every capability, so the rest are listed read-only
 * behind one disclosure instead of being offered as thirteen toggles. Each
 * control reports the state its own reply returns, so the panel header and the
 * page never show two versions of one setting.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, IconWarningOutlineRegular, Input, SegmentedControl, Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishFailure, FishResult } from '../contract/slots.ts'
import type { FishChannelGroup, FishChannelStatus, FishMode, FishSettings } from '../contract/workbench.ts'
import { parseChannels, parseModeSet, parseSettings } from '../parsers.ts'
import type { FishPageProps } from '../page-props.ts'
import { GroupStatusFacts } from './GroupStatusFacts.tsx'
import { PageHint } from './PageHint.tsx'
import { FaultStatus } from './FaultStatus.tsx'
import css from './pages.module.css'

/** Failure text of a settled reply, or null when it succeeded. */
function failureText<T>(result: FishResult<T>): FishFailure | null {
  return result.ok ? null : result.failure
}

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The one permission bit the page still offers as a switch. */
const COMPUTER_WORK = 'computer.work'

/** Names of the capabilities the owner account holds, joined for the read-only list. */
function enabledCapabilities(settings: FishSettings, t: FishPageProps['t']): string {
  const names = settings.owner_permissions
    .map(key => settings.owner_capabilities[key])
    .filter((label): label is string => typeof label === 'string' && label !== '')
  return names.length === 0 ? t('common.nothing') : names.join('、')
}

/**
 * Render the settings page.
 * @param props - the workbench face and localized copy shared by every page.
 * @returns the mode, pause, budget, and effective-setting sections.
 */
const PACING_FIELDS = [
  { key: 'maintenance_interval_s', label: 'settings.pacingMaintenance', min: 20, max: 300 },
  { key: 'proactive_check_min_s', label: 'settings.pacingMin', min: 30, max: 3600 },
  { key: 'proactive_check_max_s', label: 'settings.pacingMax', min: 30, max: 3600 },
  { key: 'round_bypass_messages', label: 'settings.pacingBypass', min: 1, max: 200 },
  { key: 'round_backoff_start_after', label: 'settings.pacingStart', min: 1, max: 20 },
  { key: 'round_backoff_base', label: 'settings.pacingBase', min: 15, max: 3600 },
  { key: 'round_backoff_cap', label: 'settings.pacingCap', min: 30, max: 3600 },
] as const

export function FishSettingsPage({ call, t, reportRefresh, formatTimestamp }: FishPageProps): ReactNode {
  const [settings, setSettings] = useState<FishSettings | null>(null)
  // Pacing lives in context-settings.json; the numbers here are the ones that run.
  const [pacing, setPacing] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [unlimited, setUnlimited] = useState(false)
  const [limit, setLimit] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState('')
  // The real channel state: who she answers as, the private route, and each
  // whitelisted group's policy. The Channels page used to own this; Settings now
  // shows it beside the switches that write it, so there is one version of it.
  const [channel, setChannel] = useState<FishChannelStatus | null>(null)
  const [channelLoaded, setChannelLoaded] = useState(false)
  const [channelSaving, setChannelSaving] = useState('')

  const applySettings = (next: FishSettings): void => {
    setSettings(next)
    setUnlimited(next.daily_limits.unlimited)
    setLimit(String(next.daily_limits.limit))
    setWorkspace(next.workspace)
  }

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await call('settings.get')
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseSettings(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      applySettings(parsed.value)
      setFailure(null)
      const channelReply = await call('channels.status')
      const parsedChannel = parseChannels(channelReply.ok ? channelReply.value : undefined)
      setChannel(parsedChannel.ok ? parsedChannel.value : null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setLoading(false)
      setChannelLoaded(true)
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
    // The first read runs once for the page's life; later reads go through this form's actions.
  }, [])

  const switchMode = async (mode: FishMode): Promise<void> => {
    setSwitching(true)
    setNotice(null)
    try {
      const result = await call('mode.set', { mode, workspace })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseModeSet(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      setSettings(current => current === null ? current : { ...current, ...parsed.value })
      setFailure(null)
      await reportRefresh(null)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setSwitching(false)
    }
  }

  const setPaused = async (paused: boolean): Promise<void> => {
    setSaving(true)
    setNotice(null)
    try {
      const result = await call('settings.save', { paused })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseSettings(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      applySettings(parsed.value)
      setFailure(null)
      setNotice(t('settings.saved'))
      await reportRefresh(t('settings.saved'))
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setSaving(false)
    }
  }

  const saveBudget = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const nextLimit = Number(limit)
    if (!unlimited && (!Number.isInteger(nextLimit) || nextLimit <= 0)) {
      setFormError(t('settings.invalidLimit'))
      return
    }
    setFormError(null)
    setSaving(true)
    setNotice(null)
    try {
      const result = await call('settings.save', {
        daily_limits: unlimited
          ? { unlimited: true, limit: Number.isInteger(nextLimit) && nextLimit > 0 ? nextLimit : settings?.daily_limits.limit ?? nextLimit }
          : { unlimited: false, limit: nextLimit },
      })
      const failed = failureText(result)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const parsed = parseSettings(result.ok ? result.value : undefined)
      if (!parsed.ok) {
        setFailure(parsed.failure)
        return
      }
      applySettings(parsed.value)
      setFailure(null)
      setNotice(t('settings.saved'))
      await reportRefresh(t('settings.saved'))
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Write one group switch or its background text through channels.update, then
   * re-read the same status the switch came from so the row and the policy cannot
   * disagree. Turning listening off also turns speaking off, exactly as the
   * backend policy does.
   */
  const updateGroup = async (group: FishChannelGroup, field: 'listen' | 'reply' | 'topic', value: boolean | string): Promise<void> => {
    const key = `${group.id}:${field}`
    setChannelSaving(key)
    setFailure(null)
    try {
      const params: Record<string, unknown> = { group_id: group.id, [field]: value }
      if (field === 'listen' && !value) params.reply = false
      const reply = await call('channels.update', params)
      const failed = failureText(reply)
      if (failed !== null) {
        setFailure(failed)
        return
      }
      const refreshed = await call('channels.status')
      const parsed = parseChannels(refreshed.ok ? refreshed.value : undefined)
      if (parsed.ok) setChannel(parsed.value)
    } catch (error) {
      setFailure({ message: reasonOf(error), offline: false })
    } finally {
      setChannelSaving('')
    }
  }

  const saveChanges = async (changes: Record<string, unknown>): Promise<void> => {
    setSaving(true)
    const result = await call('settings.save', changes)
    if (!result.ok) setFailure(result.failure)
    else {
      const next = parseSettings(result.value)
      if (next.ok) { applySettings(next.value); setFailure(null); await reportRefresh(t('settings.saved')) }
      else setFailure(next.failure)
    }
    setSaving(false)
  }
  const busy = saving || switching
  useEffect(() => {
    void (async () => {
      try {
        const reply = await call('settings.get')
        const paced = (reply.ok ? reply.value : null) as Record<string, unknown> | null
        const values = (paced?.pacing ?? {}) as Record<string, unknown>
        const next: Record<string, string> = {}
        for (const field of PACING_FIELDS) {
          if (values[field.key] !== undefined) next[field.key] = String(values[field.key])
        }
        setPacing(next)
      } catch { setPacing({}) }
    })()
  }, [])
  return (
    <div className={css.settings}>
      <FaultStatus call={call} t={t} reportRefresh={reportRefresh} formatTimestamp={formatTimestamp} />
      <div className={css.settingsHead}>
        <h2 className={css.sectionTitle}>{t('pages.settings')}</h2>
        {notice !== null && <span className={css.inlineNotice} role="status">{notice}</span>}
      </div>
      {failure !== null && <p className={css.inlineError} role="alert">
        <IconWarningOutlineRegular size={14} />{t('common.failed', { error: failure.message })}
      </p>}
      {loading && settings === null && <p className={css.muted} role="status">{t('loading')}</p>}
      <PageHint label={t('common.help')} items={[t('settings.modeHint'), t('settings.channelHint'), t('settings.autoReplyHint'), t('settings.pausedHint'), t('settings.imageIdentificationHint'), t('settings.responseHint'), t('settings.sendingHint'), t('settings.budgetHint'), t('settings.limitHint')]} />
      {settings !== null && <>
        <section className={css.settingsCard} aria-label={t('settings.pacing')}>
          <div className={css.settingsRow}>
            <div className={css.settingsText}>
              <h3 className={css.cardTitle}>{t('settings.pacing')}</h3>
              <p className={css.hint}>{t('settings.pacingHint')}</p>
            </div>
            <Button disabled={busy} onClick={() => { void saveChanges(pacing) }}>{t('settings.pacingSave')}</Button>
          </div>
          {PACING_FIELDS.map(field => (
            <label key={field.key} className={css.settingsRow}>
              <span>{t(field.label)}</span>
              <input
                type="number"
                min={field.min}
                max={field.max}
                value={pacing[field.key] ?? ''}
                disabled={busy}
                onChange={(event) => { setPacing({ ...pacing, [field.key]: event.target.value }) }}
              />
            </label>
          ))}
        </section>
        <section className={css.settingsCard}>
          <div className={css.settingsRow}>
            <span>{t('settings.qzone')}</span>
            <Switch checked={settings.qzone_enabled} disabled={busy} label={t('settings.qzone')} onChange={(value) => { void saveChanges({ qzone_enabled: value }) }} />
          </div>
          <div className={css.settingsRow}>
            <span>{t('settings.background')}</span>
            <Switch checked={settings.keep_background_on_close} label={t('settings.background')} disabled={busy}
              onChange={(value) => { void saveChanges({ keep_background_on_close: value }) }} />
          </div>
          <Button disabled={busy} onClick={() => { void (async () => {
            setSaving(true)
            const result = await call('service.restart')
            if (!result.ok) setFailure(result.failure)
            else { await load(); await reportRefresh(t('settings.saved')) }
            setSaving(false)
          })() }}>{t('settings.restart')}</Button>
        </section>
        <section className={css.settingsCard} aria-label={t('settings.mode')}>
          <div className={css.settingsRow}>
            <div className={css.settingsText}>
              <h3 className={css.cardTitle}>{t('settings.mode')}</h3>
            </div>
            <SegmentedControl<FishMode>
              id="fish-mode"
              value={settings.mode}
              label={t('settings.mode')}
              disabled={busy}
              options={[
                { value: 'chat', label: t('mode.chat'), title: t('mode.switchTo', { mode: t('mode.chat') }) },
                { value: 'work', label: t('mode.work'), title: t('mode.switchTo', { mode: t('mode.work') }) },
              ]}
              onChange={(next) => { void switchMode(next) }}
            />
          </div>
        </section>
        <section className={css.settingsCard}>
          <h3 className={css.cardTitle}>{t('settings.workspace')}</h3>
          <Input value={workspace} aria-label={t('settings.workspace')}
            onChange={(event) => { setWorkspace(event.target.value) }} />
          <Button disabled={busy} onClick={() => { void switchMode(settings.mode) }}>{t('save')}</Button>
        </section>
        <section className={css.settingsCard}>
          <h3 className={css.cardTitle}>{t('settings.response')}</h3>
          <div className={css.settingsRow}>
            <span>{t('settings.toolUnlimited')}</span>
            <Switch checked={settings.max_tool_calls_per_turn === 0} disabled={busy} label={t('settings.toolUnlimited')}
              onChange={(value) => { void saveChanges({ max_tool_calls_per_turn: value ? 0 : 24 }) }} />
          </div>
          <div className={css.settingsRow}>
            <span>{t('settings.thinking')}</span>
            <Switch checked={settings.chat_reasoning_effort !== 'off'} disabled={busy} label={t('settings.thinking')}
              onChange={(value) => { void saveChanges({ chat_reasoning_effort: value ? 'high' : 'off' }) }} />
          </div>
          <div className={css.settingsRow}>
            <span>{t('settings.display')}</span>
            <SegmentedControl id="fish-reply-display" value={settings.reply_display} label={t('settings.display')} disabled={busy}
              options={[
                { value: 'persona', label: t('settings.displayPersona') },
                { value: 'final', label: t('settings.displayFinal') },
                { value: 'thinking_excerpt', label: t('settings.displayThinking') },
              ]}
              onChange={(value) => { void saveChanges({ reply_display: value }) }} />
          </div>
          <div className={css.settingsRow}>
            <span>{t('settings.imageIdentification')}</span>
            <Switch checked={settings.image_identification_enabled} disabled={busy} label={t('settings.imageIdentification')}
              onChange={(value) => { void saveChanges({ image_identification_enabled: value }) }} />
          </div>
        </section>
        <section className={css.settingsCard}>
          <h3 className={css.cardTitle}>{t('settings.sending')}</h3>
          <div className={css.settingsRow}>
            <span>{t('settings.ownerReply')}</span>
            <Switch checked={settings.send_policy.owner_private.owner_reply} disabled={busy} label={t('settings.ownerReply')}
              onChange={(value) => { void saveChanges({ send_policy: { owner_private: { owner_reply: value } } }) }} />
          </div>
          <div className={css.settingsRow}>
            <span>{t('settings.scheduledResult')}</span>
            <Switch checked={settings.send_policy.owner_private.scheduled_result} disabled={busy} label={t('settings.scheduledResult')}
              onChange={(value) => { void saveChanges({ send_policy: { owner_private: { scheduled_result: value } } }) }} />
          </div>
          <div className={css.settingsRow}>
            <span>{t('settings.groupRequest')}</span>
            <Switch checked={settings.send_policy.group.owner_request} disabled={busy} label={t('settings.groupRequest')}
              onChange={(value) => { void saveChanges({ send_policy: { group: { owner_request: value } } }) }} />
          </div>
        </section>
        <form className={css.settingsCard} aria-label={t('settings.budget')} onSubmit={(event) => { void saveBudget(event) }}>
          <div className={css.settingsRow}>
            <div className={css.settingsText}>
              <h3 className={css.cardTitle}>{t('settings.budget')}</h3>
            </div>
            <Switch
              checked={unlimited}
              label={t('settings.budget')}
              disabled={busy}
              onChange={(next) => { setUnlimited(next) }}
            />
          </div>
          <div className={css.settingsRow}>
            <div className={css.settingsText}>
              <h3 className={css.cardTitle}>{t('settings.limit')}</h3>
            </div>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              aria-label={t('settings.limit')}
              className={css.limitInput ?? ''}
              value={unlimited ? '' : limit}
              disabled={busy || unlimited}
              onChange={(event) => { setLimit(event.target.value) }}
            />
          </div>
          {formError !== null && <p className={css.inlineError} role="alert">{formError}</p>}
          <div className={css.formActions}>
            <span className={css.muted}>
              {settings.daily_limits.unlimited
                ? t('limits.unlimited')
                : `${t('limits.count', { used: settings.daily_limits.used, limit: settings.daily_limits.limit })} · ${t('limits.remaining', { remaining: settings.daily_limits.remaining })}`}
            </span>
            <Button type="submit" variant="primary" disabled={busy}>
              {saving ? t('settings.saving') : t('settings.save')}
            </Button>
          </div>
        </form>
      </>}
      {settings !== null && <section className={css.settingsCard} aria-label={t('settings.applied')}>
        <h3 className={css.cardTitle}>{t('settings.applied')}</h3>
        <dl className={css.facts}>
          <dt>{t('settings.owner')}</dt>
          <dd>{settings.owner}</dd>
          <dt>{t('mode.label')}</dt>
          <dd>{t(settings.mode === 'work' ? 'mode.work' : 'mode.chat')}</dd>
          <dt>{t('settings.root')}</dt>
          <dd><code>{settings.paths.root}</code></dd>
          <dt>{t('settings.workspace')}</dt>
          <dd><code>{settings.paths.workspace}</code></dd>
        </dl>
        <p className={css.muted}>{t('settings.ownerLine')}</p>
        <div className={css.settingsRow}>
          <span>{t('settings.paused')}</span>
          <Switch
            checked={settings.paused}
            label={t('settings.paused')}
            disabled={busy}
            onChange={(next) => { void setPaused(next) }}
          />
        </div>
        <div className={css.settingsRow}>
          <span>{t('settings.computerWork')}</span>
          <Switch
            checked={settings.owner_permissions.includes(COMPUTER_WORK)}
            label={t('settings.computerWork')}
            disabled={busy}
            onChange={(value) => {
              const permissions = value
                ? [...settings.owner_permissions, COMPUTER_WORK]
                : settings.owner_permissions.filter(item => item !== COMPUTER_WORK)
              void saveChanges({ owner_permissions: permissions })
            }}
          />
        </div>
        <details className={css.help}>
          <summary className={css.helpSummary}>{t('settings.advanced')}</summary>
          <p className={css.muted}>
            {t('settings.enabledNow', { names: enabledCapabilities(settings, t) })}
          </p>
        </details>
      </section>}
      {channelLoaded && <section className={css.settingsCard} aria-label={t('settings.channelTitle')}>
        <h3 className={css.cardTitle}>{t('settings.channelTitle')}</h3>
        <p className={css.muted}>{t('settings.channelHint')}</p>
        {channel === null
          ? <p className={css.muted}>{t('settings.channelLoading')}</p>
          : <>
            <dl className={css.facts}>
              <dt>{t('settings.channelOwner')}</dt>
              <dd>{channel.owner}</dd>
              <dt>{t('settings.channelBot')}</dt>
              <dd>{channel.bot}</dd>
              <dt>{t('settings.channelRoute')}</dt>
              <dd>{t('settings.channelRouteValue', { route: channel.private_route })}</dd>
            </dl>
            {channel.groups.length === 0
              ? <p className={css.muted}>{t('settings.channelNoGroups')}</p>
              : <ul className={css.rows}>
                {channel.groups.map((group, index) => (
                  <li key={`${group.id}:${String(index)}`} className={css.taskRow}>
                    <div className={css.taskBody}>
                      <span className={css.rowTitle}>{t('settings.channelGroup', { id: group.id })}</span>
                      <GroupStatusFacts group={group} t={t} />
                      <Input
                        key={group.id + group.topic}
                        defaultValue={group.topic}
                        aria-label={t('settings.channelTopic')}
                        placeholder={t('settings.channelTopicPlaceholder')}
                        disabled={channelSaving !== ''}
                        onBlur={(event) => {
                          if (event.target.value !== group.topic) void updateGroup(group, 'topic', event.target.value)
                        }}
                      />
                    </div>
                    <div className={css.rowActions}>
                      <Switch
                        checked={group.listen}
                        label={t('settings.listen')}
                        disabled={channelSaving !== ''}
                        onChange={(value) => { void updateGroup(group, 'listen', value) }}
                      />
                      <Switch
                        checked={group.reply}
                        label={t('settings.reply')}
                        disabled={channelSaving !== '' || !group.listen}
                        onChange={(value) => { void updateGroup(group, 'reply', value) }}
                      />
                    </div>
                  </li>
                ))}
              </ul>}
            <p className={css.hint}>{t('settings.autoReplyHint')}</p>
            {channel.note !== '' && <p className={css.muted}>{t('settings.channelNote', { note: channel.note })}</p>}
          </>}
      </section>}
    </div>
  )
}
