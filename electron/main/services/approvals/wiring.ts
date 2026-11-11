/**
 * B10 + F7 · Startup wiring for approvals: the window's channels, the requester names, Always allow, What agents can do,
 * and agent notifications with the app's prefix. Kept out of index.ts so the entry file stays small.
 */
import { BrowserWindow, Notification } from 'electron'
import { messageKey, messageValues } from '../../../../shared/messages'
import type { ApprovalAlwaysAllowResult, ApprovalDatabasePreview, ApprovalRequester } from '../../../../shared/types/approvals'
import type { Workspace } from '../../../../shared/types/workspace'
import type { AppDatabase } from '../../db'
import { mainLanguage, tMain } from '../../i18n'
import { broadcastAgentPermissionsChanged, registerAgentPermissionsIpc } from '../../ipc/agent-permissions.ipc'
import { registerApprovalsIpc } from '../../ipc/approvals.ipc'
import { ThreadHistory } from '../conversation/thread-history'
import { productionHostsFor } from '../http-audit/production-hosts'
import type { AgentGateway } from '../oxequery/agent-gateway'
import { policyStore } from '../policy'
import {
  AgentPermissions,
  createSqliteDatabaseSource,
  createSqliteHostSource,
  policyRowsFromLoaded,
  setActiveAgentPermissions
} from './agent-permissions'
import { AlwaysAllow } from './always-allow'
import { noticeTitle } from './drafts'
import { approvalCenter } from './index'
import { paneInfo, providerName, setRequesterLookup } from './requester'

export function wireApprovals(sources: {
  db: AppDatabase
  workspaces: () => Workspace[]
  profiles: () => Array<{ agentProfileId: string; provider: string; parentProvider?: string | null }>
  oxeQuery?: () => AgentGateway | undefined
}): void {
  const alwaysAllow = new AlwaysAllow({
    db: sources.db,
    projectRoot: () => sources.workspaces()[0]?.rootPath ?? process.cwd()
  })
  const prodHosts = productionHostsFor({ db: sources.db, policy: policyStore() ?? undefined })
  const agentPermissions = new AgentPermissions({
    alwaysAllow,
    databases: createSqliteDatabaseSource(sources.db),
    hosts: createSqliteHostSource({
      db: sources.db,
      isProductionHost: prodHosts
    }),
    policy: workspaceId => {
      const workspace = workspaceId ? sources.workspaces().find(item => item.id === workspaceId) : undefined
      return policyRowsFromLoaded(policyStore()?.load(workspace?.rootPath) ?? null)
    },
    onChanged: broadcastAgentPermissionsChanged
  })
  setActiveAgentPermissions({
    permissions: agentPermissions,
    workspaceForRoot: (rootPath: string) => sources.workspaces().find(item => item.rootPath === rootPath)?.id
  })
  registerAgentPermissionsIpc(agentPermissions)

  const preview = async (requestId: string): Promise<ApprovalDatabasePreview> => {
    const gateway = sources.oxeQuery?.()
    if (!gateway) return { status: 'failed', count: null, reason: 'unavailable' }
    const centerReq = approvalCenter.list().find(item => item.id === requestId && item.kind === 'oxequery')
    if (centerReq) {
      const reference = centerReq.environment?.name ?? centerReq.target?.split(' · ')[0] ?? ''
      if (!reference) return { status: 'failed', count: null, reason: 'not-found' }
      return gateway.previewWrite(reference, centerReq.agentText.text)
    }
    const threadPending = new ThreadHistory(sources.db).pendingRequestRows(500).find(item => item.request.id === requestId)
    if (threadPending && threadPending.request.impact?.kind === 'db') {
      const reference = threadPending.request.impact.where
      const statement = threadPending.request.command ?? threadPending.request.detail ?? threadPending.request.impact.text
      if (!reference || !statement) return { status: 'failed', count: null, reason: 'not-found' }
      return gateway.previewWrite(reference, statement)
    }
    return { status: 'failed', count: null, reason: 'not-found' }
  }

  const applyAlwaysAllow = async (requestId: string): Promise<ApprovalAlwaysAllowResult> => {
    const threadPending = new ThreadHistory(sources.db).pendingRequestRows(500).find(item => item.request.id === requestId)
    if (!threadPending) return { ok: false, code: 'approvals.alwaysAllow.notOffered' }
    // Never a Claude rule for another provider: Antigravity has no rule OXESpace can save.
    if (threadPending.thread.provider === 'antigravity') return { ok: false, code: 'approvals.alwaysAllow.notOffered' }
    const provider = threadPending.thread.provider === 'codex' ? 'codex' : 'claude'
    const applied = alwaysAllow.apply(threadPending.request, provider, {
      threadId: threadPending.thread.id,
      projectRoot: threadPending.thread.rootPath
    })
    if (!applied.ok) return { ok: false, code: applied.code ?? 'approvals.alwaysAllow.notOffered' }
    broadcastAgentPermissionsChanged()
    return { ok: true, rule: applied.rule }
  }

  registerApprovalsIpc(approvalCenter, { preview, alwaysAllow: applyAlwaysAllow })
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
