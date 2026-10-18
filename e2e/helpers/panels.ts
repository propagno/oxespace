import type { Page } from '@playwright/test'

/** Shared panel names (src/components/Workbench/panelCatalog.ts). */
export type PanelLabel = 'Changes' | 'Browser' | 'Commit & pull request' | 'Files' | 'Find in files' | 'Scripts' | 'Worktrees'

/** Opens or closes a Code panel through the rail's Panels menu, which lists every panel. */
export async function togglePanel(page: Page, label: PanelLabel): Promise<void> {
  await page.locator('[data-testid="btn-open-tools"]:visible').click()
  await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click()
}

/** Runs a command palette entry by its title (tools without a panel: Skills, Semantic index log…). */
export async function runPaletteCommand(page: Page, title: string): Promise<void> {
  // The rail button, not Ctrl+K: right after a workspace opens a terminal may own the keyboard.
  await page.getByRole('button', { name: 'Files & commands' }).first().click()
  const input = page.getByPlaceholder('Search files and commands…')
  await input.waitFor({ state: 'visible' })
  await input.fill(title)
  await page.getByRole('option', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click()
}

/** Connections (MCP) has its own button in the workspace bar. */
export async function openConnections(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open connections' }).first().click()
}
