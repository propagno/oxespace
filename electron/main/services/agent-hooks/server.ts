/**
 * Loopback receiver for agent lifecycle hooks.
 *
 * Fail-open by design: the hook runs inside the agent's own turn, so a slow or
 * erroring response here must never stall or break the agent. Everything is
 * answered 204 except an unauthenticated delivery (403), and nothing a body
 * says is trusted beyond mapping an event name to a pane state.
 *
 * Authentication reuses the per-pane execution credentials every OXESpace
 * terminal already carries (OXESPACE_EXECUTION_ID/TOKEN), so there is no
 * second secret to inject, rotate or leak.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentHookAgent, AgentHookLocationEvent, AgentHookStatusEvent, SessionLocation } from '../../../../shared/types/agent-hooks'
import { mapHookEvent, type HookPayload } from './events'

const MAX_BODY_BYTES = 1024 * 1024
const BODY_TIMEOUT_MS = 5_000

export interface AgentHookServerOptions {
  /** Resolves execution credentials to a pane, or null when they are not valid. */
  authenticate(input: { executionId: string; token: string; workspaceId: string }): { paneId: string; workspaceId: string; launchRoot?: string } | null
  onStatus(event: AgentHookStatusEvent): void
  /** Resolves the `cwd` a hook reported against the pane's launch directory. */
  resolveLocation?(cwd: string, launchRoot: string): SessionLocation | null
  /** Sent when the directory a pane's agent reports working in changes. */
  onLocation?(event: AgentHookLocationEvent): void
  now?: () => number
}

interface Delivery {
  executionId?: unknown
  token?: unknown
  workspaceId?: unknown
  agent?: unknown
  payload?: unknown
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    const timer = setTimeout(() => { req.destroy(); resolve(null) }, BODY_TIMEOUT_MS)
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        clearTimeout(timer)
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', () => { clearTimeout(timer); resolve(null) })
  })
}

export class AgentHookServer {
  private server: Server | null = null
  private bound: number | null = null

  constructor(private readonly options: AgentHookServerOptions) {}

  get port(): number | null {
    return this.bound
  }

  start(): Promise<number> {
    if (this.server && this.bound) return Promise.resolve(this.bound)
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        this.server = server
        this.bound = (server.address() as AddressInfo).port
        server.removeListener('error', reject)
        server.on('error', () => undefined)
        resolve(this.bound)
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.bound = null
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const done = (code: number): void => { res.statusCode = code; res.end() }
    if (req.method !== 'POST' || req.url !== '/hook') return done(204)
    const body = await readBody(req)
    if (body === null) return done(204)

    let delivery: Delivery
    try {
      delivery = JSON.parse(body) as Delivery
    } catch {
      return done(204)
    }
    const { executionId, token, workspaceId, agent, payload } = delivery
    if (typeof executionId !== 'string' || typeof token !== 'string' || typeof workspaceId !== 'string') return done(204)
    if (agent !== 'claude-code' && agent !== 'codex') return done(204)

    const target = this.options.authenticate({ executionId, token, workspaceId })
    if (!target) return done(403)
    done(204)

    const record = payload !== null && typeof payload === 'object' ? (payload as HookPayload) : {}
    const sessionId = typeof record.session_id === 'string' ? record.session_id : null
    const at = (this.options.now ?? Date.now)()
    const state = mapHookEvent(agent as AgentHookAgent, record)
    // Location is read from every event, mapped or not, so a move into a worktree shows up at once.
    if (state === 'ended') this.lastLocation.delete(target.paneId)
    else this.reportLocation(target, agent as AgentHookAgent, sessionId, record.cwd, at)
    if (!state) return
    this.options.onStatus({
      paneId: target.paneId,
      workspaceId: target.workspaceId,
      agent: agent as AgentHookAgent,
      state,
      event: typeof record.hook_event_name === 'string' ? record.hook_event_name : '',
      at,
      sessionId
    })
  }

  /** Last location sent per pane, so an unchanged directory is not re-sent on every tool call. */
  private readonly lastLocation = new Map<string, string>()

  private reportLocation(target: { paneId: string; workspaceId: string; launchRoot?: string }, agent: AgentHookAgent, sessionId: string | null, cwd: unknown, at: number): void {
    if (typeof cwd !== 'string' || !target.launchRoot || !this.options.resolveLocation || !this.options.onLocation) return
    const location = this.options.resolveLocation(cwd, target.launchRoot)
    if (!location) return
    const key = `${location.cwd}|${location.checkoutRoot ?? ''}|${location.sameRepository}`
    if (this.lastLocation.get(target.paneId) === key) return
    this.lastLocation.set(target.paneId, key)
    this.options.onLocation({ ...location, paneId: target.paneId, workspaceId: target.workspaceId, agent, sessionId, at })
  }
}
