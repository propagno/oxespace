import { randomUUID } from 'node:crypto'
import { classifyPreviewUrl } from '../../utils/preview-url'

/**
 * Who may act on the agent browser's page (1.5.0 A49, SECURITY S1, S2, S6, HML-711-1/2).
 *
 *   reads      inspect, status, console and network never ask.
 *   loopback   localhost, *.localhost, 127/8 and [::1], written plainly: the first mutating action asks with scope
 *              `session`; an allow lasts for (previewSessionId, origin) until End, the preview closing or the
 *              conversation ending.
 *   elsewhere  every action asks with scope `action`; nothing is kept.
 *   navigate   a target that is not loopback always asks with scope `action` and url = target.
 *
 * A denial grants nothing. Every action is judged on the page's current URL (or the frame's, for an iframe), so a
 * page that left a granted origin by itself asks again. A URL with credentials, or a scheme other than http(s), is
 * refused without asking. The audit gets one row per answer (origin only) and one per End.
 */
export type PreviewGrantScope = 'session' | 'action'
export type PreviewNavigationCause = 'redirect' | 'meta-refresh' | 'script' | 'agent'

export interface PreviewGrantRequest {
  previewSessionId: string
  origin: string
  action: string
  url: string
  scope: PreviewGrantScope
  /** The element label or field name the action targets; never a fill value. */
  label?: string
}
export type PreviewGrantAsk = (request: PreviewGrantRequest) => Promise<boolean>

export interface PreviewGrant {
  previewSessionId: string
  origin: string
  scope: 'session'
  grantedAt: number
}

export interface PreviewGrantAuditEntry {
  action: 'preview-grant' | 'preview-end'
  target: string
  outcome: 'ok' | 'refused'
}

export interface PreviewGrantsDeps {
  now?: () => number
  audit?: { record(entry: PreviewGrantAuditEntry): void }
}

export interface PreviewAuthorizeInput {
  previewSessionId: string
  url: string
  action: string
  target?: string
  frameUrl?: string
  label?: string
  ask: PreviewGrantAsk
}

export interface PreviewNavigationInput {
  previewSessionId: string
  from: string
  to: string
  cause: PreviewNavigationCause
  ask: PreviewGrantAsk
}

const READ_ACTIONS = new Set(['inspect', 'status', 'console', 'network'])
const LOOPBACK_V4 = /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const PLAIN_ASCII = /^[\x21-\x7e]+$/

type Judged = { kind: 'refused' } | { kind: 'loopback' | 'external'; origin: string; href: string }

/** The host as written, after the scheme and its slashes, before the port, path, query or fragment. */
function writtenHost(raw: string): string {
  const afterScheme = raw.slice(raw.indexOf(':') + 1).replace(/^[/\\]*/, '')
  const authority = afterScheme.split(/[/\\?#]/, 1)[0] ?? ''
  if (authority.startsWith('[')) return authority.slice(0, authority.indexOf(']') + 1)
  const colon = authority.lastIndexOf(':')
  return colon === -1 ? authority : authority.slice(0, colon)
}

/** Loopback for a session grant: the shared preview rule, widened to 127/8 written plainly in dotted-quad form. */
export function judgePreviewUrl(raw: string): Judged {
  const classified = classifyPreviewUrl(raw)
  if (classified.kind === 'refused') return { kind: 'refused' }
  const url = new URL(classified.href)
  if (classified.kind === 'local') return { kind: 'loopback', origin: url.origin, href: url.href }
  const plain127 = PLAIN_ASCII.test(raw) && LOOPBACK_V4.test(url.hostname) && writtenHost(raw) === url.hostname
  return { kind: plain127 ? 'loopback' : 'external', origin: url.origin, href: url.href }
}

export class PreviewGrants {
  private readonly now: () => number
  private readonly audit?: PreviewGrantsDeps['audit']
  private readonly grants = new Map<string, Map<string, PreviewGrant>>()

  constructor(deps: PreviewGrantsDeps = {}) {
    this.now = deps.now ?? Date.now
    this.audit = deps.audit
  }

  async authorize(input: PreviewAuthorizeInput): Promise<boolean> {
    if (READ_ACTIONS.has(input.action)) return true
    const current = judgePreviewUrl(input.frameUrl ?? input.url)
    if (current.kind === 'refused') return false
    if (input.frameUrl !== undefined && judgePreviewUrl(input.url).kind === 'refused') return false
    if (input.action === 'navigate') {
      const target = judgePreviewUrl(input.target ?? '')
      if (target.kind === 'refused') return false
      if (target.kind !== 'loopback') {
        return this.askOnce(input, { origin: target.origin, url: target.href, scope: 'action' })
      }
    }
    if (current.kind === 'loopback') {
      if (this.grants.get(input.previewSessionId)?.has(current.origin)) return true
      const allowed = await this.askOnce(input, { origin: current.origin, url: current.href, scope: 'session' })
      if (allowed) this.keep(input.previewSessionId, current.origin)
      return allowed
    }
    return this.askOnce(input, { origin: current.origin, url: current.href, scope: 'action' })
  }

  /**
   * A page-driven move (a redirect, a meta refresh, a script setting the location) from a local page to an external
   * origin asks like an agent navigate.
   */
  async checkNavigation(input: PreviewNavigationInput): Promise<boolean> {
    const to = judgePreviewUrl(input.to)
    if (to.kind === 'refused') return false
    if (to.kind === 'loopback') return true
    const from = judgePreviewUrl(input.from)
    if (from.kind !== 'loopback') return true
    return this.askOnce(
      { previewSessionId: input.previewSessionId, action: 'navigate', ask: input.ask },
      { origin: to.origin, url: to.href, scope: 'action' }
    )
  }

  /** Whether a page-driven move leaves a granted loopback origin for an external origin: decided synchronously. */
  navigationNeedsAsk(input: { previewSessionId: string; from: string; to: string }): boolean {
    const to = judgePreviewUrl(input.to)
    if (to.kind !== 'external') return false
    const from = judgePreviewUrl(input.from)
    return from.kind === 'loopback' && this.grants.get(input.previewSessionId)?.has(from.origin) === true
  }

  /** A window the page opened (window.open, target=_blank) is a new preview session, with no grant. */
  openedFrom(previewSessionId: string): string {
    return `${previewSessionId}:opened:${randomUUID()}`
  }

  list(previewSessionId: string): PreviewGrant[] {
    return [...(this.grants.get(previewSessionId)?.values() ?? [])].map(grant => ({ ...grant }))
  }

  /** The window's End: the session's grants go at once, and the audit records it. */
  revoke(previewSessionId: string): void {
    this.grants.delete(previewSessionId)
    this.audit?.record({ action: 'preview-end', target: previewSessionId, outcome: 'ok' })
  }

  /** The preview session itself ended (its tab or window closed, the conversation ended). */
  endSession(previewSessionId: string): void {
    this.grants.delete(previewSessionId)
  }

  private keep(previewSessionId: string, origin: string): void {
    const forSession = this.grants.get(previewSessionId) ?? new Map<string, PreviewGrant>()
    forSession.set(origin, { previewSessionId, origin, scope: 'session', grantedAt: this.now() })
    this.grants.set(previewSessionId, forSession)
  }

  private async askOnce(
    input: { previewSessionId: string; action: string; label?: string; ask: PreviewGrantAsk },
    request: { origin: string; url: string; scope: PreviewGrantScope }
  ): Promise<boolean> {
    let allowed = false
    try {
      allowed = (await input.ask({
        previewSessionId: input.previewSessionId,
        origin: request.origin,
        action: input.action,
        url: request.url,
        scope: request.scope,
        ...(input.label !== undefined ? { label: input.label } : {})
      })) === true
    } finally {
      this.audit?.record({ action: 'preview-grant', target: request.origin, outcome: allowed ? 'ok' : 'refused' })
    }
    return allowed
  }
}

let auditSink: ((entry: PreviewGrantAuditEntry) => void) | null = null
/** Main wires the person-action audit once the database is open. */
export function setPreviewGrantAudit(record: ((entry: PreviewGrantAuditEntry) => void) | null): void {
  auditSink = record
}

/** The app's one set of agent browser grants, shared by the automation and the window's End. */
export const previewGrants = new PreviewGrants({ audit: { record: entry => { auditSink?.(entry) } } })
