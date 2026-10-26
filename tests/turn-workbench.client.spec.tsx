// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime/src/translate.ts'
import { FishChatPage } from '../src/client/pages/FishChatPage.tsx'
import { zh } from '../src/client/locales.ts'
import { createWorkbench, createInstanceWorkbench } from '../src/client/workbench-client.ts'
import { renderFishResources } from './fish-resource-runtime.tsx'

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  if (originalScroll === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  else Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
})

it('reads real materials and full selected reasoning while new turns arrive, then sends and cancels through its instance', async () => {
  HTMLElement.prototype.scrollIntoView = () => {}
  const usage = { scope: 'instance_main_execution', state: 'partial', request_count: 3, closed_steps: 2,
    turns: 2, usage_reports: 1, input_tokens: 100, output_tokens: 20, cache_read_tokens: null,
    cache_write_tokens: null, uncached_input_tokens: null, cache_hit_ratio: null,
    coverage: { recorded_requests: 4, linked_requests: 3, unlinked_requests: 1 },
    field_reports: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, uncached_input_tokens: 0 } }
  const run = (id: string, text: string) => ({ execution: id, instance_id: 'main', created: id === 'a' ? 1 : 2,
    status: 'completed', raw_status: 'done', trigger: { source: 'qq-group', place: 'group:1', kind: 'group' },
    silent: true, merged: false, merged_into: '', materials_count: 1,
    materials: [{ seq: 1, reference: id, source: 'qq-group', conversation: 'group:1', message: id,
      place: 'group:1', received: 1, payload: {}, considered: true, cancelled: false, original_state: 'available',
      text, preview: '', original: { sender_id: '小明', reply_to: 'quote-1', text, timestamp: 1, segments: [] } }],
    outputs: [{ text: '客户端真实回复', kind: 'message', state: 'sent', target: 'desktop1', call_id: 'say1' }],
    actions: [{ call_id: 'tool1', name: 'fish_search', state: 'failed', started: 1, finished: 2 }],
    trace: { state: 'recorded', id, reference: id, phase: 'silent', has_reasoning: true } })
  let rows = [run('b', '群里第二轮原文'), run('a', '群里第一轮原文')]
  let releaseOld: (() => void) | undefined
  const delayed = new Promise<void>((resolve) => { releaseOld = resolve })
  const requests: { action: string; params: Record<string, unknown> }[] = []
  const call = createInstanceWorkbench(createWorkbench(async (_url, init) => {
    const request = JSON.parse(String(init.body)) as { action: string; params: Record<string, unknown> }
    requests.push(request)
    let result: unknown = {}
    if (request.action === 'turns.list') result = { instance_id: 'main',
      runs: request.params.cursor === 'older' ? [run('old', '更早的群消息')] : rows,
      next_cursor: request.params.cursor === 'older' ? null : 'older', stats: usage }
    if (request.action === 'turn.view') {
      const id = String(request.params.execution)
      if (id === 'a') await delayed
      result = { ...run(id, '原件'), usage: { ...usage, scope: 'turn' },
        trace: { state: 'recorded', id, reference: id, phase: 'silent', has_reasoning: true,
          reasoning: id === 'a' ? '旧轮迟到' : '保存的完整思考' + '。'.repeat(20005),
          events: [{ kind: 'tool_result', at: 2, value: { call_id: 'tool1', name: 'fish_search', result: { ok: false, error: '工具失败原文' } } }] },
        output_speed: { scope: 'content', tokens_per_second: null, reason: 'missing_content_timing_and_tokens' } }
    }
    if (request.action === 'chat.snapshot') result = { conversation_id: 'desktop1', conversations: [], messages: [] }
    if (request.action === 'chat.send') result = { conversation_id: 'desktop1', job_id: 'job1' }
    if (request.action === 'chat.job') result = { status: 'running' }
    if (request.action === 'chat.cancel') result = { cancelled: true }
    return Response.json({ ok: true, result })
  }), 'main')
  const { runtime, view } = await renderFishResources(call, resources => <FishChatPage {...resources} instanceId="main"
    call={call} t={makeTranslate(zh)} formatTimestamp={String} reportRefresh={async () => {}} />)
  try {
    await waitFor(() => { expect(view.getByText('群里第一轮原文')).toBeTruthy() })
    expect(view.getAllByText('客户端真实回复')).toHaveLength(2)
    fireEvent.click(view.getByRole('button', { name: '查看回合 a' }))
    fireEvent.click(view.getByRole('button', { name: '查看回合 b' }))
    await waitFor(() => { expect(view.getByText(/保存的完整思考/).textContent?.length).toBeGreaterThan(20000) })
    fireEvent.click(view.getByRole('button', { name: '查看回合 b' }))
    expect(view.getByText(/保存的完整思考/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '加载更早回合' }))
    await waitFor(() => { expect(view.getByText('更早的群消息')).toBeTruthy() })
    await act(async () => { releaseOld?.() })
    expect(view.queryByText('旧轮迟到')).toBeNull()
    rows = [run('c', '新轮到了'), ...rows]
    fireEvent.click(view.getByRole('button', { name: '刷新回合' }))
    await waitFor(() => { expect(view.getByText('新轮到了')).toBeTruthy() })
    expect(view.getByText(/保存的完整思考/)).toBeTruthy()
    expect(view.getByText('更早的群消息')).toBeTruthy()
    expect(view.getByText('工具失败原文', { exact: false })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /^实例累计 ·/ }))
    expect(view.getByRole('dialog').textContent).toContain('未关联')
    expect(view.getByRole('dialog').textContent).toContain('未知')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(view.getByRole('textbox'), { target: { value: '新的客户端消息' } })
    fireEvent.click(view.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(requests.some(row => row.action === 'chat.job')).toBe(true) })
    fireEvent.click(view.getByRole('button', { name: '取消等待' }))
    await waitFor(() => { expect(requests.some(row => row.action === 'chat.cancel')).toBe(true) })
    expect(requests.every(row => row.params.instance_id === 'main')).toBe(true)
    expect(requests.some(row => ['chat.thoughts', 'chat.reasoning', 'activity.recent'].includes(row.action))).toBe(false)
  } finally { await runtime.dispose() }
})
