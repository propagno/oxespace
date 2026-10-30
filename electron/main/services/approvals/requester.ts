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
}

/** The provider name the app shows; any other value is a provider id the app knows, never agent text. */
export function providerName(provider: string | null | undefined): string | undefined {
  if (!provider) return undefined
  if (provider === 'claude' || provider === 'claude-code') return 'Claude'
  if (provider === 'codex') return 'Codex'
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

/** Position and provider of a pane, from the person's workspaces and agent profiles. */
export function paneInfo(paneId: string, workspaces: Array<{ panes: WorkspacePane[] }>, providerOf: (profileId: string) => string | undefined): RequesterInfo | undefined {
  for (const workspace of workspaces) {
    const ordered = [...workspace.panes].sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex)
    const index = ordered.findIndex(pane => pane.id === paneId)
    if (index === -1) continue
    const profile = ordered[index].agentProfileId
    return { pane: index + 1, agent: providerName(profile ? providerOf(profile) : undefined) }
  }
  return undefined
}

let lookup: ((owner: ExecutionOwner) => RequesterInfo | undefined) | undefined

/** Set once at startup, where the workspaces and the conversations are known. */
export function setRequesterLookup(next: typeof lookup): void { lookup = next }

/** Neutral when the provider is not known; a product word in both languages. */
const UNKNOWN_AGENT = 'AI'

export function requesterFor(owner: ExecutionOwner): ApprovalRequester {
  let info: RequesterInfo | undefined
  try { info = lookup?.(owner) } catch { info = undefined }
  const agent = info?.agent ?? UNKNOWN_AGENT
  if (owner.kind === 'thread') {
    return { kind: 'agent', id: `thread:${owner.id}`, label: mainMessage('approvals.requester.conversation', { agent, conversation: owner.id.slice(0, 6) }) }
  }
  return { kind: 'agent', id: `pane:${owner.id}`, label: mainMessage('approvals.requester.pane', { agent, pane: info?.pane ?? 0 }) }
}

/** The owner behind an audit label (`pane:abc`, `thread:abc`), for callers that only carry the label. */
export function ownerFromLabel(label: string): ExecutionOwner | undefined {
  const match = /^(pane|thread):(.+)$/.exec(label)
  return match ? { kind: match[1] as ExecutionOwner['kind'], id: match[2] } : undefined
}

export const APP_REQUESTER: ApprovalRequester = { kind: 'app', id: 'oxespace', label: mainMessage('approvals.requester.app', {}) }
