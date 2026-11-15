import type { InternalMcpWebPreviewEvent } from '../../shared/types/mcp-internal'
import type { ApprovalRequest } from '../../shared/types/approvals'
import type { AppView } from '../keyboard/keybindings'
import { useUIStore } from '../store/ui.store'
import { useThreadWorkbenchStore } from '../store/thread-workbench.store'

/** What the window lends the facade: the view on screen, the active workspace and the ways to change them. */
export interface AgentPreviewApp {
  view: AppView
  activeWorkspaceId: string | null
  showCode(): void
  activateWorkspace(id: string): void
}

/** Whose agent a Browser serves: a conversation, or the panes of a workspace. */
export interface PreviewOwner { threadId?: string; paneIds: readonly string[] }

export const PREVIEW_TOOL = 'oxespace_open_web_preview'

/**
 * An agent asked for the Web Preview (OXE-109). A conversation's Browser opens in its tool area; a workspace's Browser
 * opens with OxeCode and that workspace in front. A page main already let through (local, or allowed) is handed to the
 * panel to load; an event with `permission: 'ask'` only opens the panel on the approval record, nothing loads before
 * the OK. Holds no state of its own.
 */
export function openAgentPreview(event: InternalMcpWebPreviewEvent, app: AgentPreviewApp): void {
  const ui = useUIStore.getState()
  const asks = event.permission === 'ask'
  if (event.threadId) {
    if (!asks) ui.setPendingWebPreview(`thread:${event.threadId}`, event.url)
    useThreadWorkbenchStore.getState().setView(event.threadId, { panel: 'preview' })
    return
  }
  if (app.view !== 'code') app.showCode()
  if (app.activeWorkspaceId !== event.workspaceId) app.activateWorkspace(event.workspaceId)
  if (!asks) ui.setPendingWebPreview(event.workspaceId, event.url)
  ui.openWebPreview(event.workspaceId)
}

function isPreviewRecord(request: ApprovalRequest): boolean {
  const summary = request.summary as unknown as { code?: string; params?: Record<string, unknown> } | undefined
  return summary?.code === 'approvals.summary.mcpConfirm' && summary.params?.tool === PREVIEW_TOOL
}

/** The pending approval center record of open_web_preview raised by this owner's agent, or null. */
export function previewApprovalFor(owner: PreviewOwner, queue: readonly ApprovalRequest[]): ApprovalRequest | null {
  const ids = new Set(owner.paneIds.map(id => `pane:${id}`))
  if (owner.threadId) ids.add(`thread:${owner.threadId}`)
  return queue.find(request => request.requester?.kind === 'agent' && ids.has(request.requester.id) && isPreviewRecord(request)) ?? null
}
