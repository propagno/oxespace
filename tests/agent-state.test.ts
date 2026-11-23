import { readdirSync } from 'node:fs'
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
    expect([...manifests.keys()].sort()).toEqual(['agy', 'amp', 'claude', 'codex', 'copilot', 'cursor', 'droid', 'gemini', 'grok', 'kimi', 'opencode', 'qwen'])
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
    expect(agentFromCommand('agy --workspace .')).toBe('antigravity')
    expect(agentFromCommand('"C:\\Users\\dev\\agy.cmd"')).toBe('antigravity')
    expect(agentFromCommand('/usr/local/bin/antigravity')).toBe('antigravity')
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

  // 152perf planner amendment (OXE-123, hooks first): a pane whose hooks answer has no screen, and its permission
  // prompt arrives as the PermissionRequest hook (waiting → blocked). The screen still wins on the fallback path, when
  // the agent's hooks stay silent.
  it('believes a permission prompt on screen when the hooks stay silent', async () => {
    vi.useFakeTimers()
    const { service } = make()
    service.start('p1', 'w1', 80, 24, 'claude')
    service.output('p1', 'starting')
    await vi.advanceTimersByTimeAsync(10_500)
    service.output('p1', [' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'].join('\r\n'))
    const wait = service.waitFor('p1', ['blocked'], 2000)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await wait).toMatchObject({ timedOut: false, state: { state: 'blocked', source: 'screen' } })
  })

  it('takes a permission prompt from the PermissionRequest hook when the hooks answer', () => {
    const { service } = make()
    service.start('p1', 'w1', 80, 24, 'claude')
    service.hook('p1', 'claude', 'working')
    service.hook('p1', 'claude', 'waiting')
    expect(service.get('p1')).toMatchObject({ state: 'blocked', source: 'hook' })
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
    expect(service.agentOf('p1')).toBeNull()
    expect(events).toEqual([])
  })

  it('tracks identified provider via agentOf for executables without a detection manifest (agy/antigravity)', () => {
    const { service } = make()
    service.start('p-agy', 'w1', 80, 24, 'agy')
    expect(service.agentOf('p-agy')).toBe('antigravity')
    expect(service.get('p-agy')).toBeNull()
    service.exit('p-agy')
    expect(service.agentOf('p-agy')).toBeNull()
  })
})

describe('pane tone from the agent state', () => {
  it('prefers the main-process state over hooks and timing while the pane runs', async () => {
    const { deriveStatusTone } = await import('../src/utils/paneDisplay')
    const base = { status: 'running' as const, error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: 'working' as const, hookAt: Date.now() }
    expect(deriveStatusTone({ ...base, agentState: 'blocked' })).toBe('needs-decision')
    expect(deriveStatusTone({ ...base, agentState: 'done' })).toBe('awaiting')
    expect(deriveStatusTone({ ...base, agentState: 'idle' })).toBe('idle')
    expect(deriveStatusTone({ ...base, agentState: 'working' })).toBe('thinking')
    expect(deriveStatusTone({ ...base, agentState: 'unknown' })).toBe('thinking')
    expect(deriveStatusTone({ ...base, status: 'exited', agentState: 'working' })).toBe('exited')
  })
})

// OXE-315: the Antigravity CLI (agy) had no screen manifest, so its panes were never working or blocked. The screens
// below follow the evidence in herdr's antigravity.toml (Antigravity CLI 1.1.28 through 1.2.17): dialogs end with a
// key-hint row right above the "esc to cancel" footer, a working turn draws that footer under the prompt box's bottom
// border or a braille spinner above the box, and the idle footer reads "? for shortcuts".
describe('Antigravity CLI screen detection (OXE-315)', () => {
  const rule = '─'.repeat(60)
  const lines = (...rows: string[]) => rows.join('\n')
  const promptBox = (footer: string) => lines(rule, '> ', rule, footer)
  const dialog = (...rows: string[]) => lines('Antigravity wants to run a command', '', ...rows, '  esc to cancel')

  it('antigravity manifest detects working, blocked and idle states accurately', async () => {
    const agy = manifestFor(manifests, 'antigravity')!
    expect(agy).toMatchObject({ id: 'agy', aliases: ['antigravity', 'antigravity-cli'] })
    expect(manifestFor(manifests, 'agy')).toBe(agy)

    const working = detect(agy, screen(lines('Reading the changed files', '', rule, '> ', rule, '  esc to cancel')))
    expect(working).toMatchObject({ state: 'working', visibleWorking: true, matchedRule: { id: 'esc_cancel_footer_working' } })
    expect(detect(agy, screen(lines('⠋ Planning the refactor', '', promptBox('  ? for shortcuts'))))).toMatchObject({ state: 'working', matchedRule: { id: 'spinner_working' } })

    const permission = detect(agy, screen(dialog('   npm test', '', '↑/↓ Navigate · tab Amend · ctrl+g edit/expand command')))
    expect(permission).toMatchObject({ state: 'blocked', visibleBlocker: true, matchedRule: { id: 'permission_prompt' } })
    expect(detect(agy, screen(dialog('   src/app.ts +3 -1', '', '↑/↓ Navigate · tab Amend · f full diff'))).matchedRule?.id).toBe('permission_prompt')
    expect(detect(agy, screen(dialog('Which test runner should I use?', '❯ Vitest', '  Jest', '', '↑/↓ Navigate · enter Select · esc Skip')))).toMatchObject({ state: 'blocked', matchedRule: { id: 'question_prompt' } })
    expect(detect(agy, screen(dialog('Do you trust the contents of this project?', '❯ Yes, I trust this folder', '  No, exit', '', '↑/↓ Navigate · enter Confirm')))).toMatchObject({ state: 'blocked', matchedRule: { id: 'trust_prompt' } })
    expect(detect(agy, screen(lines('Requesting permission for: rm -rf build', 'Do you want to proceed?', '❯ Yes', '  No')))).toMatchObject({ state: 'blocked', matchedRule: { id: 'legacy_permission_prompt' } })

    expect(detect(agy, screen(lines('Done. Updated 2 files.', '', promptBox('  ? for shortcuts'))))).toMatchObject({ state: 'idle', matchedRule: null, fallbackReason: 'default_known_agent_idle_fallback' })
    // The slash-command menu is a key-hint row too, but it waits for typing, not for a decision.
    expect(detect(agy, screen(lines('/help   Show help', '/model  Choose a model', '', '↑/↓ Navigate · enter Select · tab Complete', '  ? for shortcuts'))).state).toBe('idle')
    // RN-2: an answer that only talks about confirmations is not a dialog.
    const prose = 'Do you want to proceed? Navigate to Settings, press tab, amend the entry and skip the rest with esc.'
    expect(detect(agy, screen(lines(prose, '', promptBox('  ? for shortcuts')))).state).toBe('idle')

    // RN-1: an agy pane showing a dialog is blocked, the state oxespace_agents_change refuses to write to.
    vi.useFakeTimers()
    try {
      const service = new AgentStateService({ manifests: () => manifests, emit: () => undefined })
      service.start('p-agy', 'w1', 80, 24, 'agy')
      service.output('p-agy', dialog('   npm test', '', '↑/↓ Navigate · tab Amend · ctrl+g edit/expand command').split('\n').join('\r\n'))
      const wait = service.waitFor('p-agy', ['blocked'], 2000)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(await wait).toMatchObject({ timedOut: false, state: { agent: 'antigravity', state: 'blocked', source: 'screen' } })
      service.exit('p-agy')
    } finally {
      vi.useRealTimers()
    }
  })

  it('bundled manifests include valid antigravity.toml schema', async () => {
    const { BUNDLED_MANIFESTS } = await import('../electron/main/services/agent-state/bundled-manifests')
    const onDisk = readdirSync('resources/agent-detection').filter(file => file.endsWith('.toml')).sort()
    expect(onDisk).toContain('antigravity.toml')
    expect(BUNDLED_MANIFESTS.map(manifest => manifest.file).sort()).toEqual(onDisk)
    const bundled = loadManifests(BUNDLED_MANIFESTS)
    expect(bundled.warnings).toEqual([])
    const agy = manifestFor(bundled.manifests, 'antigravity')!
    expect(agy).toMatchObject({ id: 'agy', source: 'bundled', skipped: [] })
    expect(agy.rules.map(rule => [rule.id, rule.state])).toEqual([
      ['permission_prompt', 'blocked'], ['question_prompt', 'blocked'], ['trust_prompt', 'blocked'], ['legacy_permission_prompt', 'blocked'],
      ['esc_cancel_footer_working', 'working'], ['spinner_working', 'working']
    ])
  })
})
