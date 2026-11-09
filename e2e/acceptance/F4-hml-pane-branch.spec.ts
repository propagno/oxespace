import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * HML · 1.5.0 F4 M10 (A18, BACKEND #745 / #704): a pane's branch follows what a person does in a REAL terminal, black box
 * on the real app. The shell reports its cwd the way shell integrations do (OSC 7 from PROMPT_COMMAND), and the person
 * types git commands: a switch, a detached checkout, and a cd into another repository. The pane's branch, the branch it
 * started on, and "switched" follow, through window.oxe.terminal.branch and onBranchChanged. Linux runners (bash).
 * Places, drift and the worktrees panel are added when F4 exposes them to the window.
 */
const onRunner = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
const notes: string[] = []
const note = (line: string) => { notes.push(line); console.log('HML', line) }
type Branch = { branch: string | null; startedOn: string | null; switched: boolean } | null

const paneIdOf = (page: Page) => page.locator('[data-testid="terminal-pane"]').first().getAttribute('data-pane-id', { timeout: 10_000 })
const branchOf = (page: Page, paneId: string) => page.evaluate(id => (window as unknown as { oxe: { terminal: { branch?(id: string): Promise<unknown> } } }).oxe.terminal.branch?.(id) ?? null, paneId) as Promise<Branch>
async function type(page: Page, line: string): Promise<void> {
  await page.locator('.xterm').first().click()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1_200)
}
function repoOn(dir: string, branch: string): void {
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['-c', 'user.email=hml@example.invalid', '-c', 'user.name=hml', 'commit', '-q', '-m', 'init'], { cwd: dir })
}

test('A18: a pane\'s branch follows a real terminal: switch, detached HEAD, and a cd into another repository', async () => {
  test.skip(!onRunner || process.platform !== 'linux', 'Linux CI runners (bash, PROMPT_COMMAND)')
  test.setTimeout(180_000)
  const profile = realProfile('hml-f4-branch')
  const other = join(profile.root, 'other'); repoOn(other, 'trunk')
  const { app, page } = await launchReal(profile)
  try {
    await openRepo(page, profile.repo)
    const paneId = await paneIdOf(page)
    expect(paneId, 'a terminal pane').toBeTruthy()
    const hasApi = await page.evaluate(() => typeof (window as unknown as { oxe: { terminal: { branch?: unknown } } }).oxe.terminal.branch === 'function')
    note(`terminal.branch exists: ${hasApi}`)
    expect(hasApi, 'A18: the window can read a pane\'s branch').toBe(true)
    // Every change the window is told about.
    await page.evaluate(id => {
      const w = window as unknown as { __branchEvents: unknown[]; oxe: { terminal: { onBranchChanged?(id: string, l: (e: unknown) => void): void } } }
      w.__branchEvents = []
      w.oxe.terminal.onBranchChanged?.(id, e => w.__branchEvents.push(e))
    }, paneId as string)
    // A shell with an integration reports its cwd (OSC 7) at each prompt.
    await type(page, `export PROMPT_COMMAND='printf "\\033]7;file://localhost%s\\007" "$PWD"'`)
    await type(page, 'true')

    const start = await branchOf(page, paneId as string)
    note(`at start: ${JSON.stringify(start)}`)
    expect.soft(start, 'the pane starts on main').toMatchObject({ branch: 'main', startedOn: 'main', switched: false })

    await type(page, 'git switch -q -c feature-x')
    const switched = await branchOf(page, paneId as string)
    note(`after git switch: ${JSON.stringify(switched)}`)
    expect.soft(switched, 'a switch moves the branch and says it switched from main').toMatchObject({ branch: 'feature-x', startedOn: 'main', switched: true })

    await type(page, 'git checkout -q --detach')
    const detached = await branchOf(page, paneId as string)
    note(`detached: ${JSON.stringify(detached)}`)
    expect.soft(detached?.branch === null || /^[0-9a-f]{7,40}$/.test(String(detached?.branch)), 'a detached HEAD has no branch name (or its commit)').toBe(true)

    await type(page, 'git switch -q main')
    const back = await branchOf(page, paneId as string)
    note(`back on main: ${JSON.stringify(back)}`)
    expect.soft(back, 'back on the branch it started on is not "switched"').toMatchObject({ branch: 'main', switched: false })

    // A cd into another repository: its branch, and the cwd that moved it (OSC 7), not the pane's first folder.
    await type(page, `cd '${other}'`)
    await page.waitForTimeout(1_500)
    const moved = await branchOf(page, paneId as string)
    note(`after cd: ${JSON.stringify(moved)}`)
    expect.soft(moved?.branch, 'a cd into another repository shows its branch').toBe('trunk')

    const events = await page.evaluate(() => (window as unknown as { __branchEvents: Array<{ branch: string | null }> }).__branchEvents)
    note(`branch events: ${JSON.stringify(events.map(e => e.branch))}`)
    expect.soft(events.length, 'the window is told of the changes').toBeGreaterThan(0)
    expect.soft(events.map(e => e.branch), 'it was told of trunk').toContain('trunk')
    await page.screenshot({ path: test.info().outputPath('f4-pane-branch.png') })
  } finally {
    writeFileSync(test.info().outputPath('f4-branch.txt'), notes.join('\n'))
    test.info().annotations.push({ type: 'f4-branch', description: notes.join('\n') })
    await quitReal(app)
  }
})
