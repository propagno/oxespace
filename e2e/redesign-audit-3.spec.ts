import { _electron as electron, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Coverage audit: the surfaces the first audit does not reach (menus, dialogs, panels with real
 * repository data). Every step records a screenshot, contrast and target metrics; a step that cannot
 * reach its surface is listed in step-failures.json so the gap is visible instead of silent.
 *
 * Run: OXESPACE_AUDIT_MODE=light|dark npx playwright test --config playwright.tools.config.ts redesign-audit-3.spec.ts
 */
const MODE = process.env.OXESPACE_AUDIT_MODE === 'light' || process.env.OXESPACE_AUDIT_MODE === 'dark' ? process.env.OXESPACE_AUDIT_MODE : 'light'
const OUT = join(process.cwd(), 'e2e', 'screenshots', `redesign-audit-3-${MODE}`)
const SHOTS = join(OUT, 'shots')
const failures: string[] = []
const found: Array<{ name: string; contrast: unknown[]; small: unknown[]; unnamed: unknown[]; overflow: boolean }> = []

async function measure(page: Page): Promise<{ contrast: unknown[]; small: unknown[]; unnamed: unknown[]; overflow: boolean }> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
    }
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const rgb = (v: string): number[] => {
      if (!v || v === 'transparent') return [0, 0, 0, 0]
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = v; ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return [r, g, b, a / 255]
    }
    const lum = (c: number[]) => c.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0)
    const contrast: unknown[] = [], small: unknown[] = [], unnamed: unknown[] = []
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const s = getComputedStyle(el)
      if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent?.trim())) {
        const fg = rgb(s.color)
        let node: Element | null = el, bg: number[] = []
        while (node) { const c = rgb(getComputedStyle(node).backgroundColor); if (c[3] === 1) { bg = c; break } if (c[3] > 0) break; node = node.parentElement }
        if (bg.length && fg[3] === 1) {
          const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05), px = parseFloat(s.fontSize)
          if (ratio < (px >= 24 || px >= 18.66 && +s.fontWeight >= 700 ? 3 : 4.5)) contrast.push({ cls: String((el as HTMLElement).className).slice(0, 50), text: el.textContent?.trim().slice(0, 30), ratio: Math.round(ratio * 100) / 100 })
        }
      }
      if (el.matches('button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="menuitem"]')) {
        const r = el.getBoundingClientRect()
        const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 40) || (el as HTMLInputElement).placeholder || ''
        if (!name) unnamed.push({ tag: el.tagName, cls: String(el.className).slice(0, 50) })
        if (r.width < 24 || r.height < 24) small.push({ name, tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height) })
      }
    }
    return { contrast: contrast.slice(0, 12), small: small.slice(0, 12), unnamed: unnamed.slice(0, 12), overflow: document.documentElement.scrollWidth > innerWidth }
  })
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
  found.push({ name, ...(await measure(page)) })
}

async function surface(page: Page, name: string, open: () => Promise<void>): Promise<void> {
  try {
    await open()
    await shot(page, name)
  } catch (error) {
    failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`)
  } finally {
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => undefined)
    await page.waitForTimeout(150)
  }
}

test('coverage audit', async () => {
  test.setTimeout(20 * 60_000)
  mkdirSync(SHOTS, { recursive: true })
  const root = join(tmpdir(), `oxespace-audit3-${Date.now()}`)
  const repo = join(root, 'demo-app')
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'demo-app', scripts: { dev: 'vite', build: 'tsc && vite build', test: 'vitest', lint: 'eslint .' } }, null, 2))
  writeFileSync(join(repo, 'README.md'), '# Demo app\n\nA sample project used to audit the interface.\n')
  writeFileSync(join(repo, 'src', 'main.ts'), 'export const answer = 42\nexport function greet(name: string) {\n  return `hello ${name}`\n}\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git('init', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'Audit'); git('add', '.'); git('commit', '-m', 'Initial commit')
  writeFileSync(join(repo, 'src', 'main.ts'), 'export const answer = 43\nexport function greet(name: string) {\n  return `hello, ${name}!`\n}\nexport const added = true\n')
  writeFileSync(join(repo, 'notes.md'), 'untracked notes\n')

  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'o.sqlite3') } })
  const page = await app.firstWindow()
  page.setDefaultTimeout(4000)
  try {
    await page.waitForLoadState('load'); await page.waitForTimeout(1500)
    await page.evaluate(mode => localStorage.setItem('oxe-settings', JSON.stringify({ state: { appearance: mode, notificationsEnabled: true, visitedWorkspacesCap: 5 }, version: 3 })), MODE)
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(2000)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 15000 })
    await page.waitForTimeout(1500)
    await shot(page, '00-workspace-real-repo')

    // Title bar, menus and top strip.
    await surface(page, '01-menu-file', () => page.locator('button', { hasText: /^File$/ }).first().click())
    await surface(page, '02-menu-view', () => page.locator('button', { hasText: /^View$/ }).first().click())
    await surface(page, '03-menu-help', () => page.locator('button', { hasText: /^Help$/ }).first().click())
    await surface(page, '04-team-dialog', () => page.getByRole('button', { name: 'Team', exact: true }).click())
    await surface(page, '05-update-pill', () => page.getByTestId('app-update-pill').click({ timeout: 3000 }))
    await surface(page, '06-connections', () => page.getByRole('button', { name: /Open connections/ }).click())
    await surface(page, '07-activity-dock', () => page.getByRole('button', { name: /Toggle background activity/ }).click())
    await surface(page, '08-systems-menu', () => page.getByTestId('workspace-integrations-trigger').click())
    // Panes.
    await surface(page, '10-pane-more-menu', () => page.getByTestId('btn-terminal-more').first().click())
    await surface(page, '11-pane-actions-menu', () => page.getByRole('button', { name: 'More pane actions' }).first().click())
    await surface(page, '12-pane-search', () => page.getByRole('button', { name: 'Search in terminal' }).first().click())
    await surface(page, '13-pane-rename', () => page.locator('.pane-intent-button').first().dblclick())
    await surface(page, '14-pane-provider-chip', () => page.getByTestId('pane-provider-chip').first().hover())
    await surface(page, '15-pane-maximized', async () => { await page.getByRole('button', { name: 'Maximize pane' }).first().click() })
    await page.getByRole('button', { name: /Restore pane|Minimize pane|Maximize pane/ }).first().click().catch(() => undefined)
    // Sidebar.
    await surface(page, '20-sidebar-workspace-menu', () => page.getByRole('button', { name: 'Workspace options' }).first().click())
    await surface(page, '21-sidebar-session-menu', () => page.getByTestId('pane-session-row').first().click({ button: 'right' }))
    await surface(page, '22-sidebar-filter', () => page.getByPlaceholder('Filter workspaces').fill('demo'))
    await page.getByPlaceholder('Filter workspaces').fill('').catch(() => undefined)
    await surface(page, '20b-workspace-context-menu', () => page.getByTestId('sidebar-workspace-item').first().click({ button: 'right' }))
    await surface(page, '23-remove-workspace-confirm', async () => {
      await page.getByTestId('sidebar-workspace-item').first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: /Remove workspace/ }).or(page.getByText('Remove workspace', { exact: true })).first().click()
    })
    await surface(page, '24-delegated-work', () => page.getByRole('button', { name: 'Delegated work', exact: true }).first().click())
    await surface(page, '25-rail-integration', () => page.getByRole('button', { name: 'Files & commands' }).first().click())
    await surface(page, '26-rail-search', () => page.getByRole('button', { name: 'Open settings' }).first().click())
    // Tools with real repository data.
    const tool = (label: RegExp) => async () => { await page.getByTestId('btn-open-tools').click(); await page.getByTestId('tools-modal').getByRole('menuitem', { name: label }).click(); await page.waitForTimeout(1200) }
    await surface(page, '30-tool-github-real', tool(/^GitHub/))
    await surface(page, '31-tool-review-real', tool(/^Review/))
    await surface(page, '32-tool-editor-real', tool(/^Editor/))
    await surface(page, '33-tool-worktrees-real', tool(/^Worktrees/))
    await surface(page, '34-tool-scripts-real', tool(/^Scripts/))
    await surface(page, '35-tool-search-real', async () => { await tool(/^Find in Files/)(); await page.getByRole('searchbox').or(page.getByPlaceholder(/Search/i)).first().fill('answer') ; await page.keyboard.press('Enter') })
    await surface(page, '36-tool-background', tool(/^Background Jobs/))
    await surface(page, '37-tool-web-preview', tool(/^Web Preview/))
    await surface(page, '38-tool-mcp', tool(/^MCP Servers/))
    await surface(page, '39-tool-skills', tool(/^Skills/))
    await surface(page, '40-tool-semantic', tool(/^Semantic Activity/))
    await surface(page, '41-tool-slash', tool(/^Terminal Commands/))
    await surface(page, '42-tool-workspace-settings', tool(/^Workspace Settings/))
    await surface(page, '43-tool-integration', tool(/^Multi-repo/))
    // Overlays and global.
    await surface(page, '50-palette-query', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('terminal') })
    await surface(page, '51-usage', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('Usage'); await page.keyboard.press('Enter') })
    await surface(page, '52-design-system', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('Design System'); await page.keyboard.press('Enter') })
    await page.getByRole('button', { name: /^Close/ }).first().click({ timeout: 2000 }).catch(() => undefined)
    // Thread entry without accounts.
    await surface(page, '60-thread-empty', () => page.getByRole('button', { name: 'Thread', exact: true }).first().click())
    await surface(page, '61-thread-add-project', () => page.getByRole('button', { name: /Add project/ }).first().click())
    await surface(page, '62-thread-accounts', () => page.getByRole('button', { name: /Agent accounts|Provider accounts/ }).first().click())
    await surface(page, '63-thread-new-conversation', () => page.getByRole('button', { name: /New conversation|New thread/ }).first().click())
    await surface(page, '64-oxequery-entry', () => page.getByRole('button', { name: /OxeQuery|Data|Databases/ }).first().click())
  } finally {
    writeFileSync(join(OUT, 'step-failures.json'), JSON.stringify(failures, null, 2))
    writeFileSync(join(OUT, 'findings.json'), JSON.stringify(found, null, 2))
    await app.close()
  }
})
