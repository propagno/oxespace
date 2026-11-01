import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
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
 * - T5: the status hooks the app writes into Claude's settings.json and Codex's hooks.json, run exactly as written
 *   (exec form, PowerShell string or sh string) on the system node, reach the app as pane status.
 * - T8 (Windows): the shipped updater, pointed at a feed on the loopback, sees a newer version and downloads nothing.
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

/**
 * Runs OXESpace's UserPromptSubmit handler from each agent config EXACTLY as written: Claude's exec form (command +
 * args, no shell) or the command string through the shell the agent uses for it (PowerShell for Codex on Windows,
 * sh elsewhere). Records how each ran and what it answered; the app side is checked through agentHooks.onStatus.
 */
const HOOK_DRIVER = String.raw`
const { spawn } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
const [claudeSettings, codexHooks, cwd, out] = process.argv.slice(2)
const ours = path => {
  const doc = JSON.parse(readFileSync(path, 'utf8'))
  for (const entry of (doc.hooks && doc.hooks.UserPromptSubmit) || []) {
    for (const hook of entry.hooks || []) if (JSON.stringify(hook).includes('oxespace-status-hook.cjs')) return hook
  }
  return null
}
const run = (agent, hook) => new Promise(resolve => {
  if (!hook) return resolve({ agent, missing: true })
  const form = Array.isArray(hook.args) ? 'exec' : process.platform === 'win32' ? 'powershell' : 'sh'
  const child = form === 'exec' ? spawn(hook.command, hook.args, { windowsHide: true })
    : form === 'powershell' ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', hook.command], { windowsHide: true })
    : spawn('/bin/sh', ['-c', hook.command])
  let stdout = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.on('error', error => resolve({ agent, form, error: error.code || String(error) }))
  child.on('close', code => resolve({ agent, form, command: hook.command, code, stdout: stdout.trim() }))
  child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'b13-' + agent, cwd }))
})
Promise.all([run('claude-code', ours(claudeSettings)), run('codex', ours(codexHooks))])
  .then(results => writeFileSync(out, JSON.stringify(results)))
`

/** A newer release than any real one, so the comparison cannot depend on the version being built. */
const SMOKE_UPDATE_VERSION = '99.0.0'

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
      console.log('[b13-t2]', JSON.stringify({ after8s: code }))
      expect(output, 'Node ran inside the packaged binary').not.toContain(marker)
      // Positive control: the binary did not just crash or exit; it started the app and ignored the variable.
      expect(code, 'the packaged app is still running 8 s after a start with ELECTRON_RUN_AS_NODE').toBe('running')
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

    test('T5: the status hooks the app writes run as written on the system node and reach the app', async () => {
      test.setTimeout(120_000)
      const root = scratch('hooks')
      const workspace = join(root, 'workspace')
      const claudeDir = join(root, 'claude'), codexDir = join(root, 'codex')
      // The agents' config homes point into the scratch folder: nothing of the runner's own config is touched.
      const { app, page } = await launch(root, { OXESPACE_DISABLE_SINGLE_INSTANCE: '1', CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir })
      try {
        const paneId = await openTerminal(page, workspace)
        await page.evaluate(() => {
          const seen: unknown[] = []
          ;(window as unknown as { __b13Hooks: unknown[] }).__b13Hooks = seen
          window.oxe.agentHooks.onStatus(event => { seen.push(event) })
        })
        const installed = await page.evaluate(async () => [await window.oxe.agentHooks.install('claude-code'), await window.oxe.agentHooks.install('codex')])
        expect(installed.map(status => status.state), JSON.stringify(installed)).toEqual(['installed', 'installed'])
        const claudeSettings = join(claudeDir, 'settings.json'), codexHooks = join(codexDir, 'hooks.json')
        for (const file of [claudeSettings, codexHooks]) {
          const written = readFileSync(file, 'utf8')
          expect(written, `${file} names the system node`).toMatch(/"node"|node /)
          expect(written).not.toContain('ELECTRON_RUN_AS_NODE')
          expect(written.toLowerCase()).not.toContain(basename(process.env.OXESPACE_PACKAGED_EXECUTABLE!).toLowerCase())
        }

        const driver = join(root, 'hook-driver.cjs'), out = join(root, 'hooks.json')
        writeFileSync(driver, HOOK_DRIVER)
        // From inside an app terminal: its env carries the execution credentials and the hook port, as an agent's does.
        await typeInto(page, paneId, `node ${quote(driver)} ${quote(claudeSettings)} ${quote(codexHooks)} ${quote(workspace)} ${quote(out)}`)
        await expect.poll(() => existsSync(out), { timeout: 45_000 }).toBe(true)
        const ran = JSON.parse(readFileSync(out, 'utf8')) as Array<{ agent: string; form: string; code: number; stdout: string }>
        console.log('[b13-t5]', JSON.stringify(ran.map(({ agent, form, code, stdout }) => ({ agent, form, code, stdout }))))
        expect(ran.map(({ agent, form, code, stdout }) => ({ agent, form, code, stdout }))).toEqual([
          { agent: 'claude-code', form: platform === 'win32' ? 'exec' : 'sh', code: 0, stdout: '{}' },
          { agent: 'codex', form: platform === 'win32' ? 'powershell' : 'sh', code: 0, stdout: '{}' }
        ])
        await expect.poll(async () => page.evaluate(id => ((window as unknown as { __b13Hooks: Array<{ paneId: string; agent: string; state: string }> }).__b13Hooks)
          .filter(event => event.paneId === id && event.state === 'working').map(event => event.agent).sort(), paneId), { timeout: 15_000 })
          .toEqual(['claude-code', 'codex'])
      } finally {
        await app.close()
      }
    })

    test('T8: the shipped updater reads a loopback feed, sees a newer version and downloads nothing', async () => {
      test.setTimeout(120_000)
      // The Linux unpacked tree is neither an AppImage nor apt-managed, so its updater only reads the GitHub API
      // (updaterSupportsThisInstall); electron-updater itself runs in the NSIS build, which is what ships.
      test.skip(platform !== 'win32', 'electron-updater runs only in the Windows (NSIS) build of the packaged smoke')
      const root = scratch('updater')
      const requests: string[] = []
      const feed = `version: ${SMOKE_UPDATE_VERSION}\nfiles:\n  - url: OXESpace-Setup-${SMOKE_UPDATE_VERSION}.exe\n    sha512: ${'A'.repeat(86)}==\n    size: 1\npath: OXESpace-Setup-${SMOKE_UPDATE_VERSION}.exe\nsha512: ${'A'.repeat(86)}==\nreleaseDate: '2099-01-01T00:00:00.000Z'\n`
      const server = createServer((request, response) => {
        requests.push(`${request.method} ${request.url}`)
        if (/^\/(latest|beta)\.yml(\?|$)/.test(request.url ?? '')) { response.setHeader('Content-Type', 'text/yaml'); response.end(feed); return }
        response.statusCode = 404
        response.end()
      })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      const feedUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
      const { app, page } = await launch(root, { OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_UPDATE_FEED_URL: feedUrl })
      try {
        const state = await page.evaluate(() => window.oxe.app.checkForUpdates())
        await expect.poll(async () => (await page.evaluate(() => window.oxe.app.getUpdateState())).status, { timeout: 30_000 }).toBe('available')
        const final = await page.evaluate(() => window.oxe.app.getUpdateState())
        console.log('[b13-t8]', JSON.stringify({ first: state.status, final: { status: final.status, availableVersion: final.availableVersion, error: final.error }, requests }))
        expect(final).toMatchObject({ status: 'available', availableVersion: SMOKE_UPDATE_VERSION, error: null })
        // Read-only feed: only the channel file was asked for, never the installer, and the app is still up.
        expect(requests.length).toBeGreaterThan(0)
        expect(requests.every(line => /^GET \/(latest|beta)\.yml/.test(line)), requests.join(', ')).toBe(true)
        await page.waitForTimeout(3000)
        expect(requests.some(line => line.includes('.exe'))).toBe(false)
        expect(await page.evaluate(() => window.oxe.app.getUpdateState().then(value => value.status))).toBe('available')
      } finally {
        await app.close()
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    })
  })
}
