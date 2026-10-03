import { describe, expect, it, vi } from 'vitest'
import { CodexConversationAdapter, type ConversationTransport } from '../electron/main/services/conversation/codex-conversation'
import type { ThreadEvent } from '../shared/types/thread'

function fixture(usageResult: unknown = {}, usageError = false, mcpResult: unknown = {}) {
  let receive: (chunk: Uint8Array) => void = () => {}
  let closeListener: () => void = () => {}
  const requests: Record<string, unknown>[] = []
  const transport: ConversationTransport = {
    write: line => {
      const message = JSON.parse(line)
      requests.push(message)
      if (!message.method || message.id === undefined) return
      const result = message.method === 'thread/start' || message.method === 'thread/resume'
        ? { thread: { id: 'native-A' } }
        : message.method === 'turn/start' || message.method === 'review/start' || message.method === 'thread/queue/start' ? { turn: { id: 'turn-A' } }
          : message.method === 'thread/queue/add' ? { queuedSubmission: { id: 'queued-A', clientUserMessageId: message.params.clientUserMessageId, input: message.params.input } }
          : message.method === 'mcpServerStatus/list' ? mcpResult
          : message.method === 'mcpServer/oauth/login' ? { authorizationUrl: 'https://provider.example/authorize?state=test' }
          : message.method === 'app/read' ? { data: [{ id: message.params.appIds[0], name: 'Example app', tools: [{ name: 'search' }] }] }
          : message.method === 'model/list' ? { data: [{ id: 'native-model', model: 'native-model', displayName: 'Native model', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] } : {}
      queueMicrotask(() => receive(Buffer.from(JSON.stringify(message.method === 'account/rateLimits/read'
        ? usageError ? { id: message.id, error: { code: 1, message: 'Usage unavailable' } } : { id: message.id, result: usageResult }
        : { id: message.id, result }) + '\n')))
    },
    onData: listener => { receive = listener },
    onClose: listener => { closeListener = listener },
    close: vi.fn(async () => {})
  }
  const adapter = new CodexConversationAdapter(transport)
  const events: ThreadEvent[] = []
  return { adapter, transport, requests, events, emit: (message: unknown) => receive(Buffer.from(JSON.stringify(message) + '\n')), emitClose: () => closeListener() }
}

describe('Codex conversation adapter', () => {
  it('marks the adapter closed when its app-server exits during a turn', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Continue')
    f.emitClose()
    expect(f.adapter.closed).toBe(true)
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'completed', status: 'failed' }))
  })
  it('ends a silent turn and closes its dead connection so a retry can reconnect', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: 'native-existing' }, event => f.events.push(event))
    vi.useFakeTimers()
    try {
      await f.adapter.send('Continue')
      await vi.advanceTimersByTimeAsync(125_000)
      expect(f.events).toContainEqual(expect.objectContaining({ type: 'completed', status: 'failed', errorCode: 'network' }))
      expect(f.transport.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      await f.adapter.dispose()
    }
  })
  it('resumes long native sessions without asking the app server for every turn', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: 'native-existing' }, event => f.events.push(event))
    expect(f.requests).toContainEqual(expect.objectContaining({ method: 'thread/resume', params: expect.objectContaining({ threadId: 'native-existing', excludeTurns: true }) }))
    await f.adapter.dispose()
  })
  it('accepts a large native command frame while retaining only bounded output', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Check the release')
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', turnId: 'turn-A', item: {
      id: 'large-command', type: 'commandExecution', status: 'completed', command: 'release check', aggregatedOutput: 'x'.repeat(11 * 1024 * 1024)
    } } })
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { id: 'turn-A', status: 'completed' } } })
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'tool', id: 'large-command', state: 'completed', output: 'x'.repeat(65_536) }))
    expect(f.events.at(-1)).toMatchObject({ type: 'completed', status: 'completed' })
    await f.adapter.dispose()
  })
  it('streams scoped provider summaries as activity without showing raw reasoning', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Inspect the project')
    f.emit({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 'other', turnId: 'turn-A', itemId: 'reason', delta: 'Private other thread' } })
    expect(f.events.some(event => event.type === 'activity' && event.summary?.includes('Private'))).toBe(false)
    f.emit({ method: 'item/started', params: { threadId: 'native-A', turnId: 'turn-A', item: { id: 'reason', type: 'reasoning' } } })
    f.emit({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 'native-A', turnId: 'turn-A', itemId: 'reason', delta: 'Checking the files.' } })
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'activity', id: 'reasoning:reason', summary: 'Checking the files.' }))
    expect(f.events.some(event => event.type === 'message' && event.text.includes('Checking the files.'))).toBe(false)
    expect(f.events.some(event => event.type === 'native-signal')).toBe(true)
    await f.adapter.dispose()
  })
  it('streams bounded command output while a command runs and retains it if completion omits the aggregate', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Run tests')
    f.emit({ method: 'item/started', params: { threadId: 'native-A', turnId: 'turn-A', item: { id: 'command', type: 'commandExecution', command: 'npm test' } } })
    f.emit({ method: 'item/commandExecution/outputDelta', params: { threadId: 'other', turnId: 'turn-A', itemId: 'command', delta: 'private' } })
    f.emit({ method: 'item/commandExecution/outputDelta', params: { threadId: 'native-A', turnId: 'turn-A', itemId: 'command', delta: '1 test passed' } })
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'tool', id: 'command', state: 'running', output: '1 test passed' }))
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', turnId: 'turn-A', item: { id: 'command', type: 'commandExecution', command: 'npm test', status: 'completed' } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'tool', id: 'command', state: 'completed', output: '1 test passed' })
    await f.adapter.dispose()
  })
  it('rejects a turn held by another native writer and leaves usage polling alone', async () => {
    const f = fixture()
    const write = f.transport.write
    f.transport.write = line => {
      const request = JSON.parse(line)
      if (request.method !== 'turn/start') { write(line); return }
      f.requests.push(request)
      queueMicrotask(() => f.emit({ id: request.id, error: { code: -32603, message: 'thread native-A already has an active writer' } }))
    }
    await f.adapter.start({ rootPath: '/project', nativeSessionId: 'native-A' }, event => f.events.push(event))
    await expect(f.adapter.send('Change the docs')).rejects.toMatchObject({ failure: { code: 'session-busy' } })
    expect(f.events.filter(event => event.type === 'completed')).toHaveLength(1)
    expect(f.requests.some(request => request.method === 'account/rateLimits/read')).toBe(false)
    await f.adapter.dispose()
  })
  it('shows discovered MCP tools without treating empty resources or unauthenticated OAuth status as disconnected', async () => {
    const f = fixture({}, false, { data: [{ name: 'oxespace-delegation', authStatus: 'unsupported', tools: { oxespace_memory_search: {} }, resources: [], resourceTemplates: [], token: 'never-render' }] })
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, () => {})
    const panel = await f.adapter.command('mcp', '')
    expect(panel.rows).toEqual([{ label: 'oxespace-delegation', detail: '1 tools · 0 resources · 0 templates' }])
    expect(JSON.stringify(panel)).not.toContain('never-render')
    await f.adapter.dispose()
  })
  it('manages MCP, plugins and app details through typed app-server operations', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await expect(f.adapter.command('mcp', 'reload')).resolves.toMatchObject({ title: 'MCP configuration reloaded' })
    expect(f.requests.at(-1)).toMatchObject({ method: 'config/mcpServer/reload', params: {} })
    await expect(f.adapter.command('mcp', 'login github')).resolves.toMatchObject({ title: 'Connect github', externalUrl: 'https://provider.example/authorize?state=test' })
    expect(f.requests.at(-1)).toMatchObject({ method: 'mcpServer/oauth/login', params: { name: 'github', threadId: 'native-A' } })
    f.emit({ method: 'mcpServer/oauthLogin/completed', params: { name: 'github', success: true, threadId: 'native-A' } })
    expect(f.events.at(-1)).toMatchObject({ type: 'tool', name: 'mcpOAuth', state: 'completed', output: 'Connected' })
    await f.adapter.command('plugins', 'install reviewer')
    expect(f.requests.at(-1)).toMatchObject({ method: 'plugin/install', params: { pluginName: 'reviewer', installAttemptId: expect.any(String) } })
    await f.adapter.command('plugins', 'uninstall reviewer@market')
    expect(f.requests.at(-1)).toMatchObject({ method: 'plugin/uninstall', params: { pluginId: 'reviewer@market' } })
    await expect(f.adapter.command('apps', 'github')).resolves.toMatchObject({ rows: [{ label: 'Example app', detail: '1 tools' }] })
    await expect(f.adapter.command('mcp', 'login')).rejects.toThrow('Use /mcp')
    await f.adapter.dispose()
  })
  it('retains public plan progress and the consolidated turn diff', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Implement changes')
    f.emit({ method: 'turn/plan/updated', params: { threadId: 'native-A', turnId: 'turn-A', explanation: 'Review first', plan: [{ step: 'Inspect', status: 'completed' }, { step: 'Implement', status: 'inProgress' }] } })
    expect(f.events.at(-1)).toMatchObject({ type: 'plan', id: 'plan:turn-A', steps: [{ label: 'Inspect', status: 'completed' }, { label: 'Implement', status: 'inProgress' }] })
    f.emit({ method: 'turn/diff/updated', params: { threadId: 'native-A', turnId: 'turn-A', diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n' } })
    expect(f.events.at(-1)).toMatchObject({ type: 'turn-diff', turnId: 'turn-A', files: [{ path: 'a.ts', source: 'native-patch', state: 'running' }] })
    await f.adapter.dispose()
  })
  it('preserves native file patches, rename targets and refused edits within the active turn', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Change a file')
    const changes = [{ path: '/project/old.ts', kind: { type: 'update', move_path: '/project/new.ts' }, diff: '@@ -1 +1 @@\n-old\n+new\n' }]
    f.emit({ method: 'item/completed', params: { threadId: 'other', turnId: 'turn-A', item: { id: 'foreign', type: 'fileChange', status: 'completed', changes } } })
    expect(f.events.some(event => event.type === 'tool')).toBe(false)
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', turnId: 'turn-A', item: { id: 'edit', type: 'fileChange', status: 'completed', changes } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'tool', files: [{ path: '/project/new.ts', previousPath: '/project/old.ts', kind: 'rename', source: 'native-patch', state: 'completed', patch: changes[0].diff }] })
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', turnId: 'turn-A', item: { id: 'refused', type: 'fileChange', status: 'declined', changes } } })
    expect(f.events.at(-1)).toMatchObject({ state: 'failed', files: [{ state: 'failed' }] })
    await f.adapter.dispose()
  })
  it('marks a non-zero command exit as failed even when the provider item says completed', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Run checks')
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', turnId: 'turn-A', item: { id: 'test', type: 'commandExecution', status: 'completed', command: 'npm test', exitCode: 1, aggregatedOutput: 'failed' } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'tool', state: 'failed', exitCode: 1, output: 'failed' })
    await f.adapter.dispose()
  })
  it('preserves native subagent lifecycle and dynamic tool output as structured events', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Delegate the audit')
    const base = { id: 'agent-call', type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'native-A', receiverThreadIds: ['child-A'], prompt: 'Audit authentication', model: 'gpt-5', reasoningEffort: 'high' }
    f.emit({ method: 'item/started', params: { threadId: 'native-A', turnId: 'turn-A', item: { ...base, status: 'inProgress', agentsStates: { 'child-A': { status: 'running' } } } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'subagent', id: 'agent-call', action: 'spawnAgent', state: 'running', receiverThreadIds: ['child-A'], agents: [{ threadId: 'child-A', status: 'running' }], model: 'gpt-5', reasoningEffort: 'high' })
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', turnId: 'turn-A', item: { ...base, status: 'completed', agentsStates: { 'child-A': { status: 'completed', message: 'Audit complete' } } } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'subagent', state: 'completed', agents: [{ threadId: 'child-A', status: 'completed', message: 'Audit complete' }] })
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', turnId: 'turn-A', item: { id: 'dynamic', type: 'dynamicToolCall', status: 'completed', namespace: 'project', tool: 'inspect', contentItems: [{ type: 'inputText', text: 'Inspection complete' }] } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'tool', name: 'dynamicToolCall', state: 'completed', detail: 'project/inspect', output: 'Inspection complete' })
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', turnId: 'turn-A', item: { id: 'dynamic-failed', type: 'dynamicToolCall', status: 'completed', success: false, tool: 'inspect', contentItems: [{ type: 'inputText', text: 'Inspection failed' }] } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'tool', name: 'dynamicToolCall', state: 'failed', output: 'Inspection failed' })
    await f.adapter.dispose()
  })
  it('acknowledges configuration before applying it to subsequent turns', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    expect(f.requests[0]).toMatchObject({ params: { capabilities: { experimentalApi: true } } })
    await f.adapter.configure({ model: 'native-model', reasoningEffort: 'high', access: 'workspace-write', mode: 'plan' })
    expect(f.requests.at(-1)).toMatchObject({ method: 'thread/settings/update', params: { model: 'native-model', effort: 'high', sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/project'] } } })
    await f.adapter.send('Plan the change')
    expect(f.requests.at(-1)).toMatchObject({ method: 'turn/start', params: { model: 'native-model', effort: 'high', collaborationMode: { mode: 'plan' } } })
    await f.adapter.dispose()
  })
  it('implements CLI model, status and review commands with native operations rather than literal prompts', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('/model')
    expect(f.requests.at(-1)).toMatchObject({ method: 'model/list' })
    expect(f.events.some(event => event.type === 'model-picker' && event.models[0].id === 'native-model')).toBe(true)
    expect(f.events.at(-1)).toMatchObject({ type: 'completed', status: 'completed' })
    await f.adapter.send('/model native-model high')
    expect(f.events).toContainEqual({ type: 'configuration', model: 'native-model', reasoningEffort: 'high' })
    await f.adapter.send('/status')
    expect(f.events.some(event => event.type === 'message' && event.text.includes('native-model') && event.text.includes('read-only'))).toBe(true)
    expect(f.requests.some(request => request.method === 'turn/start')).toBe(false)
    await f.adapter.send('Review authentication')
    expect(f.requests.at(-1)).toMatchObject({ method: 'turn/start', params: { model: 'native-model', effort: 'high' } })
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { status: 'completed' } } })
    await f.adapter.send('/review')
    expect(f.requests.at(-1)).toMatchObject({ method: 'review/start', params: { threadId: 'native-A', delivery: 'inline', target: { type: 'uncommittedChanges' } } })
    await f.adapter.interrupt()
    expect(f.requests.at(-1)).toMatchObject({ method: 'turn/interrupt', params: { turnId: 'turn-A' } })
    await f.adapter.dispose()
  })
  it('passes resolved native skills as structured input and routes compact to its native method', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('$oxe-plan Review auth', { name: 'oxe-plan', path: '/skills/oxe-plan/SKILL.md' })
    expect(f.requests.at(-1)).toMatchObject({ method: 'turn/start', params: { input: [
      { type: 'text', text: '$oxe-plan Review auth' }, { type: 'skill', name: 'oxe-plan', path: '/skills/oxe-plan/SKILL.md' }
    ] } })
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { status: 'completed' } } })
    await f.adapter.send('/compact')
    expect(f.requests.at(-1)).toMatchObject({ method: 'thread/compact/start', params: { threadId: 'native-A' } })
    await expect(f.adapter.send('New message')).rejects.toThrow('already running')
    f.emit({ method: 'turn/started', params: { threadId: 'native-A', turn: { id: 'compact-A' } } })
    f.emit({ method: 'item/completed', params: { threadId: 'native-A', item: { id: 'summary', type: 'contextCompaction' } } })
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { status: 'completed' } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'completed', status: 'completed' })
    await f.adapter.dispose()
  })
  it('distinguishes expired authentication from exhausted usage limits', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    for (const [info, authentication] of [['unauthorized', true], ['usageLimitExceeded', false]] as const) {
      await f.adapter.send('Inspect')
      f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { status: 'failed', error: { codexErrorInfo: info, message: 'Private diagnostic' } } } })
      expect(f.events.at(-1)).toMatchObject({ type: 'completed', status: 'failed' })
      expect((f.events.at(-1) as { errorCode?: string }).errorCode === 'authentication').toBe(authentication)
      expect(f.events.at(-1)).toMatchObject({ failure: { detail: 'Private diagnostic', providerCode: info } })
    }
    await f.adapter.dispose()
  })
  it('shows the real quota failure immediately and then attaches native reset windows to the same failure', async () => {
    const reset = 1790000000
    const f = fixture({ rateLimitsByLimitId: { codex: { limitName: 'Codex', primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: reset }, secondary: { usedPercent: 82, windowDurationMins: 10080, resetsAt: reset + 86400 } } } })
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Inspect')
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { id: 'turn-A', status: 'failed', error: { codexErrorInfo: 'usageLimitExceeded', message: 'Session usage exhausted. access_token="sensitive token"' } } } })
    const completed = f.events.at(-1)
    expect(completed).toMatchObject({ type: 'completed', errorCode: 'usage', failure: { detail: 'Session usage exhausted. access_token=[redacted]' } })
    await vi.waitFor(() => expect(f.events.at(-1)).toMatchObject({ type: 'failure-details', id: completed?.type === 'completed' ? completed.failure?.id : '', usage: { windows: [expect.objectContaining({ usedPercent: 100, resetsAt: reset * 1000 }), expect.objectContaining({ usedPercent: 82 })] } }))
    expect(f.requests.filter(request => request.method === 'account/rateLimits/read')).toHaveLength(1)
    expect(f.events.filter(event => event.type === 'completed')).toHaveLength(1)
    expect((await f.adapter.command('usage', '')).usage?.windows).toHaveLength(2)
    await f.adapter.dispose()
  })
  it('retains the failure diagnostic when usage lookup fails and never invents a reset', async () => {
    const f = fixture({}, true)
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Inspect')
    f.emit({ method: 'error', params: { threadId: 'native-A', turnId: 'turn-A', willRetry: false, error: { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 429 } }, message: 'Too many requests. Try later.' } } })
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { status: 'failed' } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'completed', failure: { code: 'rate-limit', httpStatus: 429, detail: 'Too many requests. Try later.' } })
    await vi.waitFor(() => expect(f.events.at(-1)).toMatchObject({ type: 'failure-details', usageUnavailable: true }))
    expect(JSON.stringify(f.events)).not.toContain('resetsAt')
    await f.adapter.dispose()
  })
  it('accepts global usage updates, isolates late turn errors, and does not fail a recovered retry', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    f.emit({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: { usedPercent: 91, resetsAt: 1790000000 } } } })
    f.emit({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: null, limitName: null, primary: { usedPercent: 92 }, secondary: null } } })
    await f.adapter.send('Inspect')
    f.emit({ method: 'error', params: { threadId: 'native-A', turnId: 'old-turn', error: { message: 'Old error' } } })
    f.emit({ method: 'error', params: { threadId: 'native-A', turnId: 'turn-A', willRetry: true, error: { message: 'Temporary outage' } } })
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { status: 'completed' } } })
    expect(f.events.at(-1)).toEqual({ type: 'completed', status: 'completed' })
    await f.adapter.send('Continue')
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { status: 'failed', error: { codexErrorInfo: 'usageLimitExceeded', message: 'Allowance exhausted' } } } })
    expect(f.events.at(-1)).toMatchObject({ type: 'completed', failure: { usage: { windows: [expect.objectContaining({ usedPercent: 92, resetsAt: 1790000000000 })] } } })
    await f.adapter.dispose()
  })
  it('initializes once, resumes explicitly, and retains safe defaults', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: 'native-A' }, event => f.events.push(event))
    expect(f.requests.map(request => request.method)).toEqual(['initialize', 'initialized', 'thread/resume'])
    expect(f.requests[2].params).toMatchObject({ cwd: '/project', threadId: 'native-A', modelProvider: 'openai', sandbox: 'read-only', approvalPolicy: 'on-request' })
    expect(f.events).toEqual([
      { type: 'session', nativeSessionId: 'native-A' },
      { type: 'configuration', model: undefined, reasoningEffort: undefined, access: 'read-only', networkAccess: false, approvalPolicy: 'on-request', confirmed: true }
    ])
    await f.adapter.dispose()
  })
  it('isolates event scope and rejects simultaneous turns', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Investigate the failure')
    await expect(f.adapter.send('another turn')).rejects.toThrow('already running')
    f.emit({ method: 'item/agentMessage/delta', params: { threadId: 'other-project', itemId: 'x', delta: 'do not show' } })
    expect(f.events).toHaveLength(2)
    f.emit({ method: 'item/agentMessage/delta', params: { threadId: 'native-A', itemId: 'x', delta: 'Verified finding' } })
    expect(f.events.at(-1)).toMatchObject({ type: 'delta', text: 'Verified finding' })
    await f.adapter.interrupt()
    expect(f.requests.at(-1)).toMatchObject({ method: 'turn/interrupt', params: { threadId: 'native-A', turnId: 'turn-A' } })
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { status: 'interrupted' } } })
    expect(f.events.at(-1)).toEqual({ type: 'completed', status: 'interrupted' })
    await f.adapter.send('Continue')
    await f.adapter.dispose()
  })
  it('requires explicit approval and clears pending decisions at completion', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Inspect')
    f.emit({ id: 30, method: 'item/commandExecution/requestApproval', params: { threadId: 'native-A', command: 'npm test', cwd: '/project', reason: 'Validate the change' } })
    expect(f.events.at(-2)).toMatchObject({ type: 'request', request: { kind: 'approval', command: 'npm test', cwd: '/project', reason: 'Validate the change' } })
    expect(f.events.at(-1)).toMatchObject({ type: 'approval', id: '30' })
    expect(f.requests.some(request => request.id === 30)).toBe(false)
    await f.adapter.approve('30', 'decline')
    expect(f.requests.at(-1)).toEqual({ id: 30, result: { decision: 'decline' } })
    await expect(f.adapter.approve('30', 'accept')).rejects.toThrow('no longer pending')
    f.emit({ id: 31, method: 'unsupported/request', params: { threadId: 'native-A' } })
    expect(f.requests.at(-1)).toMatchObject({ id: 31, error: { code: -32601 } })
    await f.adapter.dispose()
    await f.adapter.dispose()
    expect(f.transport.close).toHaveBeenCalledOnce()
  })
  it('round-trips structured questions, permission grants and MCP forms through host requests', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, event => f.events.push(event))
    await f.adapter.send('Ask before acting')
    f.emit({ id: 70, method: 'item/tool/requestUserInput', params: { threadId: 'native-A', turnId: 'turn-A', questions: [{ id: 'scope', header: 'Scope', question: 'Which package?', options: [{ label: 'desktop', description: 'Electron app' }] }] } })
    expect(f.events.at(-1)).toMatchObject({ type: 'request', request: { kind: 'question', questions: [{ id: 'scope', question: 'Which package?' }] } })
    await f.adapter.respondRequest('70', { answers: { scope: ['desktop'] } })
    expect(f.requests.at(-1)).toEqual({ id: 70, result: { answers: { scope: { answers: ['desktop'] } } } })
    f.emit({ id: 71, method: 'item/permissions/requestApproval', params: { threadId: 'native-A', turnId: 'turn-A', permissions: { network: { enabled: true } } } })
    await f.adapter.respondRequest('71', { permissions: { network: { enabled: true } }, scope: 'turn' })
    expect(f.requests.at(-1)).toEqual({ id: 71, result: { permissions: { network: { enabled: true } }, scope: 'turn' } })
    f.emit({ id: 72, method: 'mcpServer/elicitation/request', params: { threadId: 'native-A', turnId: 'turn-A', serverName: 'Issue tracker', requestedSchema: { type: 'object', properties: { project: { type: 'string' } } } } })
    await f.adapter.respondRequest('72', { decision: 'accept', content: { project: 'OXE' } })
    expect(f.requests.at(-1)).toEqual({ id: 72, result: { action: 'accept', content: { project: 'OXE' } } })
    f.emit({ id: 73, method: 'item/tool/call', params: { threadId: 'native-A', turnId: 'turn-A', callId: 'dynamic-A', tool: 'host_write', arguments: { value: 'never execute' } } })
    expect(f.requests.at(-1)).toEqual({ id: 73, result: { success: false, contentItems: [{ type: 'inputText', text: 'This dynamic host tool was not registered by OXESpace Thread.' }] } })
    expect(f.events.at(-1)).toMatchObject({ type: 'tool', id: 'dynamic-A', state: 'failed', output: 'The call was rejected without executing code.' })
    await f.adapter.dispose()
  })
  it('uses native queue and steering RPC without starting auxiliary terminals', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: null }, () => {})
    await f.adapter.send('Work')
    expect(await f.adapter.enqueue!({ id: 'client-A', text: 'Follow up', createdAt: 1, state: 'queued' })).toBe('queued-A')
    await f.adapter.updateQueued!('queued-A', { id: 'client-A', text: 'Updated', createdAt: 1, state: 'queued' })
    await f.adapter.reorderQueued!(['queued-A'])
    await f.adapter.steer!('Focus tests')
    expect(f.requests.map(value => value.method)).toEqual(expect.arrayContaining(['thread/queue/add', 'thread/queue/update', 'thread/queue/reorder', 'turn/steer']))
    f.emit({ method: 'turn/completed', params: { threadId: 'native-A', turn: { id: 'turn-A', status: 'completed' } } })
    await f.adapter.startQueued!('queued-A')
    expect(f.requests.at(-1)).toMatchObject({ method: 'thread/queue/start', params: { queuedSubmissionId: 'queued-A' } })
    await f.adapter.dispose()
  })
})
