#!/usr/bin/env node
/**
 * OXE-126: @xterm/xterm against libghostty WASM (ghostty-web), isolated from the app.
 *
 *   node scripts/bench-terminal-renderer.mjs --self-test
 *   node scripts/bench-terminal-renderer.mjs --ghostty-root=<ghostty-web package dir> [--rounds=5] [--parity]
 *
 * Measuring needs a display (xvfb on CI). --parity overwrites the system clipboard.
 * Each sample gets a new Electron process with its own temporary profile.
 * Results and how to read them: docs/perf/terminal-renderer.md
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, EOL, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(import.meta.url)
const ROOT = resolve(SCRIPT, '..', '..')
const MB = 1e6
const LOADS = { stream: '10 MB ANSI stream', table: '10 000-line 256-colour table', echo: '200 keys echo' }
const ENGINES = ['xterm-webgl', 'xterm-dom', 'ghostty']
// The grid and the defaults of src/store/terminal-prefs.store.ts.
const SETTINGS = {
  cols: 120, rows: 30, scrollback: 10_000, streamBytes: 10 * MB, tableLines: 10_000, keys: 200,
  fontFamily: 'Cascadia Mono, JetBrains Mono, DejaVu Sans Mono, Consolas, monospace', fontSize: 16, lineHeight: 1.4,
  theme: { background: '#131714', foreground: '#e7efe9', cursor: '#f5a939' }
}

const flag = name => process.argv.includes(`--${name}`)
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const half = sorted.length >> 1
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
}

// The two generators also run inside the page, so they use nothing from this module.
function ansiStream(targetBytes) {
  const esc = String.fromCharCode(27)
  const crlf = String.fromCharCode(13, 10)
  const encoder = new TextEncoder()
  const lines = []
  let bytes = 0
  for (let i = 0; bytes < targetBytes; i++) {
    const extra = i % 17 === 0 ? ' 日本語 ação' : i % 13 === 0 ? `${esc}[38;2;${i % 256};160;90m rgb` : ''
    const line = `${esc}[2m${String(i).padStart(7, '0')}${esc}[0m ${esc}[${31 + (i % 6)}mINFO${esc}[0m ` +
      `${esc}[1mbuild${esc}[22m src/components/module-${i % 97}.ts ${esc}[4mcompiled${esc}[24m in ${i % 1000} ms${extra}${esc}[0m${esc}[K${crlf}`
    lines.push(line)
    bytes += encoder.encode(line).length
  }
  return { text: lines.join(''), bytes, lines: lines.length }
}

function colourTable(count) {
  const esc = String.fromCharCode(27)
  const crlf = String.fromCharCode(13, 10)
  const lines = []
  for (let row = 0; row < count; row++) {
    let line = ''
    for (let col = 0; col < 12; col++) {
      line += `${esc}[38;5;${(row + col * 7) % 256};48;5;${(row * 3 + col * 19) % 256}m${String(row * 12 + col).padStart(9, '.')}`
    }
    lines.push(`${line}${esc}[0m${crlf}`)
  }
  const text = lines.join('')
  return { text, bytes: new TextEncoder().encode(text).length, lines: count }
}

/** Runs in the sandboxed page. */
async function pageMain(config, makeStream, makeTable) {
  const { engine, settings } = config
  const host = document.getElementById('host')
  const ghostty = engine === 'ghostty'
  const options = {
    cols: settings.cols, rows: settings.rows, fontFamily: settings.fontFamily, fontSize: settings.fontSize,
    lineHeight: settings.lineHeight, cursorBlink: false, cursorStyle: 'bar', theme: settings.theme,
    scrollback: ghostty ? config.ghosttyLimit : settings.scrollback
  }
  let term
  let renderer = 'canvas-2d'
  if (ghostty) {
    const lib = await import('bench://app/ghostty/ghostty-web.js')
    await lib.init()
    term = new lib.Terminal(options)
    term.open(host)
  } else {
    const { Terminal } = await import('bench://app/xterm.mjs')
    const { Unicode11Addon } = await import('bench://app/unicode.mjs')
    term = new Terminal({ ...options, allowProposedApi: true, minimumContrastRatio: 4.5, rescaleOverlappingGlyphs: true, screenReaderMode: config.parity })
    term.loadAddon(new Unicode11Addon())
    term.open(host)
    term.unicode.activeVersion = '11'
    renderer = 'dom'
    if (engine === 'xterm-webgl') {
      const { WebglAddon } = await import('bench://app/webgl.mjs')
      const addon = new WebglAddon()
      addon.onContextLoss(() => { renderer = 'webgl-context-lost' })
      term.loadAddon(addon) // throws without WebGL2: never report the DOM renderer as WebGL
      renderer = 'webgl'
    }
  }

  const received = []
  const echo = []
  let echoing = false
  let keyAt = 0
  const painted = () => new Promise(done => requestAnimationFrame(() => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => { channel.port1.close(); done(performance.now()) }
    channel.port2.postMessage(0)
  }))
  const write = text => new Promise(done => {
    if (ghostty) { term.write(text); done() } else term.write(text, done)
  })
  window.addEventListener('keydown', event => { keyAt = event.timeStamp }, true)
  term.onData(data => {
    received.push(data)
    if (!echoing) return
    const started = keyAt
    void write(data).then(painted).then(end => echo.push(end - started))
  })

  const lineText = y => {
    if (!ghostty) return term.buffer.active.getLine(term.buffer.active.baseY + y)?.translateToString(true) ?? ''
    return (term.wasmTerm.getLine(y) ?? []).map(cell => (cell.codepoint ? String.fromCodePoint(cell.codepoint) : ' ')).join('').trimEnd()
  }

  window.bench = {
    write: async text => { await write(text); await painted() },
    focus: () => term.focus(),
    startEcho: () => { echoing = true },
    echo: () => echo,
    take: () => received.splice(0).join(''),
    selection: () => term.getSelection(),
    select: () => { term.select(0, 0, 5); return term.getSelection() },
    selectAll: () => { term.selectAll(); return term.getSelection() },
    clearSelection: () => term.clearSelection(),
    cursorX: () => (ghostty ? term.wasmTerm.getCursor().x : term.buffer.active.cursorX),
    hasOscHandler: () => typeof term.parser?.registerOscHandler === 'function',
    grid() {
      const { x, y, width, height } = host.querySelector(ghostty ? 'canvas' : '.xterm-screen').getBoundingClientRect()
      return { x, y, width, height }
    },
    anchor() {
      const focused = document.activeElement.getBoundingClientRect()
      const grid = this.grid()
      return { col: (focused.x - grid.x) / (grid.width / settings.cols), row: (focused.y - grid.y) / (grid.height / settings.rows) }
    },
    state() {
      let end = false
      for (let y = 0; y < settings.rows; y++) end ||= lineText(y).includes('BENCH-END')
      return { renderer, end, grid: this.grid(), retained: ghostty ? term.getScrollbackLength() : term.buffer.active.baseY }
    },
    async run(load) {
      const data = load === 'stream' ? makeStream(settings.streamBytes) : makeTable(settings.tableLines)
      const chunks = []
      for (let at = 0; at < data.text.length; at += 65536) chunks.push(data.text.slice(at, at + 65536))
      chunks.push('BENCH-END')
      await painted()
      const frames = []
      let previous = performance.now()
      let sampling = true
      const sample = () => {
        const now = performance.now()
        frames.push(now - previous)
        previous = now
        if (sampling) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      const started = performance.now()
      if (ghostty) {
        // Its write is synchronous and its callback waits for a frame. Yield every 12 ms, as xterm's WriteBuffer does.
        let slice = started
        for (const chunk of chunks) {
          term.write(chunk)
          if (performance.now() - slice >= 12) {
            await new Promise(done => setTimeout(done))
            slice = performance.now()
          }
        }
      } else {
        await new Promise(done => chunks.forEach((chunk, i) => term.write(chunk, i === chunks.length - 1 ? done : undefined)))
      }
      const parsedMs = performance.now() - started
      const paintedMs = (await painted()) - started
      sampling = false
      frames.push(performance.now() - previous)
      return { bytes: data.bytes, lines: data.lines, parsedMs, paintedMs, frames }
    }
  }
  term.focus()
  await painted()
}

async function measure(win, electron, config) {
  const page = code => win.webContents.executeJavaScript(code)
  const cdp = (method, params) => win.webContents.debugger.sendCommand(method, params)
  const pause = ms => new Promise(done => setTimeout(done, ms))
  win.webContents.debugger.attach('1.3')
  win.focus()
  win.webContents.focus()
  await page('bench.focus()')

  if (config.parity) return await probeParity(win, electron, { page, cdp, pause })

  const memory = async () => {
    await cdp('HeapProfiler.collectGarbage')
    await pause(800)
    const metrics = electron.app.getAppMetrics()
    const size = list => list.reduce((sum, metric) => sum + metric.memory.workingSetSize * 1024, 0) / MB
    return { all: size(metrics), renderer: size(metrics.filter(metric => metric.pid === win.webContents.getOSProcessId())) }
  }
  const before = await memory()
  let result
  if (config.load === 'echo') {
    await page('bench.startEcho()')
    for (let i = 0; i < config.settings.keys; i++) {
      const key = String.fromCharCode(97 + (i % 26))
      const base = { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: 65 + (i % 26) }
      await cdp('Input.dispatchKeyEvent', { ...base, type: 'keyDown', text: key, unmodifiedText: key })
      await cdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
      await pause(34 + (i % 17)) // moves the key across the phases of a 60 Hz frame
    }
    await pause(1000)
    const samples = await page('bench.echo()')
    if (samples.length !== config.settings.keys) throw new Error(`echo painted ${samples.length} of ${config.settings.keys} keys`)
    result = { mbps: null, p50: percentile(samples, 50), p95: percentile(samples, 95) }
  } else {
    const { frames, ...run } = await page(`bench.run('${config.load}')`)
    result = { ...run, mbps: run.bytes / MB / (run.paintedMs / 1000), p50: percentile(frames, 50), p95: percentile(frames, 95) }
  }
  const after = await memory()
  const state = await page('bench.state()')
  if (config.load !== 'echo' && !state.end) throw new Error('the end marker is not on screen')

  // A renderer that draws nothing would win every row.
  const pixels = (await win.webContents.capturePage()).toBitmap()
  let lit = 0
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 80 || pixels[i + 1] > 80 || pixels[i + 2] > 80) lit++
  if (lit < 50) throw new Error(`blank capture: ${lit} lit pixels`)
  return { ...result, ...state, lit, mb: after.all, rendererMb: after.renderer, deltaMb: after.all - before.all }
}

async function probeParity(win, { clipboard }, { page, cdp, pause }) {
  const esc = String.fromCharCode(27)
  const crlf = String.fromCharCode(13, 10)
  const write = text => page(`bench.write(${JSON.stringify(text)})`)
  const result = {}
  const probe = async (name, run) => {
    try { result[name] = await run() } catch (error) { result[name] = { pass: false, error: String(error) } }
  }
  await write(`HELLO parity${crlf}`)
  await probe('selectionApi', async () => {
    const got = await page('bench.select()')
    return { pass: got === 'HELLO', got }
  })
  await probe('selectionMouse', async () => {
    await page('bench.clearSelection()')
    const grid = await page('bench.grid()')
    const cell = grid.width / SETTINGS.cols
    const y = Math.round(grid.y + grid.height / SETTINGS.rows / 2)
    const mouse = (type, x, buttons) => cdp('Input.dispatchMouseEvent', { type, x: Math.round(x), y, button: 'left', buttons, clickCount: 1 })
    await clipboard.writeText('sentinel')
    await mouse('mousePressed', grid.x + cell * 0.2, 1)
    await mouse('mouseMoved', grid.x + cell * 2.5, 1)
    await mouse('mouseMoved', grid.x + cell * 4.8, 1)
    await mouse('mouseReleased', grid.x + cell * 4.8, 0)
    await pause(200)
    const got = await page('bench.selection()')
    return { pass: got === 'HELLO', got, copiedOnRelease: (await clipboard.readText()) === 'HELLO' }
  })
  await probe('clipboardCopy', async () => {
    await page('bench.select()')
    await clipboard.writeText('sentinel')
    await page('bench.focus()')
    win.webContents.copy()
    await pause(500)
    const got = await clipboard.readText()
    return { pass: got === 'HELLO', got }
  })
  await probe('clipboardBracketedPaste', async () => {
    await page('bench.clearSelection()')
    await write(`${esc}[?2004h`)
    await clipboard.writeText('pasted')
    await page('bench.focus()')
    await page('bench.take()')
    win.webContents.paste()
    await pause(500)
    const got = await page('bench.take()')
    return { pass: got === `${esc}[200~pasted${esc}[201~`, got }
  })
  await probe('imeCommit', async () => {
    await page('bench.focus()')
    await page('bench.take()')
    await cdp('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 })
    await pause(100)
    await cdp('Input.insertText', { text: '日本' })
    await pause(500)
    const got = await page('bench.take()')
    return { pass: got === '日本', got }
  })
  await probe('imeAnchor', async () => {
    await write(`${esc}[8;21H`) // an IME opens its candidates at the focused element
    await pause(300)
    const got = await page('bench.anchor()')
    return { pass: Math.abs(got.col - 20) < 1.5 && Math.abs(got.row - 7) < 1.5, got }
  })
  await probe('a11yText', async () => {
    await write(`A11Y-MARKER${crlf}`)
    await pause(1500)
    await cdp('Accessibility.enable')
    const tree = JSON.stringify(await cdp('Accessibility.getFullAXTree'))
    return { pass: tree.includes('A11Y-MARKER') }
  })
  await probe('wideCharacter', async () => {
    await write(`${crlf}😀`)
    const got = await page('bench.cursorX()')
    return { pass: got === 2, got }
  })
  await probe('osc52Hook', async () => ({ pass: await page('bench.hasOscHandler()') }))
  await probe('selectAllHistory', async () => {
    await write(`${crlf}FIRST-LINE${crlf}${`filler${crlf}`.repeat(50)}LAST-LINE`)
    const got = await page('bench.selectAll()')
    const first = got.includes('FIRST-LINE')
    const last = got.includes('LAST-LINE')
    return { pass: first && last, first, last, characters: got.length }
  })
  return result
}

/** The Electron main process of one sample. Not awaited at top level: ready waits for this module to finish. */
function runChild(electron, config) {
  const { app, BrowserWindow, protocol } = electron
  app.setPath('userData', join(config.dir, 'profile'))
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  protocol.registerSchemesAsPrivileged([{ scheme: 'bench', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
  const finish = result => {
    writeFileSync(config.out, JSON.stringify(result))
    app.exit(0)
  }
  const start = async () => {
    await app.whenReady()
    const vendor = name => join(ROOT, 'node_modules', '@xterm', name)
    const files = new Map([
      ['/xterm.mjs', join(vendor('xterm'), 'lib', 'xterm.mjs')],
      ['/xterm.css', join(vendor('xterm'), 'css', 'xterm.css')],
      ['/webgl.mjs', join(vendor('addon-webgl'), 'lib', 'addon-webgl.mjs')],
      ['/unicode.mjs', join(vendor('addon-unicode11'), 'lib', 'addon-unicode11.mjs')]
    ])
    if (config.ghosttyRoot) {
      files.set('/ghostty/ghostty-web.js', join(config.ghosttyRoot, 'dist', 'ghostty-web.js'))
      files.set('/ghostty/ghostty-vt.wasm', join(config.ghosttyRoot, 'ghostty-vt.wasm'))
    }
    const html = `<!doctype html><meta charset='utf-8'><link rel='stylesheet' href='/xterm.css'>` +
      `<body style='margin:0;overflow:hidden;background:${SETTINGS.theme.background}'><div id='host'></div>` +
      `<script type='module'>${pageMain.toString()}; window.ready = pageMain(${JSON.stringify(config)}, (${ansiStream.toString()}), (${colourTable.toString()}));` +
      `window.ready.catch(() => undefined)</script>`
    protocol.handle('bench', request => {
      const path = new URL(request.url).pathname
      if (path === '/') return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      const file = files.get(path)
      if (!file) return new Response('not found', { status: 404 })
      const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
      return new Response(readFileSync(file), { headers: { 'content-type': type } })
    })
    const win = new BrowserWindow({
      width: 1280, height: 1000, show: true, frame: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    // The candidate is third-party code: nothing leaves the page.
    win.webContents.session.webRequest.onBeforeRequest((details, done) => {
      done({ cancel: !['bench:', 'data:', 'devtools:'].includes(new URL(details.url).protocol) })
    })
    win.webContents.on('render-process-gone', (_event, details) => finish({ error: `renderer gone: ${details.reason}` }))
    await win.loadURL('bench://app/')
    await win.webContents.executeJavaScript('window.ready.then(() => true)')
    const result = await measure(win, electron, config)
    finish({ ...result, chromium: process.versions.chrome, gpu: app.getGPUFeatureStatus() })
  }
  start().catch(error => finish({ error: String(error?.stack ?? error) }))
}

function launch(electronPath, config) {
  const dir = mkdtempSync(join(tmpdir(), 'oxe-term-bench-'))
  try {
    const out = join(dir, 'result.json')
    const input = join(dir, 'config.json')
    writeFileSync(input, JSON.stringify({ ...config, dir, out, settings: SETTINGS }))
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('OXESPACE_')))
    // The disposable CI runner has no setuid sandbox helper.
    const switches = process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []
    const child = spawnSync(electronPath, [...switches, SCRIPT, `--child=${input}`], { env, encoding: 'utf8', timeout: 150_000, maxBuffer: 16 * MB })
    if (existsSync(out)) return JSON.parse(readFileSync(out, 'utf8'))
    return { error: `no result (exit ${child.status}, ${child.error?.message ?? child.signal}): ${child.stderr?.slice(-1500)}` }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

function runBenchmark() {
  const ghosttyRoot = option('ghostty-root') && resolve(option('ghostty-root'))
  if (!ghosttyRoot || !existsSync(join(ghosttyRoot, 'dist', 'ghostty-web.js'))) {
    console.error('Pass --ghostty-root=<ghostty-web package dir>. For the check that needs neither it nor a display, use --self-test.')
    return 2
  }
  const rounds = Number(option('rounds') ?? 5)
  if (!Number.isInteger(rounds) || rounds < 1) {
    console.error('--rounds must be a positive integer')
    return 2
  }
  const electronPath = createRequire(import.meta.url)('electron')
  const version = dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
  const log = (name, value) => console.log(`[bench] ${name} ${JSON.stringify(value)}`)
  log('environment', {
    run: process.env.GITHUB_RUN_ID, platform: process.platform, os: release(), cpu: cpus()[0]?.model, cores: cpus().length,
    electron: version(join(ROOT, 'node_modules', 'electron')), xterm: version(join(ROOT, 'node_modules', '@xterm', 'xterm')),
    ghostty: version(ghosttyRoot), settings: SETTINGS, rounds
  })
  const run = config => launch(electronPath, { ghosttyRoot, parity: false, ...config })

  // ghostty-web hands scrollback to a limit in bytes. Show what the app's value keeps, then match the 10 000 lines.
  log('ghostty-unadjusted', run({ engine: 'ghostty', load: 'table', ghosttyLimit: SETTINGS.scrollback }))
  const limits = {}
  for (const load of ['stream', 'table']) {
    let limit = 16 * MB
    let best = { limit, distance: Infinity }
    for (let attempt = 0; attempt < 4; attempt++) {
      const pilot = run({ engine: 'ghostty', load, ghosttyLimit: limit })
      log('calibration', { load, limit, retained: pilot.retained, error: pilot.error })
      if (!pilot.retained) break
      const distance = Math.abs(pilot.retained - SETTINGS.scrollback)
      if (distance < best.distance) best = { limit, distance }
      if (distance <= SETTINGS.scrollback * 0.03) break
      limit = Math.round((limit * SETTINGS.scrollback) / pilot.retained)
    }
    limits[load] = best.limit
  }
  limits.echo = limits.stream

  const samples = []
  for (let round = 0; round < rounds; round++) {
    const order = ENGINES.map((_, i) => ENGINES[(i + round) % ENGINES.length])
    for (const load of Object.keys(LOADS)) {
      for (const engine of order) {
        const sample = { round, load, engine, ...run({ engine, load, ghosttyLimit: limits[load] }) }
        samples.push(sample)
        log('sample', { ...sample, gpu: round === 0 && load === 'stream' ? sample.gpu : undefined })
      }
    }
  }
  if (flag('parity')) {
    for (const engine of ENGINES) log('parity', { engine, ...run({ engine, parity: true, ghosttyLimit: limits.stream }) })
  }

  console.log('| Load | Renderer | MB/s [min; max] | p50 ms | p95 ms [min; max] | MB | renderer MB | delta MB | history lines | samples |')
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const [load, label] of Object.entries(LOADS)) {
    for (const engine of ENGINES) {
      const good = samples.filter(sample => sample.load === load && sample.engine === engine && !sample.error)
      const cell = (key, spread = false) => {
        const values = good.map(sample => sample[key]).filter(Number.isFinite)
        if (!values.length) return 'n/a'
        const range = spread ? ` [${Math.min(...values).toFixed(1)}; ${Math.max(...values).toFixed(1)}]` : ''
        return `${median(values).toFixed(1)}${range}`
      }
      const cells = [label, engine, cell('mbps', true), cell('p50'), cell('p95', true), cell('mb'), cell('rendererMb'), cell('deltaMb'), cell('retained'), `${good.length}/${rounds}`]
      console.log(`| ${cells.join(' | ')} |`)
    }
  }
  return samples.some(sample => sample.error) ? 1 : 0
}

/** No display, Electron window, dependency or libghostty: the loads, the statistics and the page source. */
function selfTest() {
  const check = (ok, what) => {
    if (!ok) throw new Error(`self-test failed: ${what}`)
  }
  const stream = ansiStream(SETTINGS.streamBytes)
  check(stream.bytes >= SETTINGS.streamBytes && stream.bytes < SETTINGS.streamBytes + 500, 'stream size')
  check(Buffer.byteLength(stream.text) === stream.bytes, 'stream byte count')
  const table = colourTable(SETTINGS.tableLines)
  check(table.text.split(String.fromCharCode(10)).length - 1 === SETTINGS.tableLines, 'table lines')
  const colours = new Set([...table.text.slice(0, 200_000).matchAll(/38;5;([0-9]+);/g)].map(match => match[1]))
  check(colours.size === 256, 'table colours')
  check(percentile(Array.from({ length: 200 }, (_, i) => i + 1), 95) === 190, 'p95 of 200 keys')
  check(median([3, 1, 2]) === 2 && median([4, 1, 3, 2]) === 2.5, 'median')
  // The page gets these functions as source, so each has to compile on its own.
  for (const source of [pageMain, ansiStream, colourTable]) new Function(`return (${source.toString()})`)
  return `self-test ok: ${stream.bytes} stream bytes, ${table.lines} table lines, ${SETTINGS.keys} keys`
}

if (flag('self-test')) {
  // Also runs when process.execPath is Electron, so it exits before anything asks for a window.
  let code = 0
  let message
  try {
    message = selfTest()
  } catch (error) {
    code = 1
    message = String(error)
  }
  process.stdout.write(message + EOL, () => process.exit(code))
} else if (option('child')) {
  const config = JSON.parse(readFileSync(option('child'), 'utf8'))
  runChild(await import('electron'), config)
} else {
  process.exitCode = runBenchmark()
}
