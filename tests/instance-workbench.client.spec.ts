import { expect, it } from 'vitest'
import { createInstanceWorkbench, createWorkbench } from '../src/client/workbench-client.ts'
import { parseInstances } from '../src/client/parsers.ts'

it('keeps existing page actions attached to the discovered initial Fish instance', async () => {
  const received: { action: string; params: Record<string, unknown> }[] = []
  const call = createWorkbench(async (_url, init) => {
    const request = JSON.parse(String(init.body)) as { action: string; params: Record<string, unknown> }
    received.push(request)
    return Response.json({ ok: true, result: request.action === 'instances.list'
      ? { initial_instance_id: 'main', instances: [{ id: 'main', name: 'Fish', initial: true, enabled: true,
        running: true, persona_configured: true, persona_id: 'fish', persona_name: '大肥鱼', status_reason: '' }] }
      : { instance_id: request.params.instance_id } })
  })
  const listed = await call('instances.list')
  expect(listed.ok).toBe(true)
  if (!listed.ok) throw new Error(listed.failure.message)
  const catalog = parseInstances(listed.value)
  expect(catalog.ok).toBe(true)
  if (!catalog.ok) throw new Error(catalog.failure.message)
  expect(catalog.value.instances[0]?.persona_name).toBe('大肥鱼')
  const instanceCall = createInstanceWorkbench(call, catalog.value.initial_instance_id)
  await instanceCall('status')
  await instanceCall('personas.save', { id: 'saved', name: '大肥鱼', instance_id: 'other' })
  await instanceCall('memory.list', { query: '回忆' })
  expect(received).toEqual([
    { action: 'instances.list', params: {} },
    { action: 'status', params: { instance_id: 'main' } },
    { action: 'personas.save', params: { id: 'saved', name: '大肥鱼', instance_id: 'main' } },
    { action: 'memory.list', params: { query: '回忆', instance_id: 'main' } },
  ])
})
