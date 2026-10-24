/**
 * Host half of the native Fish workspace: one authenticated `webServer` route
 * that forwards the browser's `POST /fish/workbench` call ({ action, params })
 * to the Python Fish ToolHost workbench and answers the browser with the
 * workbench reply (`{ ok: true, result }` or `{ ok: false, error }`).
 *
 * Security has one home, here. The route asks the composition's `connection`
 * service for a rejection first (`requestRejection`): its Host/Origin fence
 * rejects DNS rebinding and cross-site calls, and its browser authentication
 * gates every caller. The Fish control token never reaches the browser: it is
 * read from `<fishRoot>/harness/runtime/control.token` on the Host for each
 * forward and copied into the upstream `x-fish-token` header.
 *
 * The workbench itself is a separate process. Every local failure — token
 * unreadable, workbench unreachable, workbench reply not JSON — is a 502 whose
 * body is the same `{ ok: false, error }` value the browser renders, so the
 * panel cannot mistake an offline workbench for an empty one.
 */

import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'

/** Cordis function-plugin name. */
export const name = 'ui-fish'

/** The route carrier and the trust fence guarding the route. */
export const inject = ['webServer', 'connection']

/** Same-origin route the browser posts to; the Host forwards it upstream. */
export const FISH_WORKBENCH_PATH = '/fish/workbench'

/** Upstream workbench endpoint, appended to the configured loopback origin. */
const UPSTREAM_WORKBENCH_PATH = '/workbench'

/** Fish workbench host configuration. */
export interface Config {
  /** Fish installation root; the control token lives under `harness/runtime/`. */
  readonly fishRoot: string
  /** Loopback port of the Fish ToolHost workbench. */
  readonly port: number
}

export const Config: z<Config> = z.object({
  fishRoot: z.string().default('E:/Program Files/DSH/source/fish'),
  port: z.natural().max(65535).default(3104),
})

/** One browser call body: an action name and its JSON parameters. */
interface WorkbenchRequest {
  readonly action: string
  readonly params: Record<string, unknown>
}

/** Reply the browser renders: the workbench contract, discriminated by `ok`. */
type WorkbenchReply =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string }

/** Local request bodies are one action plus params; anything larger is hostile. */
const MAX_BODY_BYTES = 32 * 1024 * 1024

/** Deadline for one upstream workbench call, including response body read. */
const UPSTREAM_TIMEOUT_MS = 120_000

/** Longest local error text echoed to the browser. */
const MAX_LOCAL_ERROR_LENGTH = 400

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface FishConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** JSON response (no-store: workbench outcomes are live facts). */
function sendJson(res: ServerResponse, status: number, payload: WorkbenchReply): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** One local failure as the browser renders it. */
function sendError(res: ServerResponse, error: string): void {
  sendJson(res, 502, { ok: false, error: error.slice(0, MAX_LOCAL_ERROR_LENGTH) })
}

/** Short text of a thrown value, suitable for the browser's error line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling (stream drained). */
async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      // Drain the remainder so the refusal is a readable response, not a socket cut.
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** Validate one call body at the wire: `{ action: string, params?: object }`. */
function parseCallBody(text: string): WorkbenchRequest | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // Swallows the parse error: a non-JSON body is exactly the null case.
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { action, params } = body as { action?: unknown; params?: unknown }
  if (typeof action !== 'string' || action === '' || action.length > 64) return null
  if (params === undefined || params === null) return { action, params: {} }
  if (typeof params !== 'object' || Array.isArray(params)) return null
  return { action, params: params as Record<string, unknown> }
}

/** Narrow the upstream body to the workbench reply contract. */
function parseReply(value: unknown): WorkbenchReply | null {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return null
  const reply = value as { ok: unknown; result?: unknown; error?: unknown }
  if (reply.ok === true) return { ok: true, result: reply.result }
  if (reply.ok === false) {
    return { ok: false, error: typeof reply.error === 'string' && reply.error !== '' ? reply.error : 'unknown workbench error' }
  }
  return null
}

/**
 * Register `POST /fish/workbench` behind the connection trust fence.
 * @param ctx - Host context with `webServer` and `connection`.
 * @param config - fish root (token location) and workbench port.
 */
export function apply(ctx: Context, config: Config): void {
  const connection = Reflect.get(ctx, 'connection') as FishConnection
  const tokenPath = resolve(config.fishRoot, 'harness', 'runtime', 'control.token')
  const upstream = new URL(`http://127.0.0.1:${String(config.port)}${UPSTREAM_WORKBENCH_PATH}`)
  let starting: Promise<void> | undefined
  const backendSettings = async (): Promise<Record<string, unknown>> => {
    const value: unknown = JSON.parse(await readFile(resolve(config.fishRoot, 'harness/integration.json'), 'utf8'))
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  }
  const health = async (): Promise<boolean> => {
    try {
      const token = (await readFile(tokenPath, 'utf8')).trim()
      const reply = await fetch(new URL('/health', upstream), { method: 'POST',
        headers: { 'x-fish-token': token, 'x-fish-role': 'qq' }, body: '{}', signal: AbortSignal.timeout(1000) })
      return reply.ok
    } catch { return false }
  }
  const ensureBackend = (): Promise<void> => {
    starting ??= (async () => {
      if (await health()) return
      const settings = await backendSettings()
      const python = typeof settings['python_executable'] === 'string' ? settings['python_executable'] : 'pythonw.exe'
      const child = spawn(python, [resolve(config.fishRoot, 'harness/unified_service.py')], {
        cwd: config.fishRoot, detached: true, windowsHide: true, stdio: 'ignore',
        env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONUTF8: '1',
          PYTHONPATH: resolve(config.fishRoot, 'vendor/python'), FISH_HARNESS_HOME: config.fishRoot },
      })
      child.on('error', () => { starting = undefined })
      child.unref()
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise(done => setTimeout(done, 250))
        if (await health()) return
      }
      starting = undefined
      throw new Error('Fish 后台启动失败，请查看后台日志')
    })()
    return starting
  }
  const forward = async (call: WorkbenchRequest): Promise<WorkbenchReply> => {
    try { await ensureBackend() }
    catch (error) { return { ok: false, error: reasonOf(error) } }
    let token: string
    try {
      token = (await readFile(tokenPath, 'utf8')).trim()
    } catch (error) {
      // Swallows ENOENT/EACCES: both mean the workbench is not provisioned.
      return { ok: false, error: `Fish is offline: cannot read the control token at ${tokenPath} (${reasonOf(error)})` }
    }
    if (token === '') return { ok: false, error: `Fish is offline: the control token at ${tokenPath} is empty` }
    if (call.action === 'service.restart') {
      await fetch(new URL('/system/stop', upstream), { method: 'POST', headers: { 'x-fish-token': token }, body: '{}' })
      for (let attempt = 0; attempt < 80 && await health(); attempt++) await new Promise(done => setTimeout(done, 250))
      starting = undefined
      await ensureBackend()
      return forward({ action: 'status', params: {} })
    }
    let response: Response
    try {
      response = await fetch(upstream, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fish-token': token,
          'x-fish-role': 'qq',
        },
        body: JSON.stringify({ action: call.action, params: call.params }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch (error) {
      starting = undefined
      // Swallows ECONNREFUSED and the timeout: both mean the workbench is not answering.
      return { ok: false, error: `Fish is offline: the workbench at ${upstream.origin} did not answer (${reasonOf(error)})` }
    }
    let text: string
    try {
      text = await response.text()
    } catch (error) {
      // Swallows a body read that failed mid-stream: there is no reply to report.
      return { ok: false, error: `Fish workbench response failed (${reasonOf(error)})` }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      // Swallows the parse error: a non-JSON reply cannot be a workbench outcome.
      return { ok: false, error: `Fish workbench returned HTTP ${String(response.status)} with a non-JSON body (${reasonOf(error)})` }
    }
    const reply = parseReply(parsed)
    if (reply !== null) return reply
    return { ok: false, error: `Fish workbench returned HTTP ${String(response.status)} without an ok field` }
  }

  ctx.effect(() => async () => {
    const settings = await backendSettings()
    if (settings['keep_background_on_close'] !== false) return
    const token = (await readFile(tokenPath, 'utf8')).trim()
    await fetch(new URL('/system/stop', upstream), { method: 'POST', headers: { 'x-fish-token': token }, body: '{}', signal: AbortSignal.timeout(2000) }).catch(() => {})
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FISH_WORKBENCH_PATH,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      // String(undefined) is 'undefined', which never matches.
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        sendError(res, 'content-type must be application/json')
        return
      }
      let text: string | null
      try {
        text = await readBoundedBody(req)
      } catch (error) {
        // Swallows connection errors mid-body: there is nothing left to answer precisely.
        sendError(res, `request body unreadable (${reasonOf(error)})`)
        return
      }
      if (text === null) {
        sendError(res, 'request body is too large')
        return
      }
      const call = parseCallBody(text)
      if (call === null) {
        sendError(res, 'request body must be JSON with a string "action" and an object "params"')
        return
      }
      sendJson(res, 200, await forward(call))
    },
  }), `ui-fish: POST ${FISH_WORKBENCH_PATH}`)
}
