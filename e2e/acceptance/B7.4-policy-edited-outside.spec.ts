import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * B7.4 (S1) · A policy edited outside the app only applies once the person confirms.
 * Roadmap acceptance: an external edit leaves the old rules in force and shows the request; accepting applies it;
 * denying keeps the old rules and marks the file as not accepted; a write by the app itself applies directly.
 *
 * REAL app (the policy store and its file watch run in main): a fresh git project with a deny rule in
 * .oxespace/policy.json; the file is then rewritten from outside (as an agent or another editor would).
 */
const DENY = JSON.stringify({ rules: [{ effect: 'deny', action: 'tool.use', resource: 'mcp__oxespace__oxespace_git_change' }] }, null, 2)
const OPEN = JSON.stringify({ rules: [] }, null, 2)
const policy = (page: Page, workspaceId: string) => page.evaluate(id => (window as unknown as { oxe: { policy: { get: (id: string) => Promise<unknown> } } }).oxe.policy.get(id), workspaceId).then(v => JSON.stringify(v))

for (const answer of ['accept', 'deny'] as const) {
  test(`B7.4: an outside edit waits for the person (${answer})`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-acc-b74-'))
    const repo = join(root, 'repo'); mkdirSync(join(repo, '.oxespace'), { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: repo })
    writeFileSync(join(repo, '.oxespace', 'policy.json'), DENY)
    const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') } })
    try {
      const page = await app.firstWindow()
      await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
      await page.getByTestId('btn-new-workspace').first().click()
      await page.getByTestId('wizard-dir-input').fill(repo)
      await page.getByTestId('wizard-launch-btn').click()
      await page.waitForTimeout(3_000)
      const workspaceId = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ id: string }>> } } }).oxe.workspace.list().then(l => l[0].id))
      const before = await policy(page, workspaceId)
      expect(before, 'the deny rule is in force at start').toContain('oxespace_git_change')

      // Outside edit: the rule is removed by something other than the app.
      writeFileSync(join(repo, '.oxespace', 'policy.json'), OPEN)
      const request = page.getByRole('dialog').or(page.getByRole('alert')).filter({ hasText: /policy\.json|política|policy/i }).first()
      await expect(request, 'the person is asked about the outside change').toBeVisible({ timeout: 10_000 })
      expect(await policy(page, workspaceId), 'until the answer, the old rules stay in force').toContain('oxespace_git_change')

      if (answer === 'accept') {
        await request.getByRole('button', { name: /Aplicar|Aceitar|Apply|Accept/ }).click()
        await expect.poll(() => policy(page, workspaceId), { timeout: 5_000 }).not.toContain('oxespace_git_change')
      } else {
        await request.getByRole('button', { name: /Manter|Recusar|Keep|Reject|Deny/ }).click()
        await page.waitForTimeout(1_000)
        expect(await policy(page, workspaceId), 'refusing keeps the old rules').toContain('oxespace_git_change')
        const marked = await page.getByText(/não aceit|not accepted/i).count()
        expect(marked, 'the file is marked as not accepted').toBeGreaterThan(0)
      }
    } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined) }
  })
}
