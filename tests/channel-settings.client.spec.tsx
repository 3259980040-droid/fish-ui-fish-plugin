// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime/src/translate.ts'
import type { FishInstanceId } from '../src/client/contract/workbench.ts'
import { FishChannelsSettings } from '../src/client/pages/FishChannelsSettings.tsx'
import { zh } from '../src/client/locales.ts'
import { createInstanceWorkbench, createWorkbench } from '../src/client/workbench-client.ts'

afterEach(cleanup)

it('keeps QQ participation and sending independent and retains confirmed values on read failure', async () => {
  const state = { instance_id: 'second', version: 1, connection_id: '', receive: true, private_receive: true,
    connections: [{ id: 'qq', name: '现有QQ连接', bot: '9000', connected: true }], owner: '1000', bot: '9000',
    private_route: 'normal', note: '', services: [],
    groups: [{ id: '101', listen: true, reply: true, read: true, topic: '原有话题', route: 'normal', engine: 'fish', learn: true }] }
  const updates: Record<string, unknown>[] = []
  let refuseReadback = false
  let refuseTopic = true
  const rawCall = createWorkbench(async (_url, init) => {
    const request = JSON.parse(String(init.body)) as { action: string; params: Record<string, unknown> }
    if (request.action === 'channels.update') {
      updates.push(request.params)
      if (request.params.group_id === '101' && 'topic' in request.params) {
        if (refuseTopic) return Response.json({ ok: false, error: '话题保存失败' })
        state.groups[0]!.topic = String(request.params.topic)
      }
      if ('connection_id' in request.params) state.connection_id = String(request.params.connection_id)
      if (request.params.group_id === '101') state.groups[0]!.listen = request.params.listen === true
      if (request.params.group_id === '202') state.groups.push({ id: '202', listen: true, reply: false, read: true,
        topic: String(request.params.topic), route: 'normal', engine: 'fish', learn: true })
      if ('private_receive' in request.params) { state.private_receive = false; refuseReadback = true }
    } else if (refuseReadback) return Response.json({ ok: false, error: '读取失败' })
    return Response.json({ ok: true, result: state })
  })
  const call = createInstanceWorkbench(rawCall, 'second' as FishInstanceId)
  const view = render(<FishChannelsSettings call={call} t={makeTranslate(zh)} />)
  await waitFor(() => { expect(view.getByRole('button', { name: '选择本窗口QQ接入' })).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: '选择本窗口QQ接入' }))
  fireEvent.click(view.getByRole('menuitem', { name: /现有QQ连接/ }))
  await waitFor(() => { expect(updates[0]).toEqual({ connection_id: 'qq', instance_id: 'second' }) })
  await waitFor(() => { expect(view.getByRole('switch', { name: '群101：接收群消息' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(view.getByRole('switch', { name: '群101：接收群消息' }))
  await waitFor(() => { expect(view.getByRole('switch', { name: '群101：接收群消息' }).getAttribute('aria-checked')).toBe('false') })
  const send = view.getByRole('switch', { name: '群101：允许发送到本群' })
  expect(send.getAttribute('aria-checked')).toBe('true')
  expect(send.hasAttribute('disabled')).toBe(false)
  expect(updates[1]).toEqual({ group_id: '101', listen: false, instance_id: 'second' })
  fireEvent.change(view.getByLabelText('新增群号'), { target: { value: '202' } })
  fireEvent.change(view.getByLabelText('新群话题'), { target: { value: '赛马娘' } })
  fireEvent.click(view.getByRole('button', { name: '增加本窗口参与' }))
  await waitFor(() => { expect(view.getByText('群 202')).toBeTruthy() })
  expect(updates[2]).toEqual({ group_id: '202', listen: true, topic: '赛马娘', instance_id: 'second' })
  const topicDraft = view.getAllByLabelText('群背景（她判断该不该开口时会用到）')[0]!
  fireEvent.change(topicDraft, { target: { value: '不能丢失的草稿' } })
  fireEvent.click(view.getAllByRole('button', { name: '保存群话题' })[0]!)
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('话题保存失败') })
  expect(topicDraft).toHaveProperty('value', '不能丢失的草稿')
  refuseTopic = false
  fireEvent.click(view.getAllByRole('button', { name: '保存群话题' })[0]!)
  await waitFor(() => { expect(state.groups[0]!.topic).toBe('不能丢失的草稿') })
  await waitFor(() => { expect(view.getAllByRole('button', { name: '保存群话题' })[0]!.hasAttribute('disabled')).toBe(true) })
  fireEvent.click(view.getByRole('switch', { name: '接收主人私聊' }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('设置已提交，但回读失败') })
  expect(view.getByRole('switch', { name: '接收主人私聊' }).getAttribute('aria-checked')).toBe('true')
  expect(updates.at(-1)).toEqual({ private_receive: false, instance_id: 'second' })
})
