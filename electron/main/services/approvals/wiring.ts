/**
 * B10 · Startup wiring for approvals: the window's channels, the requester names, and agent notifications with the
 * app's prefix. Kept out of index.ts so the entry file stays small.
 */
import { BrowserWindow, Notification } from 'electron'
import { messageKey, messageValues } from '../../../../shared/messages'
import type { ApprovalRequester } from '../../../../shared/types/approvals'
import type { Workspace } from '../../../../shared/types/workspace'
import type { AppDatabase } from '../../db'
import { mainLanguage, tMain } from '../../i18n'
import { registerApprovalsIpc } from '../../ipc/approvals.ipc'
import { approvalCenter } from './index'
import { noticeTitle } from './drafts'
import { paneInfo, providerName, setRequesterLookup } from './requester'

export function wireApprovals(sources: {
  db: AppDatabase
  workspaces: () => Workspace[]
  profiles: () => Array<{ agentProfileId: string; provider: string; parentProvider?: string | null }>
}): void {
  registerApprovalsIpc(approvalCenter)
  // Prepared on first use; requesterFor falls back to a neutral name if the lookup throws.
  let threadProvider: ReturnType<AppDatabase['prepare']> | undefined
  setRequesterLookup(owner => {
    if (owner.kind === 'thread') {
      threadProvider ??= sources.db.prepare("SELECT json_extract(data_json, '$.provider') AS provider FROM conversation_threads WHERE id = ?")
      return { agent: providerName((threadProvider.get(owner.id) as { provider?: string } | undefined)?.provider) }
    }
    return paneInfo(owner.id, sources.workspaces(), id => {
      const profile = sources.profiles().find(item => item.agentProfileId === id)
      return profile ? (profile.parentProvider ?? profile.provider) : undefined
    })
  })
}

/** An agent's desktop notification: the app names the sender in the title; the agent's words follow. */
export function showAgentNotice(requester: ApprovalRequester, title: string, body: string): boolean {
  if (!Notification.isSupported()) return false
  const prefixed = noticeTitle(requester, title)
  const notification = new Notification({ title: tMain(messageKey(prefixed.code) as never, messageValues(prefixed, mainLanguage())), body, silent: false })
  notification.on('click', () => { const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed()); if (window) { window.show(); window.focus() } })
  notification.show()
  return true
}
