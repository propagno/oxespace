/**
 * The Thread event reducer: how one provider event changes a conversation.
 *
 * It mutates the snapshot it is given (the orchestrator owns the cached copy)
 * and returns *what else must happen* as data — ownership changes, operation
 * transitions, finalisation, persistence — instead of doing it. Everything with
 * an outside dependency (the request registry, the session supervisor, the
 * adapter, the clock) is either passed in through `ReduceContext` or emitted as
 * an effect, so the transition itself is deterministic and unit-testable.
 *
 * Extracted verbatim from ThreadOrchestrator.applyEvent; the golden suite
 * (tests/integration/thread-kernel-golden.test.ts) pins the behaviour.
 */
import type { ThreadEvent, ThreadRequest, ThreadSnapshot } from '../../../../../shared/types/thread'
import type { ThreadHistoryWriteOptions } from '../thread-history'
import { isTerminalToolState, nextToolState } from './tool-call-machine'

type TurnStatus = 'completed' | 'interrupted' | 'failed'
type OperationState = 'acknowledged' | 'running' | 'completed' | 'cancelled' | 'failed'

export type KernelEffect =
  | { kind: 'busy-add' }
  | { kind: 'busy-delete' }
  | { kind: 'finalizing-add' }
  | { kind: 'operation'; operationId: string; state: OperationState; error?: string }
  | { kind: 'release-attachments'; attachmentIds: string[] }
  | { kind: 'refresh-capabilities' }
  /** Runs after the save, on a microtask, like the original queueMicrotask calls. */
  | { kind: 'finalize'; status: TurnStatus; turnId?: string; captureDiff: boolean }
  | { kind: 'drain' }
  | { kind: 'refresh-context' }
  | { kind: 'memory-event' }

export interface InvalidatedRequest {
  id: string
  state: ThreadRequest['state']
  resolvedAt?: number
}

export interface ReduceContext {
  now(): number
  /** Open requests for this generation, read after any settle the caller already applied. */
  pendingRequestCount(): number
  /** Requests the caller invalidated because the turn ended (only for `completed`). */
  invalidated: InvalidatedRequest[]
  /** A pre-turn working-tree baseline exists (only for `completed`). */
  needsVerifiedDiff: boolean
  /** A file checkpoint is open for the ending turn (only for `completed`). */
  needsCheckpoint: boolean
}

export interface ReduceResult {
  /** Persistence for this transition; null when nothing is saved. */
  save: ThreadHistoryWriteOptions | null
  /** Effects to run before persisting (they may mutate the snapshot or history). */
  before: KernelEffect[]
  /** Effects to run after persisting. */
  after: KernelEffect[]
}

/** Handles every event except the metadata/connection ones the orchestrator keeps. */
export function reduceThreadEvent(snapshot: ThreadSnapshot, event: ThreadEvent, ctx: ReduceContext): ReduceResult {
  const before: KernelEffect[] = []
  const after: KernelEffect[] = []

  if (event.type === 'continuation-started') {
    if (snapshot.turns?.at(-1)?.status !== 'running') {
      snapshot.turns ??= []
      snapshot.turns.push({ id: event.id, sequence: snapshot.turns.length + 1, startedAt: event.at, status: 'running', configuration: { model: snapshot.thread.model, access: snapshot.thread.access, reasoningEffort: snapshot.thread.reasoningEffort } })
      snapshot.thread.status = 'running'
      before.push({ kind: 'busy-add' })
    }
    snapshot.events.push({ type: 'activity', id: event.id, phase: 'responding', at: event.at, summary: 'The provider is continuing after background activity.' })
    return { save: { eventsFrom: snapshot.events.length - 1 }, before, after }
  }

  const activeTurn = snapshot.turns?.at(-1)
  const operationId = activeTurn?.operationId

  if (event.type === 'turn-accepted') {
    if (activeTurn?.status !== 'running') return { save: null, before, after }
    activeTurn.nativeId = event.nativeTurnId
    delete snapshot.thread.providerObservation
    if (operationId) before.push({ kind: 'operation', operationId, state: 'acknowledged' })
    after.push({ kind: 'memory-event' })
    return { save: { eventsFrom: snapshot.events.length }, before, after }
  }

  let eventsFrom = snapshot.events.length
  if (event.type === 'request-resolved' && event.state !== 'pending') {
    const requestIndex = snapshot.events.findIndex(value => value.type === 'request' && value.id === event.id)
    const request = requestIndex >= 0 ? snapshot.events[requestIndex] : undefined
    if (request?.type === 'request') {
      request.request.state = event.state
      request.request.resolution = event.resolution ?? 'unknown'
      request.request.resolvedAt = event.resolvedAt ?? ctx.now()
    }
    if (requestIndex >= 0) eventsFrom = Math.min(eventsFrom, requestIndex)
  }
  if (activeTurn?.status === 'running' && (event.type === 'tool' || event.type === 'subagent' || event.type === 'turn-diff' || event.type === 'plan') && event.turnId) activeTurn.nativeId = event.turnId

  if (event.type === 'failure-details') {
    const completedIndex = snapshot.events.findIndex(value => value.type === 'completed' && value.failure?.id === event.id)
    const completed = completedIndex >= 0 ? snapshot.events[completedIndex] : undefined
    if (completed?.type !== 'completed' || !completed.failure) return { save: null, before, after }
    completed.failure = { ...completed.failure, ...(event.usage ? { usage: event.usage } : {}), usageUnavailable: event.usageUnavailable }
    eventsFrom = Math.min(eventsFrom, completedIndex)
  } else if (event.type === 'configuration') {
    if (event.model !== undefined) snapshot.thread.model = event.model
    if (event.reasoningEffort !== undefined) snapshot.thread.reasoningEffort = event.reasoningEffort
    if (event.access !== undefined) snapshot.thread.access = event.access
    if (event.networkAccess !== undefined) snapshot.thread.networkAccess = event.networkAccess
    if (event.approvalPolicy !== undefined) snapshot.thread.approvalPolicy = event.approvalPolicy
    if (event.hooksEnabled !== undefined) snapshot.thread.hooksEnabled = event.hooksEnabled
    if (activeTurn?.status === 'running') Object.assign(activeTurn.configuration, { ...(event.model !== undefined ? { model: event.model } : {}), ...(event.reasoningEffort !== undefined ? { reasoningEffort: event.reasoningEffort } : {}), ...(event.access !== undefined ? { access: event.access } : {}), ...(event.networkAccess !== undefined ? { networkAccess: event.networkAccess } : {}), ...(event.approvalPolicy !== undefined ? { approvalPolicy: event.approvalPolicy } : {}), ...(event.hooksEnabled !== undefined ? { hooksEnabled: event.hooksEnabled } : {}) })
  } else if (event.type === 'session') {
    snapshot.thread.nativeSessionId = event.nativeSessionId
  } else if (event.type === 'completed') {
    const turn = snapshot.turns?.at(-1)
    const now = ctx.now()
    if (turn?.status === 'running') { turn.status = event.status; turn.completedAt = now }
    // A provider may finish a turn without reporting a tool result. The turn is
    // over, but success of that command is unverified; never leave it spinning.
    const turnStart = snapshot.events.findIndex(value => value.type === 'message' && value.role === 'user' && value.id === turn?.id)
    snapshot.events.forEach((value, index) => {
      if (turnStart < 0 || index < turnStart || value.type !== 'tool' || value.state !== 'running') return
      value.state = 'unknown'
      value.completedAt = now
      value.files = value.files?.map(file => ({ ...file, state: file.state === 'running' ? 'unknown' : file.state }))
      eventsFrom = Math.min(eventsFrom, index)
    })
    snapshot.events.forEach((value, index) => {
      if (value.type === 'turn-diff' && value.turnId === turn?.nativeId) {
        value.files = value.files.map(file => ({ ...file, state: event.status === 'completed' ? 'completed' : 'failed' }))
        eventsFrom = Math.min(eventsFrom, index)
      }
    })
    snapshot.thread.status = event.status === 'completed' ? 'idle' : event.status
    snapshot.thread.lastTurnStatus = event.status
    // A stopped or failed turn must not silently start the next queued message:
    // the user decides whether the follow-up still makes sense.
    if (event.status !== 'completed' && snapshot.thread.queue?.some(item => item.state === 'queued')) {
      snapshot.thread.queuePause = { reason: event.status, since: now, ...(turn?.id ? { turnId: turn.id } : {}) }
    }
    before.push({ kind: 'busy-delete' })
    if (ctx.needsVerifiedDiff || ctx.needsCheckpoint) before.push({ kind: 'finalizing-add' })
    for (const request of ctx.invalidated) {
      const resolution = event.status === 'completed' ? 'turn-completed' : event.status === 'interrupted' ? 'interrupted' : 'turn-failed'
      const requestIndex = snapshot.events.findIndex(value => value.type === 'request' && value.id === request.id)
      const persisted = requestIndex >= 0 ? snapshot.events[requestIndex] : undefined
      if (persisted?.type === 'request') Object.assign(persisted.request, { state: request.state, resolution, resolvedAt: request.resolvedAt })
      if (requestIndex >= 0) eventsFrom = Math.min(eventsFrom, requestIndex)
      snapshot.events.push({ type: 'request-resolved', id: request.id, state: request.state, resolution, resolvedAt: request.resolvedAt })
    }
    const unresolved = snapshot.events.filter(value => value.type === 'approval' && !snapshot.events.some(resolved => resolved.type === 'approval-resolved' && resolved.id === value.id))
    for (const approval of unresolved) if (approval.type === 'approval') snapshot.events.push({ type: 'approval-resolved', id: approval.id })
    snapshot.events.push(event)
    if (operationId) before.push({ kind: 'operation', operationId, state: event.status === 'completed' ? 'completed' : event.status === 'interrupted' ? 'cancelled' : 'failed', ...(event.error !== undefined ? { error: event.error } : {}) })
    if (event.status === 'completed' && turn?.attachmentIds?.length) before.push({ kind: 'release-attachments', attachmentIds: turn.attachmentIds })
    if (ctx.needsVerifiedDiff || ctx.needsCheckpoint) after.push({ kind: 'finalize', status: event.status, turnId: turn?.id, captureDiff: ctx.needsVerifiedDiff })
    else after.push({ kind: 'drain' })
    after.push({ kind: 'refresh-context' })
  } else if (event.type === 'delta') {
    const existingIndex = snapshot.events.findIndex(value => value.type === 'message' && value.role === 'assistant' && value.id === event.id)
    const existing = existingIndex >= 0 ? snapshot.events[existingIndex] : undefined
    if (existing?.type === 'message') existing.text = (existing.text + event.text).slice(0, 256 * 1024)
    else snapshot.events.push({ type: 'message', id: event.id, role: 'assistant', text: event.text.slice(0, 256 * 1024) })
    eventsFrom = existingIndex >= 0 ? Math.min(eventsFrom, existingIndex) : eventsFrom
  } else {
    if (event.type === 'approval' || event.type === 'request') snapshot.thread.status = 'approval'
    const index = snapshot.events.findIndex(value => 'id' in value && value.id === (event as { id?: string }).id && value.type === event.type)
    if (index >= 0) {
      const previous = snapshot.events[index]
      snapshot.events[index] = event.type === 'tool' && previous.type === 'tool'
        ? { ...previous, ...event, name: event.name === 'Tool result' ? previous.name : event.name, detail: event.detail || previous.detail, state: nextToolState(previous.state, event.state), ...(isTerminalToolState(previous.state) && previous.completedAt !== undefined ? { completedAt: previous.completedAt } : {}) }
        : event
      eventsFrom = Math.min(eventsFrom, index)
    } else snapshot.events.push(event)
    if (event.type === 'approval-resolved' || event.type === 'request-resolved') snapshot.thread.status = ctx.pendingRequestCount() ? 'approval' : 'running'
  }

  if (event.type === 'session' || event.type === 'configuration') before.push({ kind: 'refresh-capabilities' })
  if (operationId && activeTurn?.status === 'running' && event.type !== 'completed' && event.type !== 'session' && event.type !== 'configuration') {
    before.push({ kind: 'operation', operationId, state: 'running' })
  }
  if (event.type === 'session' || event.type === 'completed') after.push({ kind: 'memory-event' })
  return { save: { eventsFrom, ...(operationId ? { operationId } : {}) }, before, after }
}
