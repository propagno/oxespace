import { agentFromCommand } from './agents'
import { detect, loadManifests, manifestFor, type AgentManifest, type Detection } from './manifest'
import { PaneScreen } from './screen'

/**
 * What a coding agent in a pane is doing, in herdr's vocabulary:
 *   working  it is running a turn
 *   blocked  it shows an approval, question or permission prompt
 *   done     it finished a turn and the person has not looked at the pane yet
 *   idle     it waits for input and has been seen
 *   unknown  an agent is there but its state cannot be read
 *
 * Hooks come first: once a lifecycle hook of the agent (Claude Code, Codex) arrives,
 * its state comes only from them and the pane has no screen. The screen, read with
 * herdr's detection manifests, serves agents without hooks and those whose hooks
 * stay silent for the handshake window; a permission prompt visible on it wins.
 */
import type { AgentLifecycleState, PaneAgentState, PaneAgentStateEvent } from '../../../../shared/types/agent-state'

export type AgentState = AgentLifecycleState
export type { PaneAgentState }
type RawState = 'working' | 'blocked' | 'idle' | 'unknown'
export type HookSignal = 'working' | 'waiting' | 'done' | 'ended'

export interface StateExplain {
  state: PaneAgentState | null
  hook: { state: RawState; at: number } | null
  screen: (Detection & { at: number }) | null
  pendingIdle: boolean
}

export { agentFromCommand }

const EVAL_DELAY_MS = 300
const EVAL_MAX_INTERVAL_MS = 1000
const IDLE_RECHECK_MS = 100
const IDLE_CONFIRMATIONS = 3
const IDLE_CAP_MS = 700
/** The agents that report through lifecycle hooks (see `hook`). */
const HOOK_AGENTS: ReadonlySet<string> = new Set(['claude', 'codex'])
/** How long after its first output a hook-capable agent may stay silent before its screen is read. */
const HOOK_HANDSHAKE_MS = 10_000

interface PaneRecord {
  paneId: string
  workspaceId: string
  agent: string | null
  manifest?: AgentManifest
  screen?: PaneScreen
  /** OXE-447 · Remote SSH panes cannot reach localhost lifecycle hooks, so screen detection opens immediately. */
  remote: boolean
  /** A hook arrived from this agent: its screen is never read. */
  hooked: boolean
  /** Runs from the agent's first output until a hook arrives or the screen takes over. */
  handshake?: ReturnType<typeof setTimeout>
  cols: number
  rows: number
  hook: { state: RawState; at: number } | null
  detection: (Detection & { at: number }) | null
  published: PaneAgentState | null
  raw: RawState | null
  seen: boolean
  pendingIdle: { since: number; confirmations: number } | null
  timer?: ReturnType<typeof setTimeout>
  lastEvalAt: number
}

interface Waiter { paneId: string; until: Set<AgentState>; resolve: (state: PaneAgentState | null) => void; timer: ReturnType<typeof setTimeout> }

export class AgentStateService {
  private readonly panes = new Map<string, PaneRecord>()
  private readonly waiters = new Set<Waiter>()
  private readonly now: () => number
  private seq = 0
  private cachedManifests?: { raw: unknown; parsed: Map<string, AgentManifest> }

  constructor(private readonly deps: {
    manifests: () => Map<string, AgentManifest> | Array<{ file: string; text: string }>
    emit: (event: PaneAgentStateEvent) => void
    /** Output the pane already printed, to seed a screen created after the agent started. */
    history?: (paneId: string) => string | null
    now?: () => number
  }) {
    this.now = deps.now ?? Date.now
  }

  /** A terminal started. `command` is the agent command or executable it runs, when known. */
  start(paneId: string, workspaceId: string, cols: number, rows: number, command?: string | null, options?: { remote?: boolean }): void {
    this.forget(paneId)
    const record: PaneRecord = { paneId, workspaceId, agent: null, remote: Boolean(options?.remote), hooked: false, cols, rows, hook: null, detection: null, published: null, raw: null, seen: true, pendingIdle: null, lastEvalAt: 0 }
    this.panes.set(paneId, record)
    const agent = agentFromCommand(command)
    if (agent) this.identify(paneId, agent, false)
  }

  /** The pane runs this agent (from its launch command or its hooks). */
  identify(paneId: string, agent: string, seed = true): void {
    const record = this.panes.get(paneId)
    if (!record || record.agent === agent) return
    record.agent = agent
    record.manifest = manifestFor(this.resolveManifests(), agent)
    record.hooked = false
    this.releaseScreen(record)
    if (record.manifest && (!HOOK_AGENTS.has(agent) || record.remote)) this.openScreen(record, seed)
    else this.schedule(record)
  }

  output(paneId: string, data: string): void {
    const record = this.panes.get(paneId)
    if (!record) return
    if (record.screen) { void record.screen.write(data).then(() => this.schedule(record)); return }
    if (!record.manifest || record.hooked || record.handshake) return
    // A timer, not the next chunk: an agent can print a prompt and then wait without printing again.
    record.handshake = setTimeout(() => { record.handshake = undefined; this.openScreen(record, true) }, HOOK_HANDSHAKE_MS)
  }

  resize(paneId: string, cols: number, rows: number): void {
    const record = this.panes.get(paneId)
    if (!record) return
    record.cols = cols; record.rows = rows
    record.screen?.resize(cols, rows)
  }

  /** A lifecycle hook arrived for the agent in this pane. */
  hook(paneId: string, agent: 'claude' | 'codex', signal: HookSignal): void {
    const record = this.panes.get(paneId)
    if (!record) return
    if (record.agent !== agent) this.identify(paneId, agent)
    record.hooked = true
    this.releaseScreen(record)
    record.detection = null
    record.pendingIdle = null
    record.hook = signal === 'ended' ? null : { state: signal === 'working' ? 'working' : signal === 'waiting' ? 'blocked' : 'idle', at: this.now() }
    if (signal === 'ended') { this.clear(record); return }
    this.evaluate(record)
  }

  /** The person looked at the pane: a finished turn is no longer news. */
  markSeen(paneId: string): void {
    const record = this.panes.get(paneId)
    if (!record || record.seen) return
    record.seen = true
    if (record.published?.state === 'done') this.publish(record, record.raw ?? 'idle', record.published.source)
  }

  exit(paneId: string): void {
    const record = this.panes.get(paneId)
    if (record) this.clear(record)
  }

  forget(paneId: string): void {
    const record = this.panes.get(paneId)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    this.releaseScreen(record)
    this.panes.delete(paneId)
    if (record.published) this.deps.emit({ paneId, workspaceId: record.workspaceId, cleared: true })
    this.notifyWaiters(paneId, null)
  }

  get(paneId: string): PaneAgentState | null {
    return this.panes.get(paneId)?.published ?? null
  }

  /** Identified agent executable/provider for a live pane, even when no screen manifest exists (e.g. antigravity/agy). */
  agentOf(paneId: string): string | null {
    return this.panes.get(paneId)?.agent ?? null
  }

  /** OXE-445 · Current headless terminal screen snapshot (ScreenMirror), or null if no screen is attached. */
  readScreen(paneId: string): { screen: string; oscTitle: string; oscProgress: string } | null {
    const record = this.panes.get(paneId)
    return record?.screen ? record.screen.read() : null
  }

  list(workspaceId?: string): PaneAgentState[] {
    return [...this.panes.values()].map(record => record.published).filter((state): state is PaneAgentState => Boolean(state) && (!workspaceId || state!.workspaceId === workspaceId))
  }

  explain(paneId: string): StateExplain {
    const record = this.panes.get(paneId)
    return { state: record?.published ?? null, hook: record?.hook ?? null, screen: record?.detection ?? null, pendingIdle: Boolean(record?.pendingIdle) }
  }

  /** Resolves with the state once it is one of `until`, or with the current state (or null) at the timeout. */
  waitFor(paneId: string, until: AgentState[], timeoutMs: number): Promise<{ state: PaneAgentState | null; timedOut: boolean }> {
    const current = this.get(paneId)
    if (current && until.includes(current.state)) return Promise.resolve({ state: current, timedOut: false })
    if (!this.panes.has(paneId)) return Promise.resolve({ state: null, timedOut: false })
    return new Promise(resolve => {
      const waiter: Waiter = {
        paneId, until: new Set(until),
        resolve: state => { this.waiters.delete(waiter); clearTimeout(waiter.timer); resolve({ state, timedOut: false }) },
        timer: setTimeout(() => { this.waiters.delete(waiter); resolve({ state: this.get(paneId), timedOut: true }) }, timeoutMs)
      }
      this.waiters.add(waiter)
    })
  }

  // ---- screen ----------------------------------------------------------------

  private resolveManifests(): Map<string, AgentManifest> {
    const raw = this.deps.manifests()
    if (raw instanceof Map) return raw
    if (this.cachedManifests?.raw === raw) return this.cachedManifests.parsed
    const parsed = loadManifests(raw).manifests
    this.cachedManifests = { raw, parsed }
    return parsed
  }

  private openScreen(record: PaneRecord, seed: boolean): void {
    const screen = new PaneScreen(record.cols, record.rows)
    record.screen = screen
    const history = seed ? this.deps.history?.(record.paneId) : null
    if (history) void screen.write(history).then(() => this.schedule(record))
    else this.schedule(record)
  }

  /** Drops the screen and the wait for one. */
  private releaseScreen(record: PaneRecord): void {
    if (record.handshake) clearTimeout(record.handshake)
    record.handshake = undefined
    record.screen?.dispose()
    record.screen = undefined
  }

  // ---- evaluation ------------------------------------------------------------

  private schedule(record: PaneRecord): void {
    if (record.timer) clearTimeout(record.timer)
    const due = this.now() - record.lastEvalAt >= EVAL_MAX_INTERVAL_MS
    record.timer = setTimeout(() => { record.timer = undefined; this.evaluate(record) }, due ? 0 : EVAL_DELAY_MS)
  }

  private evaluate(record: PaneRecord): void {
    if (!this.panes.has(record.paneId) || !record.agent) return
    record.lastEvalAt = this.now()
    if (record.manifest && record.screen && !record.screen.busy) {
      const detection = detect(record.manifest, record.screen.read())
      if (!detection.skipStateUpdate) {
        const changed = !record.detection || record.detection.state !== detection.state || record.detection.matchedRule?.id !== detection.matchedRule?.id
        record.detection = { ...detection, at: changed ? this.now() : record.detection!.at }
      }
    }
    const { state, source } = this.combine(record)
    if (!state) return
    // herdr: a working → plain idle drop is confirmed three times (or for 700 ms) before it is believed.
    if (record.raw === 'working' && state === 'idle' && source === 'screen' && !record.detection?.visibleIdle) {
      const pending = record.pendingIdle ?? { since: this.now(), confirmations: 0 }
      record.pendingIdle = pending
      pending.confirmations += 1
      if (pending.confirmations < IDLE_CONFIRMATIONS && this.now() - pending.since < IDLE_CAP_MS) {
        if (record.timer) clearTimeout(record.timer)
        record.timer = setTimeout(() => { record.timer = undefined; this.evaluate(record) }, IDLE_RECHECK_MS)
        return
      }
    }
    record.pendingIdle = null
    this.publish(record, state, source)
  }

  private combine(record: PaneRecord): { state: RawState | null; source: 'hook' | 'screen' } {
    const screen = record.detection
    if (screen?.visibleBlocker) return { state: 'blocked', source: 'screen' }
    const screenMatched = Boolean(screen?.matchedRule)
    if (record.hook && (!screenMatched || record.hook.at >= screen!.at)) return { state: record.hook.state, source: 'hook' }
    if (screen) return { state: screen.state, source: 'screen' }
    return { state: record.hook?.state ?? null, source: 'hook' }
  }

  private publish(record: PaneRecord, raw: RawState, source: 'hook' | 'screen'): void {
    const previous = record.published
    const finished = record.raw === 'working' && raw === 'idle'
    if (finished) record.seen = false
    if (raw === 'working' || raw === 'blocked') record.seen = true
    record.raw = raw
    const state: AgentState = raw === 'idle' && !record.seen ? 'done' : raw
    if (previous && previous.state === state && previous.agent === record.agent && previous.source === source) return
    const next: PaneAgentState = {
      paneId: record.paneId, workspaceId: record.workspaceId, agent: record.agent!, state, source, seen: record.seen,
      since: previous?.state === state ? previous.since : this.now(), stateChangeSeq: ++this.seq,
      completionSeq: (previous?.completionSeq ?? 0) + (finished ? 1 : 0)
    }
    record.published = next
    this.deps.emit(next)
    this.notifyWaiters(record.paneId, next)
  }

  private clear(record: PaneRecord): void {
    if (record.timer) clearTimeout(record.timer)
    this.releaseScreen(record)
    record.hooked = false
    record.agent = null; record.manifest = undefined; record.hook = null; record.detection = null; record.raw = null; record.pendingIdle = null
    if (record.published) { record.published = null; this.deps.emit({ paneId: record.paneId, workspaceId: record.workspaceId, cleared: true }) }
    this.notifyWaiters(record.paneId, null)
  }

  private notifyWaiters(paneId: string, state: PaneAgentState | null): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.paneId !== paneId) continue
      if (!state || waiter.until.has(state.state)) waiter.resolve(state)
    }
  }
}
