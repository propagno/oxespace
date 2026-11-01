import { envNamesProbeArgs, NODE_EXECUTABLE } from './helpers/node-child'
import { spawnSync } from 'node:child_process'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearWithheldForTests, inheritsVariable, looksSecret, noteWithheld, scrubEnvironment, withheldSummary } from '../shared/env-scrub'
import type { LoadedPolicy } from '../shared/policy'
import { inheritedEnvironment } from '../electron/main/services/policy'
import { PolicyStore } from '../electron/main/services/policy/policy-store'

const rules = (...r: LoadedPolicy['sources'][number]['rules']): LoadedPolicy => ({ sources: [{ layer: 'user', path: 'u', rules: r }], problems: [] })

describe('looksSecret', () => {
  it.each(['GITHUB_TOKEN', 'MY_API_KEY', 'DB_PASSWORD', 'CLIENT_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS',
    'NPM_CONFIG__AUTH', 'DATABASE_URL', 'APIKEY', 'SLACK_BOT_TOKEN', 'x_token', 'STRIPE_SECRET_KEY'])('flags %s', name => expect(looksSecret(name)).toBe(true))
  it.each(['PATH', 'HOME', 'USERPROFILE', 'KEYBOARD_LAYOUT', 'MONKEY_PATCH', 'GIT_AUTHOR_NAME', 'XDG_SESSION_TYPE', 'LANG', 'HTTPS_PROXY', 'SSH_AUTH_SOCK', 'TERM'])('passes %s', name =>
    expect(looksSecret(name)).toBe(false))
})

describe('scrubEnvironment', () => {
  const source: NodeJS.ProcessEnv = {
    PATH: '/bin', HOME: '/home/a', LANG: 'en',
    ANTHROPIC_API_KEY: 'a', CLAUDE_CODE_OAUTH_TOKEN: 'b', CLAUDE_CONFIG_DIR: '/c', AWS_ACCESS_KEY_ID: 'k', AWS_REGION: 'us-east-1',
    OPENAI_API_KEY: 'o', CODEX_HOME: '/x', CODEX_ACCESS_TOKEN: 't', GITHUB_TOKEN: 'g', DB_PASSWORD: 'p', NPM_TOKEN: 'n'
  }

  it('keeps Claude auth variables for a Claude launch and withholds the rest, names only', () => {
    const { env, withheld } = scrubEnvironment(source, { scope: 'claude' })
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/home/a', ANTHROPIC_API_KEY: 'a', CLAUDE_CODE_OAUTH_TOKEN: 'b', CLAUDE_CONFIG_DIR: '/c', AWS_ACCESS_KEY_ID: 'k', AWS_REGION: 'us-east-1' })
    expect(withheld).toEqual(['CODEX_ACCESS_TOKEN', 'CODEX_HOME', 'DB_PASSWORD', 'GITHUB_TOKEN', 'NPM_TOKEN', 'OPENAI_API_KEY'])
    expect(JSON.stringify(withheld)).not.toContain('"g"')
  })

  it('keeps Codex auth variables for a Codex launch and no Anthropic ones', () => {
    const { env, withheld } = scrubEnvironment(source, { scope: 'codex' })
    expect(env).toMatchObject({ OPENAI_API_KEY: 'o', CODEX_HOME: '/x', CODEX_ACCESS_TOKEN: 't', PATH: '/bin' })
    expect(Object.keys(env)).not.toContain('ANTHROPIC_API_KEY')
    expect(Object.keys(env)).not.toContain('GITHUB_TOKEN')
    expect(withheld).toContain('AWS_ACCESS_KEY_ID')
    expect(withheld).toContain('CLAUDE_CODE_OAUTH_TOKEN')
  })

  it('gives hooks and MCP servers no provider credentials at all', () => {
    for (const scope of ['hook', 'mcp'] as const) {
      const { env } = scrubEnvironment(source, { scope })
      expect(Object.keys(env).sort()).toEqual(['AWS_REGION', 'CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH'])
    }
  })

  it('lets a policy allow opt a variable in, and a deny withhold a harmless or provider one', () => {
    const optIn = rules({ effect: 'allow', action: 'integration.use', resource: 'env:GITHUB_TOKEN' })
    expect(scrubEnvironment(source, { scope: 'hook', policy: optIn }).env.GITHUB_TOKEN).toBe('g')
    expect(scrubEnvironment(source, { scope: 'hook', policy: optIn }).env.NPM_TOKEN).toBeUndefined()
    const deny = rules({ effect: 'deny', action: 'integration.use', resource: 'env:LANG' }, { effect: 'deny', action: 'integration.use', resource: 'env:ANTHROPIC_*' })
    const result = scrubEnvironment(source, { scope: 'claude', policy: deny })
    expect(result.withheld).toEqual(expect.arrayContaining(['LANG', 'ANTHROPIC_API_KEY']))
    expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('b')
  })

  it('does not mutate the source and ignores other policy resources', () => {
    const snapshot = { ...source }
    const other = rules({ effect: 'deny', action: 'integration.use', resource: 'mcp:*' })
    expect(inheritsVariable('PATH', 'claude', other)).toBe(true)
    scrubEnvironment(source, { scope: 'claude' })
    expect(source).toEqual(snapshot)
  })

  it('remembers withheld names per scope for diagnostics', () => {
    clearWithheldForTests()
    noteWithheld('hook', ['A_TOKEN'])
    expect(withheldSummary()).toEqual([{ scope: 'hook', names: ['A_TOKEN'] }])
  })
})

describe('a spawned child', () => {
  beforeEach(() => clearWithheldForTests())
  // Only the names this test is about, through the system node under Electron (tests/helpers/node-child.ts).
  const PROBED = ['PATH', 'SystemRoot', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MY_SECRET']
  const probe = (env: NodeJS.ProcessEnv): string[] => JSON.parse(spawnSync(NODE_EXECUTABLE, envNamesProbeArgs(PROBED), { env, encoding: 'utf8' }).stdout)

  it('does not see a withheld variable but sees the provider ones', () => {
    const source = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, GITHUB_TOKEN: 'x', ANTHROPIC_API_KEY: 'y', OPENAI_API_KEY: 'z', MY_SECRET: 's' }
    const store = new PolicyStore({ userData: '/nonexistent-userdata', managed: '/nonexistent-managed.json' })
    const claude = probe(inheritedEnvironment('claude', null, source, store))
    expect(claude).toContain('ANTHROPIC_API_KEY')
    for (const name of ['GITHUB_TOKEN', 'OPENAI_API_KEY', 'MY_SECRET']) expect(claude).not.toContain(name)
    const codex = probe(inheritedEnvironment('codex', null, source, store))
    expect(codex).toContain('OPENAI_API_KEY')
    expect(codex).not.toContain('ANTHROPIC_API_KEY')
    expect(withheldSummary().find(item => item.scope === 'codex')?.names).toEqual(['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'MY_SECRET'])
  })
})
