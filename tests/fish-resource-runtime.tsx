import type { ReactNode } from 'react'
import { within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, type UseResource } from '@deepseek-ai/dsh-client-resources/client'
import type { FishCall } from '../src/client/contract/slots.ts'
import { createFishTurnResources } from '../src/client/turn-resources.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'fish.resource-test': { kind: 'single'; scope: 'root' } }
}

/** Mount Fish with the same injected resource hook and providers as the client. */
export async function renderFishResources(call: FishCall, component: (props: {
  useResource: UseResource
  requestTurns: (instance: string, cursor?: string) => void
}) => ReactNode) {
  const runtime = await SlotTestRuntime.create()
  await runtime.declare({ 'fish.resource-test': { kind: 'single', scope: 'root' } })
  await runtime.mount({ inject: [...inject], apply })
  const resources = createFishTurnResources(call)
  runtime.ctx.effect(() => runtime.ctx.resources.register(resources.directory), 'fish-test: directory')
  runtime.ctx.effect(() => runtime.ctx.resources.register(resources.detail), 'fish-test: detail')
  runtime.slots.register({ name: 'fish.resource-test' }, ({ useResource }: { useResource: UseResource }) =>
    component({ useResource, requestTurns: resources.request }))
  runtime.renderSlot('fish.resource-test', {})
  return { runtime, view: within(document.body) }
}
