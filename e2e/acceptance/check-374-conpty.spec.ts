import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * #374 (B13 part 1) black box on Windows: terminals on the bundled ConPTY (useConptyDll). The same run on main and on
 * #374; any difference in input or rendering is a regression. Real app, no paid run.
 * Per shell (PowerShell, then cmd and Git Bash started inside the pane): typing, an SGR colour, columns before and
 * after a window resize, paste (a synthetic paste event: the person's clipboard is never touched), Ctrl+C on a running
 * program. Then a split, the stand-in claude.exe / codex.exe (real console executables that run node), and closing the
 * panes while a detached grandchild tree and a stand-in run: nothing of either tree may survive.
 * Output: ACC_OUT (default test-results/check-374, uploaded by acceptance.yml)/<label>.json and <label>-<shell>.png.
 * Run on CI for both refs: Actions › Acceptance (on demand), product_ref main and the PR branch, same spec_ref.
 */
const OUT = process.env.ACC_OUT ?? join(process.cwd(), 'test-results', 'check-374')
const LABEL = process.env.ACC_LABEL ?? 'ci'
mkdirSync(OUT, { recursive: true })
// The stand-in agents are real console executables (the bundled ConPTY treats .exe and .cmd differently): a tiny C#
// program, built with the .NET Framework compiler every Windows has, that runs node standin.js <name> <args>.
const STANDIN_CS = String.raw`
using System; using System.Diagnostics; using System.IO;
class Standin { static int Main(string[] argv) {
  string name = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]);
  string js = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "standin.js");
  string args = "\"" + js + "\" " + name;
  foreach (string a in argv) args += " \"" + a.Replace("\"", "\\\"") + "\"";
  var child = Process.Start(new ProcessStartInfo("node", args) { UseShellExecute = false });
  child.WaitForExit(); return child.ExitCode; } }
`
function buildStandins(dir: string): void {
  const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  writeFileSync(join(dir, 'standin.cs'), STANDIN_CS)
  execFileSync(csc, ['-nologo', `-out:${join(dir, 'claude.exe')}`, join(dir, 'standin.cs')], { stdio: 'ignore' })
  copyFileSync(join(dir, 'claude.exe'), join(dir, 'codex.exe'))
}
const ESC = String.fromCharCode(27)

const STANDIN = String.raw`
const fs = require('fs')
const [name, ...args] = process.argv.slice(2)
// The app probes CLIs (--version, --help, mcp ...): answer and exit, as the real ones do.
if (['--version', '-v', '--help', '-h', 'mcp', 'doctor', 'login', 'logout', 'auth'].includes(args[0])) { console.log('9.9.9 (stand-in)'); process.exit(0) }
fs.appendFileSync(process.env.ACC_LOG, JSON.stringify({ name, args, pid: process.pid, ppid: process.ppid }) + '\n')
process.stdout.write('\x1b[32m' + name + ' stand-in ready\x1b[0m\r\n')
process.stdin.on('data', d => process.stdout.write('agent got: ' + String(d).trim() + '\r\n'))
process.on('SIGINT', () => { process.stdout.write('agent interrupted\r\n'); process.exit(130) })
setInterval(() => undefined, 1e9)
`
// A tree as an agent's tools leave it: a child that stays, and a DETACHED grandchild (out of the console) with its own child.
const TREE = String.raw`
const { spawn } = require('child_process'), fs = require('fs')
const out = process.argv[2]
const grand = spawn(process.execPath, ['-e', "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e9)'],{stdio:'ignore'});require('fs').writeFileSync(process.argv[1], String(c.pid));setInterval(()=>{},1e9)", out + '.great'], { detached: true, stdio: 'ignore', windowsHide: true })
grand.unref()
fs.writeFileSync(out, JSON.stringify({ parent: process.pid, grand: grand.pid }))
console.log('acc-tree-up')
setInterval(() => undefined, 1e9)
`
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

test('#374: terminals on the bundled ConPTY', async () => {
  test.setTimeout(420_000)
  expect(process.platform, 'Windows only').toBe('win32')
  const base = realProfile('c374', { OXESPACE_LOCALE: 'en-US' })
  const bin = join(base.root, 'bin'); mkdirSync(bin)
  buildStandins(bin)
  writeFileSync(join(bin, 'standin.js'), STANDIN)
  const tree = join(base.root, 'tree.js'); writeFileSync(tree, TREE)
  const log = join(base.root, 'agents.jsonl'); writeFileSync(log, '')
  const pathKey = Object.keys(base.env).find(k => k.toUpperCase() === 'PATH') ?? 'Path'
  const env: Record<string, string> = { ...base.env, ACC_LOG: log }
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k]
  env[pathKey] = `${bin}${delimiter}${base.env[pathKey] ?? ''}`
  const result: Record<string, unknown> = { label: LABEL }
  const pids: number[] = []

  const { app, page } = await launchReal({ ...base, env })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
    await openRepo(page, base.repo)
    const pane1 = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => l[0].panes[0].id))
    await page.evaluate(`window.__acc = {}; window.__accSub = id => { window.__acc[id] = ''; window.oxe.terminal.onData(id, e => { window.__acc[id] += e.data }) }`)
    await page.evaluate(`window.__accSub(${JSON.stringify(pane1)})`)
    const out = (id: string) => page.evaluate(`window.__acc[${JSON.stringify(id)}] ?? ''`) as Promise<string>
    const view = (i: number) => page.locator('[data-testid="pane-container"]').nth(i)
    const line = async (i: number, text: string) => { await view(i).locator('.xterm').click(); await page.keyboard.type(text); await page.keyboard.press('Enter') }
    const waitOut = async (id: string, from: number, re: RegExp, ms = 15_000) => {
      const end = Date.now() + ms
      while (Date.now() < end) { const o = (await out(id)).slice(from); if (re.test(o)) return o; await page.waitForTimeout(250) }
      return null
    }
    const count = (s: string | null, needle: string) => s ? s.split(needle).length - 1 : 0
    // The prompt was printed before the subscription; a first command proves the stream flows.
    await page.waitForTimeout(2_500)
    await line(0, 'echo acc-ready')
    expect(await waitOut(pane1, 0, /acc-ready[\s\S]*acc-ready/, 20_000), 'the pane\'s output reaches the window').not.toBeNull()

    const shells: Array<{ name: string; enter?: string; ready?: RegExp; exit?: string }> = [
      { name: 'powershell' },
      { name: 'cmd', enter: 'cmd.exe', ready: /Microsoft Windows|>\s*$/, exit: 'exit' },
      { name: 'gitbash', enter: "& 'C:\\Program Files\\Git\\bin\\bash.exe' --noprofile --norc -i", ready: /\$\s*$|bash/, exit: 'exit' }
    ]
    for (const sh of shells) {
      const r: Record<string, unknown> = {}
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
      await page.waitForTimeout(800)
      if (sh.enter) {
        const m = (await out(pane1)).length
        await line(0, sh.enter)
        r.entered = (await waitOut(pane1, m, sh.ready!, 15_000)) !== null
        await page.waitForTimeout(1_000)
      }
      // Typing: the command and its output.
      let m = (await out(pane1)).length
      await line(0, `echo acc-typed-${sh.name}`)
      r.typed = count(await waitOut(pane1, m, new RegExp(`acc-typed-${sh.name}[\\s\\S]*acc-typed-${sh.name}`)), `acc-typed-${sh.name}`) >= 2
      // Colour: an SGR red from a program, as agents print theirs.
      m = (await out(pane1)).length
      await line(0, `node -e "process.stdout.write(String.fromCharCode(27)+'[31macc-red-${sh.name}'+String.fromCharCode(27)+'[0m'+String.fromCharCode(10))"`)
      const red = await waitOut(pane1, m, new RegExp(`\\x1b\\[[0-9;]*m[^\\x1b]*acc-red-${sh.name}(?!')`))
      const sgr = red?.match(new RegExp(`(\\x1b\\[[0-9;]*m)(?:[^\\x1b])*acc-red-${sh.name}(?!')`))
      r.sgrBeforeText = sgr?.[1]?.replace(ESC, 'ESC') ?? null
      r.red = !!sgr && /\[(?:[0-9;]*;)?(31|91|38;5;1|38;2;\d+;0;0)m/.test(sgr[1])
      await page.waitForTimeout(300)
      await view(0).screenshot({ path: join(OUT, `${LABEL}-${sh.name}.png`) })
      // Resize: columns the program sees before and after the window narrows.
      const cols = async () => {
        const at = (await out(pane1)).length
        await line(0, `node -e "console.log('acc-cols-'+process.stdout.columns+'-end')"`)
        const o = await waitOut(pane1, at, /acc-cols-(\d+)-end/)
        return Number(o?.match(/acc-cols-(\d+)-end/)?.[1] ?? NaN)
      }
      r.colsWide = await cols()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 950))
      await page.waitForTimeout(1_500)
      r.colsNarrow = await cols()
      r.resized = Number(r.colsNarrow) < Number(r.colsWide)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
      await page.waitForTimeout(1_500)
      // Paste: a paste event on the terminal's own textarea, then Enter.
      m = (await out(pane1)).length
      await view(0).locator('.xterm').click()
      await view(0).locator('textarea.xterm-helper-textarea').evaluate((el, text) => {
        const data = new DataTransfer(); data.setData('text/plain', text)
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      }, `echo acc-paste-${sh.name}`)
      await page.keyboard.press('Enter')
      r.pasted = count(await waitOut(pane1, m, new RegExp(`acc-paste-${sh.name}[\\s\\S]*acc-paste-${sh.name}`)), `acc-paste-${sh.name}`) >= 2
      // Ctrl+C ends a running program and the shell takes input again.
      await line(0, `node -e "setInterval(()=>{},1000)"`)
      await page.waitForTimeout(1_500)
      await view(0).locator('.xterm').click()
      await page.keyboard.press('Control+C')
      await page.waitForTimeout(800)
      m = (await out(pane1)).length
      await line(0, `echo acc-after-ctrlc-${sh.name}`)
      r.ctrlC = count(await waitOut(pane1, m, new RegExp(`acc-after-ctrlc-${sh.name}[\\s\\S]*acc-after-ctrlc-${sh.name}`), 8_000), `acc-after-ctrlc-${sh.name}`) >= 2
      if (sh.exit) { await line(0, sh.exit); await page.waitForTimeout(1_500) }
      result[sh.name] = r
    }

    // Split, and the stand-in agents (console executables) in the new pane.
    await view(0).locator('.xterm').click()
    await page.keyboard.press('Control+Shift+Backslash')
    await expect(page.locator('[data-testid="pane-container"]')).toHaveCount(2, { timeout: 10_000 })
    const pane2 = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => l[0].panes[l[0].panes.length - 1].id))
    await page.evaluate(`window.__accSub(${JSON.stringify(pane2)})`)
    await page.waitForTimeout(3_000)
    const i2 = await page.evaluate(id => [...document.querySelectorAll('[data-testid="pane-container"]')].findIndex(e => e.outerHTML.includes(id)), pane2)
    const p2 = i2 >= 0 ? i2 : 1
    let m = (await out(pane2)).length
    await line(p2, 'echo acc-split')
    result.split = count(await waitOut(pane2, m, /acc-split[\s\S]*acc-split/), 'acc-split') >= 2
    const agents: Record<string, unknown> = {}
    for (const name of ['claude', 'codex']) {
      m = (await out(pane2)).length
      await line(p2, name)
      const banner = await waitOut(pane2, m, new RegExp(`${name} stand-in ready`), 15_000)
      agents[`${name}Started`] = banner !== null
      agents[`${name}Green`] = !!banner && new RegExp(`\\x1b\\[[0-9;]*32m${name} stand-in ready`).test(banner)
      m = (await out(pane2)).length
      await line(p2, `hello-${name}`)
      agents[`${name}Input`] = (await waitOut(pane2, m, new RegExp(`agent got: hello-${name}`), 8_000)) !== null
      if (name === 'claude') {
        await view(p2).locator('.xterm').click(); await page.keyboard.press('Control+C'); await page.waitForTimeout(1_000)
        m = (await out(pane2)).length
        await line(p2, 'echo acc-after-agent')
        agents.claudeCtrlC = count(await waitOut(pane2, m, /acc-after-agent[\s\S]*acc-after-agent/, 8_000), 'acc-after-agent') >= 2
      }
    }
    result.agents = agents
    await view(p2).screenshot({ path: join(OUT, `${LABEL}-agents.png`) })

    // Close with trees alive: pane 1 runs a tree with a detached grandchild; pane 2 still runs the codex stand-in.
    const pidFile = join(base.root, 'tree.json')
    await line(0, `node "${tree}" "${pidFile}"`)
    await expect.poll(() => existsSync(pidFile) && existsSync(pidFile + '.great'), { timeout: 15_000, message: 'the tree is up' }).toBe(true)
    const t = JSON.parse(readFileSync(pidFile, 'utf8')) as { parent: number; grand: number }
    const great = Number(readFileSync(pidFile + '.great', 'utf8'))
    const codex = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { name: string; pid: number; ppid: number }).filter(l => l.name === 'codex').pop()
    const watched: Record<string, number> = { treeParent: t.parent, detachedGrandchild: t.grand, greatGrandchild: great, ...(codex ? { codexNode: codex.pid, codexExe: codex.ppid } : {}) }
    pids.push(...Object.values(watched))
    const before = Object.fromEntries(Object.entries(watched).map(([k, pid]) => [k, alive(pid)]))
    for (let n = 2; n > 0; n--) {
      await view(n - 1).getByRole('button', { name: /More pane actions|Mais ações do painel/ }).click()
      await page.getByRole('menuitem', { name: /^(Close pane|Fechar o painel)/ }).click()
      const confirm = page.getByRole('dialog').getByRole('button', { name: /^(Close|Fechar|End|Encerrar)/ })
      if (await confirm.isVisible({ timeout: 1_500 }).catch(() => false)) await confirm.click()
      await expect(page.locator('[data-testid="pane-container"]')).toHaveCount(n - 1, { timeout: 10_000 })
    }
    await page.waitForTimeout(5_000)
    const after = Object.fromEntries(Object.entries(watched).map(([k, pid]) => [k, alive(pid)]))
    result.closeTree = { before, after }
    // The verdict, per item (soft: every item is reported).
    for (const sh of ['powershell', 'cmd', 'gitbash']) {
      const r = (result[sh] ?? {}) as Record<string, unknown>
      for (const item of ['typed', 'pasted', 'ctrlC', 'resized']) expect.soft(r[item], `${sh}: ${item}`).toBe(true)
      if (sh !== 'powershell') expect.soft(r.red, `${sh}: SGR red reaches the window`).toBe(true)
    }
    expect.soft(result.split, 'split works').toBe(true)
    for (const [k, v] of Object.entries(result.agents as Record<string, unknown>)) expect.soft(v, `agents: ${k}`).toBe(true)
    for (const [k, v] of Object.entries(after)) expect.soft(v, `closing the panes ends ${k}`).toBe(false)
  } finally {
    await quitReal(app)
    // Whatever survived is ours: end it so no test process outlives the run.
    for (const pid of pids) if (alive(pid)) { try { process.kill(pid) } catch { /* gone */ } }
    writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 2))
    console.log('ACC-RESULT', JSON.stringify(result))
  }
})

/**
 * Time to the first prompt for a pane started with no terminal attached (OxeCode hidden behind OxeChat), as a background
 * or restored pane starts. The bundled ConPTY asks the terminal for its attributes (DA1, ESC[c) and waits for a reply.
 * Measured from terminal.start to the first output that holds the PowerShell prompt, three times.
 */
test('#374: first prompt of a pane started while hidden', async () => {
  test.setTimeout(180_000)
  const base = realProfile('c374h', { OXESPACE_LOCALE: 'en-US' })
  const { app, page } = await launchReal(base)
  const timings: Record<string, unknown> = { label: LABEL }
  try {
    await openRepo(page, base.repo)
    const workspaceId = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ id: string }>> } } }).oxe.workspace.list().then(l => l[0].id))
    // Visible baseline: a pane the Code view starts and attaches itself.
    await page.locator('[data-testid="pane-container"] .xterm').first().waitFor({ timeout: 20_000 })
    await page.locator('button[data-app-mode="thread"]').first().click()
    await page.waitForTimeout(1_500)
    const hidden: number[] = []
    for (let i = 0; i < 3; i++) {
      const ms = await page.evaluate(async id => {
        const oxe = (window as unknown as { oxe: { workspace: { createPane: (i: object) => Promise<{ paneId: string }> }; terminal: { start: (i: object) => Promise<void>; onData: (id: string, l: (e: { data: string }) => void) => () => void } } }).oxe
        const { paneId } = await oxe.workspace.createPane({ workspaceId: id })
        let text = ''
        const done = new Promise<number>(resolve => {
          const t0 = performance.now()
          const off = oxe.terminal.onData(paneId, e => { text += e.data; if (/PS [A-Z]:\\[^\r\n]*>/.test(text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ''))) { off(); resolve(Math.round(performance.now() - t0)) } })
          void oxe.terminal.start({ paneId, workspaceId: id, cols: 120, rows: 30 })
          setTimeout(() => { off(); resolve(-1) }, 20_000)
        })
        return done
      }, workspaceId)
      hidden.push(ms)
    }
    timings.hiddenFirstPromptMs = hidden
    timings.attachedViews = await page.locator('[data-testid="pane-container"] .xterm').count()
    // BACKEND's question: without an attached terminal to answer DA1, is the first prompt ~3 s late? Under 2 s passes.
    for (const [i, ms] of hidden.entries()) {
      expect.soft(ms, `hidden pane ${i + 1}: a prompt arrives`).toBeGreaterThan(0)
      expect.soft(ms, `hidden pane ${i + 1}: first prompt within 2 s`).toBeLessThan(2_000)
    }
  } finally {
    await quitReal(app)
    writeFileSync(join(OUT, `${LABEL}-hidden.json`), JSON.stringify(timings, null, 2))
    console.log('ACC-HIDDEN', JSON.stringify(timings))
  }
})
