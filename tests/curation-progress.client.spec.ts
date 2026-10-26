import { expect, it } from 'vitest'
import { parseCurationStatus } from '../src/client/parsers.ts'

it('reads the fixed run batch progress while it runs and its remaining sources after interruption', () => {
  const parsed = parseCurationStatus({ run: { id: 'curate:r04', status: 'running',
    range_start: 10, range_end: 20,
    progress: [{ name: 'learn', state: 'running', completed: 60, remaining: 1, batch_count: 1 }],
    result: { completed: 1, remaining: 60, batch_count: 1 } }, latest: null, runs: [] })
  expect(parsed.ok).toBe(true)
  if (!parsed.ok || parsed.value.run === null) throw new Error('missing curation run')
  expect(parsed.value.run.range_end).toBe(20)
  expect(parsed.value.run.result).toMatchObject({ completed: 60, remaining: 1, batch_count: 1 })

  const stopped = parseCurationStatus({ run: { id: 'curate:r04', status: 'partial',
    progress: [], result: { completed: 60, remaining: 1, batch_count: 2 } }, latest: null, runs: [] })
  expect(stopped.ok).toBe(true)
  if (!stopped.ok || stopped.value.run === null) throw new Error('missing interrupted run')
  expect(stopped.value.run.result).toMatchObject({ completed: 60, remaining: 1, batch_count: 2 })
})

it('keeps unrecorded historical batch progress distinct from zero remaining sources', () => {
  const parsed = parseCurationStatus({ run: { id: 'curate:history', status: 'done',
    result: {} }, latest: null, runs: [] })
  expect(parsed.ok).toBe(true)
  if (!parsed.ok || parsed.value.run === null) throw new Error('missing historical run')
  expect(parsed.value.run.result).toMatchObject({ completed: null, remaining: null, batch_count: null })
})
