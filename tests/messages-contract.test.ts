import { describe, expect, it } from 'vitest'
import en from '../shared/locales/en/main.json'
import ptBR from '../shared/locales/pt-BR/main.json'
import { isMainMessage, isMessageCode, mainMessage, MESSAGE_CODES, messageKey, messageValues, type MessageCode } from '../shared/messages'
import { APPROVAL_REFUSALS } from '../shared/types/approvals'
import { THREAD_PENDING_REFUSALS } from '../shared/types/thread'
import { THREAD_SECTIONS_REFUSALS } from '../shared/types/thread-sections'
import { WORKSPACE_ROOT_REFUSALS } from '../shared/types/workspace'

const lookup = (catalog: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort()

/** The parameter names each code carries, as the catalog must interpolate them. */
const PARAMETERS: Record<MessageCode, string[]> = {
  'mcp.quarantine.changed': ['tools'],
  'mcp.quarantine.added': ['tools'],
  'mcp.quarantine.removed': ['tools'],
  'mcp.quarantine.configChanged': [],
  'thread.request.notPending': [],
  'thread.request.staleGeneration': [],
  'thread.request.alreadyResponding': [],
  'thread.request.unanswered': [],
  'thread.request.guardedDecision': [],
  'thread.protectedConfig.instructions': ['path'],
  'thread.protectedConfig.mcp': ['path'],
  'thread.protectedConfig.hooks': ['path'],
  'thread.protectedConfig.warning': [],
  'thread.protectedConfig.rewritesTracked': ['command'],
  'app.connectivity.offline': [],
  'ipc.sender.refused': [],
  'thread.side.unavailable': [],
  'thread.side.noSession': [],
  'thread.sections.invalid': [],
  'thread.sections.tooMany': ['assignments', 'sections'],
  'thread.sections.nameEmpty': [],
  'thread.sections.nameTooLong': ['max'],
  'thread.sections.nameHidden': [],
  'thread.sections.nameDuplicate': ['name'],
  'thread.sections.unknownWorkspace': [],
  'incident.window.crashed': [],
  'incident.window.rendererGone': [],
  'incident.ipc.handlerFailed': [],
  'incident.ipc.validationRejected': [],
  'incident.ipc.senderRefused': [],
  'incident.agent.startFailed': [],
  'incident.mcp.quarantined': [],
  'incident.database.busy': [],
  'incident.oxequery.timeout': [],
  'incident.oxequery.restartDeferred': [],
  'incident.updater.failed': [],
  'incident.interaction.overBudget': [],
  'incident.app.journalReset': [],
  'incident.app.closeUnanswered': [],
  'incident.app.closeRendererGone': [],
  'incident.app.closeGuardFailed': [],
  'incident.window.externalRefused': [],
  'incident.window.externalRateLimited': [],
  'incident.window.externalOpenFailed': [],
  'incident.window.openDenied': [],
  'incident.window.navigationDenied': [],
  'diagnostics.bundle.fileTooLarge': [],
  'diagnostics.bundle.tooLarge': [],
  'bundle.file.snapshot': [],
  'bundle.file.incidents': [],
  'bundle.file.logTail': [],
  'bundle.file.runtime': [],
  'bundle.file.versions': [],
  'bundle.file.configuration': [],
  'linear.worktree.exists': ['issue', 'path'],
  'worktree.cleanup.notRemovable': [],
  'worktree.cleanup.blocked': ['reasons'],
  'worktree.cleanup.needsConfirmation': ['reasons'],
  'mcp.signIn.waiting': [],
  'mcp.server.quarantined': [],
  'mcp.server.untrusted': [],
  'github.cli.missing': [],
  'git.base.unresolved': ['base'],
  'oxe.status.unreadable': [],
  'oxe.dashboard.timeout': [],
  'memory.disabled': [],
  'memory.unavailable': [],
  'memory.runtimeUnavailable': [],
  'thread.commands.configure': [],
  'thread.commands.busy': [],
  'thread.commands.claudeFailed': [],
  'thread.commands.codexFailed': [],
  'thread.capability.readOnly': [],
  'thread.capability.mcpReadOnly': [],
  'thread.observe.unsupported': [],
  'thread.observe.changed': [],
  'thread.queue.deliveryUnconfirmed': [],
  'oxequery.edit.readOnly': [],
  'oxequery.edit.notTable': [],
  'oxequery.edit.noKey': [],
  'oxequery.test.connected': [],
  'oxequery.startFailed': ['reason'],
  'oxequery.sql.copyProgram': [],
  'oxequery.sql.doBlock': [],
  'oxequery.sql.callProcedure': [],
  'oxequery.sql.destructiveInside': ['keyword', 'statement'],
  'oxequery.sql.rowLock': [],
  'oxequery.sql.sessionRole': [],
  'oxequery.sql.tableLock': [],
  'oxequery.session.busy': [],
  'oxequery.session.limit': ['limit'],
  'oxequery.session.agentTransaction': [],
  'oxequery.mongo.confirmName': [],
  'oxequery.mongo.confirm': [],
  'oxequery.mongo.production': [],
  'oxequery.mongo.deletes': [],
  'oxequery.sql.ambiguousEscape': [],
  'oxepod.startFailed': ['reason'],
  'oxepost.network.notFound': [],
  'oxepost.network.refused': [],
  'oxepost.network.reset': [],
  'oxepost.network.timedOut': [],
  'oxepost.network.lookupFailed': [],
  'oxepost.network.hostUnreachable': [],
  'oxepost.network.networkUnreachable': [],
  'oxepost.send.invalidUrl': [],
  'oxepost.send.scheme': [],
  'oxepost.send.bodyNotAllowed': ['method'],
  'oxepost.send.bodyTooLarge': [],
  'oxepost.send.invalidHeader': ['name'],
  'oxepost.send.timeout': ['seconds'],
  'oxepost.send.tls': ['code'],
  'oxepost.send.failed': [],
  'oxepost.send.failedWith': ['detail'],
  'remote.port.privileged': ['port'],
  'remote.port.inUse': ['port'],
  'remote.network.noPrivateInterface': [],
  'remote.certificate.failed': [],
  'workspace.root.empty': [],
  'workspace.root.notAbsolute': ['path'],
  'workspace.root.notFound': ['path'],
  'workspace.root.notDirectory': ['path'],
  'workspace.root.unreadable': ['path'],
  'approvals.title.agent': [],
  'approvals.title.oxequery': [],
  'approvals.title.previewAutomation': [],
  'approvals.title.crash': [],
  'approvals.summary.mcpConfirm': ['action', 'target', 'tool'],
  'approvals.summary.oxequery.read': [],
  'approvals.summary.oxequery.write': [],
  'approvals.summary.oxequery.action': [],
  'approvals.summary.preview.closeTab': [],
  'approvals.summary.preview.click': [],
  'approvals.summary.preview.fill': [],
  'approvals.summary.preview.navigate': [],
  'approvals.summary.preview.scroll': [],
  'approvals.summary.preview.other': ['action'],
  'approvals.summary.crash': [],
  'approvals.requester.pane': ['agent', 'pane'],
  'approvals.requester.conversation': ['agent', 'conversation'],
  'approvals.requester.unknownPane': ['pane'],
  'approvals.requester.unknownConversation': ['conversation'],
  'approvals.requester.mcpServer': ['server'],
  'approvals.requester.app': [],
  'approvals.requester.preview': [],
  'approvals.option.deny': [],
  'approvals.option.allowOnce': [],
  'approvals.option.allowSessionReads': [],
  'approvals.option.closeTab': [],
  'approvals.option.restart': [],
  'approvals.option.keepWorking': [],
  'approvals.note.sql.removes': ['statement'],
  'approvals.note.sql.noWhere': ['statement'],
  'approvals.note.sql.alterDrop': [],
  'approvals.note.sql.withNoWhere': ['statement'],
  'approvals.note.sql.explainAnalyze': [],
  'approvals.note.sql.selectInto': [],
  'approvals.note.sql.notReadOnly': ['statement'],
  'approvals.note.sql.outsideReach': ['calls'],
  'approvals.note.production': [],
  'approvals.note.mongo.deletes': ['count'],
  'approvals.note.mongo.changes': ['count'],
  'approvals.note.mongo.emptyFilter': [],
  'approvals.note.agent.actsOnPrompt': [],
  'approvals.note.agent.turnStopped': [],
  'approvals.note.thread.actsOnMessage': [],
  'approvals.note.skill.followed': [],
  'approvals.note.automation.runsAlone': [],
  'approvals.note.preview.notLocal': [],
  'approvals.note.worktree.folderDeleted': [],
  'approvals.note.worktree.forceDiscards': [],
  'approvals.note.git.branchShared': [],
  'approvals.note.checkpoint.replaces': [],
  'approvals.note.github.autoMerge': [],
  'approvals.note.github.releasePublic': [],
  'approvals.note.textCut': ['max'],
  'approvals.note.crash': [],
  'approvals.note.hiddenCharacters': [],
  'approvals.note.nativeCriticalDenyOnly': [],
  'approvals.notify.waiting': [],
  'approvals.unavailable': [],
  'approvals.expired': [],
  'approvals.refused.notPending': [],
  'approvals.refused.staleGeneration': [],
  'approvals.refused.alreadyAnswered': [],
  'approvals.refused.unknownOption': [],
  'approvals.refused.alreadyReported': [],
  'approvals.refused.tooSoon': [],
  'approvals.refused.notShown': [],
  'approvals.denied.queueFull': ['max'],
  'approvals.denied.timeout': [],
  'approvals.denied.cancelled': [],
  'approvals.denied.tooLong': ['max'],
  'notify.prefix.pane': ['agent', 'pane', 'title'],
  'notify.prefix.conversation': ['agent', 'conversation', 'title'],
  'notify.prefix.unknownPane': ['pane', 'title'],
  'notify.prefix.unknownConversation': ['conversation', 'title'],
  'notify.refused.reservedName': ['name'],
  'notify.refused.rateLimit': ['perMinute'],
  'agents.name.reserved': ['name']
}

describe('C3 message codes', () => {
  it('lists every code once', () => {
    expect(new Set(MESSAGE_CODES).size).toBe(MESSAGE_CODES.length)
    expect([...MESSAGE_CODES].sort()).toEqual(Object.keys(PARAMETERS).sort())
  })

  it.each([['en', en], ['pt-BR', ptBR]] as const)('has words for every code in %s, with the parameters it carries', (_language, catalog) => {
    for (const code of MESSAGE_CODES) {
      const text = lookup(catalog, messageKey(code))
      expect(typeof text, code).toBe('string')
      expect(placeholders(text as string), code).toEqual(PARAMETERS[code])
    }
  })

  it('keeps catalog keys under messages.* to codes that exist', () => {
    const leaves = (node: unknown, path: string[]): string[] => typeof node === 'string' ? [path.join('.')] : Object.entries(node as object).flatMap(([key, child]) => leaves(child, [...path, key]))
    for (const catalog of [en, ptBR]) expect(leaves(catalog.messages, []).filter(code => !isMessageCode(code))).toEqual([])
  })

  it('gives every refusal of a pending answer its own code', () => {
    for (const refusal of THREAD_PENDING_REFUSALS) expect(isMessageCode(`thread.request.${refusal}`), refusal).toBe(true)
  })

  it('gives every refusal of a sections save its own code', () => {
    for (const refusal of THREAD_SECTIONS_REFUSALS) expect(isMessageCode(`thread.sections.${refusal}`), refusal).toBe(true)
  })

  it('gives every refusal of a workspace root its own code', () => {
    for (const refusal of WORKSPACE_ROOT_REFUSALS) expect(isMessageCode(`workspace.root.${refusal}`), refusal).toBe(true)
  })

  it('gives every refusal of an approval answer its own code', () => {
    for (const refusal of APPROVAL_REFUSALS) expect(isMessageCode(`approvals.refused.${refusal}`), refusal).toBe(true)
  })

  it('accepts a code with parameters and rejects anything else', () => {
    expect(isMainMessage(mainMessage('mcp.quarantine.added', { tools: ['search'] }))).toBe(true)
    for (const value of [null, 'mcp.quarantine.added', { code: 'mcp.quarantine.added' }, { code: 'made.up', params: {} }, { code: 'app.connectivity.offline', params: [] }]) {
      expect(isMainMessage(value), JSON.stringify(value)).toBe(false)
    }
  })

  it('joins list parameters the way each language writes them', () => {
    const message = mainMessage('mcp.quarantine.changed', { tools: ['search', 'fetch', 'write'] })
    expect(messageValues(message, 'en')).toEqual({ tools: 'search, fetch, and write' })
    expect(messageValues(message, 'pt-BR')).toEqual({ tools: 'search, fetch e write' })
  })
})
