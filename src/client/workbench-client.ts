/**
 * Browser caller for the Host's `/fish/workbench` proxy. The route is
 * same-origin and authenticated by the DSH connection cookie; the Fish control
 * token stays on the Host. This module owns the wire narrowing: a transport or
 * envelope failure becomes a `FishFailure`, and a reply `ok: false` carries the
 * workbench's own error text.
 */
import type { FishCall, FishFailure, FishResult } from './contract/slots.ts'
import { isRecord, type WorkbenchCall, type WorkbenchReply } from './contract/workbench.ts'

/** Route the Host half registers (relative to the document). */
export const WORKBENCH_ROUTE = 'fish/workbench'

/** Longest error text rendered in a status line. */
const MAX_REASON_LENGTH = 400

/** Whether a workbench failure text means nothing answered (token or connection). */
const OFFLINE_MARKER = 'Fish is offline'

/** Short text of a thrown value. */
function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_REASON_LENGTH)
}

/** Whether the Host proxy reported that the workbench itself is unreachable. */
export function isOfflineMessage(message: string): boolean {
  return message.startsWith(OFFLINE_MARKER)
}

/** Narrow the Host route's JSON body to the workbench reply contract. */
function parseReply(body: unknown): WorkbenchReply | null {
  if (!isRecord(body)) return null
  if (body.ok === true) return { ok: true, result: body.result }
  if (body.ok === false) {
    return { ok: false, error: typeof body.error === 'string' && body.error !== '' ? body.error : reasonOf(body.error) }
  }
  return null
}

/**
 * Create the workbench caller bound to one Fetch implementation.
 * @param doFetch - transport; the pages wire this to the connection's RPC-carrier Fetch when present.
 * @returns the caller: one action per call, never rejecting.
 */
export function createWorkbench(doFetch: (input: string, init: RequestInit) => Promise<Response>): FishCall {
  return async (action: string, params: Record<string, unknown> = {}): Promise<FishResult<unknown>> => {
    const call: WorkbenchCall = { action, params }
    let response: Response
    try {
      response = await doFetch(WORKBENCH_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(call),
        credentials: 'same-origin',
      })
    } catch (error) {
      // Swallows a rejected fetch: the Host route is the only path to the workbench.
      const message = `Fish is offline: the DSH host did not answer (${reasonOf(error)})`
      return { ok: false, failure: { message, offline: true } }
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      // Swallows a non-JSON body: HTTP status is all that is left to report.
      const message = `Workbench call ${action} returned HTTP ${String(response.status)} without JSON (${reasonOf(error)})`
      return { ok: false, failure: { message, offline: false } }
    }
    const reply = parseReply(body)
    if (reply === null) {
      return { ok: false, failure: { message: `Workbench call ${action} returned an unexpected reply`, offline: false } }
    }
    if (!reply.ok) {
      const failure: FishFailure = { message: reply.error, offline: isOfflineMessage(reply.error) }
      return { ok: false, failure }
    }
    return { ok: true, value: reply.result }
  }
}
