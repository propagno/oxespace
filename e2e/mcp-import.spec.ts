import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSurface } from './helpers/a11y'

/**
 * Importing servers other tools already have, with the real main process and database (not the mocked native layer): a temporary home holds a Cursor
 * config with a plain server, a remote one and one that carries a token. The first two are added untrusted;
 * the third is refused with the reason, and no secret value ever appears on screen.
 */
test('import MCP servers from Cursor into the Connections panel', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-mcp-import-e2e-'))
  const home = join(root, 'home')
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(join(home, '.cursor'), { recursive: true })
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {
    'local-tools': { command: 'node', args: ['server.js'] },
    'remote-docs': { url: 'https://mcp.example.com/mcp', headers: { 'X-Team': 'blue' } },
    'with-token': { command: 'node', args: ['gh.js'], env: { GITHUB_TOKEN: 'ghp_super_secret_value' } }
  } }))

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'),
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3')
    }
  })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible()

    await page.getByTestId('btn-open-tools').click()
    await page.getByText('MCP Servers', { exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Connections' })
    await expect(panel).toBeVisible()

    await panel.getByRole('button', { name: /Import from Claude Desktop, Cursor or Windsurf/ }).click()
    const importer = panel.getByRole('region', { name: 'Import MCP servers' })
    await expect(importer.getByText('Cursor')).toBeVisible()
    await expect(importer.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
    // Names and the names of secrets are shown; the values are not.
    await expect(importer.getByText('Copies GITHUB_TOKEN')).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('ghp_super_secret_value')

    for (const name of ['local-tools', 'remote-docs', 'with-token']) await importer.getByRole('checkbox', { name }).check()
    // The sidebar group header behind the dialog has its own finding (nested interactive controls), tracked
    // by the accessibility audit; this scan is about the Connections dialog.
    const violations = await scanSurface(page, 'mcp/import', { exclude: ['.ws-group-header'] })
    expect(violations.filter(item => item.impact === 'critical' || item.impact === 'serious'), JSON.stringify(violations, null, 2)).toEqual([])

    await importer.getByRole('button', { name: 'Import 3 servers' }).click()
    // The token server cannot be added untrusted: it stays listed with the reason, the other two are saved.
    await expect(importer.getByRole('alert')).toContainText('Not imported: with-token (Sensitive environment blocked on an untrusted MCP server: GITHUB_TOKEN)')
    expect(await page.locator('body').innerText()).not.toContain('ghp_super_secret_value')
    await expect(importer.getByRole('checkbox', { name: 'local-tools' })).toBeDisabled()
    await importer.getByRole('button', { name: 'Cancel' }).click()

    await panel.getByRole('tab', { name: /^Installed/ }).click()
    await expect(panel.getByText('local-tools')).toBeVisible()
    await expect(panel.getByText('remote-docs')).toBeVisible()
    await expect(panel.getByText('with-token')).toHaveCount(0)
    // The panel was opened for the workspace, so that is where the servers went.
    const saved = await page.evaluate(async () => {
      const workspace = (await window.oxe.workspace.list())[0]
      return (await window.oxe.mcp.list(workspace.id)).map(server => ({ name: server.name, trusted: server.trusted, transport: server.transport }))
    })
    expect(saved).toEqual(expect.arrayContaining([
      { name: 'local-tools', trusted: false, transport: 'stdio' },
      { name: 'remote-docs', trusted: false, transport: 'http' }
    ]))
  } finally {
    await app.close()
  }
})
