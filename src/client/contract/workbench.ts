/**
 * Wire types of the Fish workbench: the browser calls
 * `POST /fish/workbench` with `{ action, params }` and the Host half forwards
 * it to the Python Fish ToolHost, which answers `{ ok: true, result }` or
 * `{ ok: false, error }`. These types are derived from the documented actions
 * rather than from a generated schema, so the client narrows every reply at
 * this wire edge before any page reads it.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one Fish instance; unrelated to a desktop conversation id. */
export type FishInstanceId = Branded<'FishInstanceId'>

/** One running or stopped Fish instance reported by the host directory. */
export interface FishInstance {
  readonly id: FishInstanceId
  readonly name: string
  readonly initial: boolean
  readonly enabled: boolean
  readonly running: boolean
  readonly persona_configured: boolean
  readonly persona_id: string
  readonly persona_name: string
  readonly status_reason: string
}

/** One explicitly selected saved persona version available during instance creation. */
export interface FishInstancePreset {
  readonly instance_id: FishInstanceId
  readonly revision: string
  readonly name: string
  readonly body: string
}

/** `instances.list` reply; the initial identity comes from the host, not the browser. */
export interface FishInstances {
  readonly initial_instance_id: FishInstanceId
  readonly instances: readonly FishInstance[]
}

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
  /** Backend display label; empty for statuses it does not translate (merged, disabled). */
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
  /** Raw lifecycle (active, candidate, archived, disabled, merged); never guessed from labels. */
  readonly status: string
  /**
   * Provenance of the row, not an isolation identity: `owner` is the owner's
   * private chat/client, `chat:group:<id>` is that group's thread.
   */
  readonly scope: string
  /** Stored confidence; 0 when the backend omitted it. */
  readonly confidence: number
  /** Who the fact is about (QQ account or named fiction person); empty when unset. */
  readonly subject: string
}

/** `memory.merge` reply: which record stayed, which was marked, and its real new status. */
export interface FishMemoryMerged {
  readonly keep: string
  readonly drop: string
  /** Raw status the dropped record now carries (merged). */
  readonly drop_status: string
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

/** One step the curation program actually recorded, in execution order. */
export interface FishCurationStep {
  readonly name: string
  /** accepted / running / done / failed. */
  readonly state: string
  /** Real failure text of this step; empty when it succeeded. */
  readonly error: string
  /** Persisted batch counts; null on steps and historical records without them. */
  readonly completed: number | null
  readonly remaining: number | null
  readonly batch_count: number | null
}

/** One failed source inside the learning step. */
export interface FishCurationFailure {
  readonly stage: string
  readonly reason: string
}

/** The digest step's own outcome; absent when the run skipped the digest step. */
export interface FishCurationDigest {
  readonly state: string
  readonly day: string
  readonly skipped: boolean
  readonly model_calls: number
  readonly chars: number
  readonly error: string
}

/**
 * What the run really completed: counts and failures are separate, and a failed
 * step never turns into a saved count. Only the fields the backend wrote are set.
 */
export interface FishCurationResult {
  /** Actual completed units, unprocessed units and batches; absent history stays null. */
  readonly completed: number | null
  readonly remaining: number | null
  readonly batch_count: number | null
  readonly new_messages: number
  readonly saved_count: number
  readonly failure_count: number
  readonly model_calls: number
  readonly skipped_existing: number
  readonly truncated: boolean
  readonly note: string
  readonly failures: readonly FishCurationFailure[]
  readonly digest?: FishCurationDigest
}

/**
 * One curation run record. The daily window, the Fish tool and this page's
 * button all submit to the same program and read the same record back.
 */
export interface FishCurationRun {
  /** Stable run reference (`curate:…`); `memory.curate.status` takes it back. */
  readonly id: string
  /** queued / running / done / partial / failed. */
  readonly status: string
  readonly stage: string
  /** Backend label of `status` (已受理 / 整理中 / 已完成 / 部分完成 / 失败). */
  readonly status_label: string
  /** Who asked: daily, tool, or client. */
  readonly requested_by: string
  readonly day: string
  /** Epoch seconds the processed range starts and ends at. */
  readonly range_start: number
  readonly range_end: number
  readonly created: number
  readonly started: number
  readonly finished: number
  /** Real failure text of a failed/partial run; empty otherwise. */
  readonly error: string
  /** Why the record looks like it does (queued wording, reuse note); empty when absent. */
  readonly note: string
  /** True when the existing fixed run is running or resumed from its unfinished sources. */
  readonly reused: boolean
  readonly progress: readonly FishCurationStep[]
  readonly result: FishCurationResult
}

/** `memory.curate.status` reply: one run (when asked by id) or the recent list. */
export interface FishCurationStatus {
  readonly run: FishCurationRun | null
  readonly latest: FishCurationRun | null
  readonly runs: readonly FishCurationRun[]
  readonly note: string
}

/**
 * One retrieval channel's honesty text from this exact query: whether semantic
 * scores really took part, and why not when they did not.
 */
export interface FishKnowledgeChannelState {
  readonly mode: string
  readonly used: boolean
  readonly detail: string
  readonly status: string
  readonly label: string
  readonly reason: string
  readonly indexed: number
  readonly pending: number
  readonly fts5: boolean
  readonly ready: boolean
  readonly unindexed: number
}

/** The semantic channel as one query actually used it. */
export interface FishKnowledgeSemantic {
  readonly used: boolean
  readonly status: string
  readonly mode: string
  readonly label: string
  readonly reason: string
  /** True only when this query itself went through the vector channel. */
  readonly query_used_semantic: boolean
  readonly channels: Readonly<Record<string, FishKnowledgeChannelState>>
}

/** `knowledge.search` retrieval facts: mode, label, per-channel truth and counts. */
export interface FishKnowledgeRetrieval {
  readonly mode: string
  readonly label: string
  /** FTS5 is always the lexical base and is always present. */
  readonly fts5: boolean
  readonly note: string
  readonly limit: number
  readonly truncated: boolean
  readonly matched_total: number
  readonly terms: readonly string[]
  readonly channels: Readonly<Record<string, number>>
  readonly semantic: FishKnowledgeSemantic
}

/** Recorded source place, author and revision; these fields never change the request's instance. */
export interface FishKnowledgeOrigin {
  readonly scope: string
  readonly source: string
  readonly sender: string
  readonly quote: string
  readonly references: readonly string[]
  readonly version: number
  readonly parent_version: string
}

/** One graded hit: an index reference, its channel and its levels. */
export interface FishKnowledgeHit {
  /** Stable reference the owning store understands (`message:…`, `doc:…`, `memory:…`). */
  readonly reference: string
  readonly kind: string
  readonly level: string
  readonly channel: string
  readonly snippet: string
  readonly time: string
  readonly score: number | null
  readonly fused: number
  /** Which channel actually matched it (fts5 or fts5+semantic). */
  readonly matched_by: string
  /** Genuine semantic score when the vector channel returned one; null otherwise. */
  readonly semantic: number | null
  /** Whether an overview level exists for this hit at all. */
  readonly overview_available: boolean
  /** Why no overview exists; empty when one does. */
  readonly overview_reason: string
  readonly original_available: boolean
  readonly origin: FishKnowledgeOrigin
}

/** `knowledge.search` reply. */
export interface FishKnowledgeSearch {
  readonly query: string
  readonly hits: readonly FishKnowledgeHit[]
  readonly retrieval: FishKnowledgeRetrieval
}

/** One original message as `knowledge.open` reads it back from its owning store. */
export interface FishKnowledgeMessage {
  readonly id: string
  readonly time: string
  readonly place: string
  readonly sender: string
  readonly direction: string
  readonly text: string
  readonly status: string
  /** The message this one replied to, when the store recorded it. */
  readonly quote: string
  readonly conversation: string
  /** Attachment segments by type and name; originals stay in their own store. */
  readonly attachments: readonly string[]
}

/** The compressed-range catalogue entry one message belongs to. */
export interface FishKnowledgeCatalog {
  readonly gist: string
  readonly topics: string
  readonly start_time: string
  readonly end_time: string
  readonly from: string
  readonly to: string
}

/**
 * One expanded reference at a requested level. The page renders the variant the
 * owning store answered; unavailable originals stay unavailable instead of
 * being replaced by a guess.
 */
export type FishKnowledgeOpened =
  | {
    readonly kind: 'message'
    readonly reference: string
    readonly level: string
    readonly note: string
    readonly message: FishKnowledgeMessage | null
    readonly catalog: FishKnowledgeCatalog | null
    readonly context: readonly FishKnowledgeMessage[]
    readonly attachments: readonly string[]
  }
  | {
    readonly kind: 'catalog'
    readonly reference: string
    readonly level: string
    readonly note: string
    readonly gist: string
    readonly topics: string
    readonly start_time: string
    readonly end_time: string
    readonly messages: readonly FishKnowledgeMessage[]
    readonly page: number
    readonly next_page: number | null
  }
  | {
    readonly kind: 'document'
    readonly reference: string
    readonly level: string
    readonly note: string
    readonly doc_id: string
    readonly doc_name: string
    readonly version: number
    readonly chunks: number
    readonly chars: number
    readonly url: string
    readonly original_path: string
    readonly original_exists: boolean
    readonly origin: FishKnowledgeOrigin
    /** The chunk this reference points at, when the store returned one. */
    readonly chunk: FishDocumentChunk | null
    readonly preview: readonly FishDocumentChunk[]
  }
  | {
    readonly kind: 'memory'
    readonly reference: string
    readonly level: string
    readonly note: string
    readonly memory: FishMemory | null
    readonly revisions: readonly FishMemoryRevision[]
  }
  | {
    readonly kind: 'digest'
    readonly reference: string
    readonly level: string
    readonly note: string
    readonly digest: FishDigest | null
  }
  | { readonly kind: 'other'; readonly reference: string; readonly level: string; readonly note: string }

/** One instance of a plan, as `schedules.list` attaches it under `occurrences`. */
export interface FishPlanOccurrence {
  readonly slot: string
  readonly display: string
  readonly state: string
  readonly note: string
  readonly receipt_id: string
  /** Real main-execution turn id; empty when this instance has no linked turn. */
  readonly execution: string
  readonly attempts: number
  readonly created: number
  readonly updated: number
}

/** One native task record from `schedules.list`. */
export interface FishTask {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly status: string
  readonly target?: string
  /** Newest first; absent when the reply carries none. */
  readonly occurrences?: readonly FishPlanOccurrence[]
  readonly [field: string]: unknown
}

/** What triggered one main-execution turn (`turn.view.trigger`). */
export interface FishTurnTrigger {
  readonly kind: string
  readonly reason: string
  readonly place: string
  readonly source: string
  readonly reference: string
}

/** The real delivery facts of one turn; plan and chat turns fill different fields. */
export interface FishTurnDelivery {
  /** Transport state as the turn recorded it (`SUCCEEDED`, `sent`, `uncertain`…). */
  readonly state: string
  readonly sent: boolean
  readonly target: string
  /** Bubble count when the delivery module returned one; null otherwise. */
  readonly bubbles: number | null
  readonly receiptId: string
  readonly receiptMessageId: string
  readonly error: string
}

/** Real timestamps of one turn's prepared delivery; absent values stay null. */
export interface FishTurnTimes {
  readonly arrival: string
  readonly started: number | null
  readonly first_output: number | null
  readonly sending: number | null
  readonly receipt: number | null
  readonly outcome: string
  readonly error: string
}

/** The plan instance a turn served, when it was triggered by one. */
export interface FishTurnPlanRef {
  readonly schedule_id: string
  readonly slot: string
}

/** One turn's real record from `turn.view`. */
export interface FishTurnView {
  readonly instance_id: string
  readonly created: number | null
  readonly started: number | null
  readonly finished: number | null
  readonly merged_into: string
  readonly materials: readonly FishTurnMaterial[]
  readonly actions: readonly FishTurnAction[]
  readonly outputs: readonly {
    readonly text: string
    readonly kind: string
    readonly state: string
    readonly target: string
    readonly call_id: string
  }[]
  readonly trace: FishTurnTrace | null
  readonly batches: readonly Readonly<Record<string, unknown>>[]
  readonly usage: FishTurnUsage | null
  readonly output_speed: { readonly tokens_per_second: number | null; readonly reason: string } | null
  readonly execution: string
  readonly status: string
  readonly raw_status: string
  readonly error: string
  readonly trigger: FishTurnTrigger
  readonly delivery: FishTurnDelivery | null
  readonly delivery_times: FishTurnTimes | null
  readonly plan: FishTurnPlanRef | null
  readonly silent: boolean
  readonly merged: boolean
}

/** Original input material, retaining a missing original separately from its ledger preview. */
export interface FishTurnMaterial {
  readonly seq: number
  readonly reference: string
  readonly source: string
  readonly conversation: string
  readonly message: string
  readonly place: string
  readonly received: number | null
  readonly text: string
  readonly preview: string
  readonly original_state: string
  readonly original: Readonly<Record<string, unknown>> | null
  readonly payload: Readonly<Record<string, unknown>>
  readonly considered: boolean
  readonly cancelled: boolean
}

/** Tool facts shown without fetching the full trace for every row. */
export interface FishTurnAction {
  readonly call_id: string
  readonly name: string
  readonly state: string
  readonly started: number | null
  readonly finished: number | null
}

/** Persisted provider trace; directory summaries omit reasoning and events. */
export interface FishTurnTrace {
  readonly state: string
  readonly id: string
  readonly reference: string
  readonly phase: string
  readonly has_reasoning: boolean
  readonly reasoning?: string
  readonly error: string
  readonly events?: readonly { readonly kind: string; readonly at: number | null; readonly value: unknown }[]
}

/** Accounted main-execution requests; null token fields mean unreported, not zero. */
export interface FishTurnUsage {
  readonly scope: string
  readonly state: string
  readonly request_count: number
  readonly closed_steps: number
  readonly turns: number
  readonly usage_reports: number
  readonly input_tokens: number | null
  readonly output_tokens: number | null
  readonly cache_read_tokens: number | null
  readonly cache_write_tokens: number | null
  readonly uncached_input_tokens: number | null
  readonly cache_hit_ratio: number | null
  readonly coverage: { readonly recorded_requests: number; readonly linked_requests: number; readonly unlinked_requests: number }
  readonly field_reports: Readonly<Record<string, number>>
}

/** Stable execution directory, newest first, scoped to one fixed instance. */
export interface FishTurns {
  readonly instance_id: string
  readonly runs: readonly FishTurnView[]
  readonly next_cursor: string | null
  readonly stats: FishTurnUsage
}

/** One entry of Fish's own workspace (`workspace.list`). */
export interface FishWorkspaceEntry {
  readonly name: string
  readonly directory: boolean
  /** File size; null for a directory. */
  readonly bytes: number | null
}

/** `workspace.list` reply: the listed relative directory and its entries. */
export interface FishWorkspaceListing {
  readonly path: string
  readonly entries: readonly FishWorkspaceEntry[]
}

/** `workspace.read` reply: the relative path, returned line count, and text lines. */
export interface FishWorkspaceFile {
  readonly path: string
  readonly lines: number
  readonly text: readonly string[]
}

/** `workspace.write` reply: the real file_write tool result. */
export interface FishWorkspaceWrite {
  readonly ok: boolean
  readonly path: string
  readonly bytes: number
  readonly mtime_ns: number
  readonly error: string
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

/** One instance's group participation and effective sending capability. */
export interface FishChannelGroup {
  readonly id: string
  readonly topic: string
  readonly route: string
  readonly engine: string
  readonly listen: boolean
  readonly read: boolean
  readonly reply: boolean
  readonly learn: boolean
}

/** The channels.status reply: who she is, the private route, and every whitelisted group. */
/** One connected service's real readiness, in the backend's own words. */
export interface FishChannelService {
  readonly name: string
  readonly ready: boolean
  readonly detail: string
}

export interface FishChannelStatus {
  readonly instance_id: FishInstanceId
  readonly version: 1
  readonly connection_id: '' | 'qq'
  readonly receive: boolean
  readonly private_receive: boolean
  readonly connections: readonly {
    readonly id: 'qq'
    readonly name: string
    readonly bot: string
    readonly connected: boolean
  }[]
  readonly owner: string
  readonly bot: string
  readonly groups: readonly FishChannelGroup[]
  readonly services: readonly FishChannelService[]
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
  /** Category path the owner moved it into; empty when it sits at the shelf root. */
  readonly folder: string
  /** Original bytes when the backend recorded them; absent otherwise. */
  readonly bytes?: number
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

/** `library.delete` reply: the tombstoned version and how many chunks left the index. */
export interface FishDocumentDeleted {
  readonly ok: boolean
  readonly doc_id: string
  readonly chunks: number
  /** The original file is deliberately kept; only storage and retrieval left. */
  readonly original_retained: boolean
}

/** `library.organize` (move) reply: where the original and its category really went. */
export interface FishDocumentOrganized {
  readonly ok: boolean
  readonly doc_id: string
  readonly path: string
  /** Category path joined by '/'; empty for the shelf root. */
  readonly folder: string
}

/** Plugin kinds the Fish registry actually accepts; the form offers exactly these. */
export type FishPluginKind = 'mcp_stdio' | 'mcp_http' | 'mcp_sse' | 'cli' | 'http' | 'dsh'

/** One tool a plugin reported during a real discovery; display-only here. */
export interface FishPluginTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** One registry lifecycle event; the same record the maintenance view reads. */
export interface FishPluginEvent {
  readonly ts: number
  readonly plugin: string
  readonly role: string
  readonly action: string
  readonly ok: boolean
  readonly detail: string
}

/** One registered plugin with the result of its last real discovery test. */
export interface FishPlugin {
  readonly id: string
  readonly name: string
  readonly kind: FishPluginKind
  readonly roles: readonly string[]
  readonly enabled: boolean
  readonly owner_only: boolean
  readonly timeout: number
  readonly command: string
  readonly args: readonly string[]
  readonly url: string
  /** null means every discovered tool is allowed; an empty array allows none. */
  readonly allowed_tools: readonly string[] | null
  /** Epoch seconds of the last test; null when the plugin was never tested. */
  readonly last_test: number | null
  readonly last_error: string
  /** null = never tested, true = last discovery succeeded, false = it failed. */
  readonly test_ok: boolean | null
  readonly server_name: string
  readonly server_version: string
  readonly package_name: string
  readonly package_version: string
  readonly tools: readonly FishPluginTool[]
  readonly installed_roles: readonly string[]
}

/** `plugins.list` reply: the registry, its recent events, and the calls still running. */
export interface FishPluginSnapshot {
  readonly plugins: readonly FishPlugin[]
  readonly events: readonly FishPluginEvent[]
  readonly active: readonly string[]
}

/** `plugins.test` reply: the tools the plugin really reported. */
export interface FishPluginDiscovery {
  readonly tools: readonly FishPluginTool[]
  /** True when a DSH native package was installed into its roles for this discovery. */
  readonly native: boolean
}

/** One skill as `skills.list` reports it; the body is a separate real read. */
export interface FishSkill {
  readonly name: string
  readonly description: string
  readonly enabled: boolean
  /** Epoch seconds, or a string when the registry stored one; null when neither exists. */
  readonly updated: number | string | null
  readonly path: string
  readonly chars: number
}

/** `skills.list` reply: the real folder contents plus Fish's own semantic note. */
export interface FishSkillSnapshot {
  readonly skills: readonly FishSkill[]
  readonly note: string
}

/** One skill with its body, as save/import/enable/read return it. */
export interface FishSkillEntry extends FishSkill {
  readonly body: string
  readonly note: string
}

/** `skills.delete` reply. */
export interface FishSkillDeleted {
  readonly name: string
}

/** One model connection exactly as Fish's runtime configuration stores it. */
export interface FishModelConnection {
  readonly id: string
  readonly role: string
  readonly name: string
  readonly base: string
  readonly model: string
  readonly key_ref: string
  readonly has_key: boolean
  /** How the credential was found; the value itself never reaches the page. */
  readonly key_source: string
  readonly env: string
}

/** One use and the connection it really reads. Unsupported uses carry a reason. */
export interface FishModelUse {
  readonly use: string
  readonly role: string
  readonly label: string
  readonly supported: boolean
  readonly ready: boolean
  readonly connection: string
  readonly model: string
  readonly reason: string
}

/** What the chat gateway really reads right now, or why it could not be read. */
export interface FishModelGateway {
  readonly base: string
  readonly model: string
  readonly has_key: boolean
  readonly error: string
}

/** `models.connections` reply; `models.current` adds the gateway's own read. */
export interface FishModelDescription {
  readonly connections: readonly FishModelConnection[]
  readonly uses: readonly FishModelUse[]
  readonly source: string
  readonly note: string
  readonly gateway?: FishModelGateway
}

/** `models.save` reply: the stored connection and when it took effect. */
export interface FishModelSaved {
  readonly connection: FishModelConnection
  readonly effective_at: string
  readonly applied_uses: readonly string[]
  readonly note: string
}

/** `models.test` / `models.discover` reply: one real probe, success or failure. */
export interface FishModelProbe {
  readonly ok: boolean
  readonly status: number
  readonly models: readonly string[]
  readonly model: string
  readonly discovery: boolean
  readonly reason: string
  readonly note: string
}

/** `models.remove` reply: what was removed and which uses are now unconfigured. */
export interface FishModelRemoved {
  readonly removed: boolean
  readonly connection: FishModelConnection | null
  readonly affected_uses: readonly string[]
  readonly ready: boolean
  readonly note: string
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

/** One instance's persisted tool choices and effective display rows. */
export interface FishToolSettings {
  readonly instance_id: string
  readonly settings: {
    readonly tools: Readonly<Record<string, boolean>>
    readonly plugins: Readonly<Record<string, boolean>>
    readonly send: { readonly private: boolean; readonly group: boolean; readonly groups: Readonly<Record<string, boolean>> }
  }
  readonly tools: readonly { readonly name: string; readonly description: string; readonly enabled: boolean; readonly reason: string }[]
  readonly groups: readonly string[]
}
