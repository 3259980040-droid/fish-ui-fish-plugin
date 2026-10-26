/** QQ participation for this instance; sending is the existing tool-capability projection. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Input, Menu, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishChannelGroup, FishChannelStatus } from '../contract/workbench.ts'
import type { FishFailure } from '../contract/slots.ts'
import type { FishPageProps } from '../page-props.ts'
import { parseChannels } from '../parsers.ts'
import { GroupStatusFacts } from './GroupStatusFacts.tsx'
import css from './pages.module.css'

type ChannelProps = Pick<FishPageProps, 'call' | 't'>

/** One group's controls never disable sending merely because reception is off. */
function GroupParticipationRow({ group, busy, t, update }: Pick<ChannelProps, 't'> & {
  readonly group: FishChannelGroup
  readonly busy: boolean
  readonly update: (params: Record<string, unknown>) => Promise<boolean>
}): ReactNode {
  const [topic, setTopic] = useState<string | null>(null)
  const saveTopic = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (await update({ group_id: group.id, topic: topic ?? group.topic })) setTopic(null)
  }
  const switches = [
    { field: 'listen', value: group.listen, label: 'channels.groupListen', text: 'channels.listen' },
    { field: 'read', value: group.read, label: 'channels.groupRead', text: 'channels.read' },
    { field: 'reply', value: group.reply, label: 'channels.groupSend', text: 'channels.send' },
  ] as const
  return <li className={css.card}>
    <h4 className={css.cardTitle}>{t('settings.channelGroup', { id: group.id })}</h4>
    {switches.map(item => <div key={item.field} className={css.settingsRow}>
      <span>{t(item.text)}</span>
      <Switch checked={item.value} label={t(item.label, { id: group.id })} disabled={busy}
        onChange={(value) => { void update({ group_id: group.id, [item.field]: value }) }} />
    </div>)}
    <form className={css.form} onSubmit={(event) => { void saveTopic(event) }}>
      <label className={css.field}><span className={css.label}>{t('settings.channelTopic')}</span>
        <Input value={topic ?? group.topic} placeholder={t('settings.channelTopicPlaceholder')} disabled={busy}
          onChange={(event) => { setTopic(event.target.value) }} /></label>
      <div className={css.formActions}>
        <Button size="sm" variant="outline" type="submit" disabled={busy || topic === null || topic === group.topic}>
          {t('channels.saveTopic')}
        </Button>
      </div>
    </form>
    <details className={css.help}>
      <summary className={css.helpSummary}>{t('channels.groupFacts')}</summary>
      <GroupStatusFacts group={group} t={t} />
    </details>
  </li>
}

/** Read, edit and read back the same channels.status contract within the original Settings page. */
export function FishChannelsSettings({ call, t }: ChannelProps): ReactNode {
  const [channel, setChannel] = useState<FishChannelStatus | null>(null)
  const [failure, setFailure] = useState<FishFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [topic, setTopic] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const load = async (): Promise<void> => {
    setLoading(true)
    setNotice(null)
    const reply = await call('channels.status')
    const parsed = reply.ok ? parseChannels(reply.value) : reply
    if (parsed.ok) { setChannel(parsed.value); setFailure(null) }
    else setFailure(parsed.failure)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const update = async (params: Record<string, unknown>): Promise<boolean> => {
    setBusy(true); setFailure(null); setNotice(null)
    try {
      const reply = await call('channels.update', params)
      const saved = reply.ok ? parseChannels(reply.value) : reply
      if (!saved.ok) { setFailure(saved.failure); return false }
      const reread = await call('channels.status')
      const parsed = reread.ok ? parseChannels(reread.value) : reread
      if (!parsed.ok) {
        setFailure({ ...parsed.failure, message: t('channels.readbackFailed', { error: parsed.failure.message }) })
        return false
      }
      setChannel(parsed.value)
      const effectiveSend = params.reply === true
        && parsed.value.groups.find(group => group.id === params.group_id)?.reply === false
      setNotice(t(effectiveSend ? 'channels.sendStillOff' : 'settings.saved'))
      return true
    } finally { setBusy(false) }
  }
  const addGroup = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const id = groupId.trim()
    if (!/^\d+$/.test(id)) { setFormError(t('channels.invalidGroup')); return }
    setFormError(null)
    if (await update({ group_id: id, listen: true, ...(topic.trim() === '' ? {} : { topic }) })) { setGroupId(''); setTopic('') }
  }
  const selected = channel?.connections.find(item => item.id === channel.connection_id)
  return <section className={css.settingsCard} aria-label={t('settings.channelTitle')}>
    <div className={css.settingsRow}>
      <h3 className={css.cardTitle}>{t('settings.channelTitle')}</h3>
      <Button size="sm" variant="ghost" disabled={loading || busy} onClick={() => { void load() }}>{t('refresh')}</Button>
    </div>
    {failure !== null && <p className={css.inlineError} role="alert">{failure.message}</p>}
    {notice !== null && <p className={css.inlineNotice} role="status">{notice}</p>}
    {channel === null && loading && <p className={css.muted}>{t('settings.channelLoading')}</p>}
    {channel !== null && <>
      <p className={css.muted}>{t('settings.channelHint')}</p>
      <div className={css.settingsRow}>
        <span>{t('channels.connection')}</span>
        <Menu open={menu} portal selectedId={channel.connection_id || 'none'} onClose={() => { setMenu(false) }}
          anchor={<Button size="sm" variant="outline" disabled={busy} aria-label={t('channels.selectConnection')}
            aria-expanded={menu} onClick={() => { setMenu(value => !value) }}>{selected?.name ?? t('channels.unlinked')}</Button>}
          items={[{ id: 'none', label: t('channels.unlink'), disabled: busy },
            ...channel.connections.map(item => ({ id: item.id, disabled: busy,
              label: t('channels.connectionChoice', { name: item.name, bot: item.bot || t('common.nothing'),
                state: t(item.connected ? 'settings.serviceReady' : 'settings.serviceDown') }) }))]}
          onSelect={(id) => { setMenu(false); void update({ connection_id: id === 'none' ? '' : id }) }} />
      </div>
      {channel.connection_id === '' && <p className={css.hint}>{t('channels.unlinkedHint')}</p>}
      <dl className={css.facts}>
        <dt>{t('channels.instance')}</dt><dd>{channel.instance_id}</dd>
        <dt>{t('settings.channelOwner')}</dt><dd>{channel.owner}</dd>
        <dt>{t('settings.channelBot')}</dt><dd>{channel.bot || t('common.nothing')}</dd>
      </dl>
      <div className={css.settingsRow}>
        <span>{t('channels.receive')}</span>
        <Switch checked={channel.receive} disabled={busy} label={t('channels.receive')}
          onChange={(value) => { void update({ receive: value }) }} />
      </div>
      <div className={css.settingsRow}>
        <span>{t('channels.privateReceive')}</span>
        <Switch checked={channel.private_receive} disabled={busy} label={t('channels.privateReceive')}
          onChange={(value) => { void update({ private_receive: value }) }} />
      </div>
      <p className={css.hint}>{t('channels.sendSource')}</p>
      <form className={css.form} onSubmit={(event) => { void addGroup(event) }}>
        <label className={css.field}><span className={css.label}>{t('channels.newGroup')}</span>
          <Input value={groupId} inputMode="numeric" disabled={busy} onChange={(event) => { setGroupId(event.target.value) }} /></label>
        <label className={css.field}><span className={css.label}>{t('channels.newTopic')}</span>
          <Input value={topic} disabled={busy} onChange={(event) => { setTopic(event.target.value) }} /></label>
        <p className={css.hint}>{t('channels.addHint')}</p>
        {formError !== null && <p className={css.inlineError} role="alert">{formError}</p>}
        <div className={css.formActions}>
          <Button type="submit" variant="outline" disabled={busy}>{t('channels.addGroup')}</Button>
        </div>
      </form>
      {channel.groups.length === 0 ? <p className={css.muted}>{t('settings.channelNoGroups')}</p>
        : <ul className={css.cards}>{channel.groups.map(group => <GroupParticipationRow
          key={group.id} group={group} busy={busy} t={t} update={update} />)}</ul>}
      <details className={css.help}>
        <summary className={css.helpSummary}>{t('settings.services')}</summary>
        <ul className={css.rows}>{channel.services.map(service => <li key={service.name} className={css.taskRow}>
          <StateDot state={service.ready ? 'done' : 'idle'} />
          <div className={css.taskBody}><span>{service.name}</span>
            <span className={css.rowMeta}>{t(service.ready ? 'settings.serviceReady' : 'settings.serviceDown')}
              {service.detail === '' ? '' : ` · ${service.detail}`}</span>
          </div>
        </li>)}</ul>
      </details>
      {channel.note !== '' && <p className={css.muted}>{t('settings.channelNote', { note: channel.note })}</p>}
    </>}
  </section>
}
