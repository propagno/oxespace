import { describe, expect, it } from 'vitest'
import en from '../shared/locales/en/main.json'
import ptBR from '../shared/locales/pt-BR/main.json'
import { isMainMessage, isMessageCode, mainMessage, MESSAGE_CODES, messageKey, messageValues, type MessageCode } from '../shared/messages'
import { THREAD_PENDING_REFUSALS } from '../shared/types/thread'

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
  'app.connectivity.offline': [],
  'incident.window.crashed': [],
  'incident.window.rendererGone': [],
  'incident.ipc.handlerFailed': [],
  'incident.ipc.validationRejected': [],
  'incident.agent.startFailed': [],
  'incident.mcp.quarantined': [],
  'incident.database.busy': [],
  'incident.oxequery.timeout': [],
  'incident.updater.failed': [],
  'incident.interaction.overBudget': [],
  'incident.app.journalReset': [],
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
  'remote.certificate.failed': []
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
