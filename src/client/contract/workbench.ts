/**
 * Wire types of the Fish workbench: the browser calls
 * `POST /fish/workbench` with `{ action, params }` and the Host half forwards
 * it to the Python Fish ToolHost, which answers `{ ok: true, result }` or
 * `{ ok: false, error }`. These types are derived from the documented actions
 * rather than from a generated schema, so the client narrows every reply at
 * this wire edge before any page reads it.
 */

/** One workbench call: an action name and its parameters. */
export interface WorkbenchCall {
  readonly action: string
  readonly params: Record<string, unknown>
}

/** One source/error aggregate from the Fish governance ledger. */
export interface FishFault {
  readonly source: string
  readonly stage: string
  readonly code: string
  readonly reason: string
  readonly consecutive: number
  readonly total: number
  readonly first_failed: number
  readonly last_failed: number
  readonly recovered_at: number
  readonly uncertain: boolean
  readonly auto_retry: boolean
}

/** A real runtime observation, independent of whether a fault exists. */
export interface FishRuntimeObservation {
  readonly source: string
  readonly stage: string
  readonly outcome: string
  readonly reason: string
  readonly updated: number
}

/** Real repeated test outcomes; no observation means no frequency claim. */
export interface FishTestObservation {
  readonly case_name: string
  readonly runs: number
  readonly failures: number
  readonly consecutive: number
  readonly last_run: number
  readonly last_failed: number
  readonly last_passed: number
}

/** One existing consumer switch and its current effective state. */
export interface FishReminderStatus {
  readonly enabled: boolean
  readonly effective: boolean
  readonly source: string
  readonly reason: string
}

/** Read-only `faults.status`; configuration is checked without creating a persona. */
export interface FishFaultStatus {
  readonly items: readonly FishFault[]
  readonly latest: readonly FishRuntimeObservation[]
  readonly tests: readonly FishTestObservation[]
  readonly configuration: readonly { readonly source: string; readonly code: string; readonly reason: string }[]
  readonly reminders: {
    readonly memory_reminder: FishReminderStatus
    readonly private_proactive: FishReminderStatus
  }
}

/** The workbench reply, discriminated by `ok`. */
export type WorkbenchReply =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string }

/** The two Fish operating modes. */
export type FishMode = 'chat' | 'work'

/** Owner daily message budget; 0 with `unlimited` false means the budget is spent. */
export interface FishDailyLimits {
  readonly limit: number
  readonly used: number
  readonly remaining: number
  readonly unlimited: boolean
}

/** Persona text shown as the active identity. */
export interface FishPersona {
  readonly id: string
  readonly name: string
  readonly body: string
}

/** Filesystem facts reported by `status`. */
export interface FishPaths {
  readonly root: string
  readonly workspace: string
}

/** The shared state object `status`, `mode.set`, `settings.get`, and `settings.save` return. */
export interface FishModeState {
  readonly owner: string
  readonly mode: FishMode
  readonly workspace: string
  readonly permissions: string
  readonly persona: FishPersona
  readonly paused: boolean
  readonly daily_limits: FishDailyLimits
  readonly paths: FishPaths
}

/** `settings.get` / `settings.save` reply: mode state plus the owner permission list. */
export interface FishSettings extends FishModeState {
  readonly image_identification_enabled: boolean
  readonly max_tool_calls_per_turn: number
  readonly chat_reasoning_effort: 'off' | 'low' | 'high' | 'max'
  readonly reply_display: 'persona' | 'final' | 'thinking_excerpt'
  readonly qzone_enabled: boolean
  readonly keep_background_on_close: boolean
  readonly owner_permissions: readonly string[]
  readonly owner_capabilities: Readonly<Record<string, string>>
  readonly send_policy: {
    readonly owner_private: { readonly owner_reply: boolean; readonly scheduled_result: boolean }
    readonly group: { readonly owner_request: boolean }
  }
}

/** One imported persona candidate. */
export interface FishPersonaCandidate {
  readonly id: string
  readonly name: string
  readonly body: string
  readonly source?: string
}

/** Saved persona record returned by `personas.save`. */
export interface FishPersonaRecord {
  readonly id: string
  readonly name: string
  readonly body: string
}

/** One persona kept because a live window still points at it. */
export interface FishPersonaKept {
  readonly id: string
  readonly name: string
  /** Why it survived the clear: a window, a default, or a group deployment. */
  readonly reason: string
}

/** `personas.clear` reply: what stays, what went, and where the backup is. */
export interface FishPersonasCleared {
  readonly kept: { readonly id: string; readonly name: string }
  readonly deleted: number
  readonly backup: string
  readonly protected: readonly FishPersonaKept[]
}

/** `personas.apply` reply. */
export interface FishPersonaApplied {
  readonly ok: boolean
  readonly revision?: string | number
  readonly persona?: FishPersona
  readonly message?: string
}

/** `personas.current` reply: the persona the private chat answers as right now. */
export interface FishPersonaCurrent {
  readonly id: string
  readonly revision: string
  readonly name: string
  readonly body: string
}

/** One side of an A/B preview: its answer, or its own error and how long it took. */
export interface FishPersonaPreviewSide {
  readonly revision: string
  readonly name: string
  readonly text?: string
  readonly error?: string
  readonly elapsed_ms: number
}

/** `personas.preview` reply: the live persona first, the comparison version second. */
export interface FishPersonaPreview {
  readonly model_calls: number
  readonly results: readonly FishPersonaPreviewSide[]
}

/** One stored memory. */
export interface FishMemoryRevision {
  readonly revision: number
  readonly text: string
  readonly source_text: string
  readonly evidence: string
  readonly created: number
}

export interface FishMemory {
  readonly evidence_label: string
  readonly status_label: string
  readonly source_text: string
  readonly id: string
  readonly text: string
  readonly category: string
  readonly updated: string | number
  readonly source: string
  /** Memory kind (fact, preference, event…); empty when the backend omits it. */
  readonly kind: string
  /** Progress of an event-kind memory: 'open' means it can still be marked done. */
  readonly action: string
}

/** One library total: a label and how many records carry it. */
export interface FishCount {
  readonly label: string
  readonly count: number
}

/** What one day's summary counted, as `memory.digest.list` reports it. */
export interface FishDigestCounts {
  readonly memories: number
  readonly expressions: number
  readonly kinds: readonly FishCount[]
}

/** The three levels one summary can be written at. */
export type FishDigestScope = 'day' | 'week' | 'month'

/** One period's first-person summary; the period key rides in `day`. */
export interface FishDigest {
  /** Level of this summary; a reply without one is a day summary. */
  readonly scope: FishDigestScope
  /** The period key: YYYY-MM-DD, YYYY-Www, or YYYY-MM. */
  readonly day: string
  readonly text: string
  readonly kinds: readonly string[]
  readonly counts: FishDigestCounts
  /** When the record was written (epoch seconds). */
  readonly created: number
  /** Real model calls this record cost; 0 when the period had nothing to summarize. */
  readonly model_calls: number
  /** Epoch seconds the period starts and ends at; 0 when the backend omitted them. */
  readonly start: number
  readonly end: number
}

/** `memory.digest.revise` reply: the corrected paragraph and the one it replaced. */
export interface FishDigestRevised {
  readonly scope: FishDigestScope
  readonly period: string
  readonly note: string
  readonly before: string
  readonly after: string
  readonly digest: FishDigest
}

/** `memory.digest.run` reply: the summary just written and the refreshed timeline. */
export interface FishDigestRun {
  readonly digest: FishDigest
  readonly digests: readonly FishDigest[]
}

/** One still-open event; the same row `life.events` returns, so `life.event.done` closes it. */
export interface FishOpenEvent {
  readonly id: string
  readonly text: string
  readonly state: string
  readonly due: number
  readonly created: number
}

/** One expression-library entry, read only here: adopting or stopping it is the only write. */
export interface FishExpression {
  readonly id: string
  readonly kind_label: string
  readonly trigger: string
  readonly content: string
  readonly status: string
  readonly status_label: string
  /** True only for the Fish group library; other sources are managed elsewhere. */
  readonly editable: boolean
  /** Source evidence, already joined for display. */
  readonly source: string
  /** Extracted / retrieved / adopted, already joined for display. */
  readonly usage: string
}

/** Library-wide totals, not a per-day count. */
export interface FishLibraryTotals {
  readonly total: number
  readonly kinds: readonly FishCount[]
  readonly statuses: readonly FishCount[]
}

/** `memory.overview` reply: the timeline, the library totals, open events, and recent expressions. */
export interface FishOverview {
  readonly digests: readonly FishDigest[]
  readonly counts: { readonly memories: FishLibraryTotals; readonly expressions: FishLibraryTotals }
  readonly open_events: readonly FishOpenEvent[]
  readonly expressions: readonly FishExpression[]
}

/** One native task record from `schedules.list`. */
export interface FishTask {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly status: string
  readonly target?: string
  readonly [field: string]: unknown
}

/** Where a conversation's messages come from: this window, or a QQ group thread. */
export type FishConversationKind = 'private' | 'group'

/** One conversation summary: private history here, or a read-only group thread. */
export interface FishConversation {
  readonly id: string
  readonly title: string
  readonly kind?: FishConversationKind
  /** QQ group number of a group conversation; absent for private ones. */
  readonly group_id?: string
  readonly updated_at?: string
  /** True when the thread is owned elsewhere (QQ) and cannot be written here. */
  readonly read_only?: boolean
  readonly [field: string]: unknown
}

/** The five pre-screen dimensions, scored 0-10 each. */
export interface FishTraceDims {
  readonly content?: number
  readonly will?: number
  readonly social?: number
  readonly timing?: number
  readonly coherence?: number
}

/**
 * Why one message was or was not answered. Every field is optional and absent
 * when the workbench has no record, so a page never prints a guessed value.
 */
export interface FishTrace {
  readonly kind: FishConversationKind
  /** Audit event behind the trace (group): prescreen, silent, or a skip. */
  readonly event?: string
  /** Already-localized short phrase of the decision. */
  readonly reason?: string
  /** Pre-screen score and its threshold (group). */
  readonly score?: number
  readonly threshold?: number
  readonly dims?: FishTraceDims
  /** Tools one private reply used. */
  readonly tools?: readonly string[]
  /** Wall time from request start to stored reply (private). */
  readonly elapsed_ms?: number
  /** Persona the reply was written as (private). */
  readonly persona?: string
}

/** One chat message row. */
export interface FishImageReference {
  readonly resource_id: string
  readonly name: string
}

/** Actual backend transfer limits, independent of the model token window. */
export interface FishAttachmentConfig {
  readonly chunk_bytes: number
  readonly original_max_bytes: number | null
  readonly max_per_message: number
  readonly automatic_text_preview_bytes: number
  readonly workbench_control_bytes: number
  readonly tool_control_bytes: number
  readonly native_image_bytes: number
  readonly source: string
  readonly note: string
}

export interface FishAttachmentProcessing {
  readonly complete: boolean
  readonly indexed_chars: number
  readonly range_kind: string
  readonly parsed_start?: number
  readonly parsed_end?: number
  readonly parsed_pages?: number
  readonly total_pages?: number
  readonly parsed_xml_bytes?: number
  readonly total_xml_bytes?: number
}

export interface FishAttachment {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly type: string
  readonly resource_id: string
  readonly size: number
  readonly status: string
  readonly error: string
  readonly processing: FishAttachmentProcessing
}

export interface FishAttachmentDetail extends FishAttachment {
  readonly original_exists: boolean
  readonly reads: readonly {
    readonly session: string
    readonly mode: string
    readonly start: number
    readonly end: number
    readonly query: string
    readonly created: number
  }[]
}

export interface FishUploadProgress {
  readonly upload_id: string
  readonly received: number
  readonly size: number
}

export interface FishUploadStarted extends FishUploadProgress {
  readonly chunk_bytes: number
}

export interface FishImagePreview {
  readonly resource_id: string
  readonly width: number
  readonly height: number
  readonly frame: number
  readonly frames: number
  readonly mode: string
  readonly original_path: string
  readonly view_path: string
  readonly preview: string
}

export interface FishMessage {
  readonly id: string
  readonly direction: 'in' | 'out' | 'owner' | 'fish' | string
  readonly text: string
  readonly status: string
  readonly error?: string
  /** Segment types when the message carries no text (a picture, a voice note). */
  readonly kinds?: readonly string[]
  readonly images?: readonly FishImageReference[]
  readonly attachments?: readonly { readonly id: string; readonly name: string }[]
  /** Collapsible why-chain; empty when nothing was recorded for this message. */
  readonly trace?: FishTrace
  readonly [field: string]: unknown
}

/** Chat settings carried with every snapshot. */
export interface FishChatSettings {
  readonly [field: string]: unknown
}

/** A chat snapshot: the conversation list, the open context, and its messages. */
/** Latest actual turn accounting; capacity and server-reported usage stay distinct. */
export interface FishContextUsage {
  readonly model_window: number
  readonly input_ceiling: number
  readonly estimated_input_tokens: number
  readonly output_reserve: number
  readonly turn_requests: number
  readonly usage_reports: number
  readonly input_tokens: number | null
  readonly output_tokens: number | null
  readonly trimmed_layers: readonly number[]
}

export interface FishThought {
  readonly id: string
  readonly session: string
  readonly origin: string
  readonly reference: string
  readonly phase: string
  readonly reasoning: string
  readonly error: string
  readonly updated: number
  readonly events: readonly { readonly kind: string; readonly at: number; readonly value: unknown }[]
  readonly timing?: {
    readonly arrival: string
    readonly started: number | null
    readonly first_output: number | null
    readonly sending: number | null
    readonly receipt: number | null
    readonly outcome: string
    readonly error: string
  }
}

export interface FishChatSnapshot {
  readonly context_usage?: FishContextUsage
  readonly active_tasks: number
  readonly thought?: FishThought
  readonly conversation_id: string
  readonly conversations: readonly FishConversation[]
  readonly messages: readonly FishMessage[]
  readonly settings: FishChatSettings
  /** Kind of the open conversation; a group thread is read-only here. */
  readonly kind?: FishConversationKind
}

/** What one deletion actually removed. */
export interface FishChatDeleted {
  readonly conversations: number
  readonly messages: number
}

/** `chat.new` reply. */
export interface FishChatCreated {
  readonly id: string
}

/** `chat.send` reply: the queued delivery job. */
export interface FishChatSent {
  readonly job_id: string
  readonly status: string
}

/** Polled state of one delivery job. */
export interface FishChatJob {
  readonly status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  readonly error?: string
}

/** Where one stream row happened: the owner's private chat, or one QQ group. */
export type FishActivityPlace = 'private' | 'group'

/**
 * One row of the unified stream: private talk and group talk in one time order,
 * each row naming its own source. Only `text` is required — the workbench may
 * leave any other field out, and the page then renders what it was given.
 */
export interface FishActivityItem {
  readonly id: string
  /** Epoch milliseconds when the row carries a usable stamp; absent otherwise. */
  readonly at?: number
  /** Source of the row; 'private' when the reply names no source. */
  readonly place: FishActivityPlace
  /** Group name or number when the row came from a group. */
  readonly group?: string
  /** Who spoke, as the workbench named them. */
  readonly from: string
  /** 'owner' or 'fish' when the workbench classified the speaker; empty otherwise. */
  readonly direction: string
  readonly text: string
}

/** Durable lifecycle reported by the Fish delegation service. */
export type FishDelegationState = 'queued' | 'starting' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled' | 'unknown'

/** Verified attachment belonging to one computer task. */
export interface FishTaskArtifact {
  readonly id: string
  readonly name: string
}

/** Computer task execution and file availability are separate outcomes. */
export interface FishDelegatedTask {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly status: FishDelegationState
  readonly error: string
  readonly result: string
  readonly workspace: string
  readonly artifact_status: 'pending' | 'ready' | 'failed' | 'served'
  readonly artifacts: readonly FishTaskArtifact[]
  /** Unix seconds of the last lifecycle write; absent when the backend omits it. */
  readonly finished?: number
}

/** One whitelisted group as channels.status reports it: the policy that really decides. */
export interface FishChannelGroup {
  readonly id: string
  readonly topic: string
  readonly route: string
  readonly engine: string
  readonly listen: boolean
  readonly reply: boolean
  readonly learn: boolean
}

/** The channels.status reply: who she is, the private route, and every whitelisted group. */
export interface FishChannelStatus {
  readonly owner: string
  readonly bot: string
  readonly groups: readonly FishChannelGroup[]
  readonly private_route: string
  readonly note: string
}

/** Readiness is distinct from the channel actually used by the last query. */
export interface FishRetrievalStatus {
  readonly ready: boolean
  readonly mode: string
  readonly model: string
  readonly detail: string
  readonly pending: number
  readonly indexed?: number
  readonly last_mode?: string
  readonly last_detail?: string
}

export interface FishDocumentSearch {
  readonly results: readonly FishDocumentHit[]
  readonly retrieval: FishRetrievalStatus
}

/** One stored document in the owner's private shelf; one upload is one version. */
export interface FishDocument {
  readonly doc_id: string
  readonly name: string
  readonly kind: string
  readonly chars: number
  readonly chunks: number
  readonly created: number
  /** 1-based version number among the documents that share this name. */
  readonly version: number
  readonly original_path?: string
  readonly source?: string
  readonly url?: string
  readonly fetched_at?: string
}

/** One chunk as `library.detail` previews it; `ord` is the 1-based chunk number. */
export interface FishDocumentChunk {
  readonly ord: number
  readonly chars: number
  readonly text: string
}

/** `library.detail` reply: the document record plus its first three chunks. */
export interface FishDocumentDetail extends FishDocument {
  readonly preview: readonly FishDocumentChunk[]
  readonly next_ord?: number
}

/** One retrieved chunk: the search field and the private chat read the same rows. */
export interface FishDocumentHit {
  readonly doc_id: string
  readonly doc_name: string
  readonly ord: number
  readonly text: string
  readonly score: number
}

/** `library.delete` reply. */
export interface FishDocumentDeleted {
  readonly ok: boolean
  readonly doc_id: string
  readonly chunks: number
}

/** JSON object narrowing at the wire. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a required string field.
 * @param record - wire object.
 * @param key - field name.
 * @param context - value name used in the failure message.
 * @returns the string.
 * @throws {WorkbenchPayloadError} when the field is missing or not a string.
 */
export function requiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new WorkbenchPayloadError(`${context}.${key}`)
  return value
}

/**
 * Read an optional string field.
 * @param record - wire object.
 * @param key - field name.
 * @returns the string, or undefined when absent or not a string.
 */
export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read a required array field.
 * @param record - wire object.
 * @param key - field name.
 * @param context - value name used in the failure message.
 * @returns the array.
 * @throws {WorkbenchPayloadError} when the field is missing or not an array.
 */
export function requiredArray(record: Record<string, unknown>, key: string, context: string): readonly unknown[] {
  const value = record[key]
  if (!Array.isArray(value)) throw new WorkbenchPayloadError(`${context}.${key}`)
  return value
}

/**
 * Read a required field as an object.
 * @param record - wire object.
 * @param key - field name.
 * @param context - value name used in the failure message.
 * @returns the object.
 * @throws {WorkbenchPayloadError} when the field is missing or not an object.
 */
export function requiredRecord(record: Record<string, unknown>, key: string, context: string): Record<string, unknown> {
  const value = record[key]
  if (!isRecord(value)) throw new WorkbenchPayloadError(`${context}.${key}`)
  return value
}

/** One field of a workbench reply did not match the documented action. */
export class WorkbenchPayloadError extends Error {
  /**
   * @param field - the reply field that failed validation.
   */
  constructor(readonly field: string) {
    super(`workbench reply is missing ${field}`)
    this.name = 'WorkbenchPayloadError'
  }
}

/** Timestamp text of a stored record (`updated` is a number of seconds or an ISO string). */
export function timestampText(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}
