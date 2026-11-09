import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow, type Appearance } from '../helpers/launch'

/**
 * EVIDENCE ONLY, never merged (branch test/fe-r12-skills-shots): DESIGN's V1/V2/V3/V5/V7/V8 shots of R12's read-only
 * skills list, Workspace Settings › Tools › Skills, for #727. One workspace skill and one user skill, light and dark,
 * at 1440 and 900; then the empty state once. Screenshots only, no baseline comparison.
 */
const THEMES: Appearance[] = ['light', 'dark']
const SIZES = [[1440, 900], [900, 620]] as const

function seededHome(withSkills: boolean): string {
  const home = mkdtempSync(join(tmpdir(), 'oxe-r12-home-'))
  mkdirSync(join(home, '.oxe', 'skills'), { recursive: true })
  if (withSkills) writeFileSync(join(home, '.oxe', 'skills', 'release-notes.md'), '---\nname: release-notes\ndescription: Writes the release notes from the merged PRs.\nagents: [claude, codex]\n---\nWrite the notes.\n')
  return home
}

async function openSkills(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(settings).toBeVisible()
  await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: /Current workspace/ }).click()
  await settings.getByRole('button', { name: /^Tools/ }).first().click()
  const skills = settings.getByRole('region', { name: 'Skills', exact: true })
  await skills.scrollIntoViewIfNeeded()
  await expect(skills).toBeVisible()
  return { settings, skills }
}

for (const theme of THEMES) {
  test(`R12 skills list with skills — ${theme}`, async () => {
    test.setTimeout(180_000)
    const home = seededHome(true)
    const { app, page, workspaceRoot } = await launchApp({ appearance: theme, env: { HOME: home, USERPROFILE: home } })
    try {
      mkdirSync(join(workspaceRoot, '.oxe', 'skills'), { recursive: true })
      writeFileSync(join(workspaceRoot, '.oxe', 'skills', 'pix-rules.md'), '---\nname: pix-rules\ndescription: Checks a change against the Pix rules.\nagents: [claude]\n---\nCheck the rules.\n')
      await openDemoWorkspace(page, workspaceRoot)
      // The skill store reads once; a reload makes it read with the workspace open and both files in place.
      await page.reload()
      await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 20_000 })
      console.log('skill.list', JSON.stringify(await page.evaluate(async () => (await window.oxe.skill.list()).map(skill => [skill.name, skill.source]))))
      for (const [width, height] of SIZES) {
        await resizeWindow(app, width, height)
        const { settings, skills } = await openSkills(page)
        await expect(skills.getByText('pix-rules', { exact: true })).toBeVisible()
        await expect(skills.getByText('release-notes', { exact: true })).toBeVisible()
        await skills.screenshot({ path: test.info().outputPath(`skills-${theme}-${width}.png`) })
        await settings.screenshot({ path: test.info().outputPath(`settings-tools-${theme}-${width}.png`) })
        await page.keyboard.press('Escape')
        await expect(settings).toBeHidden()
      }
    } finally {
      await app.close()
    }
  })
}

test('R12 skills list empty — light', async () => {
  test.setTimeout(120_000)
  const home = seededHome(false)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { HOME: home, USERPROFILE: home } })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await resizeWindow(app, 1440, 900)
    const { settings, skills } = await openSkills(page)
    await expect(skills.getByText('No skills yet')).toBeVisible()
    await skills.screenshot({ path: test.info().outputPath('skills-empty-light-1440.png') })
    await settings.screenshot({ path: test.info().outputPath('settings-tools-empty-light-1440.png') })
  } finally {
    await app.close()
  }
})
