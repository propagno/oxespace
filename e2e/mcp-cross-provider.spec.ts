import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withoutLiveApp } from './helpers/live-app-env'

/**
 * OXE-173 (CA-4) · Built app with real services (OXESPACE_E2E_MOCK_NATIVE=0):
 * Two panes configured with distinct providers (Claude and Antigravity) in the same Code workspace.
 * Calling `oxespace_agents_change` (`prompt`) from pane 1 targeting pane 2 opens the real ApprovalDialog:
 *   - denying writes 0 bytes to pane 2;
 *   - approving delivers the exact prompt text to pane 2's PTY.
 */

const LISTENER_SCRIPT = String.raw`
const fs = require('node:fs')
const [readyPath, outPath] = process.argv.slice(2)
fs.writeFileSync(readyPath, 'ready\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  fs.appendFileSync(outPath, chunk)
})
process.stdin.resume()
`

const CALLER_SCRIPT = String.raw`
const fs = require('node:fs')
const [targetPaneId, listPath, deniedPath, approvedPath] = process.argv.slice(2)
const headers = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN,
  'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID,
  'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN
}
const rpc = async (id, name, args) => {
  const res = await fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  })
  const envelope = await res.json()
  return JSON.parse(envelope.result.content[0].text)
}
;(async () => {
  const listed = await rpc(1, 'oxespace_agents', { action: 'list' })
  fs.writeFileSync(listPath, JSON.stringify(listed))
  const denied = await rpc(2, 'oxespace_agents_change', { action: 'prompt', paneId: targetPaneId, text: 'DENIED_CROSS_PROVIDER_173' })
  fs.writeFileSync(deniedPath, JSON.stringify(denied))
  const approved = await rpc(3, 'oxespace_agents_change', { action: 'prompt', paneId: targetPaneId, text: 'APPROVED_CROSS_PROVIDER_173' })
  fs.writeFileSync(approvedPath, JSON.stringify(approved))
})().catch(err => {
  fs.writeFileSync(approvedPath, JSON.stringify({ error: String(err) }))
  process.exit(1)
})
`

test('OXE-173 in the app: cross-provider pane prompt requires approval modal before delivering text', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-173-cross-provider-'))
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]): void => { execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=E2E', ...args], { cwd: repo }) }
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), '# oxe-173\n')
  git('add', '.')
  git('commit', '-qm', 'init')

  const listenerScript = join(root, 'listener.cjs')
  const callerScript = join(root, 'caller.cjs')
  const listenerReady = join(root, 'listener-ready.txt')
  const receivedPath = join(root, 'received.txt')
  const listPath = join(root, 'list.json')
  const deniedPath = join(root, 'denied.json')
  const approvedPath = join(root, 'approved.json')
  writeFileSync(listenerScript, LISTENER_SCRIPT)
  writeFileSync(callerScript, CALLER_SCRIPT)

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e/electron-main.cjs')],
    env: {
      ...withoutLiveApp(process.env),
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '0',
      OXESPACE_LOCALE: 'en-US',
      OXESPACE_DB_PATH: join(root, 'db.sqlite3')
    }
  })

  try {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as Record<string, unknown>
      g.nativeAsked = 0
      dialog.showMessageBox = (() => { g.nativeAsked = (g.nativeAsked as number) + 1; return new Promise(() => undefined) }) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => { g.nativeAsked = (g.nativeAsked as number) + 1; return 0 }) as typeof dialog.showMessageBoxSync
    })

    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-2').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('terminal-pane')).toHaveCount(2, { timeout: 20_000 })

    // Wait for both real shell PTYs to be running before assigning distinct agent profiles to the panes.
    const { callerPaneId, targetPaneId } = await page.evaluate(async () => {
      const [ws] = await window.oxe.workspace.list()
      const ordered = [...ws.panes].sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex)
      return { callerPaneId: ordered[0].id, targetPaneId: ordered[1].id }
    })

    // Wait for both real shell PTYs to print their shell prompt (CONPTY_START_SCREEN alone sets seq=1 on Windows).
    await expect.poll(async () => page.evaluate(async ([p1, p2]) => {
      const [s1, s2] = await Promise.all([window.oxe.terminal.status(p1), window.oxe.terminal.status(p2)])
      const [a1, a2] = await Promise.all([window.oxe.terminal.attach({ paneId: p1 }), window.oxe.terminal.attach({ paneId: p2 })])
      const esc = String.fromCharCode(27)
      const bel = String.fromCharCode(7)
      const csi = new RegExp(`${esc}\\[[0-9;?]*[A-Za-z]`, 'g')
      const osc = new RegExp(`${esc}\\][^${bel}]*${bel}`, 'g')
      const ready = (text: string) => /[>$#%]\s*$/.test(text.replace(csi, '').replace(osc, '').trimEnd())
      return s1.running && s2.running && ready(a1.replay) && ready(a2.replay)
    }, [callerPaneId, targetPaneId] as const), { timeout: 25_000 }).toBe(true)

    await page.evaluate(async ([p1, p2]) => {
      const profiles = await window.oxe.agent.list()
      const claude = profiles.find(p => p.provider === 'claude')
      const antigravity = profiles.find(p => p.provider === 'antigravity')
      if (!claude || !antigravity) throw new Error('Expected built-in claude and antigravity profiles')
      await window.oxe.workspace.setPaneAgent({ paneId: p1, agentProfileId: claude.agentProfileId, preserveSession: true })
      await window.oxe.workspace.setPaneAgent({ paneId: p2, agentProfileId: antigravity.agentProfileId, preserveSession: true })
    }, [callerPaneId, targetPaneId] as const)

    const posix = (value: string) => value.replace(/\\/g, '/')
    const sendLine = async (paneId: string, line: string): Promise<void> => {
      await page.evaluate(async ({ id, text }) => {
        await window.oxe.terminal.write({ paneId: id, data: text })
        await new Promise(resolve => setTimeout(resolve, 100))
        await window.oxe.terminal.write({ paneId: id, data: '\r' })
      }, { id: paneId, text: line })
    }
    await sendLine(targetPaneId, `node "${posix(listenerScript)}" "${posix(listenerReady)}" "${posix(receivedPath)}"`)
    await expect.poll(() => existsSync(listenerReady), { timeout: 20_000 }).toBe(true)

    await sendLine(callerPaneId, `node "${posix(callerScript)}" "${targetPaneId}" "${posix(listPath)}" "${posix(deniedPath)}" "${posix(approvedPath)}"`)

    // 1. First request is denied: modal shows destination provider/position, unknown-state warning and full text; nothing reaches pane 2.
    const dialog = page.getByTestId('approval-dialog')
    await expect(dialog).toBeVisible({ timeout: 25_000 })
    await expect(page.getByTestId('approval-target')).toContainText('Antigravity · pane 2')
    await expect(page.getByTestId('approval-agent-text')).toContainText('DENIED_CROSS_PROVIDER_173')
    await expect(dialog.locator('[data-note="approvals.note.agent.unknownState"]')).toBeVisible()
    await dialog.getByRole('button', { name: /^Deny$/ }).click()

    await expect.poll(() => existsSync(deniedPath), { timeout: 15_000 }).toBe(true)
    expect(JSON.parse(readFileSync(deniedPath, 'utf8'))).toMatchObject({ ok: false, code: 'denied' })
    const afterDeny = existsSync(receivedPath) ? readFileSync(receivedPath, 'utf8') : ''
    expect(afterDeny).not.toContain('DENIED_CROSS_PROVIDER_173')

    // 2. Second request is approved: text is delivered to pane 2's PTY.
    await expect(dialog).toBeVisible({ timeout: 25_000 })
    await expect(page.getByTestId('approval-target')).toContainText('Antigravity · pane 2')
    await expect(page.getByTestId('approval-agent-text')).toContainText('APPROVED_CROSS_PROVIDER_173', { timeout: 25_000 })
    const allowBtn = dialog.getByRole('button', { name: 'Allow once' })
    await expect(allowBtn).toBeEnabled({ timeout: 5_000 })
    await allowBtn.click()
    await expect(dialog).toHaveCount(0, { timeout: 10_000 })

    await expect.poll(() => existsSync(approvedPath), { timeout: 15_000 }).toBe(true)
    expect(JSON.parse(readFileSync(approvedPath, 'utf8'))).toMatchObject({ ok: true, result: { submitted: true, provider: 'antigravity' } })
    await expect.poll(() => existsSync(receivedPath) ? readFileSync(receivedPath, 'utf8') : '', { timeout: 15_000 }).toContain('APPROVED_CROSS_PROVIDER_173')
    expect(readFileSync(receivedPath, 'utf8')).not.toContain('DENIED_CROSS_PROVIDER_173')

    const listed = JSON.parse(readFileSync(listPath, 'utf8')) as { ok: boolean; result: Array<{ paneId: string; provider: string }> }
    expect(listed.ok).toBe(true)
    expect(listed.result).toEqual(expect.arrayContaining([expect.objectContaining({ paneId: targetPaneId, provider: 'antigravity' })]))
    expect(await app.evaluate(() => (globalThis as Record<string, unknown>).nativeAsked)).toBe(0)
  } finally {
    await app.close()
    rmSync(root, { recursive: true, force: true })
  }
})
