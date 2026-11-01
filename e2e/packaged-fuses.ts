import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/**
 * B13 (BE-M-02, BE-M-08) against the REAL packaged binary, whose fuses electron-builder flipped. CI only: the
 * coordinator dispatches `packaged_smoke_only`; locally nothing here launches (no OXESPACE_PACKAGED_EXECUTABLE).
 *
 * - T2: the binary refuses to run as Node with ELECTRON_RUN_AS_NODE (RunAsNode off).
 * - T3: closing a terminal starts no second OXESpace, restores and focuses nothing, and ends the whole tree,
 *   including a detached grandchild that ignores SIGTERM (node-pty's bundled ConPTY on Windows never forks).
 * - T4: the internal MCP bridge the app wrote to `.mcp.json` runs on the system `node`, never on the app binary, and
 *   answers initialize, tools/list and a read tool, launched exactly as written from inside an app terminal.
 * T1 (reading the fuses) is the `Read packaged fuses` CI step (scripts/check-fuses.mjs).
 */
export interface PackagedFusesOptions { platform: NodeJS.Platform; label: string }

const TREE_SCRIPT = String.raw`
const { spawn } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const [pidFile, depthText] = process.argv.slice(2)
const depth = Number(depthText)
if (depth > 0) for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) { try { process.on(signal, () => {}) } catch {} }
appendFileSync(pidFile, process.pid + '\n')
if (depth < 2) spawn(process.execPath, [__filename, pidFile, String(depth + 1)], { detached: depth === 0, stdio: 'ignore', windowsHide: true }).unref()
setInterval(() => {}, 1000)
`

/** Runs the oxespace entry of `.mcp.json` exactly as written, with the terminal's env, and records what it answered. */
const BRIDGE_DRIVER = String.raw`
const { spawn } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
const [workspace, out] = process.argv.slice(2)
const entry = JSON.parse(readFileSync(workspace + '/.mcp.json', 'utf8')).mcpServers.oxespace
const result = { command: entry.command, answers: {} }
const child = spawn(entry.command, entry.args || [], { env: { ...process.env, ...(entry.env || {}) }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
let buffer = ''
const finish = () => { writeFileSync(out, JSON.stringify(result)); try { child.kill() } catch {} process.exit(0) }
setTimeout(() => { result.timedOut = true; finish() }, 20000)
child.on('error', error => { result.spawnError = error.code || String(error); finish() })
child.stdout.on('data', chunk => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.id === 1) {
      result.answers.initialize = !!message.result
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
    } else if (message.id === 2) {
      const names = (message.result && message.result.tools || []).map(tool => tool.name)
      result.answers.toolCount = names.length
      result.answers.hasCapabilities = names.includes('oxespace_capabilities')
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'oxespace_capabilities', arguments: {} } }) + '\n')
    } else if (message.id === 3) {
      result.answers.capabilities = !!message.result && !message.result.isError
      finish()
    }
  }
})
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'b13-packaged', version: '1' } } }) + '\n')
`

function scratch(name: string): string {
  const root = join(tmpdir(), `oxe-b13-${name}-${Date.now()}`)
  mkdirSync(join(root, 'workspace'), { recursive: true })
  return root
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else process.kill(-pid, 'SIGKILL')
  } catch { /* gone */ }
}

/** Main (browser) processes of this executable: Chromium helpers carry --type=, a second instance does not. */
function mainProcessCount(executablePath: string): number {
  if (process.platform === 'win32') {
    const name = basename(executablePath).replace(/'/g, "''")
    const script = `@(Get-CimInstance Win32_Process -Filter "Name='${name}'" | Where-Object { $_.CommandLine -notmatch '--type=' }).Count`
    return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim())
  }
  const out = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' })
  return out.split('\n').filter(line => line.startsWith(executablePath) && !line.includes('--type=')).length
}

async function launch(root: string, extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env.OXESPACE_PACKAGED_EXECUTABLE!
  const app = await electron.launch({ executablePath, env: { ...process.env, OXESPACE_DB_PATH: join(root, 'db.sqlite3'), ...extraEnv } })
  const page = await app.firstWindow()
  await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible', timeout: 30_000 })
  return { app, page }
}

async function openTerminal(page: Page, workspace: string): Promise<string> {
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(workspace)
  await page.getByTestId('wizard-layout-card-1').click()
  await page.getByTestId('wizard-launch-btn').click()
  await expect(page.getByTestId('terminal-status-label').filter({ hasText: 'running' }).first()).toBeVisible({ timeout: 15_000 })
  const paneId = await page.getByTestId('terminal-pane').first().getAttribute('data-pane-id')
  expect(paneId, 'the terminal exposes its pane id').toBeTruthy()
  return paneId!
}

const typeInto = (page: Page, paneId: string, line: string) =>
  page.evaluate(({ paneId, data }) => window.oxe.terminal.write({ paneId, data }), { paneId, data: line + '\r' })

const quote = (path: string) => `"${path}"`

export function registerPackagedFuses({ platform, label }: PackagedFusesOptions): void {
  test.describe(`packaged ${label} B13`, () => {
    test.beforeEach(() => {
      test.skip(process.platform !== platform, `${label} packaged artifact check`)
      const executablePath = process.env.OXESPACE_PACKAGED_EXECUTABLE
      expect(executablePath, 'OXESPACE_PACKAGED_EXECUTABLE').toBeTruthy()
      expect(existsSync(executablePath!), `packaged executable ${executablePath}`).toBe(true)
    })

    test('T2: the packaged binary does not run as Node with ELECTRON_RUN_AS_NODE', async () => {
      test.setTimeout(60_000)
      const root = scratch('run-as-node')
      const marker = 'RAN_AS_NODE_B13'
      // With the fuse off this starts the app itself (a GUI), so it gets its own database and is ended by tree.
      const child = spawn(process.env.OXESPACE_PACKAGED_EXECUTABLE!, ['-e', `process.stdout.write('${marker}')`], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3') },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32'
      })
      let output = ''
      child.stdout.on('data', chunk => { output += String(chunk) })
      child.stderr.on('data', chunk => { output += String(chunk) })
      const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)))
      const code = await Promise.race([exited, new Promise<'running'>(resolve => setTimeout(() => resolve('running'), 8000))])
      killTree(child.pid)
      expect(output, 'Node ran inside the packaged binary').not.toContain(marker)
      console.log('[b13-t2]', JSON.stringify({ after8s: code }))
    })

    test('T3: closing a terminal starts no second OXESpace and ends its whole tree', async () => {
      test.setTimeout(120_000)
      const root = scratch('terminal-close')
      const executablePath = process.env.OXESPACE_PACKAGED_EXECUTABLE!
      // The single-instance lock stays ON here: a stray second instance would hit it and fire second-instance.
      const { app, page } = await launch(root)
      try {
        const paneId = await openTerminal(page, join(root, 'workspace'))
        const script = join(root, 'tree.cjs'), pidFile = join(root, 'pids.txt')
        writeFileSync(script, TREE_SCRIPT)
        await app.evaluate(({ app, BrowserWindow }) => {
          const counters = { secondInstance: 0, restore: 0, focus: 0 }
          ;(globalThis as unknown as { __b13: typeof counters }).__b13 = counters
          app.on('second-instance', () => { counters.secondInstance++ })
          for (const window of BrowserWindow.getAllWindows()) {
            window.blur()
            window.on('restore', () => { counters.restore++ })
            window.on('focus', () => { counters.focus++ })
          }
        })
        await typeInto(page, paneId, `node ${quote(script)} ${quote(pidFile)} 0`)
        await expect.poll(() => existsSync(pidFile) ? readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).length : 0, { timeout: 30_000 }).toBe(3)
        const tree = readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number)
        const shellPid = (await page.evaluate(id => window.oxe.terminal.status(id), paneId)).pid as number
        expect(tree.every(isAlive), 'the tree is up before the close').toBe(true)
        const before = mainProcessCount(executablePath)
        expect(before, 'one OXESpace main process before the close').toBe(1)

        // The pane close path: terminal:stop, the IPC the pane calls (TerminalManager.stop).
        await page.evaluate(id => window.oxe.terminal.stop({ paneId: id }), paneId)
        let most = before
        const deadline = Date.now() + 6000
        while (Date.now() < deadline) {
          most = Math.max(most, mainProcessCount(executablePath))
          await new Promise(resolve => setTimeout(resolve, 250))
        }
        const counters = await app.evaluate(() => (globalThis as unknown as { __b13: Record<string, number> }).__b13)
        const alive = [shellPid, ...tree].filter(isAlive)
        console.log('[b13-t3]', JSON.stringify({ before, most, counters, alive }))
        expect(most, 'closing a terminal started another OXESpace').toBe(before)
        expect(counters, 'closing a terminal restored or focused the window').toEqual({ secondInstance: 0, restore: 0, focus: 0 })
        expect(alive, 'processes of the closed terminal still alive').toEqual([])
      } finally {
        for (const pid of existsSync(join(root, 'pids.txt')) ? readFileSync(join(root, 'pids.txt'), 'utf8').split('\n').filter(Boolean).map(Number) : []) killTree(pid)
        await app.close()
      }
    })

    test('T4: the MCP bridge the app wrote runs on the system node and answers', async () => {
      test.setTimeout(120_000)
      const root = scratch('bridge')
      const workspace = join(root, 'workspace')
      const executablePath = process.env.OXESPACE_PACKAGED_EXECUTABLE!
      const { app, page } = await launch(root, { OXESPACE_DISABLE_SINGLE_INSTANCE: '1' })
      try {
        const paneId = await openTerminal(page, workspace)
        const mcpJson = join(workspace, '.mcp.json')
        await expect.poll(() => existsSync(mcpJson) && 'oxespace' in (JSON.parse(readFileSync(mcpJson, 'utf8')).mcpServers ?? {}), { timeout: 20_000 }).toBe(true)
        const written = readFileSync(mcpJson, 'utf8')
        const entry = JSON.parse(written).mcpServers.oxespace as { command: string; args: string[] }
        expect(entry.command, 'the bridge runs on the system node').toBe('node')
        expect(written).not.toContain('ELECTRON_RUN_AS_NODE')
        expect(written.toLowerCase()).not.toContain(basename(executablePath).toLowerCase())

        const driver = join(root, 'bridge-driver.cjs'), out = join(root, 'bridge.json')
        writeFileSync(driver, BRIDGE_DRIVER)
        // From inside an app terminal, as an agent there would: its env carries the MCP port and token.
        await typeInto(page, paneId, `node ${quote(driver)} ${quote(workspace)} ${quote(out)}`)
        await expect.poll(() => existsSync(out), { timeout: 45_000 }).toBe(true)
        const result = JSON.parse(readFileSync(out, 'utf8'))
        console.log('[b13-t4]', JSON.stringify(result))
        expect(result).toMatchObject({ command: 'node', answers: { initialize: true, hasCapabilities: true, capabilities: true } })
        expect(result.answers.toolCount).toBeGreaterThan(0)
      } finally {
        await app.close()
      }
    })
  })
}
