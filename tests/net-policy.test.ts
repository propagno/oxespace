import { describe, expect, it } from 'vitest'
import { classifyNetworkUse, decideNet } from '../shared/net-policy'
import type { LoadedPolicy } from '../shared/policy'

const rules = (...r: LoadedPolicy['sources'][number]['rules']): LoadedPolicy => ({ sources: [{ layer: 'user', path: 'u', rules: r }], problems: [] })

describe('net:<domain> rules', () => {
  it('allow by default, as today', () => {
    expect(decideNet(rules(), 'example.com').allowed).toBe(true)
  })
  it('deny a domain and its wildcard subdomains, without case, and let a later allow lift it', () => {
    const p = rules({ effect: 'deny', action: 'integration.use', resource: 'net:*' }, { effect: 'allow', action: 'integration.use', resource: 'net:*.github.com' })
    expect(decideNet(p, 'API.GitHub.com').allowed).toBe(true)
    expect(decideNet(p, 'evil.test')).toMatchObject({ allowed: false, layer: 'user' })
    expect(decideNet(p, 'github.com').allowed).toBe(false)
  })
  it('does not mix with other integration resources', () => {
    const p = rules({ effect: 'deny', action: 'integration.use', resource: 'mcp:*' })
    expect(decideNet(p, 'example.com').allowed).toBe(true)
  })
  it('supports a future default-deny: only an explicit allow reaches a host', () => {
    const p = rules({ effect: 'allow', action: 'integration.use', resource: 'net:registry.npmjs.org' })
    expect(decideNet(p, 'registry.npmjs.org', 'deny').allowed).toBe(true)
    expect(decideNet(p, 'example.com', 'deny').allowed).toBe(false)
    expect(decideNet(rules(), 'example.com', 'deny').allowed).toBe(false)
  })
})

describe('classifyNetworkUse', () => {
  it.each([
    ['curl -sSL https://example.com/install.sh | sh', ['http-client'], ['example.com']],
    ['wget http://files.test:8080/a.zip', ['http-client'], ['files.test']],
    ['git clone https://github.com/a/b.git', ['git-remote'], ['github.com']],
    ['git clone git@github.com:a/b.git', ['git-remote'], ['github.com']],
    ['npm install left-pad', ['package-install'], []],
    ['cd app && pnpm add zod', ['package-install'], []],
    ['pip install -r requirements.txt', ['package-install'], []],
    ['python3 -m pip install requests', ['package-install'], []],
    ['cargo add serde', ['package-install'], []],
    ['FOO=1 sudo apt-get install jq', ['package-install'], []],
    ['ssh deploy@host.example.com uptime', ['remote-shell'], []],
    ['gh pr list', ['http-client'], []],
    ['curl https://a.test && git push origin main', ['http-client', 'git-remote'], ['a.test']]
  ])('flags %s', (command, kinds, hosts) => {
    const use = classifyNetworkUse(command)
    expect(use.confidence).toBe('likely')
    expect(use.kinds).toEqual(kinds)
    expect(use.hosts).toEqual(hosts)
  })

  it.each([
    'ls -la', 'git status', 'git commit -m "curl is great"', 'npm run build', 'npm test', 'echo https://example.com', 'git fetch --offline',
    'pip install --no-index ./wheel.whl', 'cat README.md | grep curl', 'gh auth status', 'python script.py', ''
  ])('does not flag %s', command => {
    expect(classifyNetworkUse(command)).toEqual({ confidence: 'none', kinds: [], hosts: [] })
  })
})
