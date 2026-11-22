/**
 * B10 · Who asks, named by the app. The requester comes from the authenticated execution's owner (a pane or a
 * conversation) and is labelled with the agent's provider and the pane's position, never with a pane name, label or
 * title an agent chose.
 */
import { mainMessage } from '../../../../shared/messages'
import type { ApprovalRequester } from '../../../../shared/types/approvals'
import type { WorkspacePane } from '../../../../shared/types/workspace'
import type { ExecutionOwner } from '../execution-registry'

export interface RequesterInfo {
  /** The provider's product name (Claude, Codex). */
  agent?: string
  /** 1-based position of the pane in its workspace, left to right, top to bottom. */
  pane?: number
  /** Sanitized executable basename running in the pane when no recognized agent profile is bound (OXE-293). */
  process?: string
}

const RESERVED_AGENT_NAMES = new Set([
  'claude',
  'claude-code',
  'codex',
  'copilot',
  'gh-copilot',
  'cursor',
  'grok',
  'antigravity',
  'agy'
])

/**
 * Normalizes a terminal executable/command into a safe process basename:
 * strips leading `&`, quotes, directory path, arguments and Windows script extensions,
 * lowercases, restricts to `[a-zA-Z0-9._-]+` (max 32 chars), and rejects reserved
 * agent provider names so an unbound script cannot impersonate a trusted agent (OXE-293 RN-2, RT-2).
 */
export function sanitizeProcessName(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const quoted = trimmed.match(/^(?:&\s*)?(?:"([^"]+)"|'([^']+)')/)
  const winPath = !quoted ? trimmed.match(/^(?:&\s*)?([^\r\n]+?\.(?:exe|cmd|bat|ps1))(?=\s|$)/i) : null
  const token = quoted?.[1] ?? quoted?.[2] ?? winPath?.[1] ?? trimmed.replace(/^&\s*/, '').split(/\s+/)[0] ?? ''
  const base = token.replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, '') ?? ''
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32).toLowerCase()
  if (!cleaned || !/[a-z0-9]/.test(cleaned)) return undefined
  if (RESERVED_AGENT_NAMES.has(cleaned)) return undefined
  return cleaned
}

/** The provider name the app shows; any other value is a provider id the app knows, never agent text. */
export function providerName(provider: string | null | undefined): string | undefined {
  if (!provider) return undefined
  if (provider === 'claude' || provider === 'claude-code') return 'Claude'
  if (provider === 'codex') return 'Codex'
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

/** Position and provider (or foreground process) of a pane, from the person's workspaces, agent profiles and terminal service. */
export function paneInfo(
  paneId: string,
  workspaces: Array<{ panes: WorkspacePane[] }>,
  providerOf: (profileId: string) => string | undefined,
  processOf?: (paneId: string) => string | undefined
): RequesterInfo | undefined {
  for (const workspace of workspaces) {
    const ordered = [...workspace.panes].sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex)
    const index = ordered.findIndex(pane => pane.id === paneId)
    if (index === -1) continue
    const profile = ordered[index].agentProfileId
    const agent = providerName(profile ? providerOf(profile) : undefined)
    const proc = agent ? undefined : sanitizeProcessName(processOf?.(paneId))
    return { pane: index + 1, agent, ...(proc ? { process: proc } : {}) }
  }
  return undefined
}

let lookup: ((owner: ExecutionOwner) => RequesterInfo | undefined) | undefined

/** Set once at startup, where the workspaces and the conversations are known. */
export function setRequesterLookup(next: typeof lookup): void { lookup = next }

/**
 * The app's name for the owner. When no recognized agent profile is bound, falls back to the pane's sanitized
 * foreground process (`approvals.requester.paneProcess`), and to "Unknown agent" only when no process is known.
 */
export function requesterFor(owner: ExecutionOwner): ApprovalRequester {
  let info: RequesterInfo | undefined
  try { info = lookup?.(owner) } catch { info = undefined }
  const agent = info?.agent
  if (owner.kind === 'thread') {
    const conversation = owner.id.slice(0, 6)
    return {
      kind: 'agent', id: `thread:${owner.id}`,
      label: agent ? mainMessage('approvals.requester.conversation', { agent, conversation }) : mainMessage('approvals.requester.unknownConversation', { conversation })
    }
  }
  const pane = info?.pane ?? 0
  if (agent) return { kind: 'agent', id: `pane:${owner.id}`, label: mainMessage('approvals.requester.pane', { agent, pane }) }
  const proc = sanitizeProcessName(info?.process)
  if (proc) return { kind: 'agent', id: `pane:${owner.id}`, label: mainMessage('approvals.requester.paneProcess', { process: proc, pane }) }
  return { kind: 'agent', id: `pane:${owner.id}`, label: mainMessage('approvals.requester.unknownPane', { pane }) }
}

/** The owner behind an audit label (`pane:abc`, `thread:abc`), for callers that only carry the label. */
export function ownerFromLabel(label: string): ExecutionOwner | undefined {
  const match = /^(pane|thread):(.+)$/.exec(label)
  return match ? { kind: match[1] as ExecutionOwner['kind'], id: match[2] } : undefined
}

export const APP_REQUESTER: ApprovalRequester = { kind: 'app', id: 'oxespace', label: mainMessage('approvals.requester.app', {}) }
