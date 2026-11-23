'use strict'
// OXE-400: one measured case in a fresh Electron main process (run by run.cjs, never by hand on a dev machine).
// Env: POC_SUITE throughput|echo|isolation|quit · POC_ARM A|B|C|D · POC_PARAMS JSON · POC_NODE · POC_RESULT_TAG
// Prints exactly one line `POC_RESULT <json>` when the case got to its end; a case that aborts prints none, and
// run.cjs records its exit code and signal instead.
const { app, BrowserWindow, Menu } = require('electron')
const { mkdtempSync, readFileSync } = require('node:fs')
const { execFile, execFileSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { monitorEventLoopDelay, performance } = require('node:perf_hooks')
const { openHost } = require('./hosts.cjs')

const suite = process.env.POC_SUITE
const arm = process.env.POC_ARM
const params = JSON.parse(process.env.POC_PARAMS || '{}')
const NODE = process.env.POC_NODE || 'node'
const GEN = join(__dirname, 'gen.cjs')
const MB = 1024 * 1024
const isWindows = process.platform === 'win32'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'oxe-400-case-')))
app.disableHardwareAcceleration()

const uncaught = []
// The app's own handler (electron/main/index.ts): log and carry on. A native abort never reaches it.
process.on('uncaughtException', error => { uncaught.push(String(error?.message ?? error)) })

const T0 = performance.now()
/** POC_DEBUG=1: a timestamped trace on stderr, for diagnosing a case on CI. */
function trace(...parts) {
  if (process.env.POC_DEBUG) process.stderr.write(`[case ${suite} ${arm} +${Math.round(performance.now() - T0)}ms] ${parts.join(' ')}\n`)
}

function result(value) {
  process.stdout.write(`POC_RESULT ${JSON.stringify({ suite, arm, ...value })}\n`)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function childEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('OXESPACE_') || key.startsWith('POC_') || key.startsWith('ELECTRON_')) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  return env
}

function shell() {
  return isWindows
    ? { file: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', args: [] }
    : { file: '/bin/bash', args: ['--noprofile', '--norc', '-i'] }
}

function options(command, cols = 120, rows = 30) {
  return { ...command, cwd: tmpdir(), env: childEnv(), cols, rows }
}

/** Resolves when the terminal has printed something and then stayed quiet for `quietMs` (its prompt). */
function settled(term, quietMs = 300, maxMs = 10000) {
  return new Promise(resolve => {
    let seen = false
    let timer = null
    const done = () => { off(); clearTimeout(timer); clearTimeout(limit); resolve(seen) }
    const off = term.onData(() => { seen = true; clearTimeout(timer); timer = setTimeout(done, quietMs) })
    const limit = setTimeout(done, maxMs)
  })
}

function waitFor(term, needle, maxMs) {
  return new Promise(resolve => {
    let tail = ''
    const off = term.onData(text => {
      tail = (tail + text).slice(-(needle.length + 4096))
      if (tail.includes(needle)) { off(); clearTimeout(limit); resolve(true) }
    })
    const limit = setTimeout(() => { off(); resolve(false) }, maxMs)
  })
}

/** Working set in MB of a process the app does not see in getAppMetrics (the arm D binary). Async on Windows, so
 * sampling never blocks the main process it is measuring. */
function osMemoryMb(pid) {
  if (process.platform === 'linux') {
    try {
      const match = /VmRSS:\s+(\d+)\s+kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
      return Promise.resolve(match ? Number(match[1]) / 1024 : 0)
    } catch { return Promise.resolve(0) }
  }
  if (!isWindows) return Promise.resolve(0)
  return new Promise(resolve => {
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }, (error, out) => {
      if (error) return resolve(0)
      const field = out.trim().split('","').pop() ?? ''
      resolve(Number(field.replace(/[^\d]/g, '')) / 1024)
    })
  })
}

/** Main process + PTY host, in MB. For A (or before the host exists) the host part is 0. */
async function hostSideMb(host) {
  const metrics = app.getAppMetrics()
  const of = pid => (metrics.find(metric => metric.pid === pid)?.memory.workingSetSize ?? 0) / 1024
  const main = of(process.pid)
  if (!host || arm === 'A') return { main, host: 0 }
  if (arm === 'D') return { main, host: await osMemoryMb(host.pid) }
  return { main, host: of(host.pid) }
}

/** Windows: which console host the arm's PTYs run on (OpenConsole.exe = node-pty's ConPTY, conhost.exe = the system's). */
function consoleHosts(hostPid) {
  if (!isWindows) return null
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${hostPid}" | ForEach-Object { $_.Name }`], { encoding: 'utf8', windowsHide: true })
    return [...new Set(out.split(/\r?\n/).map(name => name.trim()).filter(name => /console|conhost/i.test(name)))]
  } catch { return null }
}

function quantile(values, q) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

async function throughput() {
  const { terminals, kind, totalBytes = 50 * MB } = params
  const before = await hostSideMb(null)
  const host = await openHost(arm)
  const perTerminal = Math.floor(totalBytes / terminals)
  let peak = 0
  const sample = async () => { const m = await hostSideMb(host); peak = Math.max(peak, m.main + m.host) }
  const sampler = setInterval(() => { void sample() }, 500)
  const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  let received = 0
  const finished = []
  for (let index = 0; index < terminals; index++) {
    const tag = `${process.pid}x${index}`
    const term = await host.spawn(options({ file: NODE, args: [GEN, 'bytes', String(perTerminal), kind, tag] }))
    let head = ''
    term.onData(text => { received += text.length; if (head.length < 3000) head += text.slice(0, 3000 - head.length) })
    term.onExit(code => trace('exit', index, code, 'received', received, head.length < 3000 ? JSON.stringify(head) : ''))
    finished.push(waitFor(term, `__POC_END_${tag}__`, 150000).then(ok => { trace('end', index, ok); return ok }))
  }
  trace('spawned', terminals)
  const ends = await Promise.all(finished)
  const hostStats = ends.every(Boolean) ? null : await host.stats?.()
  const seconds = (performance.now() - t0) / 1000
  const cpu = process.cpuUsage(cpu0)
  clearInterval(sampler)
  await sample()
  host.close()
  result({
    terminals, kind, totalBytes: perTerminal * terminals, complete: ends.every(Boolean), seconds,
    mbPerSecond: (perTerminal * terminals) / MB / seconds,
    mainCpuPercent: ((cpu.user + cpu.system) / 1000 / (seconds * 1000)) * 100,
    receivedChars: received, hostStats,
    memoryBeforeMb: before.main, memoryPeakMb: peak, memoryPerTerminalMb: (peak - before.main) / terminals,
  })
}

async function echo() {
  const { loaders = 8, idleSamples = 10, loadSamples = 20, ratePerLoader = MB } = params
  const host = await openHost(arm)
  const idle = await host.spawn(options(shell()))
  const prompt = await settled(idle, 400)
  const consoles = consoleHosts(host.pid)
  const measure = async () => {
    const start = performance.now()
    const seen = waitFor(idle, 'q', 5000)
    idle.write('q')
    const ok = await seen
    const ms = performance.now() - start
    idle.write('\x7f')
    await sleep(150)
    return ok ? ms : null
  }
  const idleMs = []
  for (let i = 0; i < idleSamples; i++) idleMs.push(await measure())
  const loaderTerms = []
  for (let i = 0; i < loaders; i++) loaderTerms.push(await host.spawn(options({ file: NODE, args: [GEN, 'rate', String(ratePerLoader), '60', 'ansi'] })))
  await sleep(1500)
  const loop = monitorEventLoopDelay({ resolution: 10 })
  loop.enable()
  const loadMs = []
  for (let i = 0; i < loadSamples; i++) loadMs.push(await measure())
  loop.disable()
  for (const term of loaderTerms) term.kill()
  idle.kill()
  await sleep(300)
  host.close()
  const valid = values => values.filter(value => value !== null)
  result({
    prompt, consoles,
    idleMs: valid(idleMs), loadMs: valid(loadMs), timeouts: idleMs.length + loadMs.length - valid(idleMs).length - valid(loadMs).length,
    loadP50: quantile(valid(loadMs), 0.5), loadP95: quantile(valid(loadMs), 0.95), loadP99: quantile(valid(loadMs), 0.99),
    mainLoopP95Ms: loop.percentile(95) / 1e6, mainLoopMaxMs: loop.max / 1e6,
  })
}

async function isolation() {
  const { fault } = params
  const host = await openHost(arm)
  const term = await host.spawn(options(shell()))
  await settled(term, 400)
  const t0 = performance.now()
  let endedAt = null
  let endedWith = null
  term.onExit(code => { endedAt = performance.now(); endedWith = code; trace('ended', code) })
  trace('inject', fault)
  if (fault === 'listener-throws-on-exit') {
    // The app's exit listener throws (as one could while the app quits and its stores are closed).
    term.onExit(() => { throw new Error('OXE-400: injected exception in the exit listener') })
    term.kill()
  } else if (fault === 'listener-throws-on-data') {
    let thrown = false
    term.onData(() => { if (!thrown) { thrown = true; throw new Error('OXE-400: injected exception in the data listener') } })
    term.write(isWindows ? 'echo poc\r' : 'echo poc\r')
  } else if (fault === 'host-panic') {
    host.panic()
  } else if (fault === 'host-killed') {
    process.kill(host.pid, 'SIGKILL')
  }
  // Up to 5 s for the terminal to be reported as ended, then 1 s more of the main process being alive.
  for (let i = 0; i < 50 && endedAt === null; i++) await sleep(100)
  await sleep(1000)
  let stillWorks = null
  if (fault === 'listener-throws-on-data' && !term.ended) {
    const seen = waitFor(term, 'ok-after', 5000)
    term.write('echo ok-after\r')
    stillWorks = await seen
  }
  trace('report')
  result({
    fault, survived: true, ended: endedAt !== null, endedMs: endedAt === null ? null : endedAt - t0, endedWith,
    stillWorks, uncaught: uncaught.length, hostAlive: arm === 'A' ? true : Boolean(host.alive),
  })
  term.kill()
  host.close()
}

async function quit() {
  const { path, shells = 4 } = params
  const window = new BrowserWindow({ show: false, width: 400, height: 300 })
  await window.loadURL('about:blank')
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'App', submenu: [{ role: 'quit' }] }]))
  const host = await openHost(arm)
  const terms = []
  for (let i = 0; i < shells; i++) {
    const term = await host.spawn(options(shell()))
    // Like terminal.service: on exit, tell the window if it is still there.
    term.onExit(code => { if (!window.isDestroyed()) window.webContents.send('pty-exit', code) })
    terms.push(term)
  }
  await Promise.all(terms.map(term => settled(term, 300, 5000)))
  // Like electron/main/index.ts: the first before-quit stops every terminal, then quits for real (5 s cap).
  let stopping = false
  app.on('before-quit', event => {
    if (stopping) return
    stopping = true
    trace('before-quit')
    event.preventDefault()
    for (const term of terms) { try { term.kill() } catch {} }
    host.close()
    // The 5 s cap of the app; when it is what ends the process, run.cjs counts the quit as stalled.
    setTimeout(() => { app.quit(); setTimeout(() => { process.stdout.write('POC_FALLBACK_EXIT\n'); app.exit(0) }, 5000).unref() }, 50)
  })
  app.on('window-all-closed', () => { trace('window-all-closed'); app.quit() })
  app.on('will-quit', () => trace('will-quit'))
  app.on('quit', () => trace('quit'))
  for (const term of terms) term.onExit(code => trace('term exit', code))
  result({ path, shells, phase: 'quitting' })
  trace('quitting via', path)
  if (path === 'menu') Menu.getApplicationMenu().items[0].submenu.items[0].click()
  else if (path === 'window') window.close()
  else app.quit()
}

const suites = { throughput, echo, isolation, quit }

app.whenReady().then(async () => {
  try {
    await suites[suite]()
    trace('exit(0)')
    if (suite !== 'quit') app.exit(0)
  } catch (error) {
    result({ error: String(error?.stack ?? error) })
    app.exit(1)
  }
})
