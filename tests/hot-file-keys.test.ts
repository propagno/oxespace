import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MESSAGE_CODES } from '../shared/messages'
import before from './fixtures/hot-files/message-codes.before.json'
// @ts-expect-error plain ESM script without types; the test only calls messageShape(s).
import { messageShape, messageShapes } from '../scripts/hot-file-keys.mjs'

// S0.1 · A hot file split may move keys, never rename, drop or retype one. The fixture is the key set of origin/main
// before the split (scripts/hot-file-keys.mjs); later codes are additions, so the fixture never has to change.
const root = join(__dirname, '..')
type Shape = Record<string, Record<string, string>>

/**
 * The code prefixes each domain file owns (docs/factory/s0.1-hot-files.md §2). A prefix that is not the domain's own
 * name is the allowlist: it sits there on purpose. A new prefix is added here with its domain.
 */
const DOMAIN_PREFIXES: Record<string, readonly string[]> = {
  activity: ['activity'],
  agents: ['agents', 'notify', 'delegation'],
  app: ['app', 'oxe', 'memory'],
  approvals: ['approvals'],
  diagnostics: ['diagnostics', 'incident', 'bundle', 'ipc'],
  git: ['git', 'github', 'linear', 'worktree'],
  mcp: ['mcp'],
  oxepod: ['oxepod'],
  oxepost: ['oxepost'],
  oxequery: ['oxequery'],
  remote: ['remote'],
  thread: ['thread'],
  workspace: ['workspace', 'project']
}

const pascal = (name: string) => name[0].toUpperCase() + name.slice(1)
const domains = readdirSync(join(root, 'shared/messages')).filter(name => name.endsWith('.ts')).map(name => name.slice(0, -3)).sort()
const domainFile = (domain: string) => join(root, 'shared/messages', `${domain}.ts`)

describe('S0.1 · shared/messages split', () => {
  const after = messageShape(join(root, 'shared/messages.ts')) as Shape
  const interfaces = new Map(domains.map(domain => [domainFile(domain), `${pascal(domain)}MessageParams`]))
  const shapes = messageShapes([...interfaces.keys()], (file: string) => interfaces.get(file)) as Shape[]
  const byDomain = new Map(domains.map((domain, index) => [domain, shapes[index]]))

  it('keeps every code of before the split, with the same parameters', () => {
    const lost = Object.keys(before).filter(code => !(code in after))
    expect(lost).toEqual([])
    for (const [code, params] of Object.entries(before)) expect(after[code], code).toEqual(params)
  })

  it('lists at runtime exactly the codes the type declares, each once', () => {
    expect(new Set(MESSAGE_CODES).size).toBe(MESSAGE_CODES.length)
    expect([...MESSAGE_CODES].sort()).toEqual(Object.keys(after).sort())
  })

  it('declares each code in exactly one domain file, and nowhere else', () => {
    const owners = new Map<string, string[]>()
    for (const [domain, shape] of byDomain) for (const code of Object.keys(shape)) owners.set(code, [...(owners.get(code) ?? []), domain])
    expect([...owners].filter(([, files]) => files.length > 1)).toEqual([])
    // The barrel adds nothing of its own: its codes are exactly the union of the domains'.
    expect(Object.keys(after).sort()).toEqual([...owners.keys()].sort())
    const barrel = readFileSync(join(root, 'shared/messages.ts'), 'utf8')
    expect(barrel.match(/^\s+['"][\w.]+['"]\s*:/gm) ?? []).toEqual([])
  })

  it('keeps each code in the domain that owns its prefix', () => {
    expect(domains).toEqual(Object.keys(DOMAIN_PREFIXES).sort())
    const misplaced = [...byDomain].flatMap(([domain, shape]) => Object.keys(shape)
      .filter(code => !DOMAIN_PREFIXES[domain]?.includes(code.split('.')[0]))
      .map(code => `${code} in ${domain}.ts`))
    expect(misplaced).toEqual([])
  })

  it('merges every domain file in the barrel', () => {
    const barrel = readFileSync(join(root, 'shared/messages.ts'), 'utf8')
    for (const domain of domains) expect(barrel, domain).toContain(`from './messages/${domain}'`)
  })
})
