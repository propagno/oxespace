import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Claude native pages use the production worker and survive an Electron restart', async () => {
  test.setTimeout(120000)
  // Windows CI can expose TEMP through an 8.3 alias (RUNNER~1). Project
  // registration canonicalizes it, so seed Claude's directory with that same path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oxe-native-history-e2e-')))
  const repo = join(root, 'repo'), home = join(root, 'claude')
  mkdirSync(repo)
  const folder = join(home, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(folder, { recursive: true })
  const nativeId = '11111111-1111-4111-8111-111111111111'
  writeFileSync(join(folder, `${nativeId}.jsonl`), Array.from({ length: 1200 }, (_, index) => JSON.stringify({ sessionId: nativeId, cwd: repo, type: 'user', uuid: `message-${index}`, parentUuid: index ? `message-${index - 1}` : null, message: { content: `Native question ${index}` } })).join('\n'))
  const launch = () => electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'app.sqlite3'), CLAUDE_CONFIG_DIR: home } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const threadId = await page.evaluate(async ({ repo, nativeId }) => {
      const api = window.oxe.thread!
      const project = await api.addProject(repo)
      const seed = await api.create({ projectId: project.projectId, provider: 'claude' })
      return (await api.command!(seed.thread.id, `/resume ${nativeId}`)).threadId!
    }, { repo, nativeId })
    let snapshot = await page.evaluate(id => window.oxe.thread!.read(id), threadId)
    expect(snapshot.thread.nativeHistoryCursor?.claudeParent).toBe('message-199')
    expect(snapshot.events.at(-1)).toMatchObject({ text: 'Native question 1199' })
    // Restart before requesting older pages: the lineage cursor must survive,
    // not just the messages already imported into SQLite.
    await app.close()
    app = await launch(); page = await app.firstWindow()
    snapshot = await page.evaluate(id => window.oxe.thread!.read(id), threadId)
    expect(snapshot.thread.nativeHistoryCursor?.claudeParent).toBe('message-199')
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    await page.locator('.thread-navigation-item').filter({ hasText: snapshot.thread.title }).click()
    await expect(page.getByText('Native question 1199', { exact: true })).toBeVisible()
    const bounds = await page.locator('.thread-timeline').evaluate(node => ({ width: node.clientWidth, contentWidth: node.scrollWidth, height: node.clientHeight }))
    expect(bounds.height).toBeGreaterThan(100)
    expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width + 1)
    let before = snapshot.page?.before
    let foundFirst = false, pages = 0
    while (before !== undefined) {
      const result = await page.evaluate(({ id, before }) => window.oxe.thread!.history!(id, before, 250), { id: threadId, before })
      foundFirst ||= result.events.some(event => event.type === 'message' && event.text === 'Native question 0')
      before = result.before
      expect(++pages).toBeLessThan(10)
    }
    expect(foundFirst).toBe(true)
    await app.close()
    app = await launch(); page = await app.firstWindow()
    snapshot = await page.evaluate(id => window.oxe.thread!.read(id), threadId)
    expect(snapshot.page?.total).toBe(1200)
    expect(snapshot.thread.nativeHistoryCursor).toBeUndefined()
    const earliest = await page.evaluate(id => window.oxe.thread!.history!(id, 0, 250), threadId)
    expect(earliest.events[0]).toMatchObject({ text: 'Native question 0' })
    expect(await page.evaluate(async () => (await window.oxe.workspace.list()).length)).toBe(0)
  } finally { await app.close() }
})
