/**
 * B10 · The one place a request for the person is raised, answered and closed (contract: shared/types/approvals.ts).
 *
 * Every door (agent actions, OxeQuery, preview automation, the crash restart offer) calls `ask` with a draft. The
 * center bounds the text, applies the critical pacing, keeps the queue, sends the request to the app window and waits
 * for exactly one answer. The system dialog is used only through `deps.native`, and only when no window exists, when the
 * window reports `unavailable` for that request, or when an `ackRequired` request is not acknowledged in time.
 *
 * No Electron import here: the window, the native dialog and the clock are injected, so the rules run in plain tests.
 */
import { createHash, randomUUID } from 'node:crypto'
import { agentTextAdmission, allowTooSoon, approvalPacing, approvalRequestProblems, approvalSurface, boundAgentText } from '../../../../shared/approval-rules'
import { hasHiddenCharacters } from '../../../../shared/hidden-characters'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import {
  APPROVAL_ACK_TIMEOUT_MS, APPROVAL_AGENT_TEXT_MAX, APPROVAL_HISTORY_MAX, APPROVAL_QUEUE_MAX, APPROVAL_SCHEMA_VERSION, APPROVAL_TIMEOUT_MS,
  APPROVAL_RISKS, type ApprovalAckInput, type ApprovalAnswerInput, type ApprovalCallResult, type ApprovalHistoryEntry, type ApprovalIntent, type ApprovalRefusal, type ApprovalRequest,
  type ApprovalResolved, type ApprovalResolvedBy, type ApprovalRespondInput
} from '../../../../shared/types/approvals'
import { IPC_CHANNELS } from '../../../../shared/types/ipc'

/** What a door supplies; the center adds the id, the generation, the bounded text, the pacing and the times. */
export type ApprovalDraft = Omit<ApprovalRequest, 'schemaVersion' | 'id' | 'generation' | 'agentText' | 'allowDelayMs' | 'enterDisabled' | 'createdAt' | 'expiresAt' | 'ackRequired'> & {
  /** The requester's text, exactly what will run or be sent. */
  text: string
  /** Defaults to true for an agent or an MCP server, false for the app's own prompts. */
  ackRequired?: boolean
}

export interface ApprovalOutcome {
  intent: ApprovalIntent
  optionId: string
  by: ApprovalResolvedBy
  /** Why main denied it without asking (`by: 'refused'`). */
  refusal?: MainMessage
}

export type NativeReason = 'no-window' | 'unavailable' | 'no-ack'

export interface ApprovalCenterDeps {
  /** Sends to every live app window. */
  send(channel: string, payload: unknown): void
  /** A live app window exists that can show the modal. */
  hasWindow(): boolean
  /** Asks with the system dialog; the chosen option's id, or null when aborted because the request closed elsewhere. */
  native(request: ApprovalRequest, reason: NativeReason, signal: AbortSignal): Promise<string | null>
  log?(event: string, detail: Record<string, unknown>): void
  /**
   * R3 · Called when a request reaches the window, so an unfocused window can ask for attention (flash the frame, a
   * notification with fixed app text). It takes no argument, so nothing of the request can leak into it.
   */
  attention?(): void
  /** S4 · Stops asking for attention: a focused ack arrived, or no request waits any more. */
  attentionEnd?(): void
  now?(): number
  timeoutMs?: number
  ackTimeoutMs?: number
  queueMax?: number
}

interface Entry {
  request: ApprovalRequest
  settle(outcome: ApprovalOutcome): void
  timers: ReturnType<typeof setTimeout>[]
  /** When the window first acknowledged showing it, visible or not (R1: no allow before this). */
  shownAt?: number
  /** When the window first acknowledged it while visible and focused: the critical hold counts from here (R3). */
  displayedAt?: number
  /** The window said it cannot show it; only the native answer counts now. */
  reported: boolean
  native?: AbortController
}

const ANSWERED_MEMORY = 1_000

export class ApprovalCenter {
  private readonly pending = new Map<string, Entry>()
  private readonly answered = new Set<string>()
  private readonly decisions: ApprovalHistoryEntry[] = []

  constructor(private readonly deps: ApprovalCenterDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now() }

  /** Raises a request and resolves with the person's answer, or a deny (expired, cancelled, refused). Never rejects. */
  ask(draft: ApprovalDraft, signal?: AbortSignal): Promise<ApprovalOutcome> {
    const now = this.now()
    const { text, ackRequired, ...given } = draft
    // R2: bidi controls or invisible characters make the shown text differ from what runs; the text stays verbatim.
    const hidden = hasHiddenCharacters(text)
    const shown = hidden
      ? { ...given, risk: APPROVAL_RISKS[Math.max(APPROVAL_RISKS.indexOf(given.risk), APPROVAL_RISKS.indexOf('high'))], appNotes: [...given.appNotes, mainMessage('approvals.note.hiddenCharacters', {})] }
      : given
    const agentText = boundAgentText(text)
    const options = shown.options
      .filter(option => !agentText.truncated || option.intent === 'deny')
      .filter(option => shown.risk === 'low' || option.intent !== 'allow-session')
    const request: ApprovalRequest = {
      // An agent's or a server's request must be acknowledged by the window, or it falls back to the native dialog
      // (deny-only when critical): a missing panel is the same case as no window. Only the app's own prompts may wait.
      ...shown, schemaVersion: APPROVAL_SCHEMA_VERSION, id: randomUUID(), generation: 1, agentText, options,
      ackRequired: ackRequired ?? shown.requester.kind !== 'app',
      ...approvalPacing(shown.risk), createdAt: now, expiresAt: now + (this.deps.timeoutMs ?? APPROVAL_TIMEOUT_MS)
    }
    if (agentTextAdmission(agentText.length, request.risk) === 'refuse') return Promise.resolve(this.refuse(request, mainMessage('approvals.denied.tooLong', { max: APPROVAL_AGENT_TEXT_MAX })))
    const max = this.deps.queueMax ?? APPROVAL_QUEUE_MAX
    if (this.pending.size >= max) return Promise.resolve(this.refuse(request, mainMessage('approvals.denied.queueFull', { max })))
    const problems = approvalRequestProblems(request)
    if (problems.length) return Promise.resolve(this.refuse(request, undefined, problems))
    if (signal?.aborted) return Promise.resolve(this.refuse(request, undefined, ['cancelled before it was asked']))

    return new Promise<ApprovalOutcome>(settle => {
      const entry: Entry = { request, settle, timers: [], reported: false }
      this.pending.set(request.id, entry)
      entry.timers.push(setTimeout(() => this.finish(entry, request.defaultOptionId, 'timeout'), request.expiresAt - now))
      signal?.addEventListener('abort', () => this.finish(entry, request.defaultOptionId, 'cancelled'), { once: true })
      this.present(entry)
    })
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].filter(entry => !entry.reported).map(entry => entry.request)
  }

  history(): ApprovalHistoryEntry[] {
    return [...this.decisions]
  }

  respond(input: ApprovalRespondInput): ApprovalCallResult {
    const entry = this.lookup(input)
    if (typeof entry === 'string') return this.refusal(entry)
    if (entry.reported) return this.refusal('alreadyReported')
    const option = entry.request.options.find(item => item.id === input.optionId)
    if (!option) return this.refusal('unknownOption')
    // R1: nothing is allowed that the window has not said it shows, at any risk; a deny is always accepted.
    if (option.intent !== 'deny' && entry.shownAt === undefined) {
      this.deps.log?.('allow-not-shown', { id: entry.request.id, kind: entry.request.kind })
      return this.refusal('notShown')
    }
    if (allowTooSoon(entry.request, option.intent, entry.displayedAt, this.now())) {
      this.deps.log?.('allow-too-soon', { id: entry.request.id, kind: entry.request.kind, displayed: entry.displayedAt !== undefined })
      return this.refusal('tooSoon')
    }
    this.finish(entry, option.id, 'user')
    return { ok: true, id: entry.request.id }
  }

  /**
   * The window shows the request. Any ack makes it shown (R1) and settles the crash handshake; the first ack that is
   * `visible && focused` starts the critical hold (R3). Repeated acks for the same generation are accepted (the window
   * acks again when it regains focus); the hold, once started, is not restarted.
   */
  ack(input: ApprovalAckInput): ApprovalCallResult {
    const entry = this.lookup(input)
    if (typeof entry === 'string') return this.refusal(entry)
    const now = this.now()
    entry.shownAt ??= now
    if (input.visible === true && input.focused === true) {
      entry.displayedAt ??= now
      this.endAttention()
    }
    return { ok: true, id: entry.request.id }
  }

  /** The window cannot show it: ask natively, once, for this request only. */
  unavailable(input: ApprovalAnswerInput): ApprovalCallResult {
    const entry = this.lookup(input)
    if (typeof entry === 'string') return this.refusal(entry)
    if (entry.reported) return this.refusal('alreadyReported')
    entry.reported = true
    this.deps.log?.('window-unavailable', { id: entry.request.id, kind: entry.request.kind })
    this.goNative(entry, 'unavailable')
    return { ok: true, id: entry.request.id }
  }

  // ---- internals -----------------------------------------------------------------------------

  private present(entry: Entry): void {
    const surface = () => approvalSurface({
      hasWindow: this.deps.hasWindow(), ackRequired: entry.request.ackRequired, acked: entry.shownAt !== undefined, unavailable: entry.reported,
      elapsedMs: this.now() - entry.request.createdAt, ackTimeoutMs: this.deps.ackTimeoutMs ?? APPROVAL_ACK_TIMEOUT_MS
    })
    if (surface() === 'native') return this.goNative(entry, 'no-window')
    this.deps.send(IPC_CHANNELS.approvals.onRequested, entry.request)
    // Best effort: a failing flash or notification never stops the request from being asked.
    try { this.deps.attention?.() } catch { /* the request is in the window already */ }
    if (!entry.request.ackRequired) return
    const ackTimeoutMs = this.deps.ackTimeoutMs ?? APPROVAL_ACK_TIMEOUT_MS
    // A timer can fire a little before the clock says the time is up (Windows' timer resolution): then the rule still
    // reads 'wait', and a request checked only once would wait forever. Until the window acknowledges it, check again
    // when the rest of the timeout has passed.
    const check = (): void => {
      if (this.pending.get(entry.request.id) !== entry) return
      const now = surface()
      if (now === 'native') return this.goNative(entry, entry.shownAt === undefined ? 'no-ack' : 'no-window')
      if (now === 'wait') entry.timers.push(setTimeout(check, Math.max(1, ackTimeoutMs - (this.now() - entry.request.createdAt))))
    }
    entry.timers.push(setTimeout(check, ackTimeoutMs))
  }

  private goNative(entry: Entry, reason: NativeReason): void {
    if (entry.native) return
    const controller = new AbortController()
    entry.native = controller
    this.deps.log?.('native-fallback', { id: entry.request.id, kind: entry.request.kind, reason })
    this.deps.native(entry.request, reason, controller.signal).then(
      optionId => { if (optionId !== null) this.finish(entry, optionId, 'native') },
      () => this.finish(entry, entry.request.defaultOptionId, 'native')
    )
  }

  private endAttention(): void {
    try { this.deps.attentionEnd?.() } catch { /* best effort, like asking for it */ }
  }

  private lookup(input: ApprovalAnswerInput): Entry | ApprovalRefusal {
    const entry = this.pending.get(input.id)
    if (!entry) return this.answered.has(input.id) ? 'alreadyAnswered' : 'notPending'
    return input.generation === entry.request.generation ? entry : 'staleGeneration'
  }

  private refusal(refusal: ApprovalRefusal): ApprovalCallResult {
    return { ok: false, refusal, message: mainMessage(`approvals.refused.${refusal}`, {}) }
  }

  /** Denied without being shown; logged and kept in the history. */
  private refuse(request: ApprovalRequest, message: MainMessage | undefined, problems: string[] = []): ApprovalOutcome {
    this.deps.log?.('refused', { kind: request.kind, code: message?.code ?? null, problems, pending: this.pending.size })
    this.remember(request, 'deny', 'refused', message)
    return { intent: 'deny', optionId: request.defaultOptionId, by: 'refused', ...(message ? { refusal: message } : {}) }
  }

  /** The first answer wins: later ones find the request gone and are refused `alreadyAnswered`. */
  private finish(entry: Entry, optionId: string, by: ApprovalResolvedBy): void {
    if (this.pending.get(entry.request.id) !== entry) return
    this.pending.delete(entry.request.id)
    for (const timer of entry.timers) clearTimeout(timer)
    if (by !== 'native') entry.native?.abort()
    const option = entry.request.options.find(item => item.id === optionId) ?? entry.request.options.find(item => item.id === entry.request.defaultOptionId)!
    this.remember(entry.request, option.intent, by, by === 'timeout' ? mainMessage('approvals.denied.timeout', {}) : by === 'cancelled' ? mainMessage('approvals.denied.cancelled', {}) : undefined)
    const resolved: ApprovalResolved = { id: entry.request.id, generation: entry.request.generation, outcome: option.intent, optionId: option.id, by }
    this.deps.send(IPC_CHANNELS.approvals.onResolved, resolved)
    if (this.pending.size === 0) this.endAttention()
    entry.settle({ intent: option.intent, optionId: option.id, by })
  }

  private remember(request: ApprovalRequest, outcome: ApprovalIntent, by: ApprovalResolvedBy, reason?: MainMessage): void {
    this.answered.add(request.id)
    if (this.answered.size > ANSWERED_MEMORY) this.answered.delete(this.answered.values().next().value as string)
    this.decisions.unshift({
      id: request.id, kind: request.kind, requester: request.requester, risk: request.risk, title: request.title, summary: request.summary, outcome, by, ...(reason ? { reason } : {}),
      textSha256: createHash('sha256').update(request.agentText.text).digest('hex'), createdAt: request.createdAt, resolvedAt: this.now()
    })
    this.decisions.length = Math.min(this.decisions.length, APPROVAL_HISTORY_MAX)
  }
}
