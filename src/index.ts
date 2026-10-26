/**
 * Native Fish Host bridge. The existing authenticated Typert Gateway carries
 * desktop IPC and web clients. Credentials and backend startup stay on this
 * Host; no webServer or second proxy is required.
 */
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'

/** Cordis function-plugin name. */
export const name = 'ui-fish'

declare module '@deepseek-ai/cordis' {
  interface Context { fishWorkbench: FishWorkbench }
}

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

/** Short text of a thrown value, suitable for the browser's error line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

/** Native Host service; the Gateway owns IPC/browser authentication and Remote access. */
export default class FishWorkbench extends TypertRemoteService {
  static Config = Config
  private readonly forward: (call: WorkbenchRequest) => Promise<WorkbenchReply>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'fishWorkbench')
    this.forward = createBackend(ctx, config)
  }

  /** Forward the existing JSON workbench envelope through the authenticated native Remote. */
  @Remote
  async workbench(request: string): Promise<string> {
    if (Buffer.byteLength(request, 'utf8') > MAX_BODY_BYTES) {
      return JSON.stringify({ ok: false, error: 'request body is too large' })
    }
    const call = parseCallBody(request)
    if (call === null) return JSON.stringify({ ok: false, error: 'invalid workbench request' })
    return JSON.stringify(await this.forward(call))
  }
}

/** One backend lifecycle and credential owner shared by every native workbench request. */
function createBackend(ctx: Context, config: Config): (call: WorkbenchRequest) => Promise<WorkbenchReply> {
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

  return forward
}
