import { modeButton } from './helpers/modes'
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Renderer-level proof for the Thread hardening work, against the real built
 * renderer in Electron: delivery notes, queue pause and the context ring,
 * plus the incremental read path of the store. Provider behaviour is covered by
 * tests/live/thread-live.test.ts and the integration suites.
 */
test('Thread shows delivery, queue pause and context usage, offers no rewind, and merges incremental reads', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-thread-hardening-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  writeFileSync(join(repo, 'README.md'), '# hardening fixture\n')
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('load')
    await page.evaluate(() => localStorage.setItem('oxe.thread.viewMode', 'verbose'))
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await app.evaluate(({ ipcMain, BrowserWindow }, fixtureRoot) => {
      const g = globalThis as Record<string, unknown>
      const calls: Record<string, unknown[][]> = { send: [], resume: [], sendNow: [], read: [], readSince: [] }
      g.hardeningCalls = calls
      let snapshot: Record<string, any> | null = null
      let delta: Record<string, unknown> | { ok: false; reset: string } = { ok: false, reset: 'epoch' }
      const changed = () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: 'e2e-thread' }) }
      g.setHardeningDelta = (value: typeof delta) => { delta = value }
      g.hardeningChanged = changed
      g.seedHardening = () => {
        const configuration = { model: 'native-model', access: 'read-only', networkAccess: false, approvalPolicy: 'on-request', mode: 'default', hooksEnabled: false }
        Object.assign(snapshot!.thread, {
          provider: 'codex', status: 'interrupted', title: 'Hardening', lastTurnStatus: 'interrupted',
          capabilities: { provider: 'codex', platform: 'win32', authentication: 'subscription', features: { rewind: { availability: 'supported', enabled: true, authorized: true, implemented: true, verified: 'fixture' } } },
          queue: [{ id: 'queued-1', text: 'Run the tests after that', createdAt: 1, state: 'queued' }],
          queuePause: { reason: 'interrupted', since: Date.now() },
          contextReport: { model: 'native-model', usedTokens: 42000, windowTokens: 100000, percentage: 42, autoCompactAtTokens: 90000, capturedAt: Date.now(), source: 'claude-control',
            categories: [{ name: 'System prompt', tokens: 2400, kind: 'used' }, { name: 'Messages', tokens: 39600, kind: 'used' }, { name: 'Free space', tokens: 58000, kind: 'free' }] }
        })
        snapshot!.turns = [
          { id: 'turn-1', nativeId: 'native-1', sequence: 1, status: 'completed', configuration },
          { id: 'turn-2', nativeId: 'native-2', sequence: 2, status: 'interrupted', configuration }
        ]
        snapshot!.events = [
          { type: 'message', id: 'turn-1', role: 'user', text: 'First request' },
          { type: 'message', id: 'a1', role: 'assistant', text: 'First answer from the agent.' },
          { type: 'completed', status: 'completed' },
          { type: 'message', id: 'turn-2', role: 'user', text: 'Second request that may be lost' }
        ]
        snapshot!.deliveries = { 'turn-1': { state: 'delivered', updatedAt: 1 }, 'turn-2': { state: 'unconfirmed', updatedAt: 2 } }
        snapshot!.sync = { epoch: 'epoch-1', revision: 5 }
        snapshot!.page = { hasMore: false, total: 4, live: 4 }
        changed()
      }
      for (const channel of ['list', 'read', 'create', 'send', 'pin', 'projects', 'models', 'configure', 'command', 'commands', 'artifact', 'project-diff', 'observe', 'queue-resume', 'queue-send-now', 'rewind', 'redo-rewind', 'read-since', 'context-usage', 'history']) ipcMain.removeHandler(`thread:${channel}`)
      ipcMain.handle('thread:list', () => snapshot ? [snapshot.thread] : [])
      ipcMain.handle('thread:read', () => { calls.read.push([]); return snapshot })
      ipcMain.handle('thread:read-since', (_event, _id, cursor) => { calls.readSince.push([cursor]); return delta })
      ipcMain.handle('thread:create', (_event, input) => {
        snapshot = { thread: { id: 'e2e-thread', workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', rootPath: fixtureRoot, provider: input.provider, nativeSessionId: null,
          title: 'New conversation', pinned: false, status: 'idle', createdAt: Date.now(), updatedAt: Date.now() }, events: [] }
        changed(); return snapshot
      })
      ipcMain.handle('thread:send', (_event, _id, text, attachments) => { calls.send.push([text, attachments]) })
      ipcMain.handle('thread:queue-resume', () => {
        calls.resume.push([])
        delete snapshot!.thread.queuePause
        snapshot!.thread.queue = []
        snapshot!.thread.status = 'running'
        changed()
      })
      ipcMain.handle('thread:queue-send-now', (_event, _id, itemId) => { calls.sendNow.push([itemId]) })
      ipcMain.handle('thread:context-usage', () => snapshot?.thread.contextReport ?? null)
      ipcMain.handle('thread:pin', () => {})
      ipcMain.handle('thread:models', () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }] }))
      ipcMain.handle('thread:configure', () => snapshot)
      ipcMain.handle('thread:command', () => ({ kind: 'applied' }))
      ipcMain.handle('thread:commands', () => ({ commands: [] }))
      ipcMain.handle('thread:observe', () => ({ state: 'unknown', observedAt: Date.now(), source: 'unavailable', detail: '' }))
      ipcMain.handle('thread:artifact', () => { throw Error('unused') })
      ipcMain.handle('thread:project-diff', () => ({ files: [], base: 'HEAD', includeUncommitted: true, compiledAt: Date.now() }))
      ipcMain.handle('thread:history', () => ({ events: [], hasMore: false, total: 0 }))
      ipcMain.removeHandler('agent-credits:get')
      ipcMain.handle('agent-credits:get', (_event, input: { provider: string }) => ({ provider: input.provider, available: true, installed: true, planLabel: 'Pro', source: 'oauth', observedAtMs: Date.now(), error: null,
        windows: [{ kind: 'session', usedPct: 40, resetsAtMs: Date.now() + 3600000 }], display: { kind: 'session', usedPct: 40, resetsAtMs: Date.now() + 3600000 } }))
      ipcMain.removeHandler('agent-account:read')
      ipcMain.handle('agent-account:read', (_event, context) => ({ scopeId: context.provider, provider: context.provider, state: 'connected', method: 'subscription', checkedAt: Date.now() }))
      ipcMain.removeHandler('git:get-status')
      ipcMain.handle('git:get-status', () => ({ branch: 'main', ahead: 0, behind: 0, checkedAt: Date.now(), files: [] }))
    }, repo)

    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    const workspace = await page.evaluate(async () => (await window.oxe.workspace.list())[0])
    await app.evaluate(({ ipcMain }, { workspaceId, rootPath }) => {
      ;(globalThis as Record<string, unknown>).e2eWorkspaceId = workspaceId
      ipcMain.removeHandler('thread:projects')
      ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'e2e-project', displayName: 'repo', identityLabel: rootPath, contexts: [{ workspaceId, rootPath, label: 'repo' }] }], unavailable: [] }))
    }, { workspaceId: workspace.id, rootPath: repo })
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible()

    await modeButton(page, 'thread').click()
    await page.getByRole('button', { name: 'New conversation in repo' }).click()
    await page.getByRole('radio', { name: /Codex/ }).check()
    await page.getByRole('button', { name: 'Create conversation', exact: true }).click()
    await expect(page.locator('.thread-composer textarea')).toBeVisible()
    const calls = async () => app.evaluate(() => (globalThis as Record<string, any>).hardeningCalls as Record<string, unknown[][]>)

    await app.evaluate(() => (globalThis as Record<string, any>).seedHardening())
    await expect(page.getByText('Second request that may be lost')).toBeVisible()

    // Delivery: only the unconfirmed message is flagged, and resending reuses its text.
    const notes = page.locator('.thread-delivery-note')
    await expect(notes).toHaveCount(1)
    await expect(notes).toContainText('Not confirmed')
    await notes.getByRole('button', { name: 'Send again' }).click()
    await expect.poll(async () => (await calls()).send.length).toBe(1)
    expect((await calls()).send[0][0]).toBe('Second request that may be lost')

    // Queue pause: the follow-up waits, and Resume releases it.
    const banner = page.locator('.thread-queue-pause')
    await expect(banner).toContainText('Queue paused')
    await expect(page.getByText('Run the tests after that')).toBeVisible()
    await banner.getByRole('button', { name: 'Resume' }).click()
    await expect.poll(async () => (await calls()).resume.length).toBe(1)
    await expect(page.locator('.thread-queue-pause')).toHaveCount(0)
    await app.evaluate(() => { const g = globalThis as Record<string, any>; g.hardeningCalls.send.length = 0 })

    // Context ring: percentage, categories and the plan section in one popover.
    await app.evaluate(() => { const g = globalThis as Record<string, any>; g.seedHardening() })
    const ring = page.locator('.thread-usage-ring')
    await expect(ring).toHaveAttribute('aria-label', /42% of the context window used/)
    await ring.click()
    const popover = page.getByRole('dialog', { name: 'Usage details' })
    await expect(popover.getByRole('region', { name: 'Context window' })).toContainText('42%')
    await expect(popover).toContainText('System prompt')
    await expect(popover).toContainText('Auto-compact')
    await expect(popover.getByRole('region', { name: 'Plan usage' })).toContainText('40%')
    await ring.click()

    // Incremental read: an ok delta is merged without a second full read.
    const readsBefore = (await calls()).read.length
    await app.evaluate(() => {
      const g = globalThis as Record<string, any>
      const snapshot = { thread: { id: 'e2e-thread', workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', provider: 'codex', status: 'idle', title: 'Hardening', pinned: false, createdAt: 1, updatedAt: 3, nativeSessionId: null, rootPath: '' },
        events: [{ type: 'message', id: 'a2', role: 'assistant', text: 'Delta-delivered answer' }] }
      g.setHardeningDelta({ ok: true, epoch: 'epoch-1', revision: 6, live: 5, thread: { ...snapshot.thread, queue: [], capabilities: undefined }, events: [{ seq: 4, event: snapshot.events[0] }], turns: [], deliveries: {}, pendingRequests: [] })
      g.hardeningChanged()
    })
    // The status line repeats the answer's first sentence; the message itself is the one in the timeline.
    await expect(page.locator('.thread-timeline').getByText('Delta-delivered answer')).toBeVisible()
    expect((await calls()).readSince.length).toBeGreaterThan(0)
    expect((await calls()).readSince.at(-1)?.[0]).toMatchObject({ epoch: 'epoch-1', revision: 5 })
    expect((await calls()).read.length).toBe(readsBefore)

    // Rewind left 1.5.0 (product decision, 2026-11-12): a message offers neither "Rewind to here" nor "Edit", and no
    // strip offers a Redo.
    await app.evaluate(() => { const g = globalThis as Record<string, any>; g.setHardeningDelta({ ok: false, reset: 'epoch' }); g.seedHardening() })
    await expect(page.getByText('Second request that may be lost')).toBeVisible()
    const sent = page.locator('.thread-message-user').filter({ hasText: 'Second request that may be lost' })
    await sent.hover()
    await expect(sent.getByRole('button', { name: /Rewind|Edit/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Rewind to here/ })).toHaveCount(0)
    await expect(page.getByTestId('thread-dock-rewind')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
