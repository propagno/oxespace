// THROWAWAY probe for #884 (a11y: Changes panel "hidden"); never committed. Same steps as a11y-surfaces up to Changes,
// then the box and computed layout of changes-panel and each ancestor.
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchApp, resizeWindow } from '../helpers/launch'
import { seedGitRepo } from '../helpers/seed'

test('probe 884: why is Changes hidden', async () => {
  test.setTimeout(120_000)
  const { app, page, root } = await launchApp({ appearance: 'light' })
  page.setDefaultTimeout(10_000)
  try {
    await resizeWindow(app, 1280, 800)
    await page.waitForSelector('[data-testid="btn-new-workspace"]')
    const repo = `${root}/repo`
    seedGitRepo(repo, { withBranchChanges: true })
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'a11y/tree', `${root}/repo-tree`], { cwd: repo })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('terminal-pane')).toHaveCount(1)
    await page.getByTestId('btn-open-tools').click()
    await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name: /^Changes$/ }).click()
    await page.waitForTimeout(3000)
    const dump = await page.evaluate(() => {
      const out: string[] = []
      const panels = document.querySelectorAll('[data-testid="changes-panel"]')
      out.push(`changes-panel count=${panels.length}`)
      let el: Element | null = panels[0] ?? null
      for (let i = 0; el && i < 12; i++, el = el.parentElement) {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el)
        out.push(`${i} <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}" testid=${el.getAttribute('data-testid')} hidden=${el.hasAttribute('hidden')}> ${Math.round(r.width)}x${Math.round(r.height)} display=${s.display} vis=${s.visibility} gtr=${s.gridTemplateRows.slice(0, 40)} grow=${s.flexGrow} basis=${s.flexBasis} h=${s.height} ov=${s.overflow}`)
      }
      const dock = document.querySelector('[data-testid="workspace-review-panel"]')
      if (dock) for (const c of Array.from(dock.children)) { const r = c.getBoundingClientRect(); out.push(`dock child <${c.tagName.toLowerCase()} class="${String(c.className).slice(0, 50)}"> ${Math.round(r.width)}x${Math.round(r.height)} gridRow=${getComputedStyle(c).gridRowStart}`) }
      return out.join('\n')
    })
    console.log('PROBE-884\n' + dump)
  } finally { await app.close() }
})
