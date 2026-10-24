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
  type FishTask, type FishDelegatedTask, type FishDelegationState, type FishChatDeleted,
  type FishDigestRevised, type FishDigestScope, type FishPersonasCleared, type FishPersonaKept,
  type FishChannelStatus, type FishChannelGroup,
  type FishActivityItem, type FishActivityPlace, type FishImagePreview,
  type FishAttachment, type FishAttachmentConfig, type FishAttachmentDetail, type FishAttachmentProcessing,
  type FishUploadStarted, type FishUploadProgress,
  type FishConversationKind, type FishTrace, type FishTraceDims,
  type FishCount, type FishDigest, type FishDigestRun, type FishExpression,
  type FishLibraryTotals, type FishOpenEvent, type FishOverview,
  type FishRetrievalStatus, type FishDocumentSearch, type FishMemoryRevision, type FishDocument,
  type FishDocumentChunk, type FishDocumentDeleted, type FishDocumentDetail, type FishDocumentHit,
  type FishFaultStatus, type FishReminderStatus,
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

/** `personas.save` reply. */
export function parsePersonaRecord(result: unknown): FishResult<FishPersonaRecord> {
  return parseReply('personas.save', result, (value) => {
    const record = requiredRecord({ value }, 'value', 'personas.save')
    return {
      id: requiredString(record, 'id', 'personas.save'),
      name: requiredString(record, 'name', 'personas.save'),
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
      }
    }))
}

/** A create/delete result counts as a record when the workbench returns one; otherwise its value is opaque. */
export function parseOpaque(result: unknown): FishResult<unknown> {
  return { ok: true, value: result }
}

function requiredNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new WorkbenchPayloadError(`${context}.${key}`)
  return value
}

function parseDocument(record: Record<string, unknown>): FishDocument {
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

/** `library.search` reply: the chunks that answer a question, best first. */
export function parseDocumentHits(result: unknown): FishResult<readonly FishDocumentHit[]> {
  return parseReply('library.search', result, value => requiredArray({ value }, 'value', 'library.search')
    .map((item) => {
      if (!isRecord(item)) throw new WorkbenchPayloadError('library.search[]')
      return {
        doc_id: requiredString(item, 'doc_id', 'library.search'),
        doc_name: requiredString(item, 'doc_name', 'library.search'),
        ord: requiredNumber(item, 'ord', 'library.search'),
        text: requiredString(item, 'text', 'library.search'),
        score: requiredNumber(item, 'score', 'library.search'),
      }
    }))
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

/** Results and the actual retrieval channel from this exact search. */
export function parseDocumentSearch(result: unknown): FishResult<FishDocumentSearch> {
  return parseReply('library.search', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('library.search')
    const hits = parseDocumentHits(value.results)
    if (!hits.ok) throw new WorkbenchPayloadError('library.search.results')
    return { results: hits.value, retrieval: retrievalStatus(value.retrieval) }
  })
}

/** `library.delete` reply: the removed version and how many chunks went with it. */
export function parseDocumentDeleted(result: unknown): FishResult<FishDocumentDeleted> {
  return parseReply('library.delete', result, (value) => {
    if (!isRecord(value)) throw new WorkbenchPayloadError('library.delete')
    return {
      ok: value.ok !== false,
      doc_id: requiredString(value, 'doc_id', 'library.delete'),
      chunks: requiredNumber(value, 'chunks', 'library.delete'),
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
    return {
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
          reply: group.reply === true,
          learn: group.learn === true,
        }
      }),
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
