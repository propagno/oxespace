import { afterEach, describe, expect, it, vi } from 'vitest'
import { detect, loadManifests, manifestFor, parseManifest, region, translateRegex } from '../electron/main/services/agent-state/manifest'
import { AgentStateService, agentFromCommand, type PaneAgentState } from '../electron/main/services/agent-state/agent-state.service'
import { PaneScreen } from '../electron/main/services/agent-state/screen'

const { manifests, warnings } = loadManifests('resources/agent-detection')
const claude = manifestFor(manifests, 'claude')!
const screen = (text: string, oscTitle = '', oscProgress = '') => ({ screen: text, oscTitle, oscProgress })

const PROMPT_BOX = ['─'.repeat(60), '❯ ', '─'.repeat(60), '  ? for shortcuts'].join('\n')

describe('herdr manifests', () => {
  it('all bundled manifests load with every rule', () => {
    expect(warnings).toEqual([])
    expect([...manifests.keys()].sort()).toEqual(['amp', 'claude', 'codex', 'copilot', 'cursor', 'droid', 'gemini', 'grok', 'kimi', 'opencode', 'qwen'])
    expect(manifestFor(manifests, 'claude-code')?.id).toBe('claude')
  })

  it('translates Rust regex syntax: inline flags, \\x{...}, \\A and \\z', () => {
    expect(translateRegex('(?i)^yes').test('YES')).toBe(true)
    expect(translateRegex('^\\x{2733} ').test('\u2733 Claude')).toBe(true)
    expect(translateRegex('end\\z').test('the end\n')).toBe(false)
    expect(translateRegex('end\\z').test('the end')).toBe(true)
    expect(translateRegex('\\A> x').test('a\n> x')).toBe(false)
    expect(translateRegex('a\\\\z').test('a\\z')).toBe(true)
  })

  it('reads Claude Code: working turn, permission prompt, idle prompt box, transcript viewer', () => {
    expect(detect(claude, screen(`Reading files\n\n✻ Thinking… (3s · esc to interrupt)\n\n${PROMPT_BOX}`)).state).toBe('working')
    const permission = [
      '─'.repeat(60), ' Bash command', '', '   npm test', '   Run the tests', '',
      ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and don\'t ask again for npm test commands', '   3. No, and tell Claude what to do differently (esc)', '', ' Esc to cancel · Tab to amend · ctrl+e to explain'
    ].join('\n')
    const blocked = detect(claude, screen(permission))
    expect(blocked).toMatchObject({ state: 'blocked', visibleBlocker: true })
    expect(detect(claude, screen(`Done.\n\n${PROMPT_BOX}`))).toMatchObject({ state: 'idle', visibleIdle: true, matchedRule: { id: 'live_prompt_box' } })
    expect(detect(claude, screen('Showing detailed transcript · ctrl+o to toggle')).skipStateUpdate).toBe(true)
    expect(detect(claude, screen('', '\u2810 Claude Code')).state).toBe('working')
  })

  it('falls back to idle for a known agent when nothing matches, and says so', () => {
    expect(detect(claude, screen('plain text'))).toMatchObject({ state: 'idle', matchedRule: null, fallbackReason: 'default_known_agent_idle_fallback' })
  })

  it('applies priority, not and line_regex like herdr', () => {
    const manifest = parseManifest(`id = "t"
[[rules]]
id = "low"
state = "idle"
priority = 1
contains = ["match"]
[[rules]]
id = "high"
state = "working"
priority = 10
contains = ["win"]
not = [{ contains = ["blocked"] }]
[[rules]]
id = "line"
state = "blocked"
priority = 5
line_regex = ['^exact line$']
`, 'bundled')
    expect(detect(manifest, screen('match win')).matchedRule?.id).toBe('high')
    expect(detect(manifest, screen('match win blocked')).matchedRule?.id).toBe('low')
    expect(detect(manifest, screen('before\nexact line\nafter')).matchedRule?.id).toBe('line')
  })

  it('cuts the screen into herdr regions', () => {
    const text = ['a', '', 'b', '─────', 'c', 'd']
    expect(region(screen(text.join('\n')), 'bottom_non_empty_lines(2)')).toBe('c\nd')
    expect(region(screen(text.join('\n')), 'after_last_horizontal_rule')).toBe('c\nd')
    expect(region(screen(['x', '────', 'body', '────', 'foot'].join('\n')), 'prompt_box_body')).toBe('body\n')
    expect(region(screen(['• done', '› next'].join('\n')), 'after_last_prompt_marker')).toBe('')
  })
})

describe('agent from command', () => {
  it('knows the agent executables, with paths, quotes and Windows extensions', () => {
    expect(agentFromCommand('claude --resume abc')).toBe('claude')
    expect(agentFromCommand('"C:\\Program Files\\nodejs\\codex.cmd" resume')).toBe('codex')
    expect(agentFromCommand('/usr/local/bin/cursor-agent')).toBe('cursor')
    expect(agentFromCommand('pwsh.exe')).toBeNull()
  })
})

describe('PaneScreen', () => {
  it('renders output and keeps the OSC title and progress', async () => {
    const pane = new PaneScreen(40, 6)
    await pane.write('hello\x1b[31m red\x1b[0m\r\nline two\x1b]0;\u2733 Claude Code\x07\x1b]9;4;0;\x07')
    expect(pane.read()).toEqual({ screen: 'hello red\nline two', oscTitle: '\u2733 Claude Code', oscProgress: '4;0;' })
    pane.dispose()
  })
})

describe('AgentStateService', () => {
  afterEach(() => { vi.useRealTimers() })

  function make() {
    const events: Array<PaneAgentState | { cleared: true }> = []
    const service = new AgentStateService({ manifests: () => manifests, emit: event => events.push(event) })
    return { service, events }
  }

  it('turns hooks into states, marks a finished turn as done until seen, and counts completions', () => {
    const { service } = make()
    service.start('p1', 'w1', 80, 24, 'pwsh')
    service.hook('p1', 'claude', 'working')
    expect(service.get('p1')).toMatchObject({ agent: 'claude', state: 'working', source: 'hook', completionSeq: 0 })
    service.hook('p1', 'claude', 'waiting')
    expect(service.get('p1')?.state).toBe('blocked')
    service.hook('p1', 'claude', 'working')
    service.hook('p1', 'claude', 'done')
    expect(service.get('p1')).toMatchObject({ state: 'done', seen: false, completionSeq: 1 })
    service.markSeen('p1')
    expect(service.get('p1')).toMatchObject({ state: 'idle', seen: true, completionSeq: 1 })
    service.hook('p1', 'claude', 'ended')
    expect(service.get('p1')).toBeNull()
  })

  it('does not count startup as a finished turn', () => {
    const { service } = make()
    service.start('p1', 'w1', 80, 24, 'claude')
    service.hook('p1', 'claude', 'done')
    expect(service.get('p1')).toMatchObject({ state: 'idle', completionSeq: 0 })
  })

  it('believes a permission prompt on screen over an older working hook', async () => {
    const { service } = make()
    service.start('p1', 'w1', 80, 24, 'claude')
    service.hook('p1', 'claude', 'working')
    service.output('p1', [' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'].join('\r\n'))
    const result = await service.waitFor('p1', ['blocked'], 2000)
    expect(result).toMatchObject({ timedOut: false, state: { state: 'blocked', source: 'screen' } })
  })

  it('times out a wait with the current state', async () => {
    const { service } = make()
    service.start('p1', 'w1', 80, 24, 'claude')
    service.hook('p1', 'claude', 'working')
    expect(await service.waitFor('p1', ['idle', 'done'], 50)).toMatchObject({ timedOut: true, state: { state: 'working' } })
  })

  it('ignores panes without a recognised agent', () => {
    const { service, events } = make()
    service.start('p1', 'w1', 80, 24, 'bash')
    service.output('p1', 'hello')
    expect(service.get('p1')).toBeNull()
    expect(events).toEqual([])
  })
})

describe('pane tone from the agent state', () => {
  it('prefers the main-process state over hooks and timing while the pane runs', async () => {
    const { deriveStatusTone } = await import('../src/utils/paneDisplay')
    const base = { status: 'running' as const, error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: 'working' as const, hookAt: Date.now() }
    expect(deriveStatusTone({ ...base, agentState: 'blocked' })).toBe('awaiting')
    expect(deriveStatusTone({ ...base, agentState: 'done' })).toBe('awaiting')
    expect(deriveStatusTone({ ...base, agentState: 'idle' })).toBe('idle')
    expect(deriveStatusTone({ ...base, agentState: 'working' })).toBe('thinking')
    expect(deriveStatusTone({ ...base, agentState: 'unknown' })).toBe('thinking')
    expect(deriveStatusTone({ ...base, status: 'exited', agentState: 'working' })).toBe('exited')
  })
})
