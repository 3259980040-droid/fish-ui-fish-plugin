// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime/src/translate.ts'
import { FishPanel } from '../src/client/FishPanel.tsx'
import { zh } from '../src/client/locales.ts'
import { createWorkbench } from '../src/client/workbench-client.ts'
import { renderFishResources } from './fish-resource-runtime.tsx'

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  if (originalScroll === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  else Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
})

it('restores a selected instance and keeps late replies and management actions with their own window', async () => {
  HTMLElement.prototype.scrollIntoView = () => {}
  const entries = [
    { id: 'main', name: '窗口一', initial: true, enabled: true, running: true,
      persona_configured: true, persona_id: 'p1', persona_name: '人格一', status_reason: '' },
    { id: 'second', name: '窗口二', initial: false, enabled: true, running: true,
      persona_configured: true, persona_id: 'p2', persona_name: '人格二', status_reason: '' },
  ]
  const received: { action: string; params: Record<string, unknown> }[] = []
  let releaseFirst: (() => void) | undefined
  const firstStatus = new Promise<void>((resolve) => { releaseFirst = resolve })
  const call = createWorkbench(async (_url, init) => {
    const request = JSON.parse(String(init.body)) as { action: string; params: Record<string, unknown> }
    received.push(request)
    let result: unknown
    if (request.action === 'instances.list') result = { initial_instance_id: 'main', instances: entries }
    else if (request.action === 'status') {
      if (request.params.instance_id === 'main') await firstStatus
      const instance = entries.find(entry => entry.id === request.params.instance_id)!
      result = { owner: '主人', mode: 'chat', workspace: instance.id, permissions: 'owner',
        persona: { id: instance.persona_id, name: instance.persona_name, body: '' },
        paused: !instance.enabled, daily_limits: { limit: 0, used: 0, remaining: 0, unlimited: true },
        paths: { root: instance.id, workspace: instance.id } }
    } else if (request.action === 'chat.snapshot') result = { conversation_id: 'chat', conversations: [], messages: [] }
    else if (request.action === 'activity.recent') result = []
    else if (request.action === 'instances.create') {
      const entry = { id: 'third', name: String(request.params.name), initial: false, enabled: false, running: false,
        persona_configured: false, persona_id: '', persona_name: '', status_reason: '尚未配置人格，请填写或选择人格后启动' }
      entries.push(entry)
      result = entry
    } else result = {}
    return Response.json({ ok: true, result })
  })
  let saved = 'second'
  const { runtime, view } = await renderFishResources(call, resources => <FishPanel {...resources}
    call={call} t={makeTranslate(zh)} formatTimestamp={String}
    readSelectedInstance={() => saved} saveSelectedInstance={(id) => { saved = id }} />)
  try {
    await waitFor(() => { expect(view.getByText('当前性格：人格二')).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: '选择 Fish 窗口' }))
    fireEvent.click(view.getByRole('menuitem', { name: /窗口一/ }))
    await waitFor(() => { expect(received.some(row => row.action === 'status' && row.params.instance_id === 'main')).toBe(true) })
    fireEvent.click(view.getByRole('button', { name: '选择 Fish 窗口' }))
    fireEvent.click(view.getByRole('menuitem', { name: /窗口二/ }))
    await act(async () => { releaseFirst?.() })
    await waitFor(() => { expect(view.getByText('当前性格：人格二')).toBeTruthy() })
    expect(view.queryByText('当前性格：人格一')).toBeNull()
    expect(saved).toBe('second')
    fireEvent.click(view.getByRole('button', { name: '新增窗口' }))
    fireEvent.change(view.getByLabelText('窗口名称'), { target: { value: '窗口三' } })
    fireEvent.click(view.getByRole('button', { name: '创建窗口' }))
    await waitFor(() => { expect(view.getByText('尚未配置人格，请填写或选择人格后启动')).toBeTruthy() })
    expect(received.find(row => row.action === 'instances.create')?.params).toEqual({ name: '窗口三', running: false, instance_id: 'second' })
    expect(saved).toBe('third')
    expect(received.filter(row => row.action === 'instances.set_running')).toHaveLength(0)
  } finally { await runtime.dispose() }
})
