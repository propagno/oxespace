import { describe, expect, it } from 'vitest'
import en from '../shared/locales/en/main.json'
import ptBR from '../shared/locales/pt-BR/main.json'
import { isMainMessage, isMessageCode, mainMessage, MESSAGE_CODES, messageKey, messageValues, type MessageCode } from '../shared/messages'
import { ACTIVITY_REFUSALS } from '../shared/types/activity'
import { APPROVAL_REFUSALS } from '../shared/types/approvals'
import { THREAD_PENDING_REFUSALS } from '../shared/types/thread'
import { THREAD_SECTIONS_REFUSALS } from '../shared/types/thread-sections'
import { WORKSPACE_ROOT_REFUSALS } from '../shared/types/workspace'
import { ACTIVITY_PARAMETERS } from './messages-contract/activity'
import { AGENTS_PARAMETERS } from './messages-contract/agents'
import { APP_PARAMETERS } from './messages-contract/app'
import { APPROVALS_PARAMETERS } from './messages-contract/approvals'
import { DIAGNOSTICS_PARAMETERS } from './messages-contract/diagnostics'
import { GIT_PARAMETERS } from './messages-contract/git'
import { MCP_PARAMETERS } from './messages-contract/mcp'
import { OXEPOD_PARAMETERS } from './messages-contract/oxepod'
import { OXEPOST_PARAMETERS } from './messages-contract/oxepost'
import { OXEQUERY_PARAMETERS } from './messages-contract/oxequery'
import { REMOTE_PARAMETERS } from './messages-contract/remote'
import { THREAD_PARAMETERS } from './messages-contract/thread'
import { WORKSPACE_PARAMETERS } from './messages-contract/workspace'
import { ACTIVITY_MESSAGE_CODES } from '../shared/messages/activity'
import { AGENTS_MESSAGE_CODES } from '../shared/messages/agents'
import { APP_MESSAGE_CODES } from '../shared/messages/app'
import { APPROVALS_MESSAGE_CODES } from '../shared/messages/approvals'
import { DIAGNOSTICS_MESSAGE_CODES } from '../shared/messages/diagnostics'
import { GIT_MESSAGE_CODES } from '../shared/messages/git'
import { MCP_MESSAGE_CODES } from '../shared/messages/mcp'
import { OXEPOD_MESSAGE_CODES } from '../shared/messages/oxepod'
import { OXEPOST_MESSAGE_CODES } from '../shared/messages/oxepost'
import { OXEQUERY_MESSAGE_CODES } from '../shared/messages/oxequery'
import { REMOTE_MESSAGE_CODES } from '../shared/messages/remote'
import { THREAD_MESSAGE_CODES } from '../shared/messages/thread'
import { WORKSPACE_MESSAGE_CODES } from '../shared/messages/workspace'

const lookup = (catalog: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort()

/**
 * The parameter names each code carries, as the catalogs must interpolate them. One table per domain, in
 * tests/messages-contract/<domain>.ts (S0.1 part 2b): a new code edits its domain's table, not this file. What spans
 * domains stays here: every code in exactly one table, and the union equal to MESSAGE_CODES.
 */
/** Each domain's table with the codes its shared/messages file declares: a table holds exactly its own domain's codes. */
const DOMAINS: [string, Record<string, string[]>, readonly string[]][] = [['activity', ACTIVITY_PARAMETERS, ACTIVITY_MESSAGE_CODES], ['agents', AGENTS_PARAMETERS, AGENTS_MESSAGE_CODES], ['app', APP_PARAMETERS, APP_MESSAGE_CODES], ['approvals', APPROVALS_PARAMETERS, APPROVALS_MESSAGE_CODES], ['diagnostics', DIAGNOSTICS_PARAMETERS, DIAGNOSTICS_MESSAGE_CODES], ['git', GIT_PARAMETERS, GIT_MESSAGE_CODES], ['mcp', MCP_PARAMETERS, MCP_MESSAGE_CODES], ['oxepod', OXEPOD_PARAMETERS, OXEPOD_MESSAGE_CODES], ['oxepost', OXEPOST_PARAMETERS, OXEPOST_MESSAGE_CODES], ['oxequery', OXEQUERY_PARAMETERS, OXEQUERY_MESSAGE_CODES], ['remote', REMOTE_PARAMETERS, REMOTE_MESSAGE_CODES], ['thread', THREAD_PARAMETERS, THREAD_MESSAGE_CODES], ['workspace', WORKSPACE_PARAMETERS, WORKSPACE_MESSAGE_CODES]]
const DOMAIN_PARAMETERS = DOMAINS.map(([, table]) => table)
const PARAMETERS = Object.assign({}, ...DOMAIN_PARAMETERS) as Record<MessageCode, string[]>

describe('C3 message codes', () => {
  it('lists every code once', () => {
    // An object spread keeps the last of two equal keys without a word: a code in two tables would hide one of them.
    expect(DOMAIN_PARAMETERS.reduce((sum, table) => sum + Object.keys(table).length, 0)).toBe(Object.keys(PARAMETERS).length)
    expect(new Set(MESSAGE_CODES).size).toBe(MESSAGE_CODES.length)
    expect([...MESSAGE_CODES].sort()).toEqual(Object.keys(PARAMETERS).sort())
  })

  it('keeps each domain\'s parameters in its own table, next to its shared/messages file', () => {
    // tests/ is not type-checked, so the Record<keyof …> type of each table is enforced here.
    for (const [domain, table, codes] of DOMAINS) expect(Object.keys(table).sort(), domain).toEqual([...codes].sort())
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

  it('gives every refusal of an activity call its own code', () => {
    for (const refusal of ACTIVITY_REFUSALS) expect(isMessageCode(`activity.${refusal}`), refusal).toBe(true)
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
