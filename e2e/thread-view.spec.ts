import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Thread UI preserves Code terminals and renders a structured conversation', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-thread-ui-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  writeFileSync(join(repo, 'README.md'), '# Thread workbench fixture\n\nSearchable project content.\n')
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain, BrowserWindow }, fixtureRoot) => {
      let snapshot: Record<string, unknown> | null = null
      let sendCount = 0, manyThreads = false
      ;(globalThis as Record<string, unknown>).threadCommandQueries = 0
      const changed = () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: 'e2e-thread' }) }
      ;(globalThis as Record<string, unknown>).finishThreadFixture = () => { (snapshot!.thread as Record<string, unknown>).status = 'idle'; changed() }
      for (const channel of ['commands', 'list', 'read', 'create', 'send', 'pin', 'projects', 'models', 'configure', 'command', 'artifact', 'project-diff']) ipcMain.removeHandler(`thread:${channel}`)
      const reviewPatch = '--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -12,5 +12,7 @@\n export function App() {\n-  return <ThreadView />\n+  return <ThreadWorkbench>\n+    <ThreadView />\n+  </ThreadWorkbench>\n }\n'
      ipcMain.handle('thread:artifact', (_event, id, artifactId) => {
        if (id !== 'e2e-thread') throw Error('Invalid evidence scope')
        return { id: artifactId, content: reviewPatch, hash: `hash-${artifactId}`, bytes: reviewPatch.length, truncated: false, source: 'native-patch' }
      })
      ipcMain.handle('thread:project-diff', () => ({ files: [{ path: 'src/ExistingWork.ts', additions: 1, deletions: 0, mtime: null, hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ type: 'added', oldLineNo: null, newLineNo: 1, content: 'Earlier project work' }] }] }], base: 'HEAD', includeUncommitted: true, compiledAt: Date.now() }))
      ipcMain.handle('thread:models', () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: 'Native catalog model', efforts: ['low', 'high'], defaultEffort: 'low' }] }))
      ipcMain.handle('thread:configure', (_event, _id, configuration, revision) => { Object.assign(snapshot!.thread as object, configuration, { configurationRevision: revision + 1 }); changed(); return snapshot })
      ipcMain.handle('thread:command', (_event, _id, text) => text.trim() === '/usage' ? { kind: 'panel', title: 'Usage limits', usage: { checkedAt: Date.now(), windows: [{ label: 'Codex · Session · 5 hours', usedPercent: 100, resetsAt: Date.now() + 3600000 }, { label: 'Codex · Weekly', usedPercent: 72, resetsAt: Date.now() + 86400000 }] } } : { kind: 'panel', surface: text.trim().slice(1) })
      ipcMain.handle('thread:commands', () => { (globalThis as Record<string, unknown>).threadCommandQueries = Number((globalThis as Record<string, unknown>).threadCommandQueries) + 1; return { commands: [
        { name: 'oxe-plan', description: 'Plan a project change', source: 'claude' },
        { name: 'compact', description: 'Summarize conversation context', source: 'claude' },
        ...Array.from({ length: 45 }, (_, index) => ({ name: `skill-${index}`, description: `Project skill ${index}`, source: 'claude' }))
      ] } })
      ipcMain.removeHandler('voice:get-model-status')
      ipcMain.handle('voice:get-model-status', (_event, size) => ({ size, ready: true, path: '/fixture/voice', engineReady: true }))
      ipcMain.handle('thread:projects', () => ({ projects: [], unavailable: [] }))
      const accounts = new Map<string, Record<string, unknown>>()
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
      ipcMain.handle('thread:list', () => snapshot ? [snapshot.thread, ...(manyThreads ? Array.from({ length: 70 }, (_, index) => ({ ...(snapshot!.thread as object), id: `history-${index}`, title: `History conversation ${index}`, status: 'idle', updatedAt: Date.now() - (index + 1) * 60000 })) : [])] : [])
      ipcMain.handle('thread:read', (_event, id) => id !== 'e2e-thread' && snapshot ? ({
        thread: { ...snapshot.thread, id, title: id.startsWith('history-') ? `History conversation ${id.slice('history-'.length)}` : String(id), status: 'idle' },
        events: [{ type: 'message', id: `${id}-answer`, role: 'assistant', text: `Independent conversation ${id}` }, { type: 'completed', status: 'completed' }]
      }) : snapshot)
      ipcMain.handle('thread:create', (_event, input) => {
        snapshot = { thread: { id: 'e2e-thread', workspaceId: input.workspaceId, projectId: 'e2e-project', rootPath: fixtureRoot,
          provider: input.provider, nativeSessionId: null, title: 'New thread', pinned: false, status: 'idle', createdAt: Date.now(), updatedAt: Date.now() }, events: [] }
        changed(); return snapshot
      })
      ipcMain.handle('thread:send', (_event, _id, text) => {
        const thread = snapshot!.thread as Record<string, unknown>
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
        if (++sendCount === 1) {
          thread.status = 'failed'
          snapshot!.events = [{ type: 'message', id: 'user', role: 'user', text },
            { type: 'completed', status: 'failed', errorCode: 'authentication' }]
          changed(); return
        }
        thread.status = 'idle'
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
    await page.keyboard.press('Control+Shift+v')
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
    for (const [key, presses, width] of [['ArrowLeft', 20, 240], ['ArrowRight', 15, 360], ['ArrowLeft', 14, 248]] as const) {
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
    await expect(page.locator('.thread-navigation')).toHaveCSS('width', '248px')
    const threadFooter = await page.locator('.desktop-nav-footer').evaluate(el => Array.from(el.querySelectorAll('button')).map(button => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    expect(threadFooter).toEqual(codeFooter)
    await expect(page.getByRole('heading', { name: 'What would you like to work on?' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Thread projects' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Workspaces', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'New thread', exact: true }).click()
    await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('codex')
    await page.getByRole('button', { name: 'Create thread', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    const message = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect.poll(() => app.evaluate(() => Number((globalThis as Record<string, unknown>).threadCommandQueries))).toBe(1)
    await message.focus()
    await page.keyboard.type('/oxe')
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
    await permissions.getByRole('button', { name: 'Allow workspace access', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Permissions', exact: true })).toContainText('Workspace access')
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
    await page.getByRole('button', { name: 'New thread', exact: true }).click()
    await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('claude')
    await page.getByRole('button', { name: 'Create thread', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Investigate authentication')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Sign in to Claude Code', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-auth-recovery.png' })
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    const accountsDialog = page.getByRole('dialog', { name: 'Agent accounts' })
    await expect(accountsDialog).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-accounts.png' })
    const claude = accountsDialog.locator('.thread-account-card').filter({ has: page.getByText('Claude Code', { exact: true }) })
    await claude.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(claude.getByText('Complete sign-in in your browser.')).toBeVisible()
    await claude.getByRole('button', { name: 'Cancel sign-in', exact: true }).click()
    await accountsDialog.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByText('Verified fixture response', { exact: true })).toBeVisible()
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
    const expectReadingAnchor = async () => expect.poll(() => timeline.evaluate((el, expected) => {
      const row = [...el.querySelectorAll<HTMLElement>('.thread-virtual-row')].find(candidate => candidate.dataset.threadRow === expected.key)
      return row ? Math.round(row.getBoundingClientRect().top - el.getBoundingClientRect().top) : Number.NaN
    }, readingAnchor)).toBeCloseTo(readingAnchor.offset, 0)
    await page.evaluate(() => window.oxe.thread!.send('e2e-thread', 'Append streaming fixture'))
    await expect(page.getByRole('button', { name: 'Stop turn', exact: true })).toBeVisible()
    await expectReadingAnchor()
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Unsent draft')
    await nav.getByRole('button', { name: 'Code', exact: true }).click()
    await expect(grid).toBeVisible()
    expect(await page.locator('.xterm').count()).toBe(terminalCount)
    await nav.getByRole('button', { name: 'Thread', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Unsent draft')
    await expectReadingAnchor()
    await page.screenshot({ path: 'test-results/thread-reading.png' })
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
    await projects.hover()
    await page.mouse.wheel(0, 900)
    await expect.poll(() => projects.evaluate(el => el.scrollTop)).toBeGreaterThan(100)
    await expect(page.getByRole('button', { name: 'Agent accounts', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Filter threads' }).fill('History conversation 69')
    await expect(page.getByRole('button', { name: /^History conversation 69/ })).toBeVisible()
    await expect(projects.locator('.thread-navigation-item')).toHaveCount(1)
    await page.getByRole('searchbox', { name: 'Filter threads' }).fill('')
    await page.getByRole('button', { name: 'Open History conversation 69 side by side' }).click()
    await expect(page.getByRole('group', { name: 'Side-by-side conversations' })).toBeVisible()
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
        readingRatio: reading.width / view.width,
        composerRatio: composer.width / view.width,
        readingCenterDelta: Math.abs((reading.left + reading.width / 2) - (view.left + view.width / 2)),
        composerCenterDelta: Math.abs((composer.left + composer.width / 2) - (view.left + view.width / 2))
      }
    })
    expect(wideGeometry.readingRatio).toBeGreaterThan(.9)
    expect(wideGeometry.composerRatio).toBeGreaterThan(.85)
    // The timeline reserves an 8px scrollbar gutter, so its visual center may
    // differ by half that gutter while remaining aligned with the composer.
    expect(wideGeometry.readingCenterDelta).toBeLessThanOrEqual(5)
    expect(wideGeometry.composerCenterDelta).toBeLessThanOrEqual(5)
    await page.screenshot({ path: 'test-results/thread-wide-layout-1440.png' })
    await message.fill('Workbench fixture'); await message.press('Enter')
    await expect(page.locator('.thread-file-activity')).toHaveCount(3)
    await page.getByRole('button', { name: 'Expand file diff src/App.tsx' }).click()
    await expect(page.locator('.thread-inline-evidence')).toContainText('ThreadWorkbench')
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
    await expect(page.getByRole('menuitemradio', { name: 'Background jobs', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Web preview', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Terminal', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Diagnostics', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Agents', exact: true })).toBeVisible()
    await page.getByRole('menuitemradio', { name: 'Files', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Workspace files' })).toBeVisible()
    await page.getByRole('button', { name: 'README.md', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Editor' })).toContainText('README.md')
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Source control', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'GitHub tabs' })).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-source-control-1440.png' })
    await page.getByRole('button', { name: 'Select review panel' }).click()
    await page.getByRole('menuitemradio', { name: 'Project changes' }).click()
    await expect(page.getByRole('region', { name: 'File diff' })).toContainText('Earlier project work')
    await expect(page.locator('.thread-review-source').first()).toContainText('earlier work')
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
  } finally { await app.close() }
})
