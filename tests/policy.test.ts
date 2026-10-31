import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluatePolicy, matchesResource, parsePolicy, policyBlockedMessage, type LoadedPolicy } from '../shared/policy'
import { managedPolicyPath, PolicyStore } from '../electron/main/services/policy/policy-store'
import { mcpServerAllowed, policyDeniedMcpNames } from '../electron/main/services/policy'

const policy = (...sources: LoadedPolicy['sources']): LoadedPolicy => ({ sources, problems: [] })

describe('policy rules', () => {
  it('match resources by name with * wildcards, without case', () => {
    expect(matchesResource('mcp:github', 'mcp:GitHub')).toBe(true)
    expect(matchesResource('mcp:*', 'mcp:anything')).toBe(true)
    expect(matchesResource('mcp:git*', 'mcp:gitlab')).toBe(true)
    expect(matchesResource('mcp:git*', 'mcp:mygit')).toBe(false)
    expect(matchesResource('db:prod.*', 'db:prodXcustomers')).toBe(false)
    expect(matchesResource('db:prod.*', 'db:prod.customers')).toBe(true)
  })

  it('allow everything with no matching rule, and let the last match decide', () => {
    expect(evaluatePolicy(policy(), 'integration.use', 'mcp:github').allowed).toBe(true)
    const p = policy({ layer: 'user', path: 'u', rules: [
      { effect: 'deny', action: 'integration.use', resource: 'mcp:*' },
      { effect: 'allow', action: 'integration.use', resource: 'mcp:github' }
    ] })
    expect(evaluatePolicy(p, 'integration.use', 'mcp:github').allowed).toBe(true)
    expect(evaluatePolicy(p, 'integration.use', 'mcp:slack')).toMatchObject({ allowed: false, layer: 'user' })
    // Another action is not touched.
    expect(evaluatePolicy(p, 'provider.use', 'claude').allowed).toBe(true)
  })

  it('give the managed layer the final word, whatever the order the sources come in', () => {
    const managed = { layer: 'managed' as const, path: 'm', organization: 'Acme', rules: [{ effect: 'deny' as const, action: 'integration.use' as const, resource: 'mcp:github' }] }
    const project = { layer: 'project' as const, path: 'p', rules: [{ effect: 'allow' as const, action: 'integration.use' as const, resource: 'mcp:github' }] }
    const decision = evaluatePolicy(policy(managed, project), 'integration.use', 'mcp:github')
    expect(decision).toMatchObject({ allowed: false, layer: 'managed', organization: 'Acme' })
    expect(policyBlockedMessage(decision, 'The MCP server "github"')).toBe('The MCP server "github" is blocked by Acme policy.')
  })

  it('refuse a file that is not a valid policy as a whole', () => {
    expect(parsePolicy('{', 'user', 'u')).toEqual({ problem: 'u: not valid JSON' })
    expect(parsePolicy('{"rules": {}}', 'user', 'u')).toEqual({ problem: 'u: "rules" must be a list' })
    expect(parsePolicy('{"rules": [{"effect": "deny", "action": "integration.use", "resource": "mcp:a"}, {"effect": "block", "action": "x"}]}', 'user', 'u'))
      .toEqual({ problem: 'u: rule 2 needs "effect": "allow" or "deny"' })
    expect(parsePolicy('{"organization": " Acme ", "rules": [{"effect": "deny", "action": "provider.use", "resource": " codex "}]}', 'managed', 'm'))
      .toEqual({ source: { layer: 'managed', path: 'm', organization: 'Acme', rules: [{ effect: 'deny', action: 'provider.use', resource: 'codex' }] } })
  })
})

describe('policy files', () => {
  const dirs: string[] = []
  const dir = () => { const value = mkdtempSync(join(tmpdir(), 'oxe-policy-')); dirs.push(value); return value }
  afterEach(() => { for (const value of dirs.splice(0)) rmSync(value, { recursive: true, force: true }) })

  it('read the project, user and managed layers, and an edit applies without a restart', () => {
    const userData = dir(), project = dir(), managedDir = dir()
    const managed = join(managedDir, 'policy.json')
    mkdirSync(join(project, '.oxespace'))
    writeFileSync(join(project, '.oxespace', 'policy.json'), JSON.stringify({ rules: [{ effect: 'deny', action: 'integration.use', resource: 'mcp:slack' }] }))
    writeFileSync(join(userData, 'policy.json'), '{ not json')
    const store = new PolicyStore({ userData, managed })
    const loaded = store.load(project)
    expect(loaded.sources.map(source => source.layer)).toEqual(['project'])
    expect(loaded.problems).toEqual([`${join(userData, 'policy.json')}: not valid JSON`])
    expect(store.decide('integration.use', 'mcp:slack', project).allowed).toBe(false)
    // Without a project only the user and managed layers apply.
    expect(store.decide('integration.use', 'mcp:slack').allowed).toBe(true)

    writeFileSync(managed, JSON.stringify({ organization: 'Acme', rules: [{ effect: 'deny', action: 'integration.use', resource: 'mcp:*' }] }))
    expect(store.decide('integration.use', 'mcp:github', project)).toMatchObject({ allowed: false, layer: 'managed' })
    writeFileSync(managed, JSON.stringify({ rules: [] }))
    utimesSync(managed, new Date(), new Date(Date.now() + 5000))
    expect(store.decide('integration.use', 'mcp:github', project).allowed).toBe(true)

    expect(mcpServerAllowed('slack', project, store)).toBe(false)
    expect(mcpServerAllowed('github', project, store)).toBe(true)
    expect(policyDeniedMcpNames(project, store)).toEqual(['slack'])
  })

  it('look for the managed file where each system keeps machine-wide settings', () => {
    expect(managedPolicyPath('win32', { ProgramData: 'D:\\PD' })).toBe(join('D:\\PD', 'OXESpace', 'policy.json'))
    expect(managedPolicyPath('linux', {})).toBe('/etc/oxespace/policy.json')
    expect(managedPolicyPath('darwin', {})).toBe('/Library/Application Support/OXESpace/policy.json')
  })
})

describe('policy at the decision points', () => {
  const dirs: string[] = []
  afterEach(async () => {
    const { setPolicyStore } = await import('../electron/main/services/policy')
    setPolicyStore(null)
    for (const value of dirs.splice(0)) rmSync(value, { recursive: true, force: true })
  })
  const withPolicy = async (rules: unknown[]) => {
    const userData = mkdtempSync(join(tmpdir(), 'oxe-policy-points-')); dirs.push(userData)
    writeFileSync(join(userData, 'policy.json'), JSON.stringify({ organization: 'Acme', rules }))
    const { setPolicyStore } = await import('../electron/main/services/policy')
    const store = new PolicyStore({ userData, managed: join(userData, 'none.json') })
    setPolicyStore(store)
    return store
  }

  it('declines a tool the policy blocks, even with full access, and names who blocked it', async () => {
    await withPolicy([{ effect: 'deny', action: 'tool.use', resource: 'Bash' }])
    const { ThreadPolicy } = await import('../electron/main/services/conversation/thread-policy')
    const policy = new ThreadPolicy({ evaluate: () => undefined } as never, () => '/repo', async () => undefined)
    const bash = policy.evaluate('/repo', { id: 'r', kind: 'approval', toolName: 'Bash', title: 'Run', generation: 1 } as never, 'full-access')
    expect(bash).toEqual({ decision: 'deny', reasons: ['Bash is blocked by Acme policy.'] })
    const edit = policy.evaluate('/repo', { id: 'r', kind: 'approval', toolName: 'Edit', title: 'Edit', generation: 1 } as never, 'full-access')
    expect(edit?.decision).toBe('allow')
  })

  it('hides tools denied by name from Claude, next to the MCP exclusions', async () => {
    const { threadMcpArguments } = await import('../electron/main/services/conversation/thread-mcp')
    const args = threadMcpArguments('claude', [], '/bridge.cjs', undefined, [{ server: 'slack', tool: '*' }], undefined, ['Bash', 'WebFetch'])
    expect(args.slice(args.indexOf('--disallowedTools'), args.indexOf('--disallowedTools') + 2)).toEqual(['--disallowedTools', 'mcp__slack,Bash,WebFetch'])
    expect(threadMcpArguments('claude', [], '/bridge.cjs').includes('--disallowedTools')).toBe(false)
  })

  it('refuses to start an agent the policy blocks', async () => {
    const store = await withPolicy([{ effect: 'deny', action: 'provider.use', resource: 'codex' }, { effect: 'deny', action: 'tool.use', resource: 'WebFetch' }])
    const { assertProviderAllowed, policyDeniedToolNames } = await import('../electron/main/services/policy')
    expect(() => assertProviderAllowed('codex', '/repo', store)).toThrow('Codex is blocked by Acme policy.')
    expect(() => assertProviderAllowed('claude', '/repo', store)).not.toThrow()
    expect(policyDeniedToolNames('/repo', store)).toEqual(['WebFetch'])
  })
})
