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
