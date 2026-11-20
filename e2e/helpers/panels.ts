import type { Locator, Page } from '@playwright/test'

/** Shared panel names (src/components/Workbench/panelCatalog.ts). */
export type PanelLabel = 'Changes' | 'Browser' | 'Commit & pull request' | 'Files' | 'Find in files' | 'Worktrees'

/** Opens or closes a Code panel through the workspace bar toggle or the single Panels menu. */
export async function togglePanel(page: Page, label: PanelLabel): Promise<void> {
  if (label === 'Changes' || label === 'Browser') {
    const barButton = page.locator('[data-ui="panel-group"]').getByRole('button', { name: label === 'Changes' ? /^Changes\b/ : /^Browser$/ }).first()
    if (await barButton.isVisible().catch(() => false)) {
      await barButton.click()
      return
    }
  }
  const item = page.getByRole('menuitemcheckbox', { name: label, exact: true })
  const trigger = page.locator('[data-testid="btn-open-tools"]:visible, [data-ui="panel-group"] button[aria-label="More panels"]:visible').first()
  // A click that lands while the previous menu is still closing does not open a new one; open it again then.
  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click()
    if (await item.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) break
  }
  await item.click()
}

/** Opens the command palette filtered to one entry and returns that entry, without choosing it. */
export async function findPaletteCommand(page: Page, title: string): Promise<Locator> {
  // The rail button, not Ctrl+K: right after a workspace opens a terminal may own the keyboard.
  await page.getByRole('button', { name: 'Files & commands' }).first().click()
  const input = page.getByPlaceholder('Search files and commands…')
  await input.waitFor({ state: 'visible' })
  await input.fill(title)
  // The best-ranked command: a title is either the label ("Help: Show keyboard shortcuts") or a former name the
  // command keeps as a search word ("Keyboard shortcuts"), see docs/design/commands.md.
  const option = page.locator('[cmdk-item][data-value^="cmd-"]').first()
  await option.waitFor({ state: 'visible' })
  return option
}

/** Runs a command palette entry by its title or former name (tools without a panel: Skills, Semantic index log…). */
export async function runPaletteCommand(page: Page, title: string): Promise<void> {
  await (await findPaletteCommand(page, title)).click()
}

/** Connections (MCP) has its own button in the workspace bar. */
export async function openConnections(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open MCP servers' }).first().click()
}
