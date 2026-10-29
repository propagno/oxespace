import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
// Loaded through the registry, as the app does: the handlers and the registry import each other.
import { TOOL_REGISTRY } from '../electron/main/mcp-internal/tool-registry'
import { THREAD_READ_ONLY_MCP_TOOLS, THREAD_TOOL_GROUPS } from '../electron/main/services/conversation/thread-mcp'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { FORBIDDEN_ARGUMENT, FORBIDDEN_CAPABILITIES, FORBIDDEN_NAME, MCP_COVERAGE, type McpCapability, type McpLevel } from '../shared/mcp-coverage'

vi.mock('../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

/** The actions of a domain tool as its description states them, with their level. */
function domainActions(description: string, schema: unknown): Array<[string, McpLevel]> {
  const listed = [...description.matchAll(/^- ([a-z_]+) \((read|write|confirm)\):/gm)].map(match => [match[1], match[2] as McpLevel] as [string, McpLevel])
  const enumerated = (schema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum ?? []
  return listed.length && listed.length === enumerated.length && listed.every(([key]) => enumerated.includes(key)) ? listed : []
}

/** Every tool, or every action of a domain tool, the server registers; the level when the tool states it. */
const registered = new Map<string, McpLevel | null>()
for (const { descriptor } of TOOL_REGISTRY) {
  const actions = domainActions(descriptor.description, descriptor.inputSchema)
  if (!actions.length) registered.set(descriptor.name, null)
  for (const [action, level] of actions) registered.set(`${descriptor.name}#${action}`, level)
}

const entries = Object.entries(MCP_COVERAGE) as Array<[string, McpCapability]>
const declared = new Map<string, { level: McpLevel; capability: string }>()
for (const [id, capability] of entries) {
  if (!('tools' in capability)) continue
  for (const [ref, level] of Object.entries(capability.tools)) {
    expect(declared.has(ref), `${ref} is declared twice`).toBe(false)
    declared.set(ref, { level, capability: id })
  }
}

const channels = Object.entries(IPC_CHANNELS).flatMap(([group, keys]) => Object.keys(keys).map(key => `${group}.${key}`))
const glob = (pattern: string) => new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
const claims = (capability: McpCapability) => (capability.ipc ?? []).map(glob)

describe('MCP coverage manifest', () => {
  it('names every registered tool and every domain action', () => {
    const missing = [...registered.keys()].filter(ref => !declared.has(ref))
    expect(missing, 'add these to shared/mcp-coverage.ts').toEqual([])
  })

  it('names only tools that exist, at the level they enforce', () => {
    expect([...declared.keys()].filter(ref => !registered.has(ref)), 'not registered').toEqual([])
    const wrong = [...declared].filter(([ref, { level }]) => registered.get(ref) !== null && registered.get(ref) !== level)
    expect(wrong.map(([ref, { level }]) => `${ref}: manifest ${level}, tool ${registered.get(ref)}`)).toEqual([])
  })

  it('gives every IPC channel of the app a capability', () => {
    const unclaimed = channels.filter(channel => !entries.some(([, capability]) => claims(capability).some(pattern => pattern.test(channel))))
    expect(unclaimed, 'map these channels in shared/mcp-coverage.ts').toEqual([])
    const stale = entries.flatMap(([id, capability]) => (capability.ipc ?? []).filter(pattern => !channels.some(channel => glob(pattern).test(channel))).map(pattern => `${id}: ${pattern}`))
    expect(stale, 'patterns that match no channel').toEqual([])
  })

  it('keeps every capability readable in the 1.4 coverage document', () => {
    const doc = readFileSync('docs/validation/mcp-coverage-1.4.md', 'utf8')
    expect(entries.map(([id]) => id).filter(id => !doc.includes(`\`${id}\``))).toEqual([])
  })
})

describe('forbidden capabilities', () => {
  it('stay forbidden: approvals and access, sign-in and tokens, secrets, MCP server trust', () => {
    for (const id of FORBIDDEN_CAPABILITIES) expect('forbidden' in (MCP_COVERAGE[id] ?? {}), id).toBe(true)
    for (const [id, capability] of entries) if ('forbidden' in capability) expect('tools' in capability, id).toBe(false)
  })

  it('are not reachable through a channel that a covered capability also claims', () => {
    const forbidden = entries.filter(([, capability]) => 'forbidden' in capability)
    const covered = entries.filter(([, capability]) => 'tools' in capability)
    const overlap = channels.filter(channel => channel !== 'oxeQuery.call'
      && forbidden.some(([, capability]) => claims(capability).some(pattern => pattern.test(channel)))
      && covered.some(([, capability]) => claims(capability).some(pattern => pattern.test(channel))))
    expect(overlap).toEqual([])
  })

  it('have no tool, action or argument', () => {
    expect([...registered.keys()].filter(ref => FORBIDDEN_NAME.test(ref.replace(/^oxespace_/, '')))).toEqual([])
    const argumentsSeen = TOOL_REGISTRY.flatMap(({ descriptor }) => Object.keys((descriptor.inputSchema as { properties?: object }).properties ?? {}).map(name => `${descriptor.name}.${name}`))
    expect(argumentsSeen.filter(name => FORBIDDEN_ARGUMENT.test(name.split('.')[1]))).toEqual([])
  })

  it('leave container resources to P7 and OxePost to H8', () => {
    expect(MCP_COVERAGE['containers.resources']).toMatchObject({ planned: 'P7' })
    expect(MCP_COVERAGE['oxepost.all']).toMatchObject({ planned: 'H8' })
    expect(TOOL_REGISTRY.map(entry => entry.descriptor.name).filter(name => /image|volume|compose|network|oxepost/.test(name))).toEqual([])
  })
})

describe('levels and tool groups', () => {
  it('lets a read-only Thread call only tools the manifest declares read', () => {
    const notRead = THREAD_READ_ONLY_MCP_TOOLS.flatMap(name => [...declared].filter(([ref]) => ref === name || ref.startsWith(`${name}#`)).filter(([, { level }]) => level !== 'read').map(([ref]) => ref))
    expect(notRead).toEqual([])
  })

  it('does not grow the core group every ordinary Thread pays for', () => {
    expect(THREAD_TOOL_GROUPS.core).toEqual(['oxespace_capabilities', 'oxespace_project_context', 'oxespace_memory_search', 'oxespace_memory_remember',
      'oxespace_semantic_search', 'oxespace_hybrid_explore', 'oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_node', 'oxespace_code_status'])
  })
})
