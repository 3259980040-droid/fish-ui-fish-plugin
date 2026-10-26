/**
 * Wire narrowing shared by the pages: one parser per documented result, so a
 * page reads typed values or a failure and never inspects raw JSON itself.
 */
import type { FishResult } from './contract/slots.ts'
import {
  isRecord, optionalString, requiredArray, requiredRecord, requiredString, timestampText, WorkbenchPayloadError,
  type FishChatCreated, type FishChatJob, type FishChatSent, type FishChatSnapshot, type FishContextUsage, type FishConversation,
  type FishDailyLimits, type FishMemory, type FishMessage, type FishMode, type FishModeState, type FishPaths,
  type FishPersona, type FishPersonaApplied, type FishPersonaCandidate, type FishPersonaCurrent,
  type FishPersonaPreview, type FishPersonaPreviewSide, type FishPersonaRecord, type FishSettings,
  type FishTask, type FishPlanOccurrence, type FishTurnView, type FishTurnDelivery, type FishTurnTimes,
  type FishWorkspaceListing, type FishWorkspaceFile, type FishWorkspaceWrite,
  type FishDelegatedTask, type FishDelegationState, type FishChatDeleted,
  type FishDigestRevised, type FishDigestScope, type FishPersonasCleared, type FishPersonaKept,
  type FishChannelStatus, type FishChannelGroup, type FishChannelService,
  type FishActivityItem, type FishActivityPlace, type FishImagePreview,
  type FishAttachment, type FishAttachmentConfig, type FishAttachmentDetail, type FishAttachmentProcessing,
  type FishUploadStarted, type FishUploadProgress,
  type FishConversationKind, type FishTrace, type FishTraceDims,
  type FishCount, type FishDigest, type FishDigestRun, type FishExpression,
  type FishLibraryTotals, type FishOpenEvent, type FishOverview,
  type FishRetrievalStatus, type FishMemoryRevision, type FishDocument,
  type FishMemoryMerged,
  type FishDocumentChunk, type FishDocumentDeleted, type FishDocumentDetail,
  type FishDocumentOrganized,
  type FishCurationDigest, type FishCurationRun, type FishCurationStatus,
  type FishKnowledgeCatalog, type FishKnowledgeChannelState, type FishKnowledgeMessage,
  type FishKnowledgeOpened, type FishKnowledgeSearch, type FishKnowledgeOrigin,
  type FishFaultStatus, type FishReminderStatus,
  type FishPlugin, type FishPluginDiscovery, type FishPluginEvent, type FishPluginKind, type FishPluginSnapshot,
  type FishPluginTool, type FishSkill, type FishSkillDeleted, type FishSkillEntry, type FishSkillSnapshot,
  type FishModelConnection, type FishModelDescription, type FishModelGateway, type FishModelProbe,
  type FishModelRemoved, type FishModelSaved, type FishModelUse,
  type FishTurns, type FishTurnMaterial, type FishTurnUsage, type FishInstances, type FishInstanceId,
  type FishInstance, type FishInstancePreset, type FishToolSettings,
} from './contract/workbench.ts'

/** Wrap a parser so a payload mismatch becomes a rendered failure. */
function parseReply<T>(action: string, result: unknown, parse: (value: unknown) => T): FishResult<T> {
  try {
    return { ok: true, value: parse(result) }
  } catch (error) {
    // Swallows the payload error: a reply outside the documented action is an untrusted outcome.
    if (!(error instanceof WorkbenchPayloadError)) throw error
    return { ok: false, failure: { message: `Workbench call ${action}: ${error.message}`, offline: false } }
  }
}

/** One host-owned identity and its observed lifecycle state. */
function instanceRecord(value: unknown): FishInstance {
  const instance = requiredRecord({ value }, 'value', 'instance')
  return {
    id: requiredString(instance, 'id', 'instance') as FishInstanceId,
    name: requiredString(instance, 'name', 'instance'),
    initial: instance.initial === true,
    enabled: instance.enabled === true,
    running: instance.running === true,
    persona_configured: instance.persona_configured === true,
    persona_id: requiredString(instance, 'persona_id', 'instance'),
    persona_name: requiredString(instance, 'persona_name', 'instance'),
    status_reason: requiredString(instance, 'status_reason', 'instance'),
  }
}

/** A settled create, rename or lifecycle mutation returns the host's actual instance. */
export function parseInstance(result: unknown): FishResult<FishInstance> {
  return parseReply('instances', result, instanceRecord)
}

/** Saved persona versions; no contents are substituted from the active window. */
export function parseInstancePresets(result: unknown): FishResult<readonly FishInstancePreset[]> {
  return parseReply('instances.presets', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'instances.presets')
    return requiredArray(record, 'presets', 'instances.presets').map((value) => {
      const item = requiredRecord({ value }, 'value', 'preset')
      return { instance_id: requiredString(item, 'instance_id', 'preset') as FishInstanceId,
        revision: requiredString(item, 'revision', 'preset'), name: requiredString(item, 'name', 'preset'),
        body: requiredString(item, 'body', 'preset') }
    })
  })
}

/** Host directory, including effective lifecycle state and configured persona. */
export function parseInstances(result: unknown): FishResult<FishInstances> {
  return parseReply('instances.list', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'instances.list')
    const initial = requiredString(record, 'initial_instance_id', 'instances.list') as FishInstanceId
    const instances = requiredArray(record, 'instances', 'instances.list').map(instanceRecord)
    if (!instances.some(instance => instance.id === initial)) throw new WorkbenchPayloadError('initial_instance_id')
    return { initial_instance_id: initial, instances }
  })
}

/** `faults.status` is presentation of persisted observations, never a retry command. */
export function parseFaultStatus(result: unknown): FishResult<FishFaultStatus> {
  return parseReply('faults.status', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'faults.status')
    const rows = (key: string): readonly Record<string, unknown>[] => requiredArray(record, key, 'faults.status')
      .map(value => requiredRecord({ value }, 'value', key))
    const reminder = (key: string): FishReminderStatus => {
      const item = requiredRecord(requiredRecord(record, 'reminders', 'faults.status'), key, 'reminders')
      return { enabled: item.enabled === true, effective: item.effective === true,
        source: requiredString(item, 'source', key), reason: requiredString(item, 'reason', key) }
    }
    return {
      items: rows('items').map(row => ({ source: requiredString(row, 'source', 'fault'),
        stage: requiredString(row, 'stage', 'fault'), code: requiredString(row, 'code', 'fault'),
        reason: requiredString(row, 'reason', 'fault'), consecutive: requiredNumber(row, 'consecutive', 'fault'),
        total: requiredNumber(row, 'total', 'fault'), first_failed: requiredNumber(row, 'first_failed', 'fault'),
        last_failed: requiredNumber(row, 'last_failed', 'fault'), recovered_at: requiredNumber(row, 'recovered_at', 'fault'),
        uncertain: row.uncertain === true, auto_retry: row.auto_retry === true })),
      latest: rows('latest').map(row => ({ source: requiredString(row, 'source', 'observation'),
        stage: requiredString(row, 'stage', 'observation'), outcome: requiredString(row, 'outcome', 'observation'),
        reason: requiredString(row, 'reason', 'observation'), updated: requiredNumber(row, 'updated', 'observation') })),
      tests: rows('tests').map(row => ({ case_name: requiredString(row, 'case_name', 'test'),
        runs: requiredNumber(row, 'runs', 'test'), failures: requiredNumber(row, 'failures', 'test'),
        consecutive: requiredNumber(row, 'consecutive', 'test'), last_run: requiredNumber(row, 'last_run', 'test'),
        last_failed: requiredNumber(row, 'last_failed', 'test'), last_passed: requiredNumber(row, 'last_passed', 'test') })),
      configuration: rows('configuration').map(row => ({ source: requiredString(row, 'source', 'configuration'),
        code: requiredString(row, 'code', 'configuration'), reason: requiredString(row, 'reason', 'configuration') })),
      reminders: { memory_reminder: reminder('memory_reminder'), private_proactive: reminder('private_proactive') },
    }
  })
}

function parseMode(value: unknown): FishMode {
  if (value === 'chat' || value === 'work') return value
  throw new WorkbenchPayloadError('mode')
}

function parseDailyLimits(value: unknown): FishDailyLimits {
  const record = requiredRecord({ value }, 'value', 'daily_limits')
  const number = (key: string): number => {
    const field = record[key]
    if (typeof field !== 'number' || !Number.isFinite(field)) throw new WorkbenchPayloadError(`daily_limits.${key}`)
    return field
  }
  return {
    limit: number('limit'),
    used: number('used'),
    remaining: number('remaining'),
    unlimited: record.unlimited === true,
  }
}

function parsePersona(value: unknown): FishPersona {
  const record = requiredRecord({ value }, 'value', 'persona')
  return {
    id: requiredString(record, 'id', 'persona'),
    name: requiredString(record, 'name', 'persona'),
    body: optionalString(record, 'body') ?? '',
  }
}

function parsePaths(value: unknown): FishPaths {
  const record = requiredRecord({ value }, 'value', 'paths')
  return { root: requiredString(record, 'root', 'paths'), workspace: requiredString(record, 'workspace', 'paths') }
}

function parseModeState(value: unknown): FishModeState {
  const record = requiredRecord({ value }, 'value', 'status')
  return {
    owner: requiredString(record, 'owner', 'status'),
    mode: parseMode(record.mode),
    workspace: optionalString(record, 'workspace') ?? '',
    permissions: requiredString(record, 'permissions', 'status'),
    persona: parsePersona(record.persona),
    paused: record.paused === true,
    daily_limits: parseDailyLimits(record.daily_limits),
    paths: parsePaths(record.paths),
  }
}

function stringList(record: Record<string, unknown>, key: string, context: string): readonly string[] {
  return requiredArray(record, key, context).filter((item): item is string => typeof item === 'string')
}

/** `status`, `mode.set`, and `settings.save` mode state. */
export function parseStatus(result: unknown): FishResult<FishModeState> {
  return parseReply('status', result, parseModeState)
}

/** `mode.set` reply: the same mode state `status` returns. */
export function parseModeSet(result: unknown): FishResult<FishModeState> {
  return parseReply('mode.set', result, parseModeState)
}

/** `settings.get` / `settings.save` reply. */
export function parseSettings(result: unknown): FishResult<FishSettings> {
  return parseReply('settings', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'settings')
    const state = parseModeState(record)
    const capabilities = requiredRecord(record, 'owner_capabilities', 'settings')
    const send = requiredRecord(record, 'send_policy', 'settings')
    const ownerPrivate = requiredRecord(send, 'owner_private', 'send_policy')
    const group = requiredRecord(send, 'group', 'send_policy')
    return { ...state,
      image_identification_enabled: record.image_identification_enabled !== false,
      max_tool_calls_per_turn: typeof record.max_tool_calls_per_turn === 'number' ? record.max_tool_calls_per_turn : 0,
      chat_reasoning_effort: record.chat_reasoning_effort === 'off' ? 'off' : record.chat_reasoning_effort === 'low' ? 'low' : record.chat_reasoning_effort === 'max' ? 'max' : 'high',
      reply_display: record.reply_display === 'final' ? 'final' : record.reply_display === 'thinking_excerpt' ? 'thinking_excerpt' : 'persona',
      qzone_enabled: record['qzone_enabled'] === true, keep_background_on_close: record['keep_background_on_close'] !== false,
      owner_permissions: stringList(record, 'owner_permissions', 'settings'),
      owner_capabilities: Object.fromEntries(Object.entries(capabilities)
        .filter((item): item is [string, string] => typeof item[1] === 'string')),
      send_policy: {
        owner_private: { owner_reply: ownerPrivate.owner_reply === true, scheduled_result: ownerPrivate.scheduled_result === true },
        group: { owner_request: group.owner_request === true },
      },
    }
  })
}

function parsePersonaCandidate(record: Record<string, unknown>): FishPersonaCandidate {
  const source = optionalString(record, 'source')
  return {
    id: requiredString(record, 'id', 'persona'),
    name: requiredString(record, 'name', 'persona'),
    body: optionalString(record, 'body') ?? '',
    ...(source === undefined ? {} : { source }),
  }
}

/** `personas.list` reply. */
export function parsePersonas(result: unknown): FishResult<readonly FishPersonaCandidate[]> {
  return parseReply('personas.list', result, value => requiredArray({ value }, 'value', 'personas.list')
    .map((item) => {
      if (!isRecord(item)) throw new WorkbenchPayloadError('personas.list[]')
      return parsePersonaCandidate(item)
    }))
}

/** `personas.current` reply: the persona in force, body included. */
export function parsePersonaCurrent(result: unknown): FishResult<FishPersonaCurrent> {
  return parseReply('personas.current', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'personas.current')
    return {
      id: requiredString(record, 'id', 'personas.current'),
      revision: requiredString(record, 'revision', 'personas.current'),
      name: requiredString(record, 'name', 'personas.current'),
      body: optionalString(record, 'body') ?? '',
    }
  })
}

function parsePreviewSide(value: unknown): FishPersonaPreviewSide {
  if (!isRecord(value)) throw new WorkbenchPayloadError('personas.preview[]')
  const elapsed = value.elapsed_ms
  return {
    revision: requiredString(value, 'revision', 'personas.preview[]'),
    name: requiredString(value, 'name', 'personas.preview[]'),
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    elapsed_ms: typeof elapsed === 'number' && Number.isFinite(elapsed) ? elapsed : 0,
  }
}

/** `personas.preview` reply: two real model calls, each reported on its own. */
export function parsePersonaPreview(result: unknown): FishResult<FishPersonaPreview> {
  return parseReply('personas.preview', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'personas.preview')
    const calls = record.model_calls
    return {
      model_calls: typeof calls === 'number' && Number.isFinite(calls) ? calls : 0,
      results: requiredArray(record, 'results', 'personas.preview').map(parsePreviewSide),
    }
  })
}

/** `personas.import` reply: the parsed candidates. */
export function parsePersonaCandidates(result: unknown): FishResult<readonly FishPersonaCandidate[]> {
  return parseReply('personas.import', result, value => requiredArray({ value }, 'value', 'personas.import')
    .map((item) => {
      if (!isRecord(item)) throw new WorkbenchPayloadError('personas.import[]')
      return parsePersonaCandidate(item)
    }))
}

/**
 * `personas.save` (or `personas.create`) reply: the stored revision.
 * @param result - the workbench result value.
 * @param action - the action that returned it, used in a payload failure.
 */
export function parsePersonaRecord(result: unknown, action = 'personas.save'): FishResult<FishPersonaRecord> {
  return parseReply(action, result, (value) => {
    const record = requiredRecord({ value }, 'value', action)
    return {
      id: requiredString(record, 'id', action),
      name: requiredString(record, 'name', action),
      body: optionalString(record, 'body') ?? '',
    }
  })
}

/** `personas.clear` reply: what stayed, what went, and where the backup is. */
export function parsePersonasCleared(result: unknown): FishResult<FishPersonasCleared> {
  return parseReply('personas.clear', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'personas.clear')
    const kept = requiredRecord(record, 'kept', 'personas.clear')
    return {
      kept: { id: requiredString(kept, 'id', 'personas.clear.kept'), name: optionalString(kept, 'name') ?? '' },
      deleted: optionalNumber(record, 'deleted') ?? 0,
      backup: optionalString(record, 'backup') ?? '',
      protected: (Array.isArray(record.protected) ? record.protected : [])
        .filter(item => isRecord(item))
        .map((item): FishPersonaKept => ({
          id: requiredString(item, 'id', 'personas.clear.protected'),
          name: optionalString(item, 'name') ?? '',
          reason: optionalString(item, 'reason') ?? '',
        })),
    }
  })
}

/** `personas.apply` reply. */
export function parsePersonaApplied(result: unknown): FishResult<FishPersonaApplied> {
  return parseReply('personas.apply', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'personas.apply')
    const revision = record.revision
    return {
      ok: record.ok !== false,
      ...(typeof revision === 'string' || typeof revision === 'number' ? { revision } : {}),
      ...(record.persona === undefined ? {} : { persona: parsePersona(record.persona) }),
      ...(typeof record.message === 'string' ? { message: record.message } : {}),
    }
  })
}

function parseMemory(record: Record<string, unknown>): FishMemory {
  const updated = record.updated
  return {
    id: requiredString(record, 'id', 'memory'),
    text: requiredString(record, 'text', 'memory'),
    category: optionalString(record, 'category') ?? '',
    updated: typeof updated === 'number' || typeof updated === 'string' ? updated : '',
    source: optionalString(record, 'source') ?? '',
    evidence_label: optionalString(record, 'evidence_label') ?? '',
    status_label: optionalString(record, 'status_label') ?? '',
    source_text: optionalString(record, 'source_text') ?? '',
    kind: optionalString(record, 'kind') ?? '',
    action: optionalString(record, 'action') ?? '',
    status: optionalString(record, 'status') ?? '',
    scope: optionalString(record, 'scope') ?? '',
    confidence: optionalNumber(record, 'confidence') ?? 0,
    subject: optionalString(record, 'subject') ?? '',
  }
}

/** Original evidence and later owner corrections for one actual memory. */
export function parseMemoryHistory(result: unknown): FishResult<readonly FishMemoryRevision[]> {
  return parseReply('memory.history', result, value => requiredArray({ value }, 'value', 'memory.history').map((item) => {
    if (!isRecord(item)) throw new WorkbenchPayloadError('memory.history[]')
    return { revision: requiredNumber(item, 'revision', 'memory.history'),
      text: requiredString(item, 'text', 'memory.history'),
      source_text: optionalString(item, 'source_text') ?? '',
      evidence: optionalString(item, 'evidence') ?? '',
      created: requiredNumber(item, 'created', 'memory.history') }
  }))
}

/** `memory.search` reply. */
export function parseMemories(result: unknown): FishResult<readonly FishMemory[]> {
  return parseReply('memory.search', result, value => requiredArray({ value }, 'value', 'memory.search')
    .map((item) => {
      if (!isRecord(item)) throw new WorkbenchPayloadError('memory.search[]')
      return parseMemory(item)
    }))
}

/** `memory.save` reply: the stored record. */
export function parseMemoryRecord(result: unknown): FishResult<FishMemory> {
  return parseReply('memory.save', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('memory.save')
    return parseMemory(value)
  })
}

/** `memory.merge` reply: which record stayed and the dropped one's real new status. */
export function parseMemoryMerged(result: unknown): FishResult<FishMemoryMerged> {
  return parseReply('memory.merge', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('memory.merge')
    return {
      keep: requiredString(value, 'keep', 'memory.merge'),
      drop: requiredString(value, 'drop', 'memory.merge'),
      drop_status: requiredString(value, 'drop_status', 'memory.merge'),
    }
  })
}

/** One plan instance, narrowed from the `occurrences` array `schedules.list` returns. */
function parseOccurrences(value: unknown): readonly FishPlanOccurrence[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map(item => ({
    slot: optionalString(item, 'slot') ?? '',
    display: optionalString(item, 'display') ?? optionalString(item, 'slot') ?? '',
    state: optionalString(item, 'state') ?? '',
    note: optionalString(item, 'note') ?? '',
    receipt_id: optionalString(item, 'receipt_id') ?? '',
    execution: optionalString(item, 'execution') ?? '',
    attempts: optionalNumber(item, 'attempts') ?? 0,
    created: optionalNumber(item, 'created') ?? 0,
    updated: optionalNumber(item, 'updated') ?? 0,
  }))
}

/** `schedules.list` reply. */
export function parseTasks(result: unknown): FishResult<readonly FishTask[]> {
  return parseReply('schedules.list', result, value => requiredArray({ value }, 'value', 'schedules.list')
    .map((item) => {
      if (!isRecord(item)) throw new WorkbenchPayloadError('schedules.list[]')
      const target = optionalString(item, 'target')
      return {
        ...item,
        id: requiredString(item, 'id', 'schedules.list'),
        title: optionalString(item, 'title') ?? '',
        prompt: optionalString(item, 'prompt') ?? '',
        status: optionalString(item, 'status') ?? '',
        ...(target === undefined ? {} : { target }),
        occurrences: parseOccurrences(item.occurrences),
      }
    }))
}

/** A create/delete result counts as a record when the workbench returns one; otherwise its value is opaque. */
export function parseOpaque(result: unknown): FishResult<unknown> {
  return { ok: true, value: result }
}

/** Reported request accounting. Missing values remain unknown. */
function turnUsage(value: unknown): FishTurnUsage | null {
  if (!isRecord(value)) return null
  const coverage = requiredRecord(value, 'coverage', 'usage')
  const fields = requiredRecord(value, 'field_reports', 'usage')
  return {
    scope: requiredString(value, 'scope', 'usage'), state: requiredString(value, 'state', 'usage'),
    request_count: requiredNumber(value, 'request_count', 'usage'), closed_steps: requiredNumber(value, 'closed_steps', 'usage'),
    turns: requiredNumber(value, 'turns', 'usage'), usage_reports: requiredNumber(value, 'usage_reports', 'usage'),
    input_tokens: optionalNumber(value, 'input_tokens') ?? null, output_tokens: optionalNumber(value, 'output_tokens') ?? null,
    cache_read_tokens: optionalNumber(value, 'cache_read_tokens') ?? null, cache_write_tokens: optionalNumber(value, 'cache_write_tokens') ?? null,
    uncached_input_tokens: optionalNumber(value, 'uncached_input_tokens') ?? null, cache_hit_ratio: optionalNumber(value, 'cache_hit_ratio') ?? null,
    coverage: { recorded_requests: requiredNumber(coverage, 'recorded_requests', 'usage.coverage'),
      linked_requests: requiredNumber(coverage, 'linked_requests', 'usage.coverage'), unlinked_requests: requiredNumber(coverage, 'unlinked_requests', 'usage.coverage') },
    field_reports: Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
  }
}

/** Material original and preview are never conflated. */
function turnMaterial(value: unknown): FishTurnMaterial {
  const row = requiredRecord({ value }, 'value', 'material')
  return { seq: optionalNumber(row, 'seq') ?? 0, reference: requiredString(row, 'reference', 'material'),
    source: optionalString(row, 'source') ?? '', conversation: optionalString(row, 'conversation') ?? '',
    message: optionalString(row, 'message') ?? '', place: optionalString(row, 'place') ?? '',
    received: optionalNumber(row, 'received') ?? null, text: optionalString(row, 'text') ?? '', preview: optionalString(row, 'preview') ?? '',
    original_state: requiredString(row, 'original_state', 'material'), original: isRecord(row.original) ? row.original : null,
    payload: isRecord(row.payload) ? row.payload : {}, considered: row.considered === true, cancelled: row.cancelled === true }
}

/** Stable directory and whole-instance accounting, never a latest-thought substitute. */
export function parseTurns(result: unknown): FishResult<FishTurns> {
  return parseReply('turns.list', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'turns.list')
    const stats = turnUsage(row.stats)
    if (stats === null) throw new WorkbenchPayloadError('turns.list.stats')
    return { instance_id: requiredString(row, 'instance_id', 'turns.list'),
      runs: requiredArray(row, 'runs', 'turns.list').map((run) => {
        const parsed = parseTurnView(run)
        if (!parsed.ok) throw new WorkbenchPayloadError(parsed.failure.message)
        return parsed.value
      }), next_cursor: optionalString(row, 'next_cursor') ?? null, stats }
  })
}

/** `turn.view` reply: one turn's real status, trigger, delivery, times, and plan instance. */
export function parseTurnView(result: unknown): FishResult<FishTurnView> {
  return parseReply('turn.view', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'turn.view')
    const trigger = isRecord(record.trigger) ? record.trigger : {}
    const deliveryRaw = isRecord(record.delivery) ? record.delivery : null
    const receipt = deliveryRaw !== null && isRecord(deliveryRaw.receipt) ? deliveryRaw.receipt : null
    const delivery: FishTurnDelivery | null = deliveryRaw === null ? null : {
      state: optionalString(deliveryRaw, 'state') ?? '',
      sent: deliveryRaw.sent === true,
      target: optionalString(deliveryRaw, 'target') ?? '',
      bubbles: optionalNumber(deliveryRaw, 'bubbles') ?? null,
      receiptId: receipt === null ? '' : (optionalString(receipt, 'id') ?? optionalString(receipt, 'request_id') ?? ''),
      receiptMessageId: receipt === null ? '' : (optionalString(receipt, 'message_id') ?? ''),
      error: optionalString(deliveryRaw, 'error') ?? '',
    }
    const timesRaw = isRecord(record.delivery_times) ? record.delivery_times : null
    const deliveryTimes: FishTurnTimes | null = timesRaw === null ? null : {
      arrival: optionalString(timesRaw, 'arrival') ?? '',
      started: optionalNumber(timesRaw, 'started') ?? null,
      first_output: optionalNumber(timesRaw, 'first_output') ?? null,
      sending: optionalNumber(timesRaw, 'sending') ?? null,
      receipt: optionalNumber(timesRaw, 'receipt') ?? null,
      outcome: optionalString(timesRaw, 'outcome') ?? '',
      error: optionalString(timesRaw, 'error') ?? '',
    }
    const trace = isRecord(record.trace) ? record.trace : null
    const speed = isRecord(record.output_speed) ? record.output_speed : null
    const planRaw = isRecord(record.plan) ? record.plan : null
    const scheduleId = planRaw === null ? '' : (optionalString(planRaw, 'schedule_id') ?? '')
    return {
      instance_id: optionalString(record, 'instance_id') ?? '',
      created: optionalNumber(record, 'created') ?? null, started: optionalNumber(record, 'started') ?? null,
      finished: optionalNumber(record, 'finished') ?? null, merged_into: optionalString(record, 'merged_into') ?? '',
      materials: Array.isArray(record.materials) ? record.materials.map(turnMaterial) : [],
      outputs: Array.isArray(record.outputs) ? record.outputs.map((value) => {
        const output = requiredRecord({ value }, 'value', 'output')
        return { text: requiredString(output, 'text', 'output'), kind: requiredString(output, 'kind', 'output'),
          state: requiredString(output, 'state', 'output'), target: optionalString(output, 'target') ?? '',
          call_id: optionalString(output, 'call_id') ?? '' }
      }) : [],
      actions: Array.isArray(record.actions) ? record.actions.map((value) => {
        const action = requiredRecord({ value }, 'value', 'action')
        return { call_id: requiredString(action, 'call_id', 'action'), name: requiredString(action, 'name', 'action'),
          state: requiredString(action, 'state', 'action'), started: optionalNumber(action, 'started') ?? null,
          finished: optionalNumber(action, 'finished') ?? null }
      }) : [],
      trace: trace === null ? null : { state: optionalString(trace, 'state') ?? 'recorded',
        id: optionalString(trace, 'id') ?? '', reference: optionalString(trace, 'reference') ?? '',
        phase: optionalString(trace, 'phase') ?? '', has_reasoning: trace.has_reasoning === true,
        ...(typeof trace.reasoning === 'string' ? { reasoning: trace.reasoning } : {}),
        error: optionalString(trace, 'error') ?? '',
        ...(Array.isArray(trace.events) ? { events: trace.events.map((value) => {
          const event = requiredRecord({ value }, 'value', 'trace.event')
          return { kind: requiredString(event, 'kind', 'trace.event'), at: optionalNumber(event, 'at') ?? null, value: event.value }
        }) } : {}) },
      batches: Array.isArray(record.batches) ? record.batches.filter(isRecord) : [],
      usage: turnUsage(record.usage),
      output_speed: speed === null ? null : { tokens_per_second: optionalNumber(speed, 'tokens_per_second') ?? null,
        reason: optionalString(speed, 'reason') ?? '' },
      execution: requiredString(record, 'execution', 'turn.view'),
      status: optionalString(record, 'status') ?? '',
      raw_status: optionalString(record, 'raw_status') ?? '',
      error: optionalString(record, 'error') ?? '',
      trigger: {
        kind: optionalString(trigger, 'kind') ?? '',
        reason: optionalString(trigger, 'reason') ?? '',
        place: optionalString(trigger, 'place') ?? '',
        source: optionalString(trigger, 'source') ?? '',
        reference: optionalString(trigger, 'reference') ?? '',
      },
      delivery,
      delivery_times: deliveryTimes,
      plan: planRaw === null || scheduleId === '' ? null : {
        schedule_id: scheduleId,
        slot: optionalString(planRaw, 'slot') ?? '',
      },
      silent: record.silent === true,
      merged: record.merged === true,
    }
  })
}

/** `workspace.list` reply: Fish's own workspace directory listing. */
export function parseWorkspaceListing(result: unknown): FishResult<FishWorkspaceListing> {
  return parseReply('workspace.list', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'workspace.list')
    return {
      path: optionalString(record, 'path') ?? '',
      entries: requiredArray(record, 'entries', 'workspace.list').map((item) => {
        const entry = requiredRecord({ item }, 'item', 'workspace.list.entries')
        const bytes = optionalNumber(entry, 'bytes')
        return {
          name: requiredString(entry, 'name', 'workspace.list.entries'),
          directory: entry.directory === true,
          bytes: entry.directory === true ? null : (bytes ?? null),
        }
      }),
    }
  })
}

/** `workspace.read` reply: the real file lines the read tool returned. */
export function parseWorkspaceFile(result: unknown): FishResult<FishWorkspaceFile> {
  return parseReply('workspace.read', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'workspace.read')
    return {
      path: requiredString(record, 'path', 'workspace.read'),
      lines: requiredNumber(record, 'lines', 'workspace.read'),
      text: requiredArray(record, 'text', 'workspace.read').map((line) => {
        if (typeof line !== 'string') throw new WorkbenchPayloadError('workspace.read.text[]')
        return line
      }),
    }
  })
}

/** `workspace.write` reply: the fish_file_write tool's real result. */
export function parseWorkspaceWrite(result: unknown): FishResult<FishWorkspaceWrite> {
  return parseReply('workspace.write', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'workspace.write')
    return {
      ok: record.ok === true,
      path: optionalString(record, 'path') ?? '',
      bytes: optionalNumber(record, 'bytes') ?? 0,
      mtime_ns: optionalNumber(record, 'mtime_ns') ?? 0,
      error: optionalString(record, 'error') ?? optionalString(record, 'message') ?? '',
    }
  })
}

function requiredNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new WorkbenchPayloadError(`${context}.${key}`)
  return value
}

function parseDocument(record: Record<string, unknown>): FishDocument {
  const metadata = isRecord(record.metadata) ? record.metadata : {}
  const processing = isRecord(metadata.processing) ? metadata.processing : {}
  const bytes = optionalNumber(record, 'size') ?? optionalNumber(processing, 'original_bytes')
  return {
    doc_id: requiredString(record, 'doc_id', 'library'),
    name: requiredString(record, 'name', 'library'),
    kind: optionalString(record, 'kind') ?? '',
    chars: requiredNumber(record, 'chars', 'library'),
    chunks: requiredNumber(record, 'chunks', 'library'),
    created: requiredNumber(record, 'created', 'library'),
    version: requiredNumber(record, 'version', 'library'),
    original_path: optionalString(record, 'original_path') ?? '',
    source: optionalString(record, 'source') ?? '',
    url: optionalString(record, 'url') ?? '',
    fetched_at: optionalString(record, 'fetched_at') ?? '',
    folder: optionalString(record, 'folder') ?? '',
    ...(bytes === undefined ? {} : { bytes }),
  }
}

function parseChunk(item: unknown): FishDocumentChunk {
  if (!isRecord(item)) throw new WorkbenchPayloadError('library.detail.preview[]')
  return {
    ord: requiredNumber(item, 'ord', 'library.detail.preview'),
    chars: requiredNumber(item, 'chars', 'library.detail.preview'),
    text: requiredString(item, 'text', 'library.detail.preview'),
  }
}

/** `library.list` reply: every stored document, newest first. */
export function parseDocuments(result: unknown): FishResult<readonly FishDocument[]> {
  return parseReply('library.list', result, value => requiredArray({ value }, 'value', 'library.list')
    .map((item) => {
      if (!isRecord(item)) throw new WorkbenchPayloadError('library.list[]')
      return parseDocument(item)
    }))
}

/** `library.upload` reply: the stored version. */
export function parseDocumentRecord(result: unknown): FishResult<FishDocument> {
  return parseReply('library.upload', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('library.upload')
    return parseDocument(value)
  })
}
/** `library.detail` reply: one document and the first chunks of its text. */
export function parseDocumentDetail(result: unknown): FishResult<FishDocumentDetail> {
  return parseReply('library.detail', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('library.detail')
    return {
      ...parseDocument(value),
      preview: requiredArray(value, 'preview', 'library.detail').map(parseChunk),
      ...(typeof value.next_ord === 'number' ? { next_ord: value.next_ord } : {}),
    }
  })
}

function retrievalStatus(value: unknown): FishRetrievalStatus {
  if (!isRecord(value)) throw new WorkbenchPayloadError('retrieval.status')
  const last = isRecord(value.last_query) ? value.last_query : undefined
  return {
    ready: value.ready === true,
    mode: optionalString(value, 'mode') ?? 'lexical',
    model: optionalString(value, 'model') ?? '',
    detail: optionalString(value, 'detail') ?? '',
    pending: optionalNumber(value, 'pending') ?? 0,
    ...(typeof value.indexed === 'number' ? { indexed: value.indexed } : {}),
    ...(last === undefined ? {} : { last_mode: optionalString(last, 'mode') ?? '', last_detail: optionalString(last, 'detail') ?? '' }),
  }
}

/** The same readiness parser serves the memory and document faces. */
export function parseRetrievalStatus(result: unknown): FishResult<FishRetrievalStatus> {
  return parseReply('retrieval.status', result, retrievalStatus)
}

/** `library.delete` reply: the removed version and how many chunks went with it. */
export function parseDocumentDeleted(result: unknown): FishResult<FishDocumentDeleted> {
  return parseReply('library.delete', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('library.delete')
    return {
      ok: value.ok !== false,
      doc_id: requiredString(value, 'doc_id', 'library.delete'),
      chunks: requiredNumber(value, 'chunks', 'library.delete'),
      original_retained: value.original_retained === true,
    }
  })
}

/** `library.organize` move reply: the real category and where the original went. */
export function parseDocumentOrganized(result: unknown): FishResult<FishDocumentOrganized> {
  return parseReply('library.organize', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('library.organize')
    return {
      ok: value.ok !== false,
      doc_id: requiredString(value, 'doc_id', 'library.organize'),
      path: optionalString(value, 'path') ?? '',
      folder: optionalString(value, 'folder') ?? '',
    }
  })
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseConversationKind(value: unknown): FishConversationKind | undefined {
  return value === 'private' || value === 'group' ? value : undefined
}

function parseConversation(record: Record<string, unknown>): FishConversation {
  const kind = parseConversationKind(record.kind)
  const groupId = optionalString(record, 'group_id')
  const updated = optionalString(record, 'updated_at')
  return {
    ...record,
    id: requiredString(record, 'id', 'chat'),
    title: optionalString(record, 'title') ?? '',
    ...(kind === undefined ? {} : { kind }),
    ...(groupId === undefined ? {} : { group_id: groupId }),
    ...(updated === undefined ? {} : { updated_at: updated }),
    ...(record.read_only === true ? { read_only: true } : {}),
  }
}

function parseDims(value: unknown): FishTraceDims | undefined {
  if (!isRecord(value)) return undefined
  const dims: Record<string, number> = {}
  for (const key of ['content', 'will', 'social', 'timing', 'coherence'] as const) {
    const score = optionalNumber(value, key)
    if (score !== undefined) dims[key] = score
  }
  return Object.keys(dims).length === 0 ? undefined : dims
}

/** One why-chain; absent when the workbench recorded nothing for the message. */
function parseTrace(value: unknown): FishTrace | undefined {
  if (!isRecord(value)) return undefined
  const kind = parseConversationKind(value.kind)
  if (kind === undefined) return undefined
  const event = optionalString(value, 'event')
  const reason = optionalString(value, 'reason')
  const score = optionalNumber(value, 'score')
  const threshold = optionalNumber(value, 'threshold')
  const dims = parseDims(value.dims)
  const elapsed = optionalNumber(value, 'elapsed_ms')
  const persona = optionalString(value, 'persona')
  const tools = Array.isArray(value.tools)
    ? value.tools.filter((item): item is string => typeof item === 'string' && item !== '')
    : []
  const trace: FishTrace = { kind }
  return {
    ...trace,
    ...(event === undefined ? {} : { event }),
    ...(reason === undefined ? {} : { reason }),
    ...(score === undefined ? {} : { score }),
    ...(threshold === undefined ? {} : { threshold }),
    ...(dims === undefined ? {} : { dims }),
    ...(tools.length === 0 ? {} : { tools }),
    ...(elapsed === undefined ? {} : { elapsed_ms: elapsed }),
    ...(persona === undefined || persona === '' ? {} : { persona }),
  }
}

function stringValues(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item !== '')
}

function parseMessage(record: Record<string, unknown>): FishMessage {
  const trace = parseTrace(record.trace)
  const kinds = stringValues(record.kinds)
  const images = (Array.isArray(record.segments) ? record.segments : []).filter(isRecord)
    .filter(segment => segment.type === 'image' && typeof segment.resource_id === 'string')
    .map(segment => ({ resource_id: requiredString(segment, 'resource_id', 'chat.image'), name: optionalString(segment, 'name') ?? '' }))
  const attachments = (Array.isArray(record.segments) ? record.segments : []).filter(isRecord)
    .filter(segment => (segment.type === 'file' || segment.type === 'document') && typeof segment.id === 'string')
    .map(segment => ({ id: requiredString(segment, 'id', 'chat.attachment'), name: optionalString(segment, 'name') ?? '' }))
  return {
    ...record,
    id: requiredString(record, 'id', 'chat'),
    direction: requiredString(record, 'direction', 'chat'),
    text: requiredString(record, 'text', 'chat'),
    status: optionalString(record, 'status') ?? '',
    ...(typeof record.error === 'string' && record.error !== '' ? { error: record.error } : {}),
    ...(kinds.length === 0 ? {} : { kinds }),
    ...(images.length === 0 ? {} : { images }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(trace === undefined ? {} : { trace }),
  }
}

/** Local display preview; the model's actual view is separately recorded. */
export function parseImagePreview(result: unknown): FishResult<FishImagePreview> {
  return parseReply('media.preview', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('media.preview')
    return { resource_id: requiredString(value, 'resource_id', 'media.preview'),
      width: requiredNumber(value, 'width', 'media.preview'), height: requiredNumber(value, 'height', 'media.preview'),
      frame: requiredNumber(value, 'frame', 'media.preview'), frames: requiredNumber(value, 'frames', 'media.preview'),
      mode: requiredString(value, 'mode', 'media.preview'),
      original_path: requiredString(value, 'original_path', 'media.preview'),
      view_path: requiredString(value, 'view_path', 'media.preview'), preview: requiredString(value, 'preview', 'media.preview') }
  })
}

function parseContextUsage(value: unknown): FishContextUsage | undefined {
  if (value === undefined || value === null) return undefined
  const row = requiredRecord({ value }, 'value', 'chat.context_usage')
  return {
    model_window: requiredNumber(row, 'model_window', 'context_usage'),
    input_ceiling: requiredNumber(row, 'input_ceiling', 'context_usage'),
    estimated_input_tokens: requiredNumber(row, 'estimated_input_tokens', 'context_usage'),
    output_reserve: requiredNumber(row, 'output_reserve', 'context_usage'),
    turn_requests: requiredNumber(row, 'turn_requests', 'context_usage'),
    usage_reports: requiredNumber(row, 'usage_reports', 'context_usage'),
    input_tokens: row.input_tokens === null ? null : requiredNumber(row, 'input_tokens', 'context_usage'),
    output_tokens: row.output_tokens === null ? null : requiredNumber(row, 'output_tokens', 'context_usage'),
    trimmed_layers: requiredArray(row, 'trimmed_layers', 'context_usage').map((value) => {
      if (typeof value !== 'number') throw new WorkbenchPayloadError('context_usage.trimmed_layers[]')
      return value
    }),
  }
}

/** `chat.list` / `chat.snapshot` reply. */
export function parseChatSnapshot(result: unknown): FishResult<FishChatSnapshot> {
  return parseReply('chat', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'chat')
    const kind = parseConversationKind(record.kind)
    const contextUsage = parseContextUsage(record.context_usage)
    const thought = isRecord(record.thought) ? record.thought : undefined
    const timing = thought !== undefined && isRecord(thought.timing) ? thought.timing : undefined
    const nullableTime = (key: string): number | null => timing?.[key] === null ? null : optionalNumber(timing ?? {}, key) ?? null
    return {
      ...(contextUsage === undefined ? {} : { context_usage: contextUsage }),
      active_tasks: optionalNumber(record, 'active_tasks') ?? 0,
      ...(thought === undefined ? {} : { thought: {
        id: requiredString(thought, 'id', 'thought'), session: requiredString(thought, 'session', 'thought'),
        origin: requiredString(thought, 'origin', 'thought'), reference: requiredString(thought, 'reference', 'thought'),
        phase: requiredString(thought, 'phase', 'thought'), reasoning: requiredString(thought, 'reasoning', 'thought'),
        error: requiredString(thought, 'error', 'thought'), updated: requiredNumber(thought, 'updated', 'thought'),
        events: requiredArray(thought, 'events', 'thought').map((event) => {
          if (!isRecord(event)) throw new WorkbenchPayloadError('thought.events[]')
          return { kind: requiredString(event, 'kind', 'thought.event'), at: requiredNumber(event, 'at', 'thought.event'), value: event.value }
        }),
        ...(timing === undefined ? {} : { timing: {
          arrival: requiredString(timing, 'arrival', 'thought.timing'), started: nullableTime('started'),
          first_output: nullableTime('first_output'), sending: nullableTime('sending'), receipt: nullableTime('receipt'),
          outcome: requiredString(timing, 'outcome', 'thought.timing'),
          error: optionalString(timing, 'error') ?? '',
        } }),
      } }),
      conversation_id: requiredString(record, 'conversation_id', 'chat'),
      conversations: requiredArray(record, 'conversations', 'chat').map((item) => {
        if (!isRecord(item)) throw new WorkbenchPayloadError('chat.conversations[]')
        return parseConversation(item)
      }),
      messages: requiredArray(record, 'messages', 'chat').map((item) => {
        if (!isRecord(item)) throw new WorkbenchPayloadError('chat.messages[]')
        return parseMessage(item)
      }),
      settings: isRecord(record.settings) ? { ...record.settings } : {},
      ...(kind === undefined ? {} : { kind }),
    }
  })
}

/** One deletion reply: the row counts the workbench actually removed. */
export function parseChatDeleted(result: unknown): FishResult<FishChatDeleted> {
  return parseReply('chat.delete', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'chat.delete')
    return { conversations: optionalNumber(record, 'conversations') ?? 0,
      messages: optionalNumber(record, 'messages') ?? 0 }
  })
}

/** `chat.new` reply. */
export function parseChatCreated(result: unknown): FishResult<FishChatCreated> {
  return parseReply('chat.new', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'chat.new')
    return { id: requiredString(record, 'id', 'chat.new') }
  })
}

/** `chat.send` reply. */
export function parseChatSent(result: unknown): FishResult<FishChatSent> {
  return parseReply('chat.send', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'chat.send')
    return { job_id: requiredString(record, 'job_id', 'chat.send'), status: optionalString(record, 'status') ?? '' }
  })
}

/** `chat.job` reply. */
export function parseChatJob(result: unknown): FishResult<FishChatJob> {
  return parseReply('chat.job', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'chat.job')
    const status = record.status
    if (status !== 'queued' && status !== 'running' && status !== 'complete' && status !== 'failed' && status !== 'cancelled') {
      throw new WorkbenchPayloadError('chat.job.status')
    }
    return { status, ...(typeof record.error === 'string' ? { error: record.error } : {}) }
  })
}

/** Epoch milliseconds from a number (seconds or milliseconds) or a date string. */
function activityStamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value
  if (typeof value !== 'string' || value === '') return undefined
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? undefined : date.getTime()
}

/**
 * Which side of the stream one row came from. A named object and a bare string
 * are both accepted, so a reply that says `{kind: 'group', name}` and one that
 * says `'group:123456'` land on the same label.
 */
function parsePlace(value: unknown): { place: FishActivityPlace; group?: string } {
  if (isRecord(value)) {
    const kind = optionalString(value, 'kind') ?? optionalString(value, 'type') ?? ''
    const name = optionalString(value, 'name') ?? optionalString(value, 'title') ?? optionalString(value, 'id') ?? ''
    const group = kind === 'group' || name !== ''
    return { place: group ? 'group' : 'private', ...(group && name !== '' ? { group: name } : {}) }
  }
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '' || text === 'private' || text === 'owner') return { place: 'private' }
  const named = text.startsWith('group:') ? text.slice('group:'.length) : text === 'group' ? '' : text
  return { place: 'group', ...(named === '' ? {} : { group: named }) }
}

/** One stream row; a row without text cannot be rendered, so it is a payload error. */
function parseActivityItem(record: Record<string, unknown>, index: number): FishActivityItem {
  const text = optionalString(record, 'text') ?? optionalString(record, 'content') ?? optionalString(record, 'summary')
    ?? optionalString(record, 'body') ?? ''
  if (text === '') throw new WorkbenchPayloadError(`activity[${index}].text`)
  const named = optionalString(record, 'group') ?? optionalString(record, 'group_name') ?? optionalString(record, 'group_id')
  const where = record.where ?? record.place ?? record.source
  const source: { place: FishActivityPlace; group?: string } = where === undefined
    ? { place: named === undefined ? 'private' : 'group' }
    : parsePlace(where)
  const group = source.group ?? named
  const at = activityStamp(record.at ?? record.ts ?? record.created_at ?? record.time)
  const from = optionalString(record, 'from') ?? optionalString(record, 'who') ?? optionalString(record, 'sender')
    ?? optionalString(record, 'speaker') ?? optionalString(record, 'author') ?? ''
  return {
    id: optionalString(record, 'id') ?? `activity-${String(index)}`,
    place: source.place,
    ...(at === undefined ? {} : { at }),
    ...(group === undefined || group === '' ? {} : { group }),
    from,
    direction: optionalString(record, 'direction') ?? '',
    text,
  }
}

/** The row array of an `activity.recent` reply, whichever envelope it arrived in. */
function activityRows(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value
  const record = requiredRecord({ value }, 'value', 'activity.recent')
  for (const key of ['items', 'events', 'rows', 'activity', 'stream']) {
    const field = record[key]
    if (Array.isArray(field)) return field
  }
  throw new WorkbenchPayloadError('activity.recent.items')
}

/** `activity.recent` reply: private and group rows in one stream, newest first. */
export function parseActivity(result: unknown): FishResult<readonly FishActivityItem[]> {
  return parseReply('activity.recent', result, (value) => {
    const items = activityRows(value).map((item, index) => {
      if (!isRecord(item)) throw new WorkbenchPayloadError(`activity[${index}]`)
      return parseActivityItem(item, index)
    })
    // Rows with a stamp sort newest first; an unstamped row keeps its place after them.
    const stamped = items.filter(item => item.at !== undefined).sort((left, right) => (right.at ?? 0) - (left.at ?? 0))
    return [...stamped, ...items.filter(item => item.at === undefined)]
  })
}

export { timestampText }

/** Decode the computer-task list without treating missing state as completion. */
export function parseDelegatedTasks(result: unknown): FishResult<readonly FishDelegatedTask[]> {
  return parseReply('delegations.list', result, (value) => {
    if (!Array.isArray(value)) throw new WorkbenchPayloadError('delegations.list')
    return value.map((item) => {
      const row = requiredRecord({ item }, 'item', 'delegations.list')
      const status = requiredString(row, 'status', 'delegation')
      const states: readonly FishDelegationState[] = ['queued', 'starting', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled', 'unknown']
      if (!states.some(state => state === status)) throw new WorkbenchPayloadError('delegation.status')
      const availability = row.artifact_status
      if (availability !== 'pending' && availability !== 'ready' && availability !== 'failed' && availability !== 'served') {
        throw new WorkbenchPayloadError('delegation.artifact_status')
      }
      const finished = optionalNumber(row, 'updated')
      return {
        id: requiredString(row, 'id', 'delegation'), title: requiredString(row, 'title', 'delegation'),
        prompt: requiredString(row, 'prompt', 'delegation'), status: status as FishDelegationState,
        error: requiredString(row, 'error', 'delegation'), result: requiredString(row, 'result', 'delegation'),
        workspace: requiredString(row, 'workspace', 'delegation'), artifact_status: availability,
        artifacts: requiredArray(row, 'artifacts', 'delegation').map((file) => {
          const record = requiredRecord({ file }, 'file', 'delegation.artifact')
          return { id: requiredString(record, 'id', 'artifact'), name: requiredString(record, 'name', 'artifact') }
        }),
        ...(finished === undefined ? {} : { finished }),
      }
    })
  })
}

/** Decode the channel status: who she is, the private route, and each group's real policy. */
export function parseChannels(result: unknown): FishResult<FishChannelStatus> {
  return parseReply('channels.status', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'channels.status')
    const connection = requiredString(record, 'connection_id', 'channels.status')
    if (connection !== '' && connection !== 'qq') throw new WorkbenchPayloadError('channels.status.connection_id')
    if (record.version !== 1) throw new WorkbenchPayloadError('channels.status.version')
    return {
      instance_id: requiredString(record, 'instance_id', 'channels.status') as FishInstanceId,
      version: 1,
      connection_id: connection,
      receive: record.receive === true,
      private_receive: record.private_receive === true,
      connections: requiredArray(record, 'connections', 'channels.status').map((value) => {
        const item = requiredRecord({ value }, 'value', 'connection')
        if (item.id !== 'qq') throw new WorkbenchPayloadError('channels.status.connections.id')
        return { id: 'qq' as const, name: requiredString(item, 'name', 'connection'),
          bot: requiredString(item, 'bot', 'connection'), connected: item.connected === true }
      }),
      owner: requiredString(record, 'owner', 'channels.status'),
      bot: requiredString(record, 'bot', 'channels.status'),
      groups: requiredArray(record, 'groups', 'channels.status').map((item): FishChannelGroup => {
        const group = requiredRecord({ item }, 'item', 'channels.status.groups')
        return {
          id: requiredString(group, 'id', 'channels.status.groups'),
          topic: optionalString(group, 'topic') ?? '',
          route: optionalString(group, 'route') ?? '',
          engine: optionalString(group, 'engine') ?? '',
          listen: group.listen === true,
          read: group.read === true,
          reply: group.reply === true,
          learn: group.learn === true,
        }
      }),
      services: (() => {
        const raw = record.services
        if (raw === undefined) return []
        return requiredArray({ services: raw }, 'services', 'channels.status').map((item): FishChannelService => {
          const service = requiredRecord({ item }, 'item', 'channels.status.services')
          return {
            name: requiredString(service, 'name', 'channels.status.services'),
            ready: service.ready === true,
            detail: optionalString(service, 'detail') ?? '',
          }
        })
      })(),
      private_route: requiredString(record, 'private_route', 'channels.status'),
      note: optionalString(record, 'note') ?? '',
    }
  })
}

function parseCounts(value: unknown, context: string): readonly FishCount[] {
  if (value === undefined) return []
  return requiredArray({ value }, 'value', context).map((item) => {
    if (!isRecord(item)) throw new WorkbenchPayloadError(context + '[]')
    return { label: optionalString(item, 'label') ?? '', count: optionalNumber(item, 'count') ?? 0 }
  })
}

function parseScope(value: unknown): FishDigestScope {
  return value === 'week' || value === 'month' ? value : 'day'
}

function parseDigest(record: Record<string, unknown>): FishDigest {
  const counts = isRecord(record.counts) ? record.counts : {}
  return {
    scope: parseScope(record.scope),
    day: requiredString(record, 'day', 'memory.digest'),
    text: requiredString(record, 'text', 'memory.digest'),
    kinds: stringValues(record.kinds),
    counts: {
      memories: optionalNumber(counts, 'memories') ?? 0,
      expressions: optionalNumber(counts, 'expressions') ?? 0,
      kinds: parseCounts(counts.kinds, 'memory.digest.counts.kinds'),
    },
    created: optionalNumber(record, 'created') ?? 0,
    model_calls: optionalNumber(record, 'model_calls') ?? 0,
    start: optionalNumber(record, 'start') ?? 0,
    end: optionalNumber(record, 'end') ?? 0,
  }
}

/** `memory.digest.revise` reply: the rewritten paragraph and the one it replaced. */
export function parseDigestRevised(result: unknown): FishResult<FishDigestRevised> {
  return parseReply('memory.digest.revise', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'memory.digest.revise')
    return {
      scope: parseScope(row.scope),
      period: requiredString(row, 'period', 'memory.digest.revise'),
      note: optionalString(row, 'note') ?? '',
      before: requiredString(row, 'before', 'memory.digest.revise'),
      after: requiredString(row, 'after', 'memory.digest.revise'),
      digest: parseDigest(requiredRecord(row, 'digest', 'memory.digest.revise')),
    }
  })
}

/** `memory.digest.list` reply: the stored summaries, newest day first. */
export function parseDigests(result: unknown): FishResult<readonly FishDigest[]> {
  return parseReply('memory.digest.list', result, value => requiredArray({ value }, 'value', 'memory.digest.list')
    .map((item) => {
      if (!isRecord(item)) throw new WorkbenchPayloadError('memory.digest.list[]')
      return parseDigest(item)
    }))
}

/** `memory.digest.run` reply: the summary just written and the refreshed timeline. */
export function parseDigestRun(result: unknown): FishResult<FishDigestRun> {
  return parseReply('memory.digest.run', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'memory.digest.run')
    return {
      digest: parseDigest(requiredRecord(row, 'digest', 'memory.digest.run')),
      digests: requiredArray(row, 'digests', 'memory.digest.run').map((item) => {
        if (!isRecord(item)) throw new WorkbenchPayloadError('memory.digest.run.digests[]')
        return parseDigest(item)
      }),
    }
  })
}

function parseTotals(value: unknown, context: string): FishLibraryTotals {
  const row = isRecord(value) ? value : {}
  return {
    total: optionalNumber(row, 'total') ?? 0,
    kinds: parseCounts(row.kinds, context + '.kinds'),
    statuses: parseCounts(row.statuses, context + '.statuses'),
  }
}

/** One expression row, from `language.list` or `memory.overview`. */
function parseExpression(record: Record<string, unknown>): FishExpression {
  const source = isRecord(record.source) ? record.source : {}
  const usage = isRecord(record.usage) ? record.usage : {}
  return {
    id: requiredString(record, 'id', 'expression'),
    kind_label: optionalString(record, 'kind_label') ?? '',
    trigger: optionalString(record, 'trigger') ?? '',
    content: optionalString(record, 'content') ?? '',
    status: optionalString(record, 'status') ?? '',
    status_label: optionalString(record, 'status_label') ?? '',
    editable: record.editable === true,
    source: [record.source_type_label, source.chat, source.message_id, source.at, source.note]
      .filter(value => typeof value === 'string' && value !== '').join(' · '),
    usage: [usage.extracted_label ?? usage.extracted ?? '—', usage.retrieved_label ?? '—',
      usage.adopted_label ?? '—'].map(value => String(value)).join(' / '),
  }
}

/**
 * `language.list` reply, filtered to the expression libraries themselves:
 * owner memories appear in the middle of the page already and are not expressions.
 */
export function parseExpressions(result: unknown): FishResult<readonly FishExpression[]> {
  return parseReply('language.list', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'language.list')
    return requiredArray(row, 'items', 'language.list')
      .filter(item => isRecord(item) && item.source_type !== 'files')
      .map(item => parseExpression(item as Record<string, unknown>))
  })
}

/** `memory.overview` reply: timeline, library totals, open events, recent expressions. */
export function parseOverview(result: unknown): FishResult<FishOverview> {
  return parseReply('memory.overview', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'memory.overview')
    const counts = isRecord(row.counts) ? row.counts : {}
    return {
      digests: requiredArray(row, 'digests', 'memory.overview').map((item) => {
        if (!isRecord(item)) throw new WorkbenchPayloadError('memory.overview.digests[]')
        return parseDigest(item)
      }),
      counts: {
        memories: parseTotals(counts.memories, 'memory.overview.memories'),
        expressions: parseTotals(counts.expressions, 'memory.overview.expressions'),
      },
      open_events: requiredArray(row, 'open_events', 'memory.overview').map((item) => {
        if (!isRecord(item)) throw new WorkbenchPayloadError('memory.overview.open_events[]')
        return {
          id: requiredString(item, 'id', 'open_event'),
          text: optionalString(item, 'text') ?? '',
          state: optionalString(item, 'state') ?? '',
          due: optionalNumber(item, 'due') ?? 0,
          created: optionalNumber(item, 'created') ?? 0,
        } satisfies FishOpenEvent
      }),
      expressions: (Array.isArray(row.expressions) ? row.expressions : [])
        .filter(item => isRecord(item)).map(item => parseExpression(item as Record<string, unknown>)),
    }
  })
}

/** Decode the actual bytes returned for a verified task attachment. */
export function parseTaskDownload(result: unknown): FishResult<{
  readonly name: string
  readonly media_type: string
  readonly data: string
  readonly size: number
  readonly offset: number
  readonly next_offset: number | null
}> {
  return parseReply('delegations.download', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'delegations.download')
    return { name: requiredString(row, 'name', 'download'), media_type: requiredString(row, 'media_type', 'download'),
      data: requiredString(row, 'data', 'download'), size: requiredNumber(row, 'size', 'download'),
      offset: requiredNumber(row, 'offset', 'download'), next_offset: row.next_offset === null ? null : requiredNumber(row, 'next_offset', 'download') }
  })
}

/** Narrow the canonical attachment processing coverage, including older unindexed records. */
function attachmentProcessing(value: unknown): FishAttachmentProcessing {
  const row = isRecord(value) ? value : {}
  const optional = (key: string): { readonly [key: string]: number } => {
    const number = optionalNumber(row, key)
    return number === undefined ? {} : { [key]: number }
  }
  return { complete: row.complete === true, indexed_chars: optionalNumber(row, 'indexed_chars') ?? 0,
    range_kind: optionalString(row, 'range_kind') ?? 'unknown',
    ...optional('parsed_start'), ...optional('parsed_end'), ...optional('parsed_pages'), ...optional('total_pages'),
    ...optional('parsed_xml_bytes'), ...optional('total_xml_bytes') }
}

function attachmentRow(value: unknown): FishAttachment {
  const row = requiredRecord({ value }, 'value', 'attachment')
  return { id: requiredString(row, 'id', 'attachment'), name: requiredString(row, 'name', 'attachment'),
    path: requiredString(row, 'path', 'attachment'), type: requiredString(row, 'type', 'attachment'),
    resource_id: requiredString(row, 'resource_id', 'attachment'), size: requiredNumber(row, 'size', 'attachment'),
    status: requiredString(row, 'status', 'attachment'), error: optionalString(row, 'error') ?? '',
    processing: attachmentProcessing(row.processing) }
}

export function parseAttachment(value: unknown): FishResult<FishAttachment> {
  return parseReply('attachments.finish', value, attachmentRow)
}

export function parseAttachmentConfig(value: unknown): FishResult<FishAttachmentConfig> {
  return parseReply('attachments.config', value, (result) => {
    const row = requiredRecord({ result }, 'result', 'attachments.config')
    const chunk = requiredNumber(row, 'chunk_bytes', 'attachments.config')
    if (!Number.isSafeInteger(chunk) || chunk <= 0) throw new WorkbenchPayloadError('attachments.config.chunk_bytes')
    return { chunk_bytes: chunk, original_max_bytes: row.original_max_bytes === null ? null : requiredNumber(row, 'original_max_bytes', 'attachments.config'),
      max_per_message: requiredNumber(row, 'max_per_message', 'attachments.config'),
      automatic_text_preview_bytes: requiredNumber(row, 'automatic_text_preview_bytes', 'attachments.config'),
      workbench_control_bytes: requiredNumber(row, 'workbench_control_bytes', 'attachments.config'),
      tool_control_bytes: requiredNumber(row, 'tool_control_bytes', 'attachments.config'),
      native_image_bytes: requiredNumber(row, 'native_image_bytes', 'attachments.config'),
      source: requiredString(row, 'source', 'attachments.config'), note: requiredString(row, 'note', 'attachments.config') }
  })
}

export function parseUploadProgress(value: unknown): FishResult<FishUploadProgress> {
  return parseReply('attachments.chunk', value, (result) => {
    const row = requiredRecord({ result }, 'result', 'attachments.chunk')
    return { upload_id: requiredString(row, 'upload_id', 'upload'), received: requiredNumber(row, 'received', 'upload'), size: requiredNumber(row, 'size', 'upload') }
  })
}

export function parseUploadStarted(value: unknown): FishResult<FishUploadStarted> {
  return parseReply('attachments.begin', value, (result) => {
    const row = requiredRecord({ result }, 'result', 'attachments.begin')
    const chunk = requiredNumber(row, 'chunk_bytes', 'upload')
    if (!Number.isSafeInteger(chunk) || chunk <= 0) throw new WorkbenchPayloadError('upload.chunk_bytes')
    return { upload_id: requiredString(row, 'upload_id', 'upload'), received: requiredNumber(row, 'received', 'upload'),
      size: requiredNumber(row, 'size', 'upload'), chunk_bytes: chunk }
  })
}

export function parseAttachmentDetail(value: unknown): FishResult<FishAttachmentDetail> {
  return parseReply('attachments.detail', value, (result) => {
    const row = requiredRecord({ result }, 'result', 'attachments.detail')
    return { ...attachmentRow(row), original_exists: row.original_exists === true,
      reads: requiredArray(row, 'reads', 'attachments.detail').map((item) => {
        const read = requiredRecord({ item }, 'item', 'attachment.read')
        return { session: requiredString(read, 'session', 'read'), mode: requiredString(read, 'mode', 'read'),
          start: requiredNumber(read, 'start', 'read'), end: requiredNumber(read, 'end', 'read'),
          query: requiredString(read, 'query', 'read'), created: requiredNumber(read, 'created', 'read') }
      }) }
  })
}


/** Real numbers of a field object; a missing field stays 0 rather than becoming a guess. */
function numberField(record: Record<string, unknown>, key: string): number {
  return optionalNumber(record, key) ?? 0
}

function textField(record: Record<string, unknown>, key: string): string {
  return optionalString(record, key) ?? ''
}

/** Display text of an untrusted scalar: strings and numbers, nothing stringified blindly. */
function scalarText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function curationCount(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new WorkbenchPayloadError(`memory.curate.${key}`)
  }
  return value
}

/**
 * One curation run record. `result` is what the program actually completed;
 * a missing section stays empty so the page cannot print work that never ran.
 */
function parseCurationRunRecord(value: unknown): FishCurationRun {
  if (!isRecord(value)) throw new WorkbenchPayloadError('memory.curate')
  const result = isRecord(value.result) ? value.result : {}
  const progress = (Array.isArray(value.progress) ? value.progress : []).filter(isRecord).map(step => ({
    name: textField(step, 'name'), state: textField(step, 'state'), error: textField(step, 'error'),
    completed: curationCount(step, 'completed'), remaining: curationCount(step, 'remaining'),
    batch_count: curationCount(step, 'batch_count'),
  }))
  const learning = [...progress].reverse().find(step => step.name === 'learn' && step.completed !== null)
  const running = value.status === 'queued' || value.status === 'running'
  const count = (key: 'completed' | 'remaining' | 'batch_count'): number | null => running
    ? learning?.[key] ?? curationCount(result, key)
    : curationCount(result, key) ?? learning?.[key] ?? null
  const digest = isRecord(result.digest)
    ? {
      state: textField(result.digest, 'state'),
      day: textField(result.digest, 'day'),
      skipped: result.digest.skipped === true,
      model_calls: numberField(result.digest, 'model_calls'),
      chars: numberField(result.digest, 'chars'),
      error: textField(result.digest, 'error'),
    } satisfies FishCurationDigest
    : undefined
  return {
    id: requiredString(value, 'id', 'memory.curate'),
    status: textField(value, 'status'),
    stage: textField(value, 'stage'),
    status_label: textField(value, 'status_label'),
    requested_by: textField(value, 'requested_by'),
    day: textField(value, 'day'),
    range_start: numberField(value, 'range_start'),
    range_end: numberField(value, 'range_end'),
    created: numberField(value, 'created'),
    started: numberField(value, 'started'),
    finished: numberField(value, 'finished'),
    error: textField(value, 'error'),
    note: textField(value, 'note'),
    reused: value.reused === true,
    progress,
    result: {
      completed: count('completed'),
      remaining: count('remaining'),
      batch_count: count('batch_count'),
      new_messages: numberField(result, 'new_messages'),
      saved_count: numberField(result, 'saved_count'),
      failure_count: numberField(result, 'failure_count'),
      model_calls: numberField(result, 'model_calls'),
      skipped_existing: numberField(result, 'skipped_existing'),
      truncated: result.truncated === true,
      note: textField(result, 'note'),
      failures: (Array.isArray(result.failures) ? result.failures : []).filter(isRecord).map(item => ({
        stage: textField(item, 'stage'),
        reason: textField(item, 'reason'),
      })),
      ...(digest === undefined ? {} : { digest }),
    },
  }
}

/** `memory.curate.run` reply: the accepted (or already running) run record. */
export function parseCurationRun(result: unknown): FishResult<FishCurationRun> {
  return parseReply('memory.curate.run', result, parseCurationRunRecord)
}

/** `memory.curate.status` reply: the asked run, the recent list, and the shared-record note. */
export function parseCurationStatus(result: unknown): FishResult<FishCurationStatus> {
  return parseReply('memory.curate.status', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'memory.curate.status')
    return {
      run: row.run === null || row.run === undefined ? null : parseCurationRunRecord(row.run),
      latest: row.latest === null || row.latest === undefined ? null : parseCurationRunRecord(row.latest),
      runs: requiredArray(row, 'runs', 'memory.curate.status').map(parseCurationRunRecord),
      note: textField(row, 'note'),
    }
  })
}

/** One channel's honesty state; absent numbers stay 0 and absent text stays empty. */
function parseKnowledgeChannel(value: unknown): FishKnowledgeChannelState {
  const row = isRecord(value) ? value : {}
  return {
    mode: textField(row, 'mode'),
    used: row.used === true,
    detail: textField(row, 'detail'),
    status: textField(row, 'status'),
    label: textField(row, 'label'),
    reason: textField(row, 'reason'),
    indexed: numberField(row, 'indexed'),
    pending: numberField(row, 'pending'),
    fts5: row.fts5 === true,
    ready: row.ready === true,
    unindexed: numberField(row, 'unindexed'),
  }
}

function knowledgeChannels(value: unknown): Readonly<Record<string, FishKnowledgeChannelState>> {
  if (!isRecord(value)) return {}
  const channels: Record<string, FishKnowledgeChannelState> = {}
  for (const [name, state] of Object.entries(value)) channels[name] = parseKnowledgeChannel(state)
  return channels
}

/** Source fields read back from the existing document, memory or message record. */
function knowledgeOrigin(row: Record<string, unknown>): FishKnowledgeOrigin {
  const metadata = isRecord(row.metadata) ? row.metadata : {}
  const links = (Array.isArray(row.links) ? row.links : []).filter(isRecord)
    .map(link => textField(link, 'reference')).filter(reference => reference !== '')
  const reference = textField(metadata, 'source_reference')
  return {
    scope: textField(row, 'scope') || textField(row, 'place'),
    source: textField(row, 'source') || textField(row, 'store'),
    sender: textField(row, 'sender') || scalarText(metadata.sender_id ?? metadata.sender),
    quote: scalarText(row.quote ?? metadata.reply_to),
    references: Array.from(new Set([...links, ...(reference === '' ? [] : [reference])])),
    version: numberField(row, 'version'),
    parent_version: textField(row, 'parent_version'),
  }
}

/** `knowledge.search` reply: graded hits plus the retrieval facts of this exact query. */
export function parseKnowledgeSearch(result: unknown): FishResult<FishKnowledgeSearch> {
  return parseReply('knowledge.search', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'knowledge.search')
    const retrieval = isRecord(row.retrieval) ? row.retrieval : {}
    const semantic = isRecord(retrieval.semantic) ? retrieval.semantic : {}
    const counts = isRecord(retrieval.channels) ? retrieval.channels : {}
    const channelCounts: Record<string, number> = {}
    for (const [name, count] of Object.entries(counts)) {
      if (typeof count === 'number' && Number.isFinite(count)) channelCounts[name] = count
    }
    const terms = isRecord(retrieval.terms) ? stringValues(retrieval.terms.sample) : []
    return {
      query: textField(row, 'query'),
      hits: requiredArray(row, 'hits', 'knowledge.search').map((item) => {
        const hit = requiredRecord({ item }, 'item', 'knowledge.search.hit')
        const levels = isRecord(hit.levels) ? hit.levels : {}
        const index = isRecord(levels.index) ? levels.index : {}
        const overview = isRecord(levels.overview) ? levels.overview : {}
        const original = isRecord(levels.original) ? levels.original : {}
        const semanticScore = optionalNumber(index, 'semantic')
        return {
          reference: requiredString(hit, 'reference', 'knowledge.hit'),
          kind: textField(hit, 'kind'),
          level: textField(hit, 'level'),
          channel: textField(hit, 'channel'),
          snippet: textField(hit, 'snippet'),
          time: textField(hit, 'time'),
          score: optionalNumber(hit, 'score') ?? null,
          fused: numberField(hit, 'fused'),
          matched_by: textField(index, 'matched_by'),
          semantic: semanticScore === undefined ? null : semanticScore,
          overview_available: overview.available !== false,
          overview_reason: textField(overview, 'reason'),
          original_available: original.available !== false,
          origin: knowledgeOrigin(hit),
        }
      }),
      retrieval: {
        mode: textField(retrieval, 'mode'),
        label: textField(retrieval, 'label'),
        fts5: retrieval.fts5 === true,
        note: textField(retrieval, 'note'),
        limit: numberField(retrieval, 'limit'),
        truncated: retrieval.truncated === true,
        matched_total: numberField(retrieval, 'matched_total'),
        terms,
        channels: channelCounts,
        semantic: {
          used: semantic.used === true,
          status: textField(semantic, 'status'),
          mode: textField(semantic, 'mode'),
          label: textField(semantic, 'label'),
          reason: textField(semantic, 'reason'),
          query_used_semantic: semantic.query_used_semantic === true,
          channels: knowledgeChannels(semantic.channels),
        },
      },
    }
  })
}

function parseKnowledgeMessage(item: unknown, context: string): FishKnowledgeMessage {
  const row = requiredRecord({ item }, 'item', context)
  const attachments = (Array.isArray(row.attachments) ? row.attachments : []).filter(isRecord)
    .map(part => [textField(part, 'type'), optionalString(part, 'name') ?? textField(part, 'text')]
      .filter(part => part !== '').join(' · '))
  return {
    id: scalarText(row.id),
    time: textField(row, 'time'),
    place: textField(row, 'place'),
    sender: textField(row, 'sender'),
    direction: textField(row, 'direction'),
    text: textField(row, 'text'),
    status: textField(row, 'status'),
    quote: textField(row, 'quote'),
    conversation: textField(row, 'conversation'),
    attachments,
  }
}

/**
 * `knowledge.open` reply: the level the owning store answered. A kind this page
 * has no renderer for keeps its reference and note rather than being dropped.
 */
export function parseKnowledgeOpened(result: unknown): FishResult<FishKnowledgeOpened> {
  return parseReply('knowledge.open', result, (value) => {
    const row = requiredRecord({ value }, 'value', 'knowledge.open')
    const reference = requiredString(row, 'reference', 'knowledge.open')
    const level = textField(row, 'level')
    const note = textField(row, 'note')
    const kind = textField(row, 'kind')
    if (kind === 'message') {
      const catalog = isRecord(row.catalog)
        ? {
          gist: textField(row.catalog, 'gist'),
          topics: textField(row.catalog, 'topics'),
          start_time: textField(row.catalog, 'start_time'),
          end_time: textField(row.catalog, 'end_time'),
          from: scalarText(row.catalog.from_message_id),
          to: scalarText(row.catalog.to_message_id),
        } satisfies FishKnowledgeCatalog
        : null
      const attachments = (Array.isArray(row.attachments) ? row.attachments : []).filter(isRecord)
        .map(part => [textField(part, 'type'), optionalString(part, 'name') ?? textField(part, 'text')]
          .filter(part => part !== '').join(' · '))
      return {
        kind: 'message',
        reference,
        level,
        note,
        message: isRecord(row.message) ? parseKnowledgeMessage(row.message, 'knowledge.open.message') : null,
        catalog,
        context: (Array.isArray(row.context) ? row.context : [])
          .map(item => parseKnowledgeMessage(item, 'knowledge.open.context')),
        attachments,
      }
    }
    if (kind === 'catalog') {
      const entry = isRecord(row.entry) ? row.entry : {}
      return {
        kind: 'catalog',
        reference,
        level,
        note,
        gist: textField(entry, 'gist'),
        topics: textField(entry, 'topics'),
        start_time: textField(entry, 'start_time'),
        end_time: textField(entry, 'end_time'),
        messages: (Array.isArray(row.messages) ? row.messages : [])
          .map(item => parseKnowledgeMessage(item, 'knowledge.open.messages')),
        page: numberField(row, 'page'),
        next_page: optionalNumber(row, 'next_page') ?? null,
      }
    }
    if (kind === 'document') {
      return {
        kind: 'document',
        reference,
        level,
        note,
        doc_id: requiredString(row, 'doc_id', 'knowledge.open.document'),
        doc_name: textField(row, 'doc_name'),
        version: numberField(row, 'version'),
        chunks: numberField(row, 'chunks'),
        chars: numberField(row, 'chars'),
        url: textField(row, 'url'),
        original_path: textField(row, 'original_path'),
        original_exists: row.original_exists === true,
        origin: knowledgeOrigin(row),
        chunk: isRecord(row.chunk) ? parseChunk(row.chunk) : null,
        preview: (Array.isArray(row.preview) ? row.preview : []).map(parseChunk),
      }
    }
    if (kind === 'memory') {
      return {
        kind: 'memory',
        reference,
        level,
        note,
        memory: isRecord(row.memory) ? parseMemory(row.memory) : null,
        revisions: requiredArray(row, 'revisions', 'knowledge.open.memory').map((item) => {
          if (!isRecord(item)) throw new WorkbenchPayloadError('knowledge.open.memory.revisions[]')
          return {
            revision: requiredNumber(item, 'revision', 'knowledge.open.memory'),
            text: requiredString(item, 'text', 'knowledge.open.memory'),
            source_text: optionalString(item, 'source_text') ?? '',
            evidence: optionalString(item, 'evidence') ?? '',
            created: requiredNumber(item, 'created', 'knowledge.open.memory'),
          }
        }),
      }
    }
    if (kind === 'digest') {
      return {
        kind: 'digest',
        reference,
        level,
        note,
        digest: isRecord(row.digest) ? parseDigest(row.digest) : null,
      }
    }
    return { kind: 'other', reference, level, note }
  })
}

/** The six plugin kinds the Fish registry accepts; an unknown kind is a payload failure. */
function parsePluginKind(value: unknown): FishPluginKind {
  if (value === 'mcp_stdio' || value === 'mcp_http' || value === 'mcp_sse'
    || value === 'cli' || value === 'http' || value === 'dsh') return value
  throw new WorkbenchPayloadError('plugin.kind')
}

/** One tool row from a discovery reply; only name and description are shown. */
function parsePluginTool(value: unknown): FishPluginTool {
  const record = requiredRecord({ value }, 'value', 'plugin.tool')
  return {
    name: requiredString(record, 'name', 'plugin.tool'),
    description: optionalString(record, 'description') ?? '',
    inputSchema: isRecord(record.inputSchema) ? record.inputSchema : { type: 'object', properties: {} },
  }
}

/** One event row; the registry may leave any text field empty. */
function parsePluginEvent(value: unknown): FishPluginEvent {
  const record = requiredRecord({ value }, 'value', 'plugin.event')
  return {
    ts: requiredNumber(record, 'ts', 'plugin.event'),
    plugin: optionalString(record, 'plugin') ?? '',
    role: optionalString(record, 'role') ?? '',
    action: optionalString(record, 'action') ?? '',
    ok: record.ok === true,
    detail: optionalString(record, 'detail') ?? '',
  }
}

/** One plugin entry: registry fields with the last real test result, no derived health. */
function parsePlugin(value: unknown): FishPlugin {
  const record = requiredRecord({ value }, 'value', 'plugin')
  const server = isRecord(record.server_info) ? record.server_info : {}
  const lastTest = optionalNumber(record, 'last_test')
  const testOk = record.test_ok === true ? true : record.test_ok === false ? false : null
  const allowed = record.allowed_tools
  return {
    id: requiredString(record, 'id', 'plugin'),
    name: optionalString(record, 'name') ?? requiredString(record, 'id', 'plugin'),
    kind: parsePluginKind(record.kind),
    roles: (Array.isArray(record.roles) ? record.roles : []).filter((role): role is string => typeof role === 'string'),
    enabled: record.enabled === true,
    owner_only: record.owner_only !== false,
    timeout: optionalNumber(record, 'timeout') ?? 60,
    command: optionalString(record, 'command') ?? '',
    args: (Array.isArray(record.args) ? record.args : []).filter((arg): arg is string => typeof arg === 'string'),
    url: optionalString(record, 'url') ?? '',
    allowed_tools: Array.isArray(allowed)
      ? allowed.filter((tool): tool is string => typeof tool === 'string')
      : null,
    last_test: lastTest ?? null,
    last_error: optionalString(record, 'last_error') ?? '',
    test_ok: testOk,
    server_name: optionalString(server, 'name') ?? '',
    server_version: optionalString(server, 'version') ?? '',
    package_name: optionalString(record, 'package_name') ?? '',
    package_version: optionalString(record, 'package_version') ?? '',
    tools: (Array.isArray(record.tools) ? record.tools : []).map(parsePluginTool),
    installed_roles: (Array.isArray(record.installed_roles) ? record.installed_roles : [])
      .filter((role): role is string => typeof role === 'string'),
  }
}

/** `plugins.list` reply: registered plugins, recent events, and in-flight calls. */
export function parsePlugins(result: unknown): FishResult<FishPluginSnapshot> {
  return parseReply('plugins.list', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'plugins.list')
    return {
      plugins: requiredArray(record, 'plugins', 'plugins.list').map(parsePlugin),
      events: (Array.isArray(record.events) ? record.events : []).map(parsePluginEvent),
      active: (Array.isArray(record.active) ? record.active : []).filter((item): item is string => typeof item === 'string'),
    }
  })
}

/** `plugins.save` reply: the stored plugin id. */
export function parsePluginSaved(result: unknown): FishResult<string> {
  return parseReply('plugins.save', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'plugins.save')
    return requiredString(record, 'id', 'plugins.save')
  })
}

/** `plugins.test` reply: the tools the plugin actually reported. */
export function parsePluginTest(result: unknown): FishResult<FishPluginDiscovery> {
  return parseReply('plugins.test', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'plugins.test')
    return {
      tools: requiredArray(record, 'tools', 'plugins.test').map(parsePluginTool),
      native: record.native === true,
    }
  })
}

/** One skill row; a missing enabled flag follows the backend default (enabled). */
function parseSkill(value: unknown, context: string): FishSkill {
  const record = requiredRecord({ value }, 'value', context)
  const updated = record.updated
  return {
    name: requiredString(record, 'name', context),
    description: optionalString(record, 'description') ?? '',
    enabled: record.enabled !== false,
    updated: typeof updated === 'number' || typeof updated === 'string' ? updated : null,
    path: optionalString(record, 'path') ?? '',
    chars: optionalNumber(record, 'chars') ?? 0,
  }
}

/** `skills.list` reply: the real `data/skills` folder and Fish's own note. */
export function parseSkills(result: unknown): FishResult<FishSkillSnapshot> {
  return parseReply('skills.list', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'skills.list')
    return {
      skills: requiredArray(record, 'skills', 'skills.list').map(item => parseSkill(item, 'skills.list')),
      note: optionalString(record, 'note') ?? '',
    }
  })
}

/**
 * `skills.save`, `skills.import`, or `skills.enable` reply: the stored skill.
 * @param result - the workbench result value.
 * @param action - the action that returned it, used in a payload failure.
 */
export function parseSkillEntry(result: unknown, action: string): FishResult<FishSkillEntry> {
  return parseReply(action, result, (value) => {
    const record = requiredRecord({ value }, 'value', action)
    return {
      ...parseSkill(record, action),
      body: optionalString(record, 'body') ?? '',
      note: optionalString(record, 'note') ?? '',
    }
  })
}

/** `skills.read` reply: the body Fish's `fish_skill_use` would actually load. */
export function parseSkillRead(result: unknown): FishResult<FishSkillEntry> {
  return parseReply('skills.read', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'skills.read')
    return {
      ...parseSkill(record, 'skills.read'),
      body: requiredString(record, 'body', 'skills.read'),
      note: optionalString(record, 'note') ?? '',
    }
  })
}

/** `skills.delete` reply: the removed name. */
export function parseSkillDeleted(result: unknown): FishResult<FishSkillDeleted> {
  return parseReply('skills.delete', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'skills.delete')
    return { name: requiredString(record, 'deleted', 'skills.delete') }
  })
}

/** One connection record; credential presence comes only from the backend. */
function parseModelConnection(value: unknown, context: string): FishModelConnection {
  const record = requiredRecord({ value }, 'value', context)
  return {
    id: optionalString(record, 'id') ?? requiredString(record, 'role', context),
    role: requiredString(record, 'role', context),
    name: optionalString(record, 'name') ?? '',
    base: optionalString(record, 'base') ?? '',
    model: optionalString(record, 'model') ?? '',
    key_ref: optionalString(record, 'key_ref') ?? '',
    has_key: record.has_key === true,
    key_source: optionalString(record, 'key_source') ?? '',
    env: optionalString(record, 'env') ?? '',
  }
}

/** One use row; an omitted supported flag follows the backend default (supported). */
function parseModelUse(value: unknown): FishModelUse {
  const record = requiredRecord({ value }, 'value', 'model.use')
  return {
    use: requiredString(record, 'use', 'model.use'),
    role: optionalString(record, 'role') ?? '',
    label: optionalString(record, 'label') ?? '',
    supported: record.supported !== false,
    ready: record.ready === true,
    connection: optionalString(record, 'connection') ?? '',
    model: optionalString(record, 'model') ?? '',
    reason: optionalString(record, 'reason') ?? '',
  }
}

/** `models.current` gateway: fields, or the backend's own read error. */
function parseModelGateway(value: unknown): FishModelGateway {
  const record = requiredRecord({ value }, 'value', 'models.current.gateway')
  return {
    base: optionalString(record, 'base') ?? '',
    model: optionalString(record, 'model') ?? '',
    has_key: record.has_key === true,
    error: optionalString(record, 'error') ?? '',
  }
}

/**
 * `models.connections` / `models.current` reply: connections, uses, and the
 * gateway read only when the reply carries one.
 * @param result - the workbench result value.
 * @param action - the action that returned it, used in a payload failure.
 */
export function parseModels(result: unknown, action: string): FishResult<FishModelDescription> {
  return parseReply(action, result, (value) => {
    const record = requiredRecord({ value }, 'value', action)
    const gateway = record.gateway === undefined ? undefined : parseModelGateway(record.gateway)
    return {
      connections: requiredArray(record, 'connections', action).map(item => parseModelConnection(item, action)),
      uses: requiredArray(record, 'uses', action).map(parseModelUse),
      source: optionalString(record, 'source') ?? '',
      note: optionalString(record, 'note') ?? '',
      ...(gateway === undefined ? {} : { gateway }),
    }
  })
}

/** `models.save` reply: the stored connection and the moment it takes effect. */
export function parseModelSaved(result: unknown): FishResult<FishModelSaved> {
  return parseReply('models.save', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'models.save')
    return {
      connection: parseModelConnection(record.connection, 'models.save'),
      effective_at: optionalString(record, 'effective_at') ?? '',
      applied_uses: (Array.isArray(record.applied_uses) ? record.applied_uses : [])
        .filter((use): use is string => typeof use === 'string'),
      note: optionalString(record, 'note') ?? '',
    }
  })
}

/**
 * `models.test` / `models.discover` reply: one real probe. A failed probe has
 * a reason and no model list; neither shape is turned into the other.
 * @param result - the workbench result value.
 * @param action - the action that returned it, used in a payload failure.
 */
export function parseModelProbe(result: unknown, action = 'models.test'): FishResult<FishModelProbe> {
  return parseReply(action, result, (value) => {
    const record = requiredRecord({ value }, 'value', action)
    return {
      ok: record.ok === true,
      status: optionalNumber(record, 'status') ?? 0,
      models: (Array.isArray(record.models) ? record.models : []).filter((model): model is string => typeof model === 'string'),
      model: optionalString(record, 'model') ?? '',
      discovery: record.discovery === true,
      reason: optionalString(record, 'reason') ?? '',
      note: optionalString(record, 'note') ?? '',
    }
  })
}

/** `models.remove` reply: the credential removal and the uses it affects. */
export function parseModelRemoved(result: unknown): FishResult<FishModelRemoved> {
  return parseReply('models.remove', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'models.remove')
    return {
      removed: record.removed === true,
      connection: record.connection === null || record.connection === undefined
        ? null
        : parseModelConnection(record.connection, 'models.remove'),
      affected_uses: (Array.isArray(record.affected_uses) ? record.affected_uses : [])
        .filter((use): use is string => typeof use === 'string'),
      ready: record.ready === true,
      note: optionalString(record, 'note') ?? '',
    }
  })
}

/** Parse the one instance-owned settings value, including actual effective tools. */
export function parseToolSettings(result: unknown): FishResult<FishToolSettings> {
  return parseReply('tools.settings', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'tools.settings')
    const settings = requiredRecord(record, 'settings', 'tools.settings')
    const send = requiredRecord(settings, 'send', 'tools.settings')
    const flags = (source: unknown): Record<string, boolean> => {
      if (!isRecord(source)) throw new WorkbenchPayloadError('tools.settings.flags')
      const output: Record<string, boolean> = {}
      for (const [name, enabled] of Object.entries(source)) {
        if (typeof enabled !== 'boolean') throw new WorkbenchPayloadError('tools.settings.enabled')
        output[name] = enabled
      }
      return output
    }
    if (typeof send.private !== 'boolean' || typeof send.group !== 'boolean') throw new WorkbenchPayloadError('tools.settings.send')
    return {
      instance_id: requiredString(record, 'instance_id', 'tools.settings'),
      settings: { tools: flags(settings.tools), plugins: flags(settings.plugins), send: {
        private: send.private, group: send.group, groups: flags(send.groups),
      } },
      tools: requiredArray(record, 'tools', 'tools.settings').map((item) => {
        const tool = requiredRecord({ item }, 'item', 'tools.settings.tool')
        if (typeof tool.enabled !== 'boolean') throw new WorkbenchPayloadError('tools.settings.tool.enabled')
        return { name: requiredString(tool, 'name', 'tools.settings.tool'), description: optionalString(tool, 'description') ?? '',
          enabled: tool.enabled, reason: optionalString(tool, 'reason') ?? '' }
      }),
      groups: requiredArray(record, 'groups', 'tools.settings').map((group) => {
        if (typeof group !== 'string') throw new WorkbenchPayloadError('tools.settings.group')
        return group
      }),
    }
  })
}
