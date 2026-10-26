/** Resource providers own Fish turn reads; components keep only viewing choices. */
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { FishCall } from './contract/slots.ts'
import type { FishTurns, FishTurnView } from './contract/workbench.ts'
import { parseTurns, parseTurnView } from './parsers.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'fish/read-failed': Record<string, never> }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    'fish-turns': FishTurnDirectory
    'fish-turn': FishTurnView
  }
}
/** Loaded history remains part of the directory while the live head advances. */
export interface FishTurnDirectory extends FishTurns { readonly loading_older: boolean }

/** Address both data and subscriptions by the fixed originating instance. */
export function fishTurnAddress(instance: string, execution?: string): string {
  return `dsh-resource://${execution === undefined ? 'fish-turns' : 'fish-turn'}/${encodeURIComponent(instance)}`
    + (execution === undefined ? '' : `/${encodeURIComponent(execution)}`)
}

/** Register one Fish-owned adapter to the framework resource cache and lifecycle. */
export function createFishTurnResources(call: FishCall): {
  readonly directory: ResourceProvider<'fish-turns'>
  readonly detail: ResourceProvider<'fish-turn'>
  readonly request: (instance: string, cursor?: string) => void
} {
  const requests = new Map<string, { queue: (string | undefined)[]; wake: (() => void) | undefined }>()
  const wait = (signal: AbortSignal, owner?: { queue: (string | undefined)[]; wake: (() => void) | undefined }): Promise<void> => {
    if (signal.aborted || (owner !== undefined && owner.queue.length > 0)) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); if (owner !== undefined) owner.wake = undefined; resolve() }
      const timer = setTimeout(done, 2000)
      signal.addEventListener('abort', done, { once: true })
      if (owner !== undefined) owner.wake = done
    })
  }
  return {
    request: (instance, cursor) => { const owner = requests.get(fishTurnAddress(instance)); owner?.queue.push(cursor); owner?.wake?.() },
    directory: {
      protocol: 'fish-turns',
      async *open(address, { signal }) {
        const instance = decodeURIComponent(new URL(address).pathname.slice(1))
        const owner: { queue: (string | undefined)[]; wake: (() => void) | undefined } = { queue: [], wake: undefined }
        requests.set(address, owner)
        let value: FishTurnDirectory | undefined
        let olderLoaded = false
        try {
          while (!signal.aborted) {
            const cursor = owner.queue.shift()
            if (cursor !== undefined && value !== undefined) yield { ok: true as const, value: { ...value, loading_older: true } }
            const reply = await call('turns.list', { instance_id: instance, limit: 30, ...(cursor === undefined ? {} : { cursor }) })
            if (signal.aborted) return
            const parsed = reply.ok ? parseTurns(reply.value) : reply
            if (!parsed.ok) yield { ok: false as const, error: new RemoteError('fish/read-failed', parsed.failure.message, {}) }
            else {
              const next = parsed.value
              const runs = new Map((value?.runs ?? []).map(run => [run.execution, run]))
              for (const run of next.runs) runs.set(run.execution, run)
              value = { ...next,
                runs: [...runs.values()].sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || b.execution.localeCompare(a.execution)),
                next_cursor: cursor === undefined && olderLoaded ? value?.next_cursor ?? null : next.next_cursor, loading_older: false }
              if (cursor !== undefined) olderLoaded = true
              yield { ok: true as const, value }
            }
            await wait(signal, owner)
          }
        } finally { if (requests.get(address) === owner) requests.delete(address) }
      },
    },
    detail: {
      protocol: 'fish-turn',
      async *open(address, { signal }) {
        const [instance, execution] = new URL(address).pathname.slice(1).split('/').map(decodeURIComponent)
        while (!signal.aborted) {
          const reply = await call('turn.view', { instance_id: instance, execution })
          if (signal.aborted) return
          const parsed = reply.ok ? parseTurnView(reply.value) : reply
          if (!parsed.ok) yield { ok: false as const, error: new RemoteError('fish/read-failed', parsed.failure.message, {}) }
          else {
            yield { ok: true as const, value: parsed.value }
            if (!['queued', 'running'].includes(parsed.value.raw_status)) return
          }
          await wait(signal)
        }
      },
    },
  }
}
