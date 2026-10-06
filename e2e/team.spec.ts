import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('project roles persist and Code and Thread resolve the same team', async () => {
  test.setTimeout(90000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-team-e2e-')), repo = join(root, 'repo')
  mkdirSync(repo); execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' })
  const launch = () => electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'app.sqlite3') } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const ids = await page.evaluate(async path => {
      const workspace = await window.oxe.workspace.create({ rootPath: path, autoStart: false })
      const project = await window.oxe.thread!.addProject(path)
      return { code: workspace.id, thread: project.projectId }
    }, repo)
    await page.getByRole('button', { name: 'Team', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Team', exact: true })
    await expect(dialog.getByText('No members yet.', { exact: false })).toBeVisible()
    await dialog.getByLabel('Member name').fill('Integrator')
    await dialog.getByRole('radio', { name: 'Coordinator / integrator' }).check()
    await dialog.getByRole('button', { name: 'Add member' }).click()
    await expect(dialog.getByRole('list', { name: 'Team members' })).toContainText('Integrator')
    await dialog.getByRole('button', { name: 'Messages: Integrator' }).click()
    await dialog.getByLabel('Message to Integrator').fill('Please prepare the integration plan.')
    await dialog.getByRole('button', { name: 'Send to inbox' }).click()
    await expect(dialog.getByText('Please prepare the integration plan.', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Saved · receipt not confirmed', { exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeInViewport()
    await dialog.getByRole('button', { name: 'Add member' }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole('button', { name: 'Add member' })).toBeInViewport()
    const geometry = await dialog.evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth, height: node.getBoundingClientRect().height, viewport: innerHeight }))
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewport)
    await page.screenshot({ path: test.info().outputPath('team-short-window.png') })
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const before = await page.evaluate(async ids => {
      const code = await window.oxe.team!.read({ kind: 'code', id: ids.code })
      const thread = await window.oxe.team!.read({ kind: 'thread', id: ids.thread })
      return { code, thread, workspaces: (await window.oxe.workspace.list()).length }
    }, ids)
    expect(before.code).toEqual(before.thread)
    expect(before.workspaces).toBe(1)
    await app.close(); app = await launch(); page = await app.firstWindow()
    expect(await page.evaluate(id => window.oxe.team!.read({ kind: 'thread', id }), ids.thread)).toEqual(before.code)
    const saved = await page.evaluate(async ({ project, member }) => window.oxe.team!.messages({ kind: 'thread', id: project }, member), { project: ids.thread, member: before.code.members[0].id })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ senderId: null, body: 'Please prepare the integration plan.', receivedAt: null })
    expect(await page.evaluate(async () => (await window.oxe.workspace.list()).length)).toBe(1)
  } finally { await app.close() }
})
