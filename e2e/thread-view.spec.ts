import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordThreadVisualAudit } from './helpers/thread-visual-audit'

test('Thread UI preserves Code terminals and renders a structured conversation', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-thread-ui-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  writeFileSync(join(repo, 'README.md'), '# Thread workbench fixture\n\nSearchable project content.\n')
  const previewServer = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Thread preview</title>Ready')
  })
  await new Promise<void>(resolve => previewServer.listen(0, '127.0.0.1', resolve))
  const address = previewServer.address()
  const previewUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    if (process.env.OXESPACE_VISUAL_AUDIT_OUTPUT) {
      const screenshot = page.screenshot.bind(page)
      page.screenshot = async options => {
        await recordThreadVisualAudit(page, String(options?.path ?? 'checkpoint'))
        return screenshot(options)
      }
    }
    await app.evaluate(({ ipcMain, BrowserWindow }, fixtureRoot) => {
      let snapshot: Record<string, unknown> | null = null
      let sendCount = 0, manyThreads = false, archivedRestored = false
      ;(globalThis as Record<string, unknown>).missingInputFixture = (missing: boolean) => {
        ;(snapshot!.thread as Record<string, unknown>).status = 'approval'
        snapshot!.events = [{ type: 'message', id: 'recent', role: 'assistant', text: 'Recent history without the older request.' }]
        snapshot!.pendingRequests = missing ? [] : [{ id: 'older-mcp', nativeId: 'older-mcp', nativeMethod: 'mcpServer/elicitation/request', kind: 'elicitation', title: 'Memory confirmation', detail: 'Allow this memory update?', state: 'pending', generation: 1, createdAt: Date.now() }]
        changed()
      }
      ;(globalThis as Record<string, unknown>).longThreadCommandFixture = (enabled: boolean) => {
        const events = snapshot!.events as Array<Record<string, unknown>>
        snapshot!.events = events.filter(event => event.id !== 'overflow-command')
        if (enabled) (snapshot!.events as unknown[]).push({ type: 'tool', id: 'overflow-command', name: 'commandExecution', state: 'running', detail: 'powershell -Command ' + 'very-long-command-'.repeat(80), startedAt: Date.now() })
        changed()
      }
      ;(globalThis as Record<string, unknown>).threadCommandQueries = 0
      const changed = () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: 'e2e-thread' }) }
      ;(globalThis as Record<string, unknown>).setPartialHistoryFixture = () => { (snapshot!.thread as Record<string, unknown>).cliNotice = 'Showing the recent part of this native session. Its complete history remains available in the provider CLI.'; changed() }
      ;(globalThis as Record<string, unknown>).finishThreadFixture = () => { (snapshot!.thread as Record<string, unknown>).status = 'idle'; changed() }
      ;(globalThis as Record<string, unknown>).silenceThreadFixture = () => {
        const time = Date.now() - 70000
        Object.assign(snapshot!.thread as object, { status: 'running', provider: 'codex', connection: { state: 'connected', attempt: 0, changedAt: time, lastNativeSignalAt: time } })
        snapshot!.turns = [{ id: 'silent-turn', nativeId: 'silent-native-turn', sequence: 1, startedAt: time, status: 'running', configuration: {} }]
        changed()
      }
      for (const channel of ['commands', 'list', 'read', 'create', 'send', 'pin', 'projects', 'models', 'configure', 'command', 'artifact', 'project-diff', 'observe']) ipcMain.removeHandler(`thread:${channel}`)
      ipcMain.handle('thread:observe', () => {
        const observation = { state: 'unknown', observedAt: Date.now(), source: 'unavailable', detail: 'Provider outcome is unconfirmed. No message was resent.' }
        ;(snapshot!.thread as Record<string, unknown>).providerObservation = observation
        changed(); return observation
      })
      ipcMain.removeHandler('git:get-status')
      ipcMain.handle('git:get-status', () => ({ branch: 'feature/thread', ahead: 1, behind: 0, checkedAt: Date.now(), files: [
        { path: 'README.md', staged: false, unstaged: true, untracked: false, conflicted: false, status: '.M' },
        { path: 'docs/new.md', staged: false, unstaged: true, untracked: true, conflicted: false, status: '?' }
      ] }))
      ipcMain.removeHandler('agent-credits:get')
      ipcMain.handle('agent-credits:get', (_event, input: { provider: string }) => ({ provider: input.provider, available: true, installed: true, planLabel: 'Pro', source: 'oauth', observedAtMs: Date.now(), error: null,
        windows: [{ kind: 'session', usedPct: 40, resetsAtMs: Date.now() + 3600000 }, { kind: 'weekly', usedPct: 30, resetsAtMs: Date.now() + 86400000 }], display: { kind: 'weekly', usedPct: 30, resetsAtMs: Date.now() + 86400000 } }))
      ipcMain.removeHandler('copilot:credits')
      ipcMain.handle('copilot:credits', () => ({ installed: false, credits: null, plan: null, error: null }))
      ipcMain.removeHandler('thread:respond')
      ipcMain.handle('thread:respond', (_event, _id, requestId, response) => {
        ;(globalThis as Record<string, unknown>).lastThreadAnswer = response
        delete snapshot!.pendingRequests
        const request = (snapshot!.events as Array<Record<string, unknown>>).find(event => event.type === 'request' && event.id === requestId)
        if (request) Object.assign(request.request as object, { state: response.decision === 'cancel' ? 'cancelled' : 'resolved', resolution: response.decision === 'decline' ? 'declined' : response.decision === 'cancel' ? 'cancelled-by-user' : 'answered', resolvedAt: Date.now() })
        ;(snapshot!.thread as Record<string, unknown>).status = 'idle'
        changed()
      })
      const reviewPatch = '--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -12,5 +12,7 @@\n export function App() {\n-  return <ThreadView />\n+  return <ThreadWorkbench>\n+    <ThreadView />\n+  </ThreadWorkbench>\n }\n'
      ipcMain.handle('thread:artifact', (_event, id, artifactId) => {
        if (id !== 'e2e-thread') throw Error('Invalid evidence scope')
        const content = reviewPatch.replace('export function App() {', 'export function App() { // ' + 'long diff content '.repeat(150))
        return { id: artifactId, content, hash: `hash-${artifactId}`, bytes: content.length, truncated: false, source: 'native-patch' }
      })
      ipcMain.handle('thread:project-diff', () => ({ files: [{ path: 'src/ExistingWork.ts', additions: 1, deletions: 0, mtime: null, hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ type: 'added', oldLineNo: null, newLineNo: 1, content: 'Earlier project work' }] }] }, { path: 'README.md', additions: 1, deletions: 0, mtime: null, hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ type: 'added', oldLineNo: null, newLineNo: 1, content: '# Thread workbench fixture' }] }] }], base: 'HEAD', includeUncommitted: true, compiledAt: Date.now() }))
      ipcMain.handle('thread:models', () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: 'Native catalog model', efforts: ['low', 'high'], defaultEffort: 'low' }] }))
      ipcMain.handle('thread:configure', (_event, _id, configuration, revision) => { Object.assign(snapshot!.thread as object, configuration, { configurationRevision: revision + 1 }); changed(); return snapshot })
      ipcMain.handle('thread:command', (_event, _id, text) => {
        if (text.trim() === '/resume archived-fixture') { archivedRestored = true; return { kind: 'navigate', threadId: 'archived-fixture' } }
        return text.trim() === '/usage' ? { kind: 'panel', title: 'Usage limits', usage: { checkedAt: Date.now(), windows: [{ label: 'Codex · Session · 5 hours', usedPercent: 100, resetsAt: Date.now() + 3600000 }, { label: 'Codex · Weekly', usedPercent: 72, resetsAt: Date.now() + 86400000 }] } } : { kind: 'panel', surface: text.trim().slice(1) }
      })
      ipcMain.handle('thread:commands', () => { (globalThis as Record<string, unknown>).threadCommandQueries = Number((globalThis as Record<string, unknown>).threadCommandQueries) + 1; return { commands: [
        { name: 'oxe-plan', description: 'Plan a project change', source: 'claude' },
        { name: 'compact', description: 'Summarize conversation context', source: 'claude' },
        ...Array.from({ length: 45 }, (_, index) => ({ name: `skill-${index}`, description: `Project skill ${index}`, source: 'claude' }))
      ] } })
      ipcMain.removeHandler('voice:get-model-status')
      ipcMain.handle('voice:get-model-status', (_event, size) => ({ size, ready: true, path: '/fixture/voice', engineReady: true }))
      ipcMain.handle('thread:projects', () => ({ projects: [], unavailable: [] }))
      const accounts = new Map<string, Record<string, unknown>>()
      let copiedText = ''
      ipcMain.removeHandler('clipboard:write-text')
      ipcMain.removeHandler('clipboard:read-text')
      ipcMain.handle('clipboard:write-text', (_event, value) => { copiedText = String(value); return true })
      ipcMain.handle('clipboard:read-text', () => copiedText)
      for (const name of ['read', 'login', 'cancel', 'code', 'browser']) ipcMain.removeHandler(`agent-account:${name}`)
      const accountChanged = (status: Record<string, unknown>) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent-account:changed', status) }
      ipcMain.handle('agent-account:read', (_event, context) => {
        const scopeId = context.provider
        const status = accounts.get(scopeId) ?? { scopeId, provider: context.provider, state: 'connected', method: 'subscription', checkedAt: Date.now() }
        accounts.set(scopeId, status); return status
      })
      ipcMain.handle('agent-account:login', (_event, context) => {
        const status = { scopeId: context.provider, provider: context.provider, state: 'awaiting-browser', method: 'unknown', checkedAt: Date.now(), attemptId: `attempt-${context.provider}`, canOpenBrowser: true }
        accounts.set(context.provider, status); accountChanged(status); return status
      })
      ipcMain.handle('agent-account:cancel', (_event, id) => {
        const provider = id.replace('attempt-', '')
        const status = { scopeId: provider, provider, state: 'connected', method: 'subscription', checkedAt: Date.now() }
        accounts.set(provider, status); accountChanged(status)
      })
      ipcMain.handle('agent-account:browser', () => {})
      ipcMain.handle('thread:list', () => snapshot ? [snapshot.thread, ...(manyThreads ? [...Array.from({ length: 70 }, (_, index) => ({ ...(snapshot!.thread as object), id: `history-${index}`, title: `History conversation ${index}`, status: 'idle', updatedAt: Date.now() - (index + 1) * 60000 })), { ...(snapshot!.thread as object), id: 'archived-fixture', title: 'Archived agent work', status: 'idle', archived: !archivedRestored }] : [])] : [])
      ipcMain.handle('thread:read', (_event, id) => id !== 'e2e-thread' && snapshot ? ({
        thread: { ...snapshot.thread, id, title: id.startsWith('history-') ? `History conversation ${id.slice('history-'.length)}` : id === 'archived-fixture' ? 'Archived agent work' : String(id), status: 'idle', ...(id === 'archived-fixture' ? { archived: !archivedRestored } : {}) },
        events: [{ type: 'message', id: `${id}-answer`, role: 'assistant', text: `Independent conversation ${id}` }, { type: 'completed', status: 'completed' }]
      }) : snapshot)
      ipcMain.handle('thread:create', (_event, input) => {
        snapshot = { thread: { id: 'e2e-thread', workspaceId: (globalThis as Record<string, unknown>).e2eWorkspaceId, projectId: 'e2e-project', rootPath: fixtureRoot,
          provider: input.provider, nativeSessionId: null, title: 'New thread', pinned: false, status: 'idle', createdAt: Date.now(), updatedAt: Date.now() }, events: [] }
        changed(); return snapshot
      })
      ipcMain.handle('thread:send', (_event, _id, text) => {
        const thread = snapshot!.thread as Record<string, unknown>
        if (text === 'Long command fixture') {
          thread.status = 'idle'
          snapshot!.events = [{ type: 'message', id: 'long-command-user', role: 'user', text },
            { type: 'tool', id: 'long-command', name: 'Bash', state: 'unknown', detail: JSON.stringify({ command: `git log ${'very-long-path/'.repeat(95)}`, description: 'Inspect project history' }, null, 2) },
            { type: 'completed', status: 'completed' }]
          changed(); return
        }
        if (text === 'Lost approval fixture') {
          thread.status = 'interrupted'
          snapshot!.events = [{ type: 'request', id: 'lost-approval', request: { id: 'lost-approval', nativeId: 'lost-approval', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Saved command approval', command: 'npm test -- ' + 'long-path/'.repeat(80), cwd: fixtureRoot, reason: 'Verify changes', generation: 1, createdAt: Date.now(), state: 'cancelled', resolution: 'connection-lost' } }]
          changed(); return
        }
        if (text === 'Historical questions fixture') {
          thread.status = 'idle'
          snapshot!.events = [{ type: 'message', id: 'historical-questions', role: 'assistant', text: '', historicalQuestions: [{ title: 'Which branch?', options: ['Current branch', 'New isolated branch'] }, { title: 'Additional context?', options: null }] }, { type: 'completed', status: 'completed' }]
          changed(); return
        }
        if (text === 'Structured question fixture') {
          thread.status = 'approval'
          snapshot!.events = [{ type: 'message', id: 'choice-user', role: 'user', text },
            { type: 'request', id: 'native-choice', request: { id: 'native-choice', nativeId: 'native-choice', nativeMethod: 'can_use_tool:AskUserQuestion', kind: 'question', title: 'Claude needs your input', generation: 1, createdAt: Date.now(), state: 'pending', questions: [{ id: 'rollout', question: 'Which rollout?', options: [{ label: 'Staged' }, { label: 'Immediate' }] }, { id: 'validation', question: 'Which validation?', options: [{ label: 'Pilot' }, { label: 'Full rollout' }] }] } }]
          changed(); return
        }
        if (text === 'Prose choices fixture') {
          thread.status = 'idle'
          snapshot!.events = [{ type: 'message', id: 'prose-user', role: 'user', text }, { type: 'message', id: 'prose-answer', role: 'assistant', text: 'As opções:\n- **A (Recomendado):** Staged rollout.\n- **B:** Immediate rollout.' }, { type: 'completed', status: 'completed' }]
          changed(); return
        }
        if (text === 'Approval fixture') {
          const command = '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command \'$path = "docs\\thread-view.md"; $content = Get-Content -LiteralPath $path -Raw; $needle = "First line\\r\\nSecond line"; Set-Content -LiteralPath $path -Value $content\''
          thread.status = 'approval'
          snapshot!.events = [{ type: 'message', id: 'approval-user', role: 'user', text }, { type: 'request', id: 'approval-1', request: { id: 'approval-1', nativeId: '1', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command', detail: command, command, cwd: fixtureRoot, reason: 'Update the Thread guide', generation: 1, createdAt: Date.now(), state: 'pending' } }]
          changed(); return
        }
        if (text === 'Workbench fixture') {
          thread.status = 'idle'; thread.provider = 'codex'; thread.title = 'Improve the Thread workbench'
          snapshot!.events = [{ type: 'message', id: 'workbench-user', role: 'user', text: 'Show the files updated in this conversation and let me review the changes.' },
            { type: 'tool', id: 'command', name: 'commandExecution', state: 'completed', detail: 'npm run typecheck', output: 'TypeScript checks passed', exitCode: 0 },
            { type: 'plan', id: 'workbench-plan', steps: [{ label: 'Preserve file changes', status: 'completed' }, { label: 'Integrate review alongside the conversation', status: 'completed' }] },
            { type: 'subagent', id: 'agent-audit', action: 'spawnAgent', state: 'completed', senderThreadId: 'native-parent', receiverThreadIds: ['native-child'], agents: [{ threadId: 'native-child', status: 'completed', message: 'Review complete' }], prompt: 'Review the workbench implementation', model: 'native-model', reasoningEffort: 'low' },
            ...['src/App.tsx', 'src/components/Threads/ThreadWorkbench.tsx', 'src/components/Threads/ThreadWorkbench.css'].map((path, index) => ({ type: 'tool', id: `file-${index}`, name: 'fileChange', state: 'completed', detail: path, files: [{ path, kind: index ? 'add' : 'update', state: 'completed', source: 'native-patch', artifactId: `artifact-${index}`, additions: 3, deletions: 1 }] })),
            { type: 'message', id: 'workbench-answer', role: 'assistant', text: 'The conversation now keeps file changes visible and opens their historical diffs alongside your messages.\n\n- Review each file without leaving the conversation.\n- Add a comment on a diff line to your draft.\n- Compare session changes with the current project separately.\n\nTypeScript checks passed.' },
            { type: 'completed', status: 'completed' }]
          changed(); return
        }
        if (text.trim() === '/model') { (snapshot!.events as unknown[]).push({ type: 'model-picker', id: 'model-picker', models: [{ id: 'native-model', label: 'Native model', description: 'Native catalog model', efforts: ['low', 'high'], defaultEffort: 'low' }] }); changed(); return }
        if (/^\/model native-model(?: high)?$/.test(text.trim())) { thread.model = 'native-model'; thread.reasoningEffort = text.trim().endsWith(' high') ? 'high' : undefined; changed(); return }
        if (text.trim() === '/permissions') { (snapshot!.events as unknown[]).push({ type: 'cli-command', id: 'native-permissions', command: text.trim() }); changed(); return }
        thread.title = 'Authentication flow'
        if (text === 'Usage failure fixture') {
          thread.status = 'failed'
          thread.lastTurnStatus = 'failed'
          snapshot!.events = [{ type: 'message', id: 'quota-user', role: 'user', text }, { type: 'completed', status: 'failed', errorCode: 'usage', failure: {
            id: 'quota-failure', occurredAt: Date.now(), code: 'usage', message: 'The provider reported an exhausted usage allowance.', providerCode: 'usageLimitExceeded',
            detail: 'You have hit the session usage limit. Retry when your allowance resets.',
            usage: { checkedAt: Date.now(), windows: [{ label: 'Codex · Session · 5 hours', usedPercent: 100, resetsAt: Date.now() + 3600000 }, { label: 'Codex · Weekly', usedPercent: 60, resetsAt: Date.now() + 86400000 }] }
          } }]
          changed(); return
        }
        if (text === 'Sidebar history fixture') {
          manyThreads = true
          for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: 'new-sidebar-fixture' })
          return
        }
        if (text === 'Append streaming fixture') {
          thread.status = 'running'
          thread.connection = { state: 'connected', attempt: 0, changedAt: Date.now(), lastNativeSignalAt: Date.now() }
          ;(snapshot!.events as unknown[]).push({ type: 'activity', id: 'streaming-reasoning', phase: 'reasoning', at: Date.now(), summary: 'Checking project files.' })
          ;(snapshot!.events as unknown[]).push({ type: 'message', id: 'streaming-output', role: 'assistant', text: 'New streaming output. '.repeat(100) })
          changed(); return
        }
        if (text === 'Long history fixture') {
          snapshot!.events = Array.from({ length: 3334 }, (_, i) => [
            { type: 'message', id: `u-${i}`, role: 'user', text: `Review message ${i}` },
            { type: 'message', id: `a-${i}`, role: 'assistant', text: 'A detailed response to verify the conversation history. '.repeat(5) },
            { type: 'completed', status: 'completed' }
          ]).flat(); changed(); return
        }
        if (text === 'Imported formatting fixture') {
          thread.status = 'idle'; thread.title = 'Imported conversation'
          snapshot!.events = [
            { type: 'message', id: 'native:metadata', role: 'user', text: '<environment_context><current_date>2026-09-24</current_date><root>private local path</root></environment_context>' },
            { type: 'message', id: 'native:prompt', role: 'user', text: '<image name=[Image #1] path="C:\\private\\capture.png"> </image>\nAjuste a apresentação da conversa. ' + 'Considere a hierarquia visual e a legibilidade. '.repeat(30) },
            { type: 'message', id: 'native:answer', role: 'assistant', text: '## Apresentação da conversa\n\nO histórico mantém **parágrafos legíveis**, listas e código com destaque adequado.\n\n- Metadados técnicos ficam ocultos.\n- Mensagens longas podem ser abertas quando necessário.' },
            { type: 'completed', status: 'completed' }
          ]; changed(); return
        }
        if (++sendCount === 1) {
          thread.status = 'failed'
          thread.lastTurnStatus = 'failed'
          snapshot!.events = [{ type: 'message', id: 'user', role: 'user', text },
            { type: 'completed', status: 'failed', errorCode: 'authentication' }]
          changed(); return
        }
        thread.status = 'idle'
        thread.lastTurnStatus = 'completed'
        snapshot!.events = [{ type: 'message', id: 'user', role: 'user', text },
          { type: 'tool', id: 'tool', name: 'Read', state: 'completed', detail: 'Fixture README' },
          { type: 'message', id: 'answer', role: 'assistant', text: '**Verified fixture response**\n\nThe session is stored in an HttpOnly cookie, keeping credentials outside client scripts.\n\n- Verify the callback before creating a session.\n- Refresh the connection when the native account expires.\n- Keep the conversation draft during reconnection.\n\n| Priority | Improvement | Reason |\n| --- | --- | --- |\n| **High** | Split `App.tsx` | Reduce coupling between navigation and sessions. |\n| Medium | Preserve errors | Make diagnostics readable and actionable. |\n\n> Check the active worktree before making changes.\n\n```ts\nconst session = { id: "fixture" }\n  console.log(session.id)\n```' },
          { type: 'completed', status: 'completed' }]
        changed()
      })
      ipcMain.handle('thread:pin', () => {})
      let cliCommand: string | undefined, cliOutput = 'Claude Code · Native session\r\n\r\n❯ '
      const cliData = (data: string) => { cliOutput += data; for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread-cli:data', { paneId: 'e2e-thread', data }) }
      for (const name of ['open', 'state', 'write', 'resize', 'attach', 'detach', 'stop', 'insert', 'link']) ipcMain.removeHandler(`thread-cli:${name}`)
      ipcMain.handle('thread-cli:open', (_event, _id, command) => { cliCommand = command; (snapshot!.thread as Record<string, unknown>).cliActive = true; changed(); return { running: true, nativeSessionId: null, pendingCommand: cliCommand } })
      ipcMain.handle('thread-cli:state', () => ({ running: Boolean((snapshot!.thread as Record<string, unknown>).cliActive), nativeSessionId: null, pendingCommand: cliCommand }))
      ipcMain.handle('thread-cli:attach', () => ({ running: true, seq: cliOutput.length, prologue: '', replay: cliOutput, truncated: false, altScreen: false }))
      ipcMain.handle('thread-cli:detach', () => {})
      ipcMain.handle('thread-cli:resize', () => {})
      ipcMain.handle('thread-cli:insert', () => { cliData(cliCommand ?? ''); cliCommand = undefined })
      ipcMain.handle('thread-cli:write', (_event, _id, data) => { cliData(data === '\r' ? '\r\nSelect native permissions\r\n  Read only\r\n  Workspace access\r\n' : data) })
      ipcMain.handle('thread-cli:stop', () => { (snapshot!.thread as Record<string, unknown>).cliActive = false; changed() })
      ipcMain.handle('thread-cli:link', () => {})

    }, repo)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    const projectWorkspace = await page.evaluate(async () => (await window.oxe.workspace.list())[0])
    await app.evaluate((_context, workspaceId) => { (globalThis as Record<string, unknown>).e2eWorkspaceId = workspaceId }, projectWorkspace.id)
    await app.evaluate(({ ipcMain }, { workspaceId, rootPath }) => {
      ipcMain.removeHandler('thread:projects')
      ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'e2e-project', displayName: 'repo', identityLabel: rootPath, contexts: [{ workspaceId, rootPath, label: 'repo' }] }], unavailable: [] }))
    }, { workspaceId: projectWorkspace.id, rootPath: repo })
    const grid = page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()
    await expect(grid).toBeVisible()
    const codeInput = page.locator('.terminal-pane .xterm-helper-textarea').first()
    await expect(page.getByTestId('terminal-status-label').first()).toHaveText('running')
    await page.evaluate(() => {
      const media = navigator.mediaDevices
      ;(globalThis as Record<string, unknown>).originalGetUserMedia = media.getUserMedia
      media.getUserMedia = async () => { throw new DOMException('The user aborted a request.', 'AbortError') }
    })
    await codeInput.focus()
    await page.keyboard.press('Control+Shift+v')
    await expect(page.getByText('Microphone request was canceled. Try again.')).toBeVisible()
    await page.screenshot({ path: 'test-results/voice-error-dismissible.png' })
    await page.getByRole('button', { name: 'Close voice input' }).click()
    await expect(page.locator('.oxe-voice-hud')).toHaveCount(0)
    await expect(codeInput).toBeFocused()
    await page.keyboard.press('Control+Shift+v')
    await expect(page.locator('.oxe-voice-hud.error')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.oxe-voice-hud')).toHaveCount(0)
    await page.keyboard.press('Control+Shift+v')
    await expect(page.locator('.oxe-voice-hud.error')).toBeVisible()
    await page.getByRole('button', { name: 'Close voice input' }).click()
    await expect(page.locator('.oxe-voice-hud')).toHaveCount(0)
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = (globalThis as Record<string, unknown>).originalGetUserMedia as typeof navigator.mediaDevices.getUserMedia
      delete (globalThis as Record<string, unknown>).originalGetUserMedia
    })
    const terminalCount = await page.locator('.xterm').count()
    const nav = page.getByRole('navigation', { name: 'Application view' })
    await expect(page.locator('.sidebar').getByRole('navigation', { name: 'Application view' })).toBeVisible()
    await expect(page.locator('.workspace-surface').getByRole('navigation', { name: 'Application view' })).toHaveCount(0)
    const canvasTop = await page.locator('.workspace-host:not(.workspace-host-hidden)').evaluate(el => el.getBoundingClientRect().top)
    const surfaceTop = await page.locator('.workspace-surface').evaluate(el => el.getBoundingClientRect().top)
    expect(canvasTop).toBe(surfaceTop)
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Collapsed workspaces' })).toBeVisible()
    await nav.getByRole('button', { name: 'Thread', exact: true }).click()
    await nav.getByRole('button', { name: 'Code', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Collapsed workspaces' })).toBeVisible()
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()

    const codeSidebar = page.locator('.sidebar')
    const resize = codeSidebar.getByRole('separator', { name: 'Sidebar width', exact: true })
    for (const [key, presses, width] of [['ArrowLeft', 20, 240], ['ArrowRight', 15, 360], ['ArrowLeft', 10, 280]] as const) {
      for (let index = 0; index < presses; index++) await resize.press(key)
      await expect(resize).toHaveAttribute('aria-valuenow', String(width))
      await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('.workspace-surface')!.getBoundingClientRect().left - document.querySelector('.sidebar')!.getBoundingClientRect().right))).toBe(0)
      await expect(codeSidebar.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
      const bounds = await codeSidebar.evaluate(el => {
        const side = el.getBoundingClientRect()
        return Array.from(el.querySelectorAll('.desktop-mode-select button, .sidebar-footer button')).every(button => {
          const box = button.getBoundingClientRect()
          return box.left >= side.left && box.right <= side.right && box.bottom <= side.bottom
        })
      })
      expect(bounds).toBe(true)
      await nav.getByRole('button', { name: 'Thread', exact: true }).click()
      await expect(page.locator('.thread-navigation')).toHaveCSS('width', `${width}px`)
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      await expect(page.locator('.settings-center-nav')).toHaveCSS('width', `${width}px`)
      await page.getByRole('button', { name: 'Close settings', exact: true }).click()
      await nav.getByRole('button', { name: 'Code', exact: true }).click()
    }
    await page.mouse.move(800, 400)
    await page.screenshot({ path: 'test-results/code-sidebar-mode.png' })
    const codeFooter = await page.locator('.desktop-nav-footer').evaluate(el => Array.from(el.querySelectorAll('button')).map(button => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    await nav.getByRole('button', { name: 'Thread', exact: true }).click()
    await expect(page.locator('.thread-navigation')).toHaveCSS('width', '280px')
    const threadFooter = await page.locator('.desktop-nav-footer').evaluate(el => Array.from(el.querySelectorAll('button')).map(button => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    expect(threadFooter).toEqual(codeFooter)
    await expect(page.getByRole('heading', { name: 'What would you like to work on?' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Thread projects' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Workspaces', exact: true })).toHaveCount(0)
    await expect(page.locator('.thread-navigation').getByRole('button', { name: 'Add project' })).toHaveCount(1)
    await expect(page.locator('.thread-navigation').getByRole('button', { name: 'New thread', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'New thread in repo' }).click()
    await expect(page.getByRole('dialog', { name: 'New thread' })).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-new-dialog.png' })
    await page.getByRole('radio', { name: /Codex/ }).check()
    await expect(page.getByRole('radio', { name: /Codex/ })).toBeChecked()
    await page.getByRole('button', { name: 'Create thread', exact: true }).click()
    const projectTree = page.locator('.thread-project-group').filter({ has: page.getByRole('button', { name: 'New thread in repo' }) })
    await expect(projectTree.locator('.thread-project-name')).toHaveText('repo')
    await expect(projectTree.locator('.thread-project-count')).toHaveCount(0)
    await expect(projectTree.locator('.thread-project-rows .thread-navigation-row')).toHaveCount(1)
    await expect(projectTree.locator('.thread-project-rows .thread-session-title')).toHaveText('New thread')
    await expect(projectTree.locator('.thread-project-rows .thread-session-meta')).toContainText('Codex')
    await expect(projectTree.locator('.thread-session-provider .agent-provider-icon')).toBeVisible()
    await expect(projectTree.locator('.thread-session-provider .agent-provider-icon')).toHaveCSS('background-color', await page.evaluate(() => { const el = document.createElement('span'); el.style.backgroundColor = 'var(--provider-codex)'; document.body.append(el); const color = getComputedStyle(el).backgroundColor; el.remove(); return color }))
    await expect(projectTree.locator('.thread-session-indicator')).toHaveAttribute('data-status', 'ready')
    await expect(projectTree.locator('.thread-session-state')).toHaveText('Ready')
    await app.evaluate(({BrowserWindow}, url) => BrowserWindow.getAllWindows()[0].webContents.send('mcp-internal:on-web-preview', {
      workspaceId:(globalThis as Record<string, unknown>).e2eWorkspaceId, threadId:'e2e-thread', url, requestedAt:Date.now()
    }), previewUrl)
    await expect(page.locator('.thread-review-panel').getByTestId('browser-preview-native')).toHaveAttribute('data-thread-id','e2e-thread')
    await expect(page.locator('.thread-review-panel').getByTestId('browser-preview-native')).toHaveAttribute('data-workspace-id', await app.evaluate(() => String((globalThis as Record<string, unknown>).e2eWorkspaceId)))
    await page.getByRole('button',{name:'Close review panel'}).click()
    const readyIcon = await projectTree.locator('.thread-session-indicator').evaluate(el => ({ icon: el.querySelector('svg')?.getAttribute('class'), color: getComputedStyle(el).color }))
    expect(readyIcon.icon).toContain('circle')
    expect(readyIcon.color).toBe(await page.evaluate(() => { const el = document.createElement('span'); el.style.color = 'var(--dot-blue)'; document.body.append(el); const color = getComputedStyle(el).color; el.remove(); return color }))
    await expect(projectTree.locator('.thread-project-children')).toHaveCSS('border-left-style', 'solid')
    await page.screenshot({ path: 'test-results/thread-project-hierarchy.png' })
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('midnight')
    await page.getByRole('button', { name: 'Thread text size' }).click()
    await expect(page.locator('output[aria-label="Thread text size"]')).toHaveText('14px')
    await page.getByRole('button', { name: 'Increase thread text size' }).click()
    await expect(page.locator('output[aria-label="Thread text size"]')).toHaveText('15px')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('oxe.thread-appearance') || '{}').state?.fontSize)).toBe(15)
    await page.getByRole('button', { name: 'Reset to default' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    const message = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect.poll(() => app.evaluate(() => Number((globalThis as Record<string, unknown>).threadCommandQueries))).toBe(1)
    await message.focus()
    await message.pressSequentially('/oxe')
    await expect(message).toBeFocused()
    await expect(page.getByRole('option', { name: /oxe-plan/ })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Filter threads' })).toHaveValue('')
    await page.keyboard.press('Tab')
    await expect(message).toHaveValue('/oxe-plan ')
    await expect(page.getByRole('listbox', { name: 'Thread commands' })).toHaveCount(0)
    await message.fill('')
    await page.keyboard.press('Control+/')
    await expect(page.getByRole('listbox', { name: 'Thread commands' })).toBeVisible()
    await expect(page.locator('.slash-overlay')).toHaveCount(0)
    const commandList = page.getByRole('listbox', { name: 'Thread commands' })
    await commandList.hover(); await page.mouse.wheel(0, 900)
    await expect.poll(() => commandList.evaluate(el => el.scrollTop)).toBeGreaterThan(100)
    for (const width of [1280, 900]) {
      await page.setViewportSize({ width, height: 600 })
      const bounds = await page.locator('.thread-command-popup').boundingBox()
      expect(bounds!.y).toBeGreaterThanOrEqual(48)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `test-results/thread-commands-${width}.png` })
    }
    await message.focus(); await page.keyboard.press('Escape')
    await expect(message).toHaveValue('/')
    await expect(page.getByRole('listbox', { name: 'Thread commands' })).toHaveCount(0)
    expect(await app.evaluate(() => Number((globalThis as Record<string, unknown>).threadCommandQueries))).toBe(1)
    await message.fill('/usage')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Usage & rate limits' })).toBeVisible()
    await expect(page.getByTestId('usage-card-claude')).toContainText('40% used')
    await expect(page.getByTestId('usage-card-codex')).toContainText('30% used')
    await page.screenshot({ path: 'test-results/thread-usage-roster.png' })
    await page.keyboard.press('Escape')
    await message.fill('/model')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const modelPicker = page.getByRole('dialog', { name: 'Select model', exact: true })
    await expect(modelPicker).toBeVisible()
    await expect(page.getByLabel('Native CLI', { exact: true })).toHaveCount(0)
    await expect(message).toBeVisible()
    await modelPicker.getByRole('button', { name: /Native model Native catalog model/ }).click()
    await message.fill('Keep this draft')
    await page.getByRole('button', { name: 'Select effort', exact: true }).click()
    await page.getByRole('button', { name: 'High', exact: true }).click()
    await expect(message).toHaveValue('Keep this draft')
    await expect(page.getByRole('button', { name: 'Select effort', exact: true })).toContainText('High')
    const threadBounds = await page.locator('.thread-view').boundingBox()
    expect(threadBounds!.height).toBeLessThanOrEqual(600)
    await page.screenshot({ path: 'test-results/thread-model-picker-900.png' })
    await message.fill('/permissions')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const native = page.getByLabel('Native CLI', { exact: true })
    await expect(native).toHaveCount(0)
    await expect(message).toBeVisible()
    const permissions = page.getByRole('dialog', { name: 'Permissions', exact: true })
    await expect(permissions).toBeVisible()
    await permissions.getByRole('button', { name: /Workspace access Allow edits inside this project/ }).click()
    const accessDialog = page.getByRole('dialog', { name: 'Change conversation access?', exact: true })
    await expect(accessDialog.getByRole('button', { name: 'Apply access', exact: true })).toBeInViewport()
    await page.screenshot({ path: 'test-results/thread-access-dialog.png' })
    await accessDialog.getByRole('button', { name: 'Apply access', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Permissions', exact: true })).toContainText('Workspace access')
    await expect(page.getByRole('button', { name: 'Permissions', exact: true })).toBeFocused()
    await expect(page.locator('.thread-timeline')).toHaveCount(1)
    await expect(page.locator('.thread-composer textarea')).toHaveCount(1)
    await expect(page.locator('.thread-navigation')).toBeVisible()
    await expect(page.locator('.slash-overlay')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Advanced CLI tools', exact: true })).toHaveCount(0)
    await expect(native).toHaveCount(0)
    await page.screenshot({ path: 'test-results/thread-integrated-controls-900.png' })
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('')
    await message.fill('Usage failure fixture')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.locator('.thread-heading h1')).toHaveText('Authentication flow')
    await expect(page.locator('.thread-navigation-row').filter({ has: page.locator('.thread-session-title', { hasText: 'Authentication flow' }) }).locator('.thread-session-state')).toHaveText('Failed')
    const failedColor = await page.locator('.thread-session-indicator[data-status="failed"]').first().evaluate(el => getComputedStyle(el).color)
    expect(failedColor).not.toBe(readyIcon.color)
    await expect(page.locator('.workbench-titlebar-context')).not.toContainText('Authentication flow')
    const failureCard = page.locator('.thread-failure-card')
    await expect(failureCard.getByText('Usage allowance exhausted', { exact: true })).toBeVisible()
    await expect(failureCard.getByLabel('Provider diagnostic')).toContainText('hit the session usage limit')
    await expect(failureCard.getByText('100% used', { exact: true })).toBeVisible()
    await expect(failureCard.locator('.thread-usage-window time')).toHaveCount(2)
    await failureCard.getByRole('button', { name: 'Refresh usage', exact: true }).click()
    await expect(failureCard.getByText('72% used', { exact: true })).toBeVisible()
    for (const width of [900, 1280]) {
      await page.setViewportSize({ width, height: 720 })
      await expect(failureCard.getByRole('button', { name: 'Refresh usage', exact: true })).toBeVisible()
      expect(await failureCard.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.screenshot({ path: `test-results/thread-failure-usage-${width}.png` })
    }
    await failureCard.locator('summary').click()
    await expect(failureCard).not.toHaveAttribute('open')
    await expect(native).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'New thread in repo' }).click()
    await page.getByRole('radio', { name: /Claude Code/ }).check()
    await page.getByRole('button', { name: 'Create thread', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Investigate authentication')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Sign in to Claude Code', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-auth-recovery.png' })
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    const accountsDialog = page.getByRole('dialog', { name: 'Agent accounts' })
    await expect(accountsDialog).toBeVisible()
    await expect.poll(() => accountsDialog.locator('.thread-account-heading .agent-provider-icon').first().evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(28)
    await page.screenshot({ path: 'test-results/thread-accounts.png' })
    const claude = accountsDialog.locator('.thread-account-card').filter({ has: page.getByText('Claude Code', { exact: true }) })
    await claude.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(claude.getByText('Complete sign-in in your browser.')).toBeVisible()
    await claude.getByRole('button', { name: 'Cancel sign-in', exact: true }).click()
    await accountsDialog.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByText('Verified fixture response', { exact: true })).toBeVisible()
    await expect(page.locator('.thread-navigation-row').filter({ has: page.locator('.thread-session-title', { hasText: 'Authentication flow' }) }).locator('.thread-session-state')).toHaveText('Completed')
    const completedIcon = await page.locator('.thread-session-indicator[data-status="completed"]').first().evaluate(el => ({ icon: el.querySelector('svg')?.getAttribute('class'), color: getComputedStyle(el).color }))
    expect(completedIcon.icon).toContain('circle-check')
    expect(completedIcon.color).toBe(readyIcon.color)
    expect(completedIcon.color).not.toBe(failedColor)
    await expect(page.locator('.thread-activity-single')).toHaveCount(1)
    await expect(page.locator('.thread-turn-timing')).toContainText('1 action')
    await expect(page.getByRole('table')).toHaveCount(1)
    await expect(page.getByRole('columnheader', { name: 'Priority', exact: true })).toBeVisible()
    await expect(page.locator('.thread-code-block pre code')).toContainText('const session')
    for (const width of [1440, 1280, 900]) {
      await page.setViewportSize({ width, height: 720 })
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const tableBounds = await page.getByRole('region', { name: 'Message table' }).evaluate(el => {
        const rect = el.getBoundingClientRect()
        return { x: rect.x, width: rect.width }
      })
      expect(tableBounds.x + tableBounds.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `test-results/thread-${width}.png` })
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'one-dark' })
    await page.screenshot({ path: 'test-results/thread-one-dark-900.png' })
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const zoom of [1.25, 1.5]) {
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
      await page.screenshot({ path: `test-results/thread-scale-${zoom}.png` })
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Imported formatting fixture')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Apresentação da conversa' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show full message' })).toBeVisible()
    expect(await page.getByText('private local path').count()).toBe(0)
    await page.screenshot({ path: 'test-results/thread-imported-formatting.png' })
    await page.getByRole('button', { name: 'Show full message' }).click()
    await expect(page.getByText(/Image #1 attached/)).toBeVisible()
    await page.setViewportSize({ width: 900, height: 600 })
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Long history fixture')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Review message 3333', { exact: true })).toBeAttached()
    const geometry = await page.evaluate(() => Object.fromEntries(['.app-shell', '.workspace-surface', '.thread-view', '.thread-timeline', '.thread-composer'].map(selector => {
      const el = document.querySelector(selector) as HTMLElement
      return [selector, { height: el.clientHeight, scroll: el.scrollHeight, bottom: el.getBoundingClientRect().bottom }]
    })))
    console.log('Thread geometry', JSON.stringify(geometry))
    expect(geometry['.thread-composer'].bottom).toBeLessThanOrEqual(600)
    expect(geometry['.thread-timeline'].scroll).toBeGreaterThan(geometry['.thread-timeline'].height)
    expect(geometry['.app-shell'].height).toBe(600)
    await expect(page.locator('.thread-virtual-space')).toHaveAttribute('data-total-rows', '10002')
    expect(await page.locator('.thread-virtual-row').count()).toBeLessThanOrEqual(80)
    const visibleMessages = () => page.evaluate(() => {
      const viewport = document.querySelector('.thread-timeline')!.getBoundingClientRect()
      return [...document.querySelectorAll('.thread-virtual-row .thread-message')].filter(message => {
        const rect = message.getBoundingClientRect()
        return rect.bottom > viewport.top && rect.top < viewport.bottom
      }).length
    })
    await page.locator('.thread-timeline').hover()
    await page.mouse.wheel(0, -1)
    await page.locator('.thread-timeline').evaluate(el => { el.scrollTop = el.scrollHeight / 2 })
    await expect.poll(visibleMessages).toBeGreaterThan(0)
    await page.locator('.thread-timeline').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(visibleMessages).toBeGreaterThan(0)
    await page.locator('.thread-timeline').hover()
    const timeline = page.locator('.thread-timeline')
    const end = await timeline.evaluate(el => el.scrollTop)
    await page.mouse.wheel(0, -1500)
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeLessThan(end - 500)
    await expect(page.getByRole('button', { name: /Latest messages/ })).toBeVisible()
    await timeline.focus()
    await page.keyboard.press('Home')
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBe(0)
    await page.keyboard.press('End')
    await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(64)
    await page.keyboard.press('PageUp')
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeLessThan(end - 100)
    await page.mouse.wheel(0, -1)
    await timeline.evaluate(el => { el.scrollTop = el.scrollHeight / 2 })
    await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(500)
    await timeline.evaluate(async el => {
      let previous = el.scrollTop, stable = 0
      for (let frame = 0; frame < 120; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        const current = el.scrollTop
        stable = current === previous ? stable + 1 : 0
        previous = current
        if (stable >= 6) return
      }
      throw Error('Keyboard scroll did not settle')
    })
    const readingAnchor = await timeline.evaluate(el => {
      const viewportTop = el.getBoundingClientRect().top
      const row = [...el.querySelectorAll<HTMLElement>('.thread-virtual-row')].find(candidate => candidate.getBoundingClientRect().bottom > viewportTop)
      if (!row) throw Error('No visible timeline anchor')
      return { key: row.dataset.threadRow, offset: Math.round(row.getBoundingClientRect().top - viewportTop) }
    })
    const expectReadingAnchor = async (tolerance = 0) => expect.poll(() => timeline.evaluate((el, expected) => {
      const row = [...el.querySelectorAll<HTMLElement>('.thread-virtual-row')].find(candidate => candidate.dataset.threadRow === expected.key)
      return row ? Math.abs(Math.round(row.getBoundingClientRect().top - el.getBoundingClientRect().top) - expected.offset) : Number.NaN
    }, readingAnchor)).toBeLessThanOrEqual(tolerance)
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Append streaming fixture'))
    await expect(page.getByRole('button', { name: 'Stop turn', exact: true })).toBeVisible()
    const liveActivity = page.locator('.thread-live-activity')
    await expect(liveActivity.getByRole('status')).toHaveText('Analyzing request')
    await expect(liveActivity).toContainText('Last provider signal')
    await app.evaluate(() => (globalThis as Record<string, (enabled: boolean) => void>).longThreadCommandFixture(true))
    await expect(liveActivity).toContainText('Running command')
    await expect(liveActivity.locator('time')).toContainText('Turn ·')
    expect(await liveActivity.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await app.evaluate(() => (globalThis as Record<string, (enabled: boolean) => void>).longThreadCommandFixture(false))
    const runningDot = page.locator('.thread-session-indicator[data-status="running"]').first()
    await expect(runningDot).toBeVisible()
    const runningColors = await runningDot.evaluate(el => ({ label: getComputedStyle(el).color, dot: getComputedStyle(el, '::before').backgroundColor, green: (() => { const token = document.createElement('span'); token.style.color = 'var(--dot-green)'; document.body.append(token); const color = getComputedStyle(token).color; token.remove(); return color })() }))
    expect(runningColors.label).toBe(runningColors.green)
    expect(runningColors.dot).toBe(runningColors.green)
    expect(runningColors.dot).not.toBe(readyIcon.color)
    const runningActions = await page.evaluate(() => {
      const footer = document.querySelector('.thread-composer > footer')!.getBoundingClientRect()
      const stop = document.querySelector('.thread-stop')!.getBoundingClientRect()
      const send = document.querySelector('.thread-send')!.getBoundingClientRect()
      return { gap: send.left - stop.right, rightInset: footer.right - send.right, stopWidth: stop.width, sendWidth: send.width }
    })
    expect(runningActions.gap).toBeGreaterThanOrEqual(0)
    expect(runningActions.gap).toBeLessThanOrEqual(12)
    expect(runningActions.rightInset).toBeLessThanOrEqual(12)
    expect(runningActions.stopWidth).toBe(28)
    expect(runningActions.sendWidth).toBe(28)
    await expectReadingAnchor()
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Unsent draft')
    await nav.getByRole('button', { name: 'Code', exact: true }).click()
    await expect(grid).toBeVisible()
    expect(await page.locator('.xterm').count()).toBe(terminalCount)
    await nav.getByRole('button', { name: 'Thread', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Unsent draft')
    // Font and virtual-row measurements can settle a few pixels differently
    // after remounting Thread; a large reading-position jump still fails.
    await expectReadingAnchor(4)
    await liveActivity.locator('details').evaluate((el: HTMLDetailsElement) => { el.open = true })
    await expect(liveActivity).toContainText('Checking project files.')
    await page.screenshot({ path: 'test-results/thread-reading.png' })
    await app.evaluate(() => (globalThis as Record<string, () => void>).silenceThreadFixture())
    await expect(liveActivity).toContainText('Execution outcome is not confirmed. Your message was not resent.')
    await expect(liveActivity.getByRole('status').first()).toHaveText('Waiting for a confirmed provider update')
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Unsent draft')
    await expect(page.getByRole('button', { name: 'Stop turn', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Latest messages/ }).click()
    await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(64)
    await page.screenshot({ path: 'test-results/thread-long-900.png' })
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Collapsed threads' })).toBeVisible()
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Thread projects' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Unsent draft')
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Sidebar history fixture'))
    await expect(page.getByRole('button', { name: /^History conversation 69/ })).toBeAttached()
    const projects = page.getByRole('navigation', { name: 'Thread projects' })
    await expect(projects.locator('.thread-project-rows .thread-navigation-row')).toHaveCount(71)
    await page.screenshot({ path: 'test-results/thread-project-history.png' })
    await page.getByRole('button', { name: 'Compact thread list', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Compact thread list', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await projects.locator('.thread-navigation-item').first().evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(40)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('oxe.navigation')!).state.threadDensity)).toBe('compact')
    await page.screenshot({ path: 'test-results/thread-project-history-compact.png' })
    await page.getByRole('button', { name: 'Compact thread list', exact: true }).click()
    await projects.hover()
    await page.mouse.wheel(0, 900)
    await expect.poll(() => projects.evaluate(el => el.scrollTop)).toBeGreaterThan(100)
    await expect(page.getByRole('button', { name: 'Agent accounts', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Filter threads' }).fill('History conversation 69')
    await expect(page.getByRole('button', { name: /^History conversation 69/ })).toBeVisible()
    await expect(projects.locator('.thread-navigation-item')).toHaveCount(1)
    await page.getByRole('searchbox', { name: 'Filter threads' }).fill('')
    const mainThreadName = await projects.locator('.thread-navigation-item[aria-current="page"] span').first().textContent()
    const mainThreadButton = projects.locator('.thread-navigation-item').filter({ hasText: mainThreadName! }).first()
    await page.getByRole('button', { name: /^History conversation 69/ }).click()
    await expect(page.getByText('Independent conversation history-69')).toBeVisible()
    await mainThreadButton.click()
    await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(64)
    await timeline.hover()
    await page.mouse.wheel(0, -700)
    await expect(page.getByRole('button', { name: /Latest messages/ })).toBeVisible()
    const savedReadingTop = await timeline.evaluate(el => el.scrollTop)
    await page.getByRole('button', { name: /^History conversation 69/ }).click()
    await mainThreadButton.click()
    await page.waitForTimeout(700)
    await expect.poll(() => timeline.evaluate((el, top) => Math.abs(el.scrollTop - top), savedReadingTop)).toBeLessThanOrEqual(64)
    const sessionActions = page.getByRole('button', { name: 'Actions for History conversation 69' })
    const actionBounds = await sessionActions.boundingBox()
    await sessionActions.click()
    const sessionMenu = page.getByRole('menu', { name: 'Actions for History conversation 69' })
    await expect(sessionMenu.getByRole('menuitem', { name: 'Open to the side' })).toBeVisible()
    await expect(sessionMenu.getByRole('menuitem', { name: 'Pin conversation' })).toBeVisible()
    await expect(sessionMenu.getByRole('menuitem', { name: 'Rename conversation…' })).toBeVisible()
    await expect(sessionMenu.getByRole('menuitem', { name: 'Mark as unread' })).toBeVisible()
    await expect(sessionMenu.getByRole('menuitem', { name: 'Archive conversation' })).toBeVisible()
    const menuBounds = await sessionMenu.boundingBox()
    expect(actionBounds).not.toBeNull()
    expect(menuBounds).not.toBeNull()
    expect(menuBounds!.x).toBeGreaterThanOrEqual(actionBounds!.x - 8)
    expect(menuBounds!.x).toBeLessThan(actionBounds!.x + 80)
    expect(menuBounds!.y).toBeLessThanOrEqual(actionBounds!.y + actionBounds!.height)
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 4)
    await page.screenshot({ path: 'test-results/thread-session-menu.png' })
    await sessionMenu.getByRole('menuitem', { name: 'Mark as unread' }).click()
    await expect(page.getByRole('button', { name: /^Unread conversation History conversation 69/ })).toBeVisible()
    await page.getByRole('button', { name: 'Open History conversation 69 side by side' }).click()
    await expect(page.getByRole('group', { name: 'Side-by-side conversations' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Unread conversation History conversation 69/ })).toHaveCount(0)
    const cells = page.locator('.thread-cell')
    await expect(cells).toHaveCount(2)
    await cells.nth(1).getByRole('textbox').fill('Independent draft')
    await expect(cells.first().getByRole('textbox')).toHaveValue('Unsent draft')
    await page.getByRole('button', { name: 'Close side-by-side conversation' }).click()
    await expect(page.getByRole('group', { name: 'Side-by-side conversations' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Unsent draft')
    await app.evaluate(() => ((globalThis as Record<string, unknown>).finishThreadFixture as () => void)())
    await expect(page.getByRole('button', { name: 'Stop turn' })).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 900 })
    const wideGeometry = await page.evaluate(() => {
      const view = document.querySelector('.thread-view')!.getBoundingClientRect()
      const reading = document.querySelector('.thread-reading-column')!.getBoundingClientRect()
      const composer = document.querySelector('.thread-composer-column')!.getBoundingClientRect()
      return {
        readingWidth: reading.width,
        composerWidth: composer.width,
        viewWidth: view.width,
        readingCenterDelta: Math.abs((reading.left + reading.width / 2) - (view.left + view.width / 2)),
        composerCenterDelta: Math.abs((composer.left + composer.width / 2) - (view.left + view.width / 2))
      }
    })
    expect(wideGeometry.readingWidth).toBeGreaterThan(850)
    expect(wideGeometry.readingWidth).toBeLessThanOrEqual(1100)
    expect(wideGeometry.composerWidth).toBe(wideGeometry.readingWidth)
    expect(wideGeometry.viewWidth).toBeGreaterThan(wideGeometry.readingWidth)
    // The timeline reserves an 8px scrollbar gutter, so its visual center may
    // differ by half that gutter while remaining aligned with the composer.
    expect(wideGeometry.readingCenterDelta).toBeLessThanOrEqual(5)
    expect(wideGeometry.composerCenterDelta).toBeLessThanOrEqual(5)
    await page.screenshot({ path: 'test-results/thread-wide-layout-1440.png' })
    await message.fill('Workbench fixture'); await message.press('Enter')
    await expect(page.locator('.thread-file-activity')).toHaveCount(3)
    await expect(page.getByRole('complementary', { name: 'Thread workbench' })).toBeVisible()
    await page.getByRole('button', { name: 'Expand file diff src/App.tsx' }).click()
    await expect(page.locator('.thread-inline-evidence')).toContainText('ThreadWorkbench')
    const inlineDiff = page.locator('.thread-inline-evidence')
    expect(await inlineDiff.evaluate(element => {
      const column = element.closest('.thread-reading-column')!
      return element.getBoundingClientRect().right <= column.getBoundingClientRect().right + 1
    })).toBe(true)
    expect(await inlineDiff.locator('.thread-review-diff').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Expand file diff src/App.tsx' }).click()
    await page.locator('.thread-file-entry').first().click()
    await expect(page.getByRole('region', { name: 'File diff' })).toBeVisible()
    await expect(page.locator('.thread-workbench')).not.toHaveClass(/is-drawer/)
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
    await expect(page.locator('.thread-change-summary')).toContainText('3 files reported')
    await page.screenshot({ path: 'test-results/thread-workbench-1440.png' })
    await page.getByRole('button', { name: 'Comment on new line 13' }).click()
    await page.getByRole('textbox', { name: 'Review comment' }).fill('Keep the conversation mounted when opening review.')
    await page.getByRole('button', { name: 'Add to conversation' }).click()
    await expect(message).toHaveValue(/Review comment: src\/App.tsx \(new line 13\)/)
    await expect(message).toHaveValue(/hash-artifact-0/)
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Files', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Source control', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Find in files', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Scripts', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Background activity', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Web preview', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Terminal', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Diagnostics', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Agents', exact: true })).toBeVisible()
    await page.getByRole('menuitemradio', { name: 'Background activity', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Activity source' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Activity source' }).getByRole('button', { name: 'Delegated work' }).click()
    await expect(page.getByText('No delegated work')).toBeVisible()
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Files', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Workspace files' })).toBeVisible()
    await page.getByRole('button', { name: 'README.md', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Editor' })).toContainText('README.md')
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Source control', exact: true }).click()
    await expect(page.locator('.git-control')).toContainText('feature/thread')
    await expect(page.locator('.git-control')).toContainText('README.md')
    await page.screenshot({ path: 'test-results/thread-git-control-1440.png' })
    await page.getByRole('button', { name: 'GitHub features' }).click()
    await expect(page.getByRole('navigation', { name: 'GitHub tabs' })).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-source-control-1440.png' })
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Project changes' }).click()
    await expect(page.getByRole('region', { name: 'File diff' })).toContainText('Earlier project work')
    await expect(page.locator('.thread-review-source').first()).toContainText('earlier work')
    await page.getByRole('button', { name: 'Read Markdown README.md' }).click()
    const markdownDialog = page.getByRole('dialog', { name: 'README.md' })
    await expect(markdownDialog.getByRole('region', { name: 'Markdown document' })).toContainText('Thread workbench fixture')
    expect((await markdownDialog.boundingBox())!.width).toBeGreaterThan(800)
    await page.screenshot({ path: 'test-results/thread-markdown-reader.png' })
    await markdownDialog.getByRole('button', { name: 'Close readme.md' }).click()
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Activity', exact: true }).click()
    await expect(page.locator('.thread-review-log')).toContainText('npm run typecheck')
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Agents', exact: true }).click()
    await expect(page.locator('.thread-review-agents')).toContainText('native-child')
    await expect(page.locator('.thread-review-agents')).toContainText('Review complete')
    await page.screenshot({ path: 'test-results/thread-agents-1440.png' })
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Plan', exact: true }).click()
    await expect(page.locator('.thread-review-panel .thread-plan')).toContainText('2/2 completed')
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Session changes' }).click()
    await expect(page.locator('.thread-session-change-group')).toContainText('Turn 1')
    await expect(page.locator('.thread-session-operations')).toContainText('Provider patch')
    await page.screenshot({ path: 'test-results/thread-session-changes-1440.png' })
    await page.setViewportSize({ width: 900, height: 720 })
    await expect(page.locator('.thread-workbench')).toHaveClass(/is-drawer/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/thread-workbench-900.png' })
    await page.getByRole('button', { name: 'Close review panel' }).click()
    await expect(page.getByRole('complementary', { name: 'Thread workbench' })).toHaveCount(0)
    await expect(message).toBeFocused()
    await expect(message).toHaveValue(/Keep the conversation mounted/)
    await expect(page.locator('.xterm')).toHaveCount(terminalCount)
    const actions = page.getByRole('button', { name: 'Conversation actions' })
    await actions.click()
    const actionsMenu = page.getByRole('menu', { name: 'Conversation actions' })
    await expect(actionsMenu).toBeVisible()
    await expect(actionsMenu.getByRole('menuitem', { name: 'Find or resume session…' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Fork conversation' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete conversation' })).toHaveClass(/is-destructive/)
    const bounds = await actionsMenu.boundingBox()
    expect(bounds!.width).toBeLessThan(280)
    expect(bounds!.height).toBeLessThan(370)
    await page.screenshot({ path: 'test-results/thread-conversation-actions.png' })
    await page.keyboard.press('Escape')
    await expect(actionsMenu).toHaveCount(0)
    await expect(actions).toBeFocused()
    await expect(message).toHaveValue(/Keep the conversation mounted/)
    await page.setViewportSize({ width: 1440, height: 900 })
    await message.fill('Approval fixture'); await message.press('Enter')
    const approval = page.getByRole('region', { name: 'Approve command' })
    await expect(approval).toContainText('This command may modify docs/thread-view.md.')
    await expect(approval).toContainText('Readable preview')
    await expect(approval.locator('.thread-approval-preview pre')).toContainText('First line\nSecond line')
    await page.screenshot({ path: 'test-results/thread-approval-1440.png' })
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Workbench fixture'))
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Long history fixture'))
    await expect(page.locator('.thread-virtual-space')).toHaveAttribute('data-total-rows', '10002')
    await page.reload()
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    await expect(page.locator('.thread-virtual-space')).toHaveAttribute('data-total-rows', '10002')
    await expect(page.getByText('Review message 3333', { exact: true })).toBeVisible()
    const latestMessage = page.locator('.thread-message-user').filter({ hasText: 'Review message 3333' })
    const latestResponse = page.locator('.thread-message-assistant').filter({ hasText: 'A detailed response to verify the conversation history.' }).last()
    await expect(latestMessage.getByRole('button', { name: 'Copy message' })).toBeVisible()
    await expect(latestResponse).toHaveClass(/is-final-response/)
    await expect(latestResponse.getByText('Final response')).toBeVisible()
    await expect(latestResponse.getByRole('button', { name: 'Copy final response' })).toBeVisible()
    await expect(page.locator('.thread-virtual-turn.is-turn-end').last().locator('.thread-turn-timing')).toContainText('Completed')
    await expect(latestMessage.getByRole('button', { name: 'Edit and retry this message' })).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-message-actions.png' })
    await latestMessage.getByRole('button', { name: 'Copy message' }).click()
    await expect.poll(() => page.evaluate(() => window.oxe.clipboard.readText())).toBe('Review message 3333')
    await latestResponse.getByRole('button', { name: 'Copy final response' }).click()
    await expect.poll(() => page.evaluate(() => window.oxe.clipboard.readText())).toContain('A detailed response to verify the conversation history.')
    await page.setViewportSize({ width: 900, height: 600 })
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Long command fixture'))
    const longCommand = page.locator('.thread-activity-single')
    await expect(longCommand).toContainText('Ran command')
    await longCommand.locator(':scope > summary').click()
    await expect(longCommand).toContainText('Result unconfirmed')
    await expect(longCommand.locator('pre')).not.toBeVisible()
    await expect(longCommand.getByRole('button', { name: 'Open session diagnostics' })).toBeVisible()
    await longCommand.getByText('Technical details').click()
    const commandBounds = await longCommand.locator('pre').evaluate(el => ({ right: el.getBoundingClientRect().right, viewport: document.querySelector('.thread-timeline')!.getBoundingClientRect().right, scroll: el.scrollWidth, width: el.clientWidth }))
    expect(commandBounds.right).toBeLessThanOrEqual(commandBounds.viewport)
    expect(commandBounds.scroll).toBeLessThanOrEqual(commandBounds.width + 1)
    await longCommand.getByRole('button', { name: 'Open session diagnostics' }).click()
    await expect(page.getByRole('complementary', { name: 'Thread workbench' })).toBeVisible()
    await page.getByRole('button', { name: 'Check provider state', exact: true }).click()
    await expect(page.getByText('Provider: unknown', { exact: true })).toBeVisible()
    await expect(page.getByText('Provider outcome is unconfirmed. No message was resent.', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-provider-observation.png' })
    await page.getByRole('button', { name: 'Close review panel' }).click()
    await app.evaluate(() => ((globalThis as Record<string, unknown>).setPartialHistoryFixture as () => void)())
    await expect(page.getByText(/You can continue this conversation here/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Recover conversation' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Structured question fixture'))
    await expect(page.getByRole('region', { name: 'Pending agent requests' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Claude needs your input' })).toBeVisible()
    await page.getByRole('radio', { name: 'Staged' }).check()
    await page.getByRole('region', { name: 'Claude needs your input' }).getByRole('button', { name: 'Next' }).click()
    await page.getByRole('radio', { name: 'Pilot', exact: true }).check()
    await page.screenshot({ path: 'test-results/thread-question-interactive.png' })
    console.log('Question geometry', await page.evaluate(() => Object.fromEntries(['.thread-timeline', '.thread-request-question', '.thread-request-question fieldset:not([hidden])', '.thread-request-question footer'].map(selector => {
      const element = document.querySelector(selector)!, rect = element.getBoundingClientRect()
      return [selector, { top: rect.top, bottom: rect.bottom, height: rect.height, scroll: element.scrollHeight }]
    }))))
    await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeInViewport()
    const questionLayout = await page.locator('.thread-request-question').evaluate(card => ({
      bodyBottom: card.querySelector('.thread-question-body')!.getBoundingClientRect().bottom,
      footerTop: card.querySelector('footer')!.getBoundingClientRect().top,
      bodyOverflow: getComputedStyle(card.querySelector('.thread-question-body')!).overflowY
    }))
    expect(questionLayout.bodyBottom).toBeLessThanOrEqual(questionLayout.footerTop + 1)
    expect(questionLayout.bodyOverflow).toBe('auto')
    await page.screenshot({ path: 'test-results/thread-question-interactive.png' })
    await page.getByRole('button', { name: 'Answer', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).lastThreadAnswer)).toEqual({ answers: { rollout: ['Staged'], validation: ['Pilot'] } })
    await expect(page.getByText('Answer sent to agent')).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-question-answered.png' })
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Structured question fixture'))
    await page.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect(page.getByText('Declined by you')).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-question-declined.png' })
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Lost approval fixture'))
    await expect(page.getByText(/Connection closed; response not confirmed/)).toBeVisible()
    const savedApproval = page.locator('.thread-request-history')
    await savedApproval.locator('summary').click()
    await expect(savedApproval.getByText(/No permission was inferred or resent/)).toBeVisible()
    await expect(savedApproval.locator('button, input')).toHaveCount(0)
    expect(await savedApproval.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/thread-lost-approval.png' })
    await app.evaluate(() => (globalThis as Record<string, (missing: boolean) => void>).missingInputFixture(true))
    await expect(page.getByRole('button', { name: 'Refresh request', exact: true })).toBeVisible()
    await app.evaluate(() => (globalThis as Record<string, (missing: boolean) => void>).missingInputFixture(false))
    const requestDock = page.getByRole('region', { name: 'Pending agent requests' })
    await expect(requestDock.getByText('Allow this memory update?')).toBeVisible()
    await timeline.evaluate(element => { element.scrollTop = 0 })
    await expect(requestDock.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport()
    await requestDock.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).lastThreadAnswer)).toEqual({ decision: 'accept', content: {} })
    await expect(requestDock).toHaveCount(0)
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Historical questions fixture'))
    const historicalQuestions = page.getByRole('complementary', { name: 'Recovered questions' })
    await expect(historicalQuestions).toBeVisible()
    await expect(historicalQuestions).toContainText('Answer not confirmed')
    await expect(historicalQuestions).toContainText('Additional context?')
    await expect(historicalQuestions.getByRole('listitem')).toHaveCount(2)
    await expect(historicalQuestions.locator('button, input')).toHaveCount(0)
    expect(await historicalQuestions.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/thread-historical-questions.png' })
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Prose choices fixture'))
    const suggestions = page.getByLabel('Suggested replies')
    await expect(suggestions.getByRole('button', { name: 'A (Recomendado)' })).toBeVisible()
    await suggestions.getByRole('button', { name: 'A (Recomendado)' }).click()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('A')
    const archived = page.getByRole('region', { name: 'Archived conversations' })
    await expect(archived.getByRole('button', { name: 'Archived 1' })).toHaveAttribute('aria-expanded', 'false')
    await archived.getByRole('button', { name: 'Archived 1' }).click()
    await expect(archived.getByRole('button', { name: 'Restore Archived agent work' })).toBeVisible()
    await archived.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/thread-archived-sessions.png' })
    await archived.getByRole('button', { name: 'Restore Archived agent work' }).click()
    await expect(page.locator('.thread-heading h1')).toHaveText('Archived agent work')
    await expect(page.getByRole('region', { name: 'Archived conversations' })).toHaveCount(0)
    if (process.env.OXESPACE_VISUAL_AUDIT_OUTPUT) {
      await page.setViewportSize({ width: 900, height: 600 })
      await page.getByRole('button', { name: 'Settings for repo', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.screenshot({ path: 'test-results/thread-project-settings-audit.png' })
      for (let index = 0; index < 15; index++) {
        await page.keyboard.press('Tab')
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
      }
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Settings for repo', exact: true })).toBeFocused()
    }
  } finally {
    await app.close()
    await new Promise<void>(resolve => previewServer.close(() => resolve()))
  }
})
