import { describe, expect, it, vi } from 'vitest'
import { ClaudeConversationAdapter } from '../electron/main/services/conversation/claude-conversation'
import { describePermissionRequest } from '../electron/main/services/conversation/claude-permission-request'
import type { ThreadEvent } from '../shared/types/thread'

const PLAN = ['## Plan', '1. Add the index', '2. Backfill'].join('\n')

describe('describePermissionRequest', () => {
  it('uses the CLI-provided title and explains why it is asking', () => {
    const p = describePermissionRequest(
      { title: 'Claude wants to run a command', display_name: 'Bash', description: 'List files', decision_reason: 'No allow rule matched', blocked_path: 'C:\\outside\\x' },
      'Bash',
      { command: 'ls' }
    )
    expect(p.title).toBe('Claude wants to run a command')
    expect(p.detail).toContain('List files')
    expect(p.detail).toContain('Reason: No allow rule matched')
    expect(p.detail).toContain('C:\\outside\\x')
    // The command itself, as a person reads it: never the tool's JSON.
    expect(p.detail).toMatch(/^ls$/m)
    expect(p.detail).not.toContain('"command"')
  })

  it('falls back to the tool name and offers session scope only with suggestions', () => {
    const plain = describePermissionRequest({}, 'Edit', { file_path: 'a.ts' })
    expect(plain.title).toBe('Edit a.ts')
    expect(plain.decisions).toEqual(['accept', 'decline'])

    const scoped = describePermissionRequest(
      { permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git status:*' }], behavior: 'allow', destination: 'session' }, 'junk', null], tool_use_id: 'toolu_1' },
      'Bash',
      {}
    )
    expect(scoped.decisions).toEqual(['accept', 'acceptForSession', 'decline'])
    expect(scoped.suggestions).toHaveLength(1)
    expect(scoped.toolUseId).toBe('toolu_1')
  })

  it('says what the tool does in plain words: a command, a file change with its lines, an address', () => {
    const run = describePermissionRequest({}, 'PowerShell', { command: 'npm test', description: 'Run the tests' })
    expect(run.title).toBe('Run a command')
    expect(run.detail).toBe('npm test')

    const file = ['C:', 'repo', 'src', 'price.js'].join('\\')
    const edit = describePermissionRequest({}, 'Edit', { file_path: file, old_string: 'sum + item.price', new_string: 'sum + item.price * item.qty', replace_all: false })
    expect(edit.title).toBe('Edit price.js')
    expect(edit.detail.split('\n')).toEqual([file, '- sum + item.price', '+ sum + item.price * item.qty'])
    expect(edit.detail).not.toContain('{')

    const write = describePermissionRequest({}, 'Write', { file_path: 'notes/a.md', content: ['one', 'two'].join('\n') })
    expect(write.title).toBe('Write a.md')
    expect(write.detail.split('\n')).toEqual(['notes/a.md', '+ one', '+ two'])
    // B-2: a file that ends with a line break, as files do, has no empty "+" line after its last one. A blank line
    // inside the file, or a second line break at the end, is still a line.
    const ended = describePermissionRequest({}, 'Write', { file_path: 'notes/a.md', content: 'one\n\ntwo\n' })
    expect(ended.detail.split('\n')).toEqual(['notes/a.md', '+ one', '+ ', '+ two'])
    expect(describePermissionRequest({}, 'Write', { file_path: 'notes/a.md', content: 'one\n\n' }).detail.split('\n')).toEqual(['notes/a.md', '+ one', '+ '])

    expect(describePermissionRequest({}, 'WebFetch', { url: 'https://example.com/docs?x=1', prompt: 'Summarize' }).title).toBe('Open example.com')
    const other = describePermissionRequest({ display_name: 'Capabilities' }, 'mcp__oxespace__capabilities', { scope: 'workspace', limit: 5 })
    expect(other.title).toBe('Use Capabilities')
    expect(other.detail.split('\n')).toEqual(['scope: workspace', 'limit: 5'])
  })

  it('shows a plan as prose and never offers to remember the approval', () => {
    const p = describePermissionRequest(
      { permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits' }], tool_use_id: 'toolu_p' },
      'ExitPlanMode',
      { plan: PLAN }
    )
    expect(p.title).toBe('Aprovar o plano?')
    expect(p.detail).toBe(PLAN)
    expect(p.suggestions).toEqual([])
    expect(p.decisions).toEqual(['accept', 'decline'])
    expect(p.toolUseId).toBe('toolu_p')
  })

  it('strips control characters and bounds untrusted text', () => {
    const p = describePermissionRequest({ description: `ok\u0007${'x'.repeat(5000)}` }, 'Bash', {})
    expect(p.detail.includes('\u0007')).toBe(false)
    expect(p.detail.length).toBeLessThan(5000)
  })
})

function fixture() {
  const turns: { data: (chunk: Uint8Array) => void; close: () => void; writes: Array<Record<string, unknown>> }[] = []
  const adapter = new ClaudeConversationAdapter(() => {
    const turn = { data: (_c: Uint8Array) => {}, close: () => {}, writes: [] as Array<Record<string, unknown>> }
    turns.push(turn)
    return {
      write: (text: string) => {
        const message = JSON.parse(text) as Record<string, unknown>
        turn.writes.push(message)
        if (message.type === 'control_request' && message.request_id === 'initialize') {
          turn.data(Buffer.from(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize', response: { commands: [], models: [] } } }) + '\n'))
        }
      },
      onData: (cb: (c: Uint8Array) => void) => { turn.data = cb },
      onClose: (cb: () => void) => { turn.close = cb },
      close: vi.fn(async () => turn.close())
    }
  })
  const events: ThreadEvent[] = []
  return { adapter, turns, events, emit: (event: unknown) => turns[0].data(Buffer.from(JSON.stringify(event) + '\n')) }
}

describe('Claude approval scope', () => {
  const suggestion = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git status:*' }], behavior: 'allow', destination: 'session' }

  it('offers allow-for-session and returns the CLI rule unchanged', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/p', nativeSessionId: 'n' }, (e) => f.events.push(e))
    await f.adapter.send('Check status')
    f.emit({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'git status' }, permission_suggestions: [suggestion], tool_use_id: 'toolu_9' } })

    const request = f.events.find((e) => e.type === 'request')
    if (request?.type !== 'request') throw Error('expected a request')
    expect(request.request.availableDecisions).toEqual(['accept', 'acceptForSession', 'decline'])

    await f.adapter.respondRequest('r1', { decision: 'acceptForSession' })
    const response = f.turns[0].writes.at(-1) as { response: { response: Record<string, unknown> } }
    expect(response.response.response).toMatchObject({ behavior: 'allow', updatedPermissions: [suggestion], toolUseID: 'toolu_9' })
    await f.adapter.dispose()
  })

  it('a plain accept grants only this call', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/p', nativeSessionId: 'n' }, (e) => f.events.push(e))
    await f.adapter.send('Check status')
    f.emit({ type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'git status' }, permission_suggestions: [suggestion] } })
    await f.adapter.respondRequest('r2', { decision: 'accept' })
    const response = f.turns[0].writes.at(-1) as { response: { response: Record<string, unknown> } }
    expect(response.response.response.behavior).toBe('allow')
    expect(response.response.response).not.toHaveProperty('updatedPermissions')
    await f.adapter.dispose()
  })

  it('without suggestions only accept/decline are offered', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/p', nativeSessionId: 'n' }, (e) => f.events.push(e))
    await f.adapter.send('Edit')
    f.emit({ type: 'control_request', request_id: 'r3', request: { subtype: 'can_use_tool', tool_name: 'Edit', input: { file_path: 'a.ts' } } })
    const request = f.events.find((e) => e.type === 'request')
    if (request?.type !== 'request') throw Error('expected a request')
    expect(request.request.availableDecisions).toEqual(['accept', 'decline'])
    await f.adapter.dispose()
  })
})

describe('describePermissionRequest: rules the CLI states about remembering', () => {
  const suggestion = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git status:*' }], behavior: 'allow', destination: 'session' }

  it('never offers to remember when the CLI suppresses the always-allow row', () => {
    const p = describePermissionRequest({ permission_suggestions: [suggestion], suppress_always_allow_rule: true }, 'Bash', {})
    expect(p.decisions).toEqual(['accept', 'decline'])
    expect(p.suggestions).toEqual([])
  })

  it('does not offer to remember a safety check that needs a person', () => {
    for (const extra of [{ classifier_approvable: false }, { decision_reason_type: 'safetyCheck' }]) {
      const p = describePermissionRequest({ permission_suggestions: [suggestion], ...extra }, 'Bash', {})
      expect(p.decisions).toEqual(['accept', 'decline'])
    }
    // classifier_approvable true is not a reason to withhold it.
    expect(describePermissionRequest({ permission_suggestions: [suggestion], classifier_approvable: true }, 'Bash', {}).decisions).toContain('acceptForSession')
  })

  it('removes ANSI sequences from the reason, not just the escape byte', () => {
    const p = describePermissionRequest({ decision_reason: '\u001b[31mDangerous\u001b[0m rm \u001b]0;title\u0007here' }, 'Bash', {})
    expect(p.detail).toContain('Reason: Dangerous rm here')
    expect(p.detail).not.toMatch(/\[31m|\[0m|title/)
  })

  it('names the ask rule that forced the prompt', () => {
    const p = describePermissionRequest({ matched_ask_rule: { source: 'projectSettings', tool_name: 'Bash', rule_content: 'git push:*' } }, 'Bash', {})
    expect(p.detail).toContain('Confirmation rule: Bash (git push:*)')
  })
})
