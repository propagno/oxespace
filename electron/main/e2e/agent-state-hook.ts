/**
 * E2E hook: a spec sets a pane's agent state from the main process, through the same entry point the agents'
 * lifecycle hooks use, so everything downstream (the `agentState:changed` event, the terminal store, notifications,
 * the activity center, `agentState.explain`) runs as it does in production.
 *
 * `OXESPACE_E2E_AGENT_STATE=1` (with `OXESPACE_E2E_MOCK_NATIVE=1`, never in a packaged build) defines
 * `globalThis.__oxeE2eAgentState` in the main process. A spec calls it with:
 *
 *   await app.evaluate((_electron, input) => globalThis.__oxeE2eAgentState?.(input), { paneId, state: 'waiting' })
 *
 * `state` takes the hook signals of `AgentStateService.hook`, unchanged:
 *   working  the agent runs a turn          → published `working`
 *   waiting  it waits on the person (approval, permission, question) → published `blocked`
 *   done     the turn finished                → published `done` when the pane was `working` before, else `idle`
 *   ended    the agent session ended          → the pane's state is cleared
 * A `done` that is then seen (`agentState.markSeen`, i.e. the person looks at the pane) becomes `idle`.
 *
 * The service has no field for why a pane is blocked, so there is no free-text reason. `hookEvent` (optional) is
 * the hook's own event name, e.g. `PermissionRequest`, carried on the `agentHooks:status` event exactly as a real
 * hook delivery carries it.
 *
 * Nothing runs: no agent, no PTY. The pane must be a terminal pane of a mock workspace. This module imports nothing
 * from Electron, so the gate is unit-tested.
 */
import { AgentStateService, type HookSignal, type StateExplain } from '../services/agent-state/agent-state.service'
import type { AgentManifest } from '../services/agent-state/manifest'
import type { AgentHookStatusEvent } from '../../../shared/types/agent-hooks'
import type { PaneAgentStateEvent } from '../../../shared/types/agent-state'
import type { WorkspacePane } from '../../../shared/types/workspace'

export const E2E_AGENT_STATE_GLOBAL = '__oxeE2eAgentState'

export const E2E_AGENT_STATE_SIGNALS: readonly HookSignal[] = ['working', 'waiting', 'done', 'ended']
export type E2eAgentStateAgent = 'claude' | 'codex'

export interface E2eAgentStateInput {
  paneId: string
  state: HookSignal
  /** Defaults to the pane's profile: `codex` for the Codex profile, `claude` otherwise. */
  agent?: E2eAgentStateAgent
  /** The hook's own event name, carried on `agentHooks:status`. Defaults per state. */
  hookEvent?: string
}

export type E2eAgentStateRefusal = 'invalid-input' | 'unknown-pane' | 'not-terminal-pane' | 'unknown-state' | 'unknown-agent' | 'reason-unsupported'

export type E2eAgentStateResult =
  | { ok: true; explain: StateExplain }
  | { ok: false; refusal: E2eAgentStateRefusal }

export type E2eAgentStateFn = (input: unknown) => E2eAgentStateResult

export interface E2eAgentStateDeps {
  /** The pane in the mock workspaces, or null. */
  findPane(paneId: string): WorkspacePane | null
  manifests(): Map<string, AgentManifest>
  /** The production `agentState:changed` broadcast. */
  emit(event: PaneAgentStateEvent): void
  /** The production `agentHooks:status` broadcast. */
  sendHookStatus(event: AgentHookStatusEvent): void
  /** The production `agentState:*` IPC handlers, bound to the service. */
  registerIpc(service: AgentStateService): void
  now?: () => number
}

/** Whether the hook may be installed. Never in a packaged build, never without the E2E mocks. */
export function e2eAgentStateEnabled(env: Record<string, string | undefined>, isPackaged: boolean): boolean {
  if (isPackaged) return false
  if (env.OXESPACE_E2E_MOCK_NATIVE !== '1') return false
  return env.OXESPACE_E2E_AGENT_STATE === '1'
}

const DEFAULT_HOOK_EVENT: Record<HookSignal, string> = { working: 'UserPromptSubmit', waiting: 'PermissionRequest', done: 'Stop', ended: 'SessionEnd' }

/**
 * Defines `target.__oxeE2eAgentState` and the real `agentState:*` IPC when the gate allows it, and returns the
 * service; otherwise touches nothing and returns null.
 */
export function installE2eAgentStateHook(target: object, env: Record<string, string | undefined>, isPackaged: boolean, deps: E2eAgentStateDeps): AgentStateService | null {
  if (!e2eAgentStateEnabled(env, isPackaged)) return null
  const now = deps.now ?? Date.now
  const service = new AgentStateService({ manifests: deps.manifests, emit: deps.emit, now })
  deps.registerIpc(service)
  const started = new Set<string>()

  const fn: E2eAgentStateFn = (raw) => {
    if (!raw || typeof raw !== 'object') return { ok: false, refusal: 'invalid-input' }
    const input = raw as Record<string, unknown>
    if (typeof input.paneId !== 'string' || !input.paneId) return { ok: false, refusal: 'invalid-input' }
    if (input.reason !== undefined) return { ok: false, refusal: 'reason-unsupported' }
    if (typeof input.state !== 'string' || !E2E_AGENT_STATE_SIGNALS.includes(input.state as HookSignal)) return { ok: false, refusal: 'unknown-state' }
    if (input.agent !== undefined && input.agent !== 'claude' && input.agent !== 'codex') return { ok: false, refusal: 'unknown-agent' }
    if (input.hookEvent !== undefined && typeof input.hookEvent !== 'string') return { ok: false, refusal: 'invalid-input' }
    const pane = deps.findPane(input.paneId)
    if (!pane) return { ok: false, refusal: 'unknown-pane' }
    if (pane.type !== 'terminal') return { ok: false, refusal: 'not-terminal-pane' }

    const state = input.state as HookSignal
    const agent: E2eAgentStateAgent = (input.agent as E2eAgentStateAgent | undefined) ?? (pane.shellProfileId === 'builtin-codex' ? 'codex' : 'claude')
    // The real terminal manager tells the service a pane started; the mock terminal does not, so the first call does.
    if (!started.has(pane.id)) {
      service.start(pane.id, pane.workspaceId, 120, 30)
      started.add(pane.id)
    }
    // What the hook server's onStatus does with a delivery: feed the service, then tell the windows.
    service.hook(pane.id, agent, state)
    deps.sendHookStatus({
      paneId: pane.id, workspaceId: pane.workspaceId, agent: agent === 'codex' ? 'codex' : 'claude-code', state,
      event: (input.hookEvent as string | undefined) ?? DEFAULT_HOOK_EVENT[state], at: now(), sessionId: null
    })
    return { ok: true, explain: service.explain(pane.id) }
  }

  Object.defineProperty(target, E2E_AGENT_STATE_GLOBAL, { value: fn, configurable: true, writable: false, enumerable: false })
  return service
}
