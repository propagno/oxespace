import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSurface } from './helpers/a11y'

/**
 * Skill headers are read as YAML by the real main process: a block list of agents and a folded description
 * load, and a skill whose header is not valid YAML (an unquoted colon) still loads the way it always did.
 */
test('skills with YAML headers load in the Skills dialog', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-skills-e2e-'))
  const home = join(root, 'home')
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(join(home, '.oxe', 'skills'), { recursive: true })
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(home, '.oxe', 'skills', 'ship-it.md'), '---\nname: ship-it\ndescription: >\n  Build the release\n  and publish it.\nagents:\n  - claude\n  - codex\ncategory: release\n---\nRun the release steps.\n')
  writeFileSync(join(home, '.oxe', 'skills', 'legacy-note.md'), '---\nname: legacy-note\ndescription: use for: quick notes\nagents: [claude]\n---\nWrite a note.\n')

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, HOME: home, USERPROFILE: home, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') }
  })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible()

    const skills = await page.evaluate(async () => (await window.oxe.skill.list()).map(skill => ({ name: skill.name, description: skill.description, agents: skill.agents, category: skill.category })))
    expect(skills).toEqual(expect.arrayContaining([
      { name: 'ship-it', description: 'Build the release and publish it.', agents: ['claude', 'codex'], category: 'release' },
      { name: 'legacy-note', description: 'use for: quick notes', agents: ['claude'], category: undefined }
    ]))

    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: 'Skills', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Skills' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('/ship-it', { exact: true })).toBeVisible()
    await expect(dialog.getByText('/legacy-note', { exact: true })).toBeVisible()
    const violations = await scanSurface(page, 'skills', { exclude: ['.ws-group-header'] })
    expect(violations.filter(item => item.impact === 'critical' || item.impact === 'serious'), JSON.stringify(violations, null, 2)).toEqual([])
  } finally {
    await app.close()
  }
})
